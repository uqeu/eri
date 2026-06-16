import { strict as assert } from "node:assert";
import {
  CALENDAR_LIST_TOOL,
  CALENDAR_TOOLKIT,
  GMAIL_FETCH_TOOL,
  GMAIL_TOOLKIT,
  calendarEventsToSignals,
  fetchSignalsForUser,
  gmailMessagesToSignals,
  rowsFromResult,
  toEpochMs,
  type SignalDeps,
  type ToolResult,
} from "../proactive/signals";

const NOW = Date.UTC(2026, 5, 16, 16, 0, 0); // fixed "now"

// ---- toEpochMs (pure) ------------------------------------------------------
{
  assert.equal(toEpochMs(NOW), NOW, "ms number passes through");
  assert.equal(toEpochMs(Math.floor(NOW / 1000)), NOW, "seconds number scaled to ms");
  assert.equal(toEpochMs("2026-06-16T16:00:00.000Z"), NOW, "ISO string parsed");
  assert.equal(toEpochMs("not a date"), undefined, "garbage string → undefined");
  assert.equal(toEpochMs(NaN), undefined, "NaN → undefined");
  assert.equal(toEpochMs(undefined), undefined, "undefined → undefined");
  assert.equal(toEpochMs({}), undefined, "object → undefined");
}

// ---- gmailMessagesToSignals (pure) -----------------------------------------
{
  // empty / non-array
  assert.deepEqual(gmailMessagesToSignals([]), [], "empty in → empty out");
  assert.deepEqual(gmailMessagesToSignals(undefined as unknown as unknown[]), [], "non-array → empty");

  // well-formed
  const signals = gmailMessagesToSignals(
    [
      { id: "m1", from: "Boss <boss@co>", subject: "URGENT", snippet: "sign today", messageTimestamp: NOW },
      { messageId: "m2", sender: "News", title: "digest" }, // alias keys, no snippet, no ts
    ],
    NOW,
  );
  assert.equal(signals.length, 2, "both well-formed rows map");
  assert.equal(signals[0].id, "m1");
  assert.equal(signals[0].from, "Boss <boss@co>");
  assert.equal(signals[0].subject, "URGENT");
  assert.equal(signals[0].snippet, "sign today");
  assert.equal(signals[0].receivedMs, NOW, "timestamp parsed");
  assert.equal(signals[1].id, "m2", "messageId alias works");
  assert.equal(signals[1].from, "News", "sender alias works");
  assert.equal(signals[1].subject, "digest", "title alias works");
  assert.equal(signals[1].receivedMs, NOW, "missing ts falls back to now");
  assert.equal(signals[1].snippet, undefined, "no snippet stays absent");

  // malformed rows are skipped, never throw
  const partial = gmailMessagesToSignals([
    null,
    "string",
    42,
    {}, // no id/from/subject
    { id: "x", from: "a" }, // missing subject
    { id: "y", subject: "s" }, // missing from
    { from: "f", subject: "s" }, // missing id
    { id: "ok", from: "f", subject: "s" }, // the only valid one
  ]);
  assert.equal(partial.length, 1, "only the complete row survives");
  assert.equal(partial[0].id, "ok");
}

// ---- calendarEventsToSignals (pure) ----------------------------------------
{
  assert.deepEqual(calendarEventsToSignals([]), [], "empty in → empty out");
  assert.deepEqual(calendarEventsToSignals({} as unknown as unknown[]), [], "non-array → empty");

  const signals = calendarEventsToSignals([
    { id: "e1", summary: "Standup", start: { dateTime: "2026-06-16T16:10:00.000Z" } }, // nested gcal
    { eventId: "e2", title: "Flat", startTime: NOW + 20 * 60_000 }, // flat ms + aliases
    { id: "e3", summary: "All day", start: { date: "2026-06-17" } }, // all-day date
  ]);
  assert.equal(signals.length, 3, "all three map");
  assert.equal(signals[0].id, "e1");
  assert.equal(signals[0].title, "Standup");
  assert.equal(signals[0].startMs, Date.UTC(2026, 5, 16, 16, 10, 0), "nested dateTime parsed");
  assert.equal(signals[1].id, "e2", "eventId alias");
  assert.equal(signals[1].title, "Flat");
  assert.equal(signals[1].startMs, NOW + 20 * 60_000, "flat ms passes through");

  // malformed skipped
  const partial = calendarEventsToSignals([
    null,
    { id: "no-start", title: "x" }, // missing start
    { title: "no-id", start: { dateTime: "2026-06-16T16:10:00.000Z" } }, // missing id
    { id: "bad-start", title: "x", start: { dateTime: "nope" } }, // unparseable start
    { id: "good", title: "Good", start: { dateTime: "2026-06-16T16:10:00.000Z" } },
  ]);
  assert.equal(partial.length, 1, "only the valid event survives");
  assert.equal(partial[0].id, "good");
}

