/**
 * Connections source — normalize the bearer's connected-account data into the
 * brain's "observation" shape for the auto-index dreaming loop (ADR-0012).
 *
 * PASS-THROUGH, never a store: the route reads Gmail / Calendar live via Composio
 * and forwards normalized one-liners; nothing is persisted on the website side
 * (data lives nowhere → nothing to leak). The brain Q23-screens + ingests; this
 * module is the fetch + normalize half, behind the same injected `ConnectorDeps`
 * seam the proactive/inbound reads use (so it's unit-tested without a DB or live
 * Composio). Pure of transport.
 *
 * Contract: docs/contracts/connections-source-contract.md.
 */

import {
  CALENDAR_LIST_TOOL,
  CALENDAR_TOOLKIT,
  GMAIL_FETCH_TOOL,
  GMAIL_TOOLKIT,
  rowsFromResult,
  toEpochMs,
  type ConnectorDeps,
} from "@/lib/agent/connectors";

export type ObservationKind = "email" | "calendar";

export interface Observation {
  /** Stable provenance + idempotency key: `gmail:<id>` / `gcal:<id>`. */
  sourceId: string;
  /** One-line metadata + snippet (no bodies/attachments/HTML). */
  text: string;
  kind: ObservationKind;
  /** Event time, ms epoch (received / start). */
  ts: number;
}

export interface ObservationsResult {
  observations: Observation[];
  /** ms cursor to resume from; null when the window is exhausted. */
  nextCursor: number | null;
}

/** Default + hard cap on how many observations one page returns. */
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;
/** Snippet length cap — a snippet, never a full body. */
const SNIPPET_MAX = 160;

const GMAIL_ROW_KEYS = ["messages", "items", "results", "emails", "data"] as const;
const CALENDAR_ROW_KEYS = ["events", "items", "results", "data"] as const;

