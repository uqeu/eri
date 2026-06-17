/**
 * In-cloud read connectors for phone eri — "what's going on today / any important
 * emails?" answered FROM THE PHONE WITH THE LAPTOP CLOSED.
 *
 * Unlike control_computer / recall_memory (which dispatch a goal to the user's
 * machine and text the result back later), these reads resolve *in the cloud this
 * turn*: eri reads the user's recent Gmail + upcoming Google Calendar server-side
 * and feeds a compact, formatted summary straight back to the model — the same
 * in-cloud shape as remember_fact (ADR-0002). So eri can answer the inbox/calendar
 * question in one reply, even with the computer asleep.
 *
 * Two layers, both kept honest (mirrors lib/proactive/signals.ts):
 *   1. PURE mappers + formatters (`mapEmails`, `mapEvents`, `formatEmails`,
 *      `formatEvents`) defensively narrow raw `unknown` tool-result rows into the
 *      compact `RecentEmail` / `UpcomingEvent` shapes and render them as the short
 *      text eri reads back. Every field is guarded; a malformed row is skipped,
 *      never thrown on. Fully unit-tested.
 *   2. `readRecentEmails` / `readUpcomingEvents` orchestrate: confirm the user has
 *      the relevant active Composio connection, execute the read via the
 *      `@composio/core` tools.execute path (injected behind a `ConnectorDeps` seam,
 *      same as SignalDeps), map the rows, and return a typed `ReadResult`.
 *
 * SAFETY CONTRACT: these NEVER throw. A missing connection, an unconfigured
 * connector, a thrown dep, or an unsuccessful tool result all collapse to
 * `{ items: [], reason }` — eri then honestly tells the user it couldn't check
 * (e.g. "looks like your inbox isn't connected yet") instead of the turn crashing.
 *
 * The connector is never named to the user: the exported ToolDefs read as plain
 * "check your recent email / upcoming calendar", and the `reason` strings are
 * user-safe phrasing with no mechanics.
 */

import type { ToolDef } from "./run_core";

// ---- toolkit + tool slugs (shared with proactive/signals) ------------------

/** Composio toolkit slugs (must match composio_accounts.toolkit). */
export const GMAIL_TOOLKIT = "gmail";
export const CALENDAR_TOOLKIT = "googlecalendar";

/** Composio tool slugs for the reads. Canonical names (best-effort). */
export const GMAIL_FETCH_TOOL = "GMAIL_FETCH_EMAILS";
export const CALENDAR_LIST_TOOL = "GOOGLECALENDAR_EVENTS_LIST";

/** How far back "recent" email reaches, and how far forward "upcoming" events. */
export const EMAIL_LOOKBACK_MS = 24 * 60 * 60_000; // last 24h
export const EVENT_LOOKAHEAD_MS = 24 * 60 * 60_000; // next 24h

/** Cap the rows fed back to the model — a phone reply stays short + cheap. */
export const MAX_EMAILS = 8;
export const MAX_EVENTS = 8;

// ---- compact result shapes -------------------------------------------------

/** A single recent email, narrowed to what eri needs to summarize it. */
export interface RecentEmail {
  from: string;
  subject: string;
  snippet?: string;
  /** ISO 8601 received time, or undefined if the row carried no parseable time. */
  receivedAt?: string;
}

/** A single upcoming calendar event, narrowed to the essentials. */
export interface UpcomingEvent {
  title: string;
  /** ISO 8601 start time. */
  start: string;
  location?: string;
}

/**
 * The result of an in-cloud read. `items` is always present (possibly empty);
 * `reason` is a user-safe explanation present only when the read returned nothing
 * actionable (not connected / errored / genuinely empty). Never throws.
 */
export interface ReadResult<T> {
  items: T[];
  reason?: string;
}

/** Shape of a Composio tool execution result (subset we rely on). */
export interface ToolResult {
  data: Record<string, unknown>;
  error: string | null;
  successful: boolean;
}

/**
 * IO the readers need — injected so orchestration is testable with stubs (no DB,
 * no live Composio). Identical shape to lib/proactive/signals.ts `SignalDeps`, so
 * the route can share one wiring.
 */
export interface ConnectorDeps {
  /** Active toolkit slugs for this user (status='active' rows). */
  activeToolkits(userId: string): Promise<Set<string>>;
  /** Execute a Composio tool for this user. Returns the raw tool result. */
  executeTool(userId: string, slug: string, args: Record<string, unknown>): Promise<ToolResult>;
}

/** Per-read options (defaulted). */
export interface ReadEmailsOpts {
  /** Override the lookback window (ms). */
  lookbackMs?: number;
  /** Max rows to fetch + return. */
  limit?: number;
  /** Clock injection for deterministic tests. */
  nowMs?: number;
}
export interface ReadEventsOpts {
  /** Override the lookahead window (ms). */
  lookaheadMs?: number;
  /** Max rows to fetch + return. */
  limit?: number;
  /** Clock injection for deterministic tests. */
  nowMs?: number;
}

// ---- pure value guards (mirrors signals.ts) --------------------------------

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
 * ISO / parseable date string. Returns undefined for anything unparseable.
 */
