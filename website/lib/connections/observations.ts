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

function clampLimit(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

async function fetchEmails(
  userId: string,
  deps: ConnectorDeps,
  sinceMs: number,
  limit: number,
): Promise<Observation[]> {
  try {
    const afterSec = Math.max(0, Math.floor(sinceMs / 1000));
    // Gmail REJECTS `after:0` (returns zero rows) — an unbounded / since=0 fetch
    // must be an EMPTY query, which returns the most-recent emails. Only add the
    // `after:` clause for a real lower bound.
    const query = afterSec > 0 ? `after:${afterSec}` : "";
    const result = await deps.executeTool(userId, GMAIL_FETCH_TOOL, {
      query,
      max_results: limit,
    });
    return rowsFromResult(result, GMAIL_ROW_KEYS)
      .map(emailToObservation)
      .filter((o): o is Observation => o !== null);
  } catch {
    return [];
  }
}

async function fetchEvents(
  userId: string,
  deps: ConnectorDeps,
  sinceMs: number,
  limit: number,
): Promise<Observation[]> {
  try {
    // since=0 must NOT become timeMin:1970 (that returns the oldest events, asc).
    // For an unbounded fetch, floor to a recent window so "who you meet" is recent.
    const timeMinMs = sinceMs > 0 ? sinceMs : Date.now() - 30 * 24 * 60 * 60 * 1000;
    const result = await deps.executeTool(userId, CALENDAR_LIST_TOOL, {
      timeMin: new Date(timeMinMs).toISOString(),
      single_events: true,
      order_by: "startTime",
      max_results: limit,
    });
    return rowsFromResult(result, CALENDAR_ROW_KEYS)
      .map(calendarToObservation)
      .filter((o): o is Observation => o !== null);
  } catch {
    return [];
  }
}

/**
 * Fetch the bearer's recent observations since `since`, normalized + bounded.
 * Reads only the toolkits the user has active; an unconnected account simply
 * contributes nothing (never an error). Drops obvious secrets, de-dupes by
 * stable `sourceId`, sorts ascending by `ts`, caps at `limit`, and returns a
 * forward cursor (`nextCursor`) when more may remain. Never throws.
 */
export async function fetchObservations(
  userId: string,
  deps: ConnectorDeps,
  opts: { since: number; limit: number },
): Promise<ObservationsResult> {
  const limit = clampLimit(opts.limit);
  const since = Number.isFinite(opts.since) && opts.since > 0 ? Math.floor(opts.since) : 0;

  let active: Set<string>;
  try {
    active = await deps.activeToolkits(userId);
  } catch {
    return { observations: [], nextCursor: null };
  }

  const fetched: Observation[] = [];
  if (active.has(GMAIL_TOOLKIT)) fetched.push(...(await fetchEmails(userId, deps, since, limit)));
  if (active.has(CALENDAR_TOOLKIT)) fetched.push(...(await fetchEvents(userId, deps, since, limit)));

  const seen = new Set<string>();
  const cleaned = fetched
    .filter((o) => o.ts > since)
    .filter((o) => !looksLikeSecret(o.text))
    .filter((o) => (seen.has(o.sourceId) ? false : (seen.add(o.sourceId), true)))
    .sort((a, b) => a.ts - b.ts);

  const observations = cleaned.slice(0, limit);
  const nextCursor =
    observations.length >= limit && observations.length > 0
      ? observations[observations.length - 1].ts
      : null;
  return { observations, nextCursor };
}