// ---- small value guards (mirror connectors.ts; kept local so the module is pure) ----

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
function firstString(row: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const s = asString(row[key]);
    if (s !== undefined) return s;
  }
  return undefined;
}
function truncate(s: string, max: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/** Read an event start: flat keys, then nested gcal `{ dateTime | date }`. */
function readEventStartMs(row: Record<string, unknown>): number | undefined {
  for (const key of ["startTime", "start_time", "startMs"] as const) {
    const ms = toEpochMs(row[key]);
    if (ms !== undefined) return ms;
  }
  const start = row.start;
  if (isRecord(start)) return toEpochMs(start.dateTime ?? start.date_time ?? start.date);
  return toEpochMs(start);
}

/** Join the first few attendee names/emails (`Sam, priya@x.com`), or undefined. */
function readAttendees(row: Record<string, unknown>): string | undefined {
  const list = row.attendees ?? row.attendeeList ?? row.attendee_list;
  if (!Array.isArray(list)) return undefined;
  const names = list
    .map((a) => (isRecord(a) ? firstString(a, ["displayName", "display_name", "name", "email"]) : asString(a)))
    .filter((s): s is string => s !== undefined)
    .slice(0, 5);
  return names.length > 0 ? names.join(", ") : undefined;
}

// ---- defense-in-depth secret screen (the brain's Q23 is the CANONICAL boundary;
//      this just avoids forwarding obvious secrets — never reimplement refusal) ----

const SECRET_RX =
  /\b(verification code|one[-\s]?time (?:code|password|passcode|pin)|otp\b|passcode is|password is|your code is|2fa code|cvv|card number|ssn\b|social security number|routing number|account number)\b/i;

/** True when the line obviously carries a secret — dropped before forwarding. */
export function looksLikeSecret(text: string): boolean {
  return SECRET_RX.test(text);
}

// ---- pure mappers: raw Composio row → Observation (or null if unusable) ----

export function emailToObservation(row: unknown): Observation | null {
  if (!isRecord(row)) return null;
  const id = firstString(row, ["messageId", "message_id", "id", "threadId", "thread_id"]);
  const from = firstString(row, ["from", "sender", "fromEmail", "from_email"]);
  const subject = firstString(row, ["subject", "title"]);
  if (id === undefined || from === undefined || subject === undefined) return null;
  const snippet = firstString(row, ["snippet", "preview", "messageText", "message_text", "body"]);
  const ts =
    toEpochMs(
      row.receivedMs ?? row.messageTimestamp ?? row.message_timestamp ?? row.internalDate ?? row.date,
    ) ?? 0;
  const text = `Email from ${from}: ${subject}${snippet !== undefined ? ` — ${truncate(snippet, SNIPPET_MAX)}` : ""}`;
  return { sourceId: `gmail:${id}`, text, kind: "email", ts };
}

export function calendarToObservation(row: unknown): Observation | null {
  if (!isRecord(row)) return null;
  const id = firstString(row, ["id", "eventId", "event_id", "iCalUID", "ical_uid"]);
  const title = firstString(row, ["title", "summary", "name"]);
  const startMs = readEventStartMs(row);
  if (id === undefined || title === undefined || startMs === undefined) return null;
  const attendees = readAttendees(row);
  const when = new Date(startMs).toISOString().slice(0, 16).replace("T", " ");
  const text = `${title}${attendees !== undefined ? ` with ${attendees}` : ""} at ${when}`;
  return { sourceId: `gcal:${id}`, text, kind: "calendar", ts: startMs };
}

// ---- orchestration ----

/** Composio's GMAIL_FETCH_EMAILS THROWS for max_results >= ~50 (verified live) —
 *  page in safe chunks and accumulate via page_token to honor a large `limit`. */
const PAGE_SIZE = 40;
/** Backstop so a runaway page loop can't spin (limit<=MAX_LIMIT → <=5 real pages). */
const MAX_PAGES = 8;

function clampLimit(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

/** The forward page token a Composio list result carries, if any. */
function nextPageToken(result: { data: Record<string, unknown> }): string | undefined {
  const t = result.data.nextPageToken ?? result.data.next_page_token;
  return typeof t === "string" && t.length > 0 ? t : undefined;
}

/**
 * Fetch up to `limit` emails in the (since, before] window, NEWEST-first, paging
 * in PAGE_SIZE chunks via page_token so a large `limit` never trips Composio's
 * per-call cap (>=50 throws). `since` → `after:`, `before` → `before:`, so the
 * caller can walk backward through history by passing the previous nextCursor as
 * `before`. `after:0`/empty since means an unbounded (recent-first) fetch.
 */
async function fetchEmails(
  userId: string,
  deps: ConnectorDeps,
  sinceMs: number,
  beforeMs: number | null,
  limit: number,
): Promise<Observation[]> {
  const clauses: string[] = [];
  if (sinceMs > 0) clauses.push(`after:${Math.floor(sinceMs / 1000)}`);
  if (beforeMs && beforeMs > 0) clauses.push(`before:${Math.floor(beforeMs / 1000)}`);
  const query = clauses.join(" ");

  const out: Observation[] = [];
  let pageToken: string | undefined;
  for (let page = 0; out.length < limit && page < MAX_PAGES; page++) {
    let result;
    try {
      result = await deps.executeTool(userId, GMAIL_FETCH_TOOL, {
        query,
        max_results: Math.min(PAGE_SIZE, limit - out.length),
        ...(pageToken ? { page_token: pageToken } : {}),
      });
    } catch {
      break;
    }
    const rows = rowsFromResult(result, GMAIL_ROW_KEYS);
    out.push(...rows.map(emailToObservation).filter((o): o is Observation => o !== null));
    pageToken = nextPageToken(result);
    if (!pageToken || rows.length === 0) break;
  }
  return out;
}

async function fetchEvents(
  userId: string,
  deps: ConnectorDeps,
  sinceMs: number,
  beforeMs: number | null,
  limit: number,
): Promise<Observation[]> {
  try {
    // since=0 must NOT become timeMin:1970 (that returns the oldest events, asc).
    // For an unbounded fetch, floor to a recent window so "who you meet" is recent.
    // Calendar is a bounded window read (event volume is small — no deep paging);
    // `before` narrows the ceiling via timeMax.
    const timeMinMs = sinceMs > 0 ? sinceMs : Date.now() - 30 * 24 * 60 * 60 * 1000;
    const result = await deps.executeTool(userId, CALENDAR_LIST_TOOL, {
      timeMin: new Date(timeMinMs).toISOString(),
      ...(beforeMs && beforeMs > 0 ? { timeMax: new Date(beforeMs).toISOString() } : {}),
      single_events: true,
      order_by: "startTime",
      max_results: Math.min(PAGE_SIZE, limit),
    });
    return rowsFromResult(result, CALENDAR_ROW_KEYS)
      .map(calendarToObservation)
      .filter((o): o is Observation => o !== null);
  } catch {
    return [];
  }
}

/**
 * Fetch the bearer's observations in the `(since, before)` window, normalized +
 * bounded. `before` enables BACKWARD / deep paging: each call returns the newest
 * `limit` observations older than `before` (absent → newest overall), and
 * `nextCursor` is the OLDEST ts returned — the caller passes it back as `before`
 * to walk further into history, stopping when `nextCursor` is null. Reads only
 * active toolkits; unconnected → nothing (never an error). Drops obvious secrets,
 * de-dupes by stable `sourceId`. Never throws.
 */
export async function fetchObservations(
  userId: string,
  deps: ConnectorDeps,
  opts: { since: number; before?: number | null; limit: number },
): Promise<ObservationsResult> {
  const limit = clampLimit(opts.limit);
  const since = Number.isFinite(opts.since) && opts.since > 0 ? Math.floor(opts.since) : 0;
  const before =
    opts.before != null && Number.isFinite(opts.before) && opts.before > 0 ? Math.floor(opts.before) : null;

  let active: Set<string>;
  try {
    active = await deps.activeToolkits(userId);
  } catch {
    return { observations: [], nextCursor: null };
  }

  const fetched: Observation[] = [];
  if (active.has(GMAIL_TOOLKIT)) fetched.push(...(await fetchEmails(userId, deps, since, before, limit)));
  if (active.has(CALENDAR_TOOLKIT)) fetched.push(...(await fetchEvents(userId, deps, since, before, limit)));

  const seen = new Set<string>();
  const cleaned = fetched
    .filter((o) => o.ts > since && (before === null || o.ts < before))
    .filter((o) => !looksLikeSecret(o.text))
    .filter((o) => (seen.has(o.sourceId) ? false : (seen.add(o.sourceId), true)));

  // Newest-first, take the top `limit`; cursor = the OLDEST of those (walk older).
  cleaned.sort((a, b) => b.ts - a.ts);
  const page = cleaned.slice(0, limit);
  const nextCursor = page.length >= limit && page.length > 0 ? page[page.length - 1].ts : null;

  // Emit oldest→newest within the page (stable, matches the contract example).
  const observations = [...page].sort((a, b) => a.ts - b.ts);
  return { observations, nextCursor };
}
