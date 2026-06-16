/**
 * Signal FETCH for proactive eri — the seam that makes the iMessage loop fire.
 *
 * The cron (app/api/v1/proactive/trigger) enumerates users, asks this module for
 * each user's recent signals (urgent email / upcoming meeting), then hands them to
 * the pure detectors (lib/proactive/detect). This file is the bridge between the
 * live Composio Gmail/Calendar tool results and the typed `EmailSignal` /
 * `CalendarSignal` shapes the detectors consume.
 *
 * Two layers, both kept honest:
 *   1. PURE mappers (`gmailMessagesToSignals`, `calendarEventsToSignals`) defensively
 *      narrow the raw `unknown` tool-result rows into typed signals. Every field is
 *      guarded; a malformed row is skipped, never thrown on. Fully unit-tested.
 *   2. `fetchSignalsForUser` orchestrates: confirm the user has active gmail +
 *      googlecalendar connections, read recent emails + upcoming events via the
 *      Composio tool path, map them, return typed signals. The Composio + SQL access
 *      is injected behind a `SignalDeps` seam (mirrors lib/imessage/inbound) so the
 *      orchestration is unit-tested with stubs.
 *
 * SAFETY CONTRACT: on ANY error, missing connection, or unconfigured Composio,
 * `fetchSignalsForUser` returns `{ emails: [], events: [] }`. It never throws — the
 * cron must not 500 because one user's connector hiccupped. The loop then simply
 * finds nothing to nudge about for that user this sweep.
 *
 * The live Composio Gmail/Calendar result shapes are best-effort: the mappers probe
 * the documented field names plus a few common aliases and skip anything that
 * doesn't narrow cleanly, so an unexpected shape degrades to "no signals", never to
 * a crash or a garbage trigger.
 */

import type { CalendarSignal, EmailSignal } from "./detect";

/** Composio toolkit slugs we read from (must match composio_accounts.toolkit). */
export const GMAIL_TOOLKIT = "gmail";
export const CALENDAR_TOOLKIT = "googlecalendar";

/** Composio tool slugs for the reads. Best-effort canonical names. */
export const GMAIL_FETCH_TOOL = "GMAIL_FETCH_EMAILS";
export const CALENDAR_LIST_TOOL = "GOOGLECALENDAR_EVENTS_LIST";

/** How far back to look for "recent" emails, and how far forward for events. */
export const LOOKBACK_MS = 60 * 60_000; // last ~60 min
export const LOOKAHEAD_MS = 60 * 60_000; // next ~60 min

/** Shape of a Composio tool execution result (subset we rely on). */
export interface ToolResult {
  data: Record<string, unknown>;
  error: string | null;
  successful: boolean;
}

/**
 * The IO `fetchSignalsForUser` needs — injected so the orchestration is testable
 * with stubs (no DB, no live Composio). Mirrors the injected-deps pattern in
 * lib/imessage/inbound.ts.
 */
export interface SignalDeps {
  /** Active toolkit slugs for this user (status='active' rows). */
  activeToolkits(userId: string): Promise<Set<string>>;
  /** Execute a Composio tool for this user. Returns the raw tool result. */
  executeTool(userId: string, slug: string, args: Record<string, unknown>): Promise<ToolResult>;
}

// ---- pure value guards -----------------------------------------------------

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Read the first present, non-empty string among candidate keys. */
function firstString(row: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const s = asString(row[key]);
    if (s !== undefined) return s;
  }
  return undefined;
}

/**
 * Coerce a value into epoch ms. Accepts a number (already ms, or seconds), or an
 * ISO / parseable date string. Returns undefined for anything unparseable, NaN, or
 * non-finite — so a bad timestamp skips the row rather than producing a junk signal.
 */
export function toEpochMs(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) {
    // Heuristic: a 10-digit-ish value is seconds, not ms (year ~2001–2286 in s).
    return v < 1e12 ? Math.round(v * 1000) : Math.round(v);
  }
  if (typeof v === "string" && v.length > 0) {
    const ms = Date.parse(v);
    return Number.isFinite(ms) ? ms : undefined;
  }
  return undefined;
}

/** Read a start timestamp: flat (string OR number) keys first, then nested gcal. */
function readEventStart(row: Record<string, unknown>): number | undefined {
  // Flat candidates — each may be an ISO string or an epoch number.
  for (const key of ["startTime", "start_time", "startMs"] as const) {
    const ms = toEpochMs(row[key]);
    if (ms !== undefined) return ms;
  }
  // Google Calendar nests start under { dateTime } (timed) or { date } (all-day).
  const start = row.start;
  if (isRecord(start)) {
    return toEpochMs(start.dateTime ?? start.date_time ?? start.date);
  }
  // A flat `start` that's itself a string/number.
  return toEpochMs(start);
}

// ---- pure mappers ----------------------------------------------------------

/**
 * Map raw Gmail message rows into `EmailSignal[]`. Defensive: each row must yield
 * an id, a from, and a subject; receivedMs falls back to now if absent (the email
 * is "recent" by construction of the query). Malformed rows are skipped silently.
 */