// ---- rowsFromResult (pure) -------------------------------------------------
{
  const ok = (data: Record<string, unknown>): ToolResult => ({ data, error: null, successful: true });
  assert.deepEqual(rowsFromResult(ok({ messages: [1, 2] }), ["messages"]), [1, 2], "flat key");
  assert.deepEqual(rowsFromResult(ok({ items: [3] }), ["messages", "items"]), [3], "fallback key");
  assert.deepEqual(
    rowsFromResult(ok({ response_data: { events: [9] } }), ["events"]),
    [9],
    "one-level-nested key",
  );
  assert.deepEqual(
    rowsFromResult({ data: [7] as unknown as Record<string, unknown>, error: null, successful: true }, ["x"]),
    [7],
    "data itself an array",
  );
  assert.deepEqual(rowsFromResult(ok({ nothing: 1 }), ["messages"]), [], "no array → []");

  // A successful, error-free result with no row array under any known key is a
  // likely schema drift — it must emit a structured log (still returns []).
  {
    const original = console.log;
    const lines: string[] = [];
    console.log = (...args: unknown[]) => { lines.push(String(args[0])); };
    try {
      const out = rowsFromResult(ok({ unexpected: 1 }), ["messages"]);
      assert.deepEqual(out, [], "drift still returns [] (contract unchanged)");
    } finally {
      console.log = original;
    }
    const drift = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } });
    assert.ok(
      drift.some((d) => d && d.event === "proactive.signal_unpack_empty"),
      "schema drift emits a structured signal_unpack_empty log",
    );
  }
  assert.deepEqual(
    rowsFromResult({ data: { messages: [1] }, error: "boom", successful: false }, ["messages"]),
    [],
    "errored result → []",
  );
  assert.deepEqual(
    rowsFromResult({ data: { messages: [1] }, error: null, successful: false }, ["messages"]),
    [],
    "unsuccessful result → []",
  );
  assert.deepEqual(rowsFromResult(undefined, ["messages"]), [], "undefined result → []");
}

// ---- fetchSignalsForUser (orchestration, stub deps) ------------------------
function deps(over: Partial<SignalDeps> = {}): SignalDeps {
  return {
    activeToolkits: async () => new Set([GMAIL_TOOLKIT, CALENDAR_TOOLKIT]),
    executeTool: async (_userId, slug) => {
      if (slug === GMAIL_FETCH_TOOL) {
        return {
          data: { messages: [{ id: "m1", from: "Boss", subject: "URGENT", messageTimestamp: NOW }] },
          error: null,
          successful: true,
        };
      }
      if (slug === CALENDAR_LIST_TOOL) {
        return {
          data: { events: [{ id: "e1", summary: "Standup", start: { dateTime: new Date(NOW + 10 * 60_000).toISOString() } }] },
          error: null,
          successful: true,
        };
      }
      return { data: {}, error: "unknown tool", successful: false };
    },
    ...over,
  };
}

(async () => {
  // happy path → both channels mapped
  const happy = await fetchSignalsForUser("u1", deps(), NOW);
  assert.equal(happy.emails.length, 1, "email mapped");
  assert.equal(happy.emails[0].id, "m1");
  assert.equal(happy.events.length, 1, "event mapped");
  assert.equal(happy.events[0].id, "e1");

  // no gmail connection → no emails, calendar still read
  const calOnly = await fetchSignalsForUser("u1", deps({ activeToolkits: async () => new Set([CALENDAR_TOOLKIT]) }), NOW);
  assert.equal(calOnly.emails.length, 0, "no gmail connection → no emails");
  assert.equal(calOnly.events.length, 1, "calendar still read");

  // no connections at all → empty
  const none = await fetchSignalsForUser("u1", deps({ activeToolkits: async () => new Set() }), NOW);
  assert.deepEqual(none, { emails: [], events: [] }, "no connections → empty");

  // activeToolkits throws → empty, never throws
  const tkThrew = await fetchSignalsForUser("u1", deps({ activeToolkits: async () => { throw new Error("db down"); } }), NOW);
  assert.deepEqual(tkThrew, { emails: [], events: [] }, "thrown toolkit dep → empty");

  // executeTool throws → that channel empties, never throws
  const execThrew = await fetchSignalsForUser("u1", deps({ executeTool: async () => { throw new Error("composio 500"); } }), NOW);
  assert.deepEqual(execThrew, { emails: [], events: [] }, "thrown executeTool → empty (both channels)");

  // unsuccessful tool result → empty signals (not a crash)
  const failTool = await fetchSignalsForUser(
    "u1",
    deps({ executeTool: async () => ({ data: {}, error: "auth expired", successful: false }) }),
    NOW,
  );
  assert.deepEqual(failTool, { emails: [], events: [] }, "unsuccessful tool result → empty");

  // events outside the lookahead window are filtered out
  const farEvent = await fetchSignalsForUser(
    "u1",
    deps({
      activeToolkits: async () => new Set([CALENDAR_TOOLKIT]),
      executeTool: async () => ({
        data: { events: [{ id: "far", summary: "Tomorrow", start: { dateTime: new Date(NOW + 5 * 60 * 60_000).toISOString() } }] },
        error: null,
        successful: true,
      }),
    }),
    NOW,
  );
  assert.equal(farEvent.events.length, 0, "an event hours away is filtered out of the lookahead");

  console.log("proactive-signals.test.ts: all assertions passed");
})();