export function toEpochMs(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v < 1e12 ? Math.round(v * 1000) : Math.round(v);
  }
  if (typeof v === "string" && v.length > 0) {
    const ms = Date.parse(v);
    return Number.isFinite(ms) ? ms : undefined;
  }
  return undefined;
}

/** Read an event start: flat keys first, then nested gcal { dateTime | date }. */
function readEventStartMs(row: Record<string, unknown>): number | undefined {
  for (const key of ["startTime", "start_time", "startMs"] as const) {
    const ms = toEpochMs(row[key]);
    if (ms !== undefined) return ms;
  }
  const start = row.start;
  if (isRecord(start)) {
    return toEpochMs(start.dateTime ?? start.date_time ?? start.date);
  }
  return toEpochMs(start);
}

/** Read an event location: flat, or nested gcal-style. */
function readEventLocation(row: Record<string, unknown>): string | undefined {
  const flat = firstString(row, ["location", "where"]);
  if (flat !== undefined) return flat;
  const loc = row.location;
  if (isRecord(loc)) return firstString(loc, ["displayName", "display_name", "name"]);
  return undefined;
}

// ---- pure mappers ----------------------------------------------------------

/**
 * Map raw Gmail rows into compact `RecentEmail[]`. Each row must yield a from +
 * subject; snippet and receivedAt are optional. Malformed rows are skipped.
 */
export function mapEmails(raw: unknown[]): RecentEmail[] {
  if (!Array.isArray(raw)) return [];
  const out: RecentEmail[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const from = firstString(item, ["from", "sender", "fromEmail", "from_email"]);
    const subject = firstString(item, ["subject", "title"]);
    if (from === undefined || subject === undefined) continue;
    const snippet = firstString(item, ["snippet", "preview", "body", "messageText", "message_text"]);
    const receivedMs = toEpochMs(
      item.receivedMs ?? item.messageTimestamp ?? item.message_timestamp ?? item.internalDate ?? item.date,
    );
    out.push({
      from,
      subject,
      ...(snippet !== undefined ? { snippet: truncate(snippet, 160) } : {}),
      ...(receivedMs !== undefined ? { receivedAt: new Date(receivedMs).toISOString() } : {}),
    });
  }
  return out;
}

/**
 * Map raw Calendar rows into compact `UpcomingEvent[]`. Each row must yield a
 * title + parseable start; location is optional. Malformed rows are skipped.
 */
export function mapEvents(raw: unknown[]): UpcomingEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: UpcomingEvent[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const title = firstString(item, ["title", "summary", "name"]);
    const startMs = readEventStartMs(item);
    if (title === undefined || startMs === undefined) continue;
    const location = readEventLocation(item);
    out.push({
      title,
      start: new Date(startMs).toISOString(),
      ...(location !== undefined ? { location } : {}),
    });
  }
  return out;
}