export function gmailMessagesToSignals(raw: unknown[], nowMs: number = Date.now()): EmailSignal[] {
  if (!Array.isArray(raw)) return [];
  const signals: EmailSignal[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const id = firstString(item, ["id", "messageId", "message_id", "threadId", "thread_id"]);
    const from = firstString(item, ["from", "sender", "fromEmail", "from_email"]);
    const subject = firstString(item, ["subject", "title"]);
    if (id === undefined || from === undefined || subject === undefined) continue;
    const snippet = firstString(item, ["snippet", "preview", "body", "messageText", "message_text"]);
    const receivedMs =
      toEpochMs(item.receivedMs ?? item.messageTimestamp ?? item.message_timestamp ?? item.internalDate ?? item.date) ??
      nowMs;
    signals.push({ id, from, subject, ...(snippet !== undefined ? { snippet } : {}), receivedMs });
  }
  return signals;
}

/**
 * Map raw Calendar event rows into `CalendarSignal[]`. Each row must yield an id,
 * a title, and a parseable start. Malformed rows are skipped silently.
 */
export function calendarEventsToSignals(raw: unknown[]): CalendarSignal[] {
  if (!Array.isArray(raw)) return [];
  const signals: CalendarSignal[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const id = firstString(item, ["id", "eventId", "event_id", "iCalUID", "ical_uid"]);
    const title = firstString(item, ["title", "summary", "name"]);
    const startMs = readEventStart(item);
    if (id === undefined || title === undefined || startMs === undefined) continue;
    signals.push({ id, title, startMs });
  }
  return signals;
}

// ---- tool-result unwrapping ------------------------------------------------

/**
 * Pull the array of rows out of a Composio tool result. Tool results put the
 * payload under `data`, and the row array lives under one of a few common keys
 * (`messages`, `events`, `items`, `results`) — or `data` is itself an array. Any
 * non-array shape yields []. Pure.
 */
export function rowsFromResult(result: ToolResult | undefined, keys: readonly string[]): unknown[] {
  if (!result || !result.successful || result.error) return [];
  const data: unknown = result.data;
  if (Array.isArray(data)) return data;
  if (!isRecord(data)) return [];
  for (const key of keys) {
    const v = data[key];
    if (Array.isArray(v)) return v;
  }
  // Some tools nest one more level, e.g. data.response_data.messages.
  for (const v of Object.values(data)) {
    if (isRecord(v)) {
      for (const key of keys) {
        const inner = v[key];
        if (Array.isArray(inner)) return inner;
      }
    }
  }
  // Successful result, no error, yet no row array under any known key: a likely
  // Composio schema drift. Surface it structured so it's visible in logs rather
  // than silently degrading to "0 nudges". Contract is unchanged — still [].
  console.log(
    JSON.stringify({
      event: "proactive.signal_unpack_empty",
      keys,
      dataKeys: Object.keys(data),
    }),
  );
  return [];
}

const GMAIL_ROW_KEYS = ["messages", "items", "results", "emails", "data"] as const;
const CALENDAR_ROW_KEYS = ["events", "items", "results", "data"] as const;

// ---- orchestration ---------------------------------------------------------

const EMPTY: { emails: EmailSignal[]; events: CalendarSignal[] } = { emails: [], events: [] };

/**
 * Fetch one user's recent email + upcoming calendar signals via Composio.
 *
 * Never throws and never propagates a connector failure: a missing connection,
 * unconfigured Composio, a thrown dep, or an unsuccessful tool result all collapse
 * to empty signals for that channel. Email and calendar are read independently, so
 * a failure on one still returns the other.
 */
export async function fetchSignalsForUser(
  userId: string,
  deps: SignalDeps,
  nowMs: number = Date.now(),
): Promise<{ emails: EmailSignal[]; events: CalendarSignal[] }> {
  let active: Set<string>;
  try {
    active = await deps.activeToolkits(userId);
  } catch {
    return EMPTY;
  }

  const emails = active.has(GMAIL_TOOLKIT) ? await fetchEmails(userId, deps, nowMs) : [];
  const events = active.has(CALENDAR_TOOLKIT) ? await fetchEvents(userId, deps, nowMs) : [];
  return { emails, events };
}

/** Read recent (prefer unread/important) emails. Any failure → []. */
async function fetchEmails(userId: string, deps: SignalDeps, nowMs: number): Promise<EmailSignal[]> {
  try {
    // Gmail search query: unread OR important, received in the lookback window.
    const afterSec = Math.floor((nowMs - LOOKBACK_MS) / 1000);
    const result = await deps.executeTool(userId, GMAIL_FETCH_TOOL, {
      query: `(is:unread OR is:important) after:${afterSec}`,
      max_results: 10,
    });
    const rows = rowsFromResult(result, GMAIL_ROW_KEYS);
    const signals = gmailMessagesToSignals(rows, nowMs);
    // Keep only those genuinely inside the lookback window (the query is best-effort).
    return signals.filter((s) => s.receivedMs >= nowMs - LOOKBACK_MS && s.receivedMs <= nowMs + 60_000);
  } catch {
    return [];
  }
}

/** Read upcoming events in the lookahead window. Any failure → []. */
async function fetchEvents(userId: string, deps: SignalDeps, nowMs: number): Promise<CalendarSignal[]> {
  try {
    const result = await deps.executeTool(userId, CALENDAR_LIST_TOOL, {
      timeMin: new Date(nowMs).toISOString(),
      timeMax: new Date(nowMs + LOOKAHEAD_MS).toISOString(),
      single_events: true,
      order_by: "startTime",
      max_results: 10,
    });
    const rows = rowsFromResult(result, CALENDAR_ROW_KEYS);
    const signals = calendarEventsToSignals(rows);
    // Keep only events actually starting within the lookahead window.
    return signals.filter((s) => s.startMs > nowMs && s.startMs <= nowMs + LOOKAHEAD_MS);
  } catch {
    return [];
  }
}