/** Trim a string to `max` chars, collapsing whitespace, with an ellipsis. */
function truncate(s: string, max: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

// ---- tool-result unwrapping (mirrors signals.ts) ---------------------------

/**
 * Pull the array of rows out of a Composio tool result. The payload lives under
 * `data`; the row array under one of a few common keys, or `data` is itself an
 * array, or it's nested one level deeper. Any non-array shape yields []. Pure.
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
  for (const v of Object.values(data)) {
    if (isRecord(v)) {
      for (const key of keys) {
        const inner = v[key];
        if (Array.isArray(inner)) return inner;
      }
    }
  }
  return [];
}

const GMAIL_ROW_KEYS = ["messages", "items", "results", "emails", "data"] as const;
const CALENDAR_ROW_KEYS = ["events", "items", "results", "data"] as const;

// ---- pure formatters (the text eri reads back) -----------------------------

/**
 * Render recent emails as the compact text fed back to the model. Empty list
 * yields a short "nothing notable" line so eri answers honestly rather than
 * inventing mail. Pure + unit-tested.
 */
export function formatEmails(result: ReadResult<RecentEmail>): string {
  if (result.items.length === 0) {
    return result.reason ?? "No recent emails.";
  }
  const lines = result.items.map((e) => {
    const snip = e.snippet ? ` — ${e.snippet}` : "";
    return `- From ${e.from}: "${e.subject}"${snip}`;
  });
  return [`Recent emails (${result.items.length}):`, ...lines].join("\n");
}

/**
 * Render upcoming events as the compact text fed back to the model. Empty list
 * yields a short "nothing on the calendar" line. Pure + unit-tested.
 */
export function formatEvents(result: ReadResult<UpcomingEvent>): string {
  if (result.items.length === 0) {
    return result.reason ?? "Nothing on the calendar.";
  }
  const lines = result.items.map((ev) => {
    const where = ev.location ? ` @ ${ev.location}` : "";
    return `- ${ev.title} at ${ev.start}${where}`;
  });
  return [`Upcoming events (${result.items.length}):`, ...lines].join("\n");
}

// ---- orchestration ---------------------------------------------------------

/** User-safe reason strings (never mention the connector or mechanics). */
const NOT_CONNECTED_EMAIL = "Your email isn't connected yet, so I can't check it.";
const NOT_CONNECTED_CALENDAR = "Your calendar isn't connected yet, so I can't check it.";
const COULDNT_CHECK_EMAIL = "I couldn't check your email just now.";
const COULDNT_CHECK_CALENDAR = "I couldn't check your calendar just now.";

/**
 * Read the user's recent emails in the cloud. Never throws: a missing connection,
 * unconfigured connector, thrown dep, or unsuccessful result all return
 * `{ items: [], reason }`. Results are compact and capped.
 */
export async function readRecentEmails(
  userId: string,
  deps: ConnectorDeps,
  opts: ReadEmailsOpts = {},
): Promise<ReadResult<RecentEmail>> {
  const nowMs = opts.nowMs ?? Date.now();
  const lookbackMs = opts.lookbackMs ?? EMAIL_LOOKBACK_MS;
  const limit = opts.limit ?? MAX_EMAILS;

  let active: Set<string>;
  try {
    active = await deps.activeToolkits(userId);
  } catch {
    return { items: [], reason: COULDNT_CHECK_EMAIL };
  }
  if (!active.has(GMAIL_TOOLKIT)) {
    return { items: [], reason: NOT_CONNECTED_EMAIL };
  }

  try {
    const afterSec = Math.floor((nowMs - lookbackMs) / 1000);
    const result = await deps.executeTool(userId, GMAIL_FETCH_TOOL, {
      query: `(is:unread OR is:important) after:${afterSec}`,
      max_results: limit,
    });
    if (!result.successful || result.error) {
      return { items: [], reason: COULDNT_CHECK_EMAIL };
    }
    const rows = rowsFromResult(result, GMAIL_ROW_KEYS);
    const items = mapEmails(rows).slice(0, limit);
    return items.length > 0 ? { items } : { items: [], reason: "Nothing notable in your inbox." };
  } catch {
    return { items: [], reason: COULDNT_CHECK_EMAIL };
  }
}

/**
 * Read the user's upcoming calendar events in the cloud. Never throws (same
 * contract as readRecentEmails). Results are compact and capped.
 */
export async function readUpcomingEvents(
  userId: string,
  deps: ConnectorDeps,
  opts: ReadEventsOpts = {},
): Promise<ReadResult<UpcomingEvent>> {
  const nowMs = opts.nowMs ?? Date.now();
  const lookaheadMs = opts.lookaheadMs ?? EVENT_LOOKAHEAD_MS;
  const limit = opts.limit ?? MAX_EVENTS;

  let active: Set<string>;
  try {
    active = await deps.activeToolkits(userId);
  } catch {
    return { items: [], reason: COULDNT_CHECK_CALENDAR };
  }
  if (!active.has(CALENDAR_TOOLKIT)) {
    return { items: [], reason: NOT_CONNECTED_CALENDAR };
  }

  try {
    const result = await deps.executeTool(userId, CALENDAR_LIST_TOOL, {
      timeMin: new Date(nowMs).toISOString(),
      timeMax: new Date(nowMs + lookaheadMs).toISOString(),
      single_events: true,
      order_by: "startTime",
      max_results: limit,
    });
    if (!result.successful || result.error) {
      return { items: [], reason: COULDNT_CHECK_CALENDAR };
    }
    const rows = rowsFromResult(result, CALENDAR_ROW_KEYS);
    // Keep only events at/after now, sorted by start, capped.
    const items = mapEvents(rows)
      .filter((ev) => {
        const ms = toEpochMs(ev.start);
        return ms !== undefined && ms >= nowMs && ms <= nowMs + lookaheadMs;
      })
      .sort((a, b) => a.start.localeCompare(b.start))
      .slice(0, limit);
    return items.length > 0 ? { items } : { items: [], reason: "Nothing on your calendar coming up." };
  } catch {
    return { items: [], reason: COULDNT_CHECK_CALENDAR };
  }
}

// ---- tool definitions (read-only; never name the connector) ----------------

/**
 * eri's read-only tool for the user's recent email. Resolves in-cloud this turn
 * (the inbound onToolCall branch returns the formatted text immediately), so eri
 * can summarize the inbox in the same reply — laptop open or closed. Description
 * reads naturally: no mechanics, no connector name.
 */
export const CHECK_EMAIL_TOOL: ToolDef = {
  name: "check_email",
  description:
    "Check the user's recent email and summarize what's there — use when they ask what's in their inbox, whether anything important came in, or to catch up on messages. You get the result back this turn, so answer directly with what you find.",
  input_schema: {
    type: "object",
    properties: {},
  },
};

/**
 * eri's read-only tool for the user's upcoming calendar. Resolves in-cloud this
 * turn. Description reads naturally: no mechanics, no connector name.
 */
export const CHECK_CALENDAR_TOOL: ToolDef = {
  name: "check_calendar",
  description:
    "Check the user's upcoming calendar and summarize it — use when they ask what's going on today, what's next, whether they have any meetings, or to plan their day. You get the result back this turn, so answer directly with what you find.",
  input_schema: {
    type: "object",
    properties: {},
  },
};
