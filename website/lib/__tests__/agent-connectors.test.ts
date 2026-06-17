import { strict as assert } from "node:assert";
import {
  CALENDAR_TOOLKIT,
  CHECK_CALENDAR_TOOL,
  CHECK_EMAIL_TOOL,
  GMAIL_TOOLKIT,
  formatEmails,
  formatEvents,
  mapEmails,
  mapEvents,
  readRecentEmails,
  readUpcomingEvents,
  rowsFromResult,
  toEpochMs,
  type ConnectorDeps,
  type ToolResult,
} from "../agent/connectors";

const NOW = Date.UTC(2026, 5, 16, 16, 0, 0); // fixed "now"

// ---- toEpochMs (pure) ------------------------------------------------------
{
  assert.equal(toEpochMs(NOW), NOW, "ms number passes through");
  assert.equal(toEpochMs(Math.floor(NOW / 1000)), NOW, "seconds scaled to ms");
  assert.equal(toEpochMs("2026-06-16T16:00:00.000Z"), NOW, "ISO parsed");
  assert.equal(toEpochMs("garbage"), undefined, "bad string → undefined");
  assert.equal(toEpochMs(NaN), undefined, "NaN → undefined");
  assert.equal(toEpochMs({}), undefined, "object → undefined");
}

// ---- mapEmails (pure) ------------------------------------------------------
{
  const rows = [
    { from: "a@x.com", subject: "Invoice due", snippet: "Please   pay\nby Friday", internalDate: NOW },
    { sender: "b@y.com", title: "Re: lunch" }, // alias keys, no snippet/time
    { subject: "no from" }, // missing from → skipped
    { from: "c@z.com" }, // missing subject → skipped
    "not an object", // skipped
  ];
  const got = mapEmails(rows);
  assert.equal(got.length, 2, "two valid rows mapped, malformed skipped");
  assert.equal(got[0].from, "a@x.com");
  assert.equal(got[0].subject, "Invoice due");
  assert.equal(got[0].snippet, "Please pay by Friday", "whitespace collapsed");
  assert.equal(got[0].receivedAt, new Date(NOW).toISOString(), "time → ISO");
  assert.equal(got[1].from, "b@y.com", "sender alias read");
  assert.equal(got[1].subject, "Re: lunch", "title alias read");
  assert.equal(got[1].snippet, undefined, "no snippet omitted");
  assert.equal(got[1].receivedAt, undefined, "no time omitted (not faked)");

  // snippet truncation
  const long = mapEmails([{ from: "x", subject: "y", snippet: "z".repeat(300) }]);
  assert.ok(long[0].snippet!.length <= 160, "snippet truncated to <=160");
  assert.ok(long[0].snippet!.endsWith("…"), "truncation ellipsis");

  assert.deepEqual(mapEmails([]), [], "empty → []");
  assert.deepEqual(mapEmails("nope" as unknown as unknown[]), [], "non-array → []");
}

// ---- mapEvents (pure) ------------------------------------------------------
{
  const rows = [
    { summary: "Standup", start: { dateTime: "2026-06-16T17:00:00.000Z" }, location: "Zoom" },
    { title: "Dentist", startTime: NOW + 3_600_000 }, // flat epoch ms
    { name: "All hands", start: { date: "2026-06-17" }, location: { displayName: "HQ" } }, // nested loc
    { summary: "no start" }, // missing start → skipped
    { start: { dateTime: "2026-06-16T18:00:00.000Z" } }, // missing title → skipped
  ];
  const got = mapEvents(rows);
  assert.equal(got.length, 3, "three valid rows, malformed skipped");
  assert.equal(got[0].title, "Standup");
  assert.equal(got[0].start, "2026-06-16T17:00:00.000Z", "nested dateTime → ISO");
  assert.equal(got[0].location, "Zoom");
  assert.equal(got[1].title, "Dentist", "title alias");
  assert.equal(got[1].location, undefined, "no location omitted");
  assert.equal(got[2].location, "HQ", "nested location.displayName read");

  assert.deepEqual(mapEvents([]), [], "empty → []");
}

// ---- rowsFromResult (pure) -------------------------------------------------
{
  const ok = (data: Record<string, unknown>): ToolResult => ({ data, error: null, successful: true });
  assert.deepEqual(rowsFromResult(ok({ messages: [1, 2] }), ["messages"]), [1, 2], "row key found");
  assert.deepEqual(rowsFromResult(ok({ response_data: { events: [9] } }), ["events"]), [9], "nested one level");
  assert.deepEqual(rowsFromResult({ data: { x: 1 }, error: "boom", successful: false }, ["x"]), [], "error → []");
  assert.deepEqual(rowsFromResult(undefined, ["x"]), [], "undefined → []");
  assert.deepEqual(rowsFromResult(ok({ nope: 1 }), ["messages"]), [], "no row array → []");
}

// ---- formatEmails / formatEvents (pure) ------------------------------------
{
  const emailText = formatEmails({
    items: [
      { from: "boss@co.com", subject: "Q3 numbers", snippet: "Need these today" },
      { from: "n@news.com", subject: "Daily digest" },
    ],
  });
  assert.ok(emailText.includes("Recent emails (2)"), "header counts items");
  assert.ok(emailText.includes('From boss@co.com: "Q3 numbers" — Need these today'), "snippet rendered");
  assert.ok(emailText.includes('From n@news.com: "Daily digest"'), "no-snippet line ok");

  assert.equal(formatEmails({ items: [], reason: "nope" }), "nope", "empty uses reason");
  assert.equal(formatEmails({ items: [] }), "No recent emails.", "empty default");

  const evText = formatEvents({
    items: [
      { title: "Standup", start: "2026-06-16T17:00:00.000Z", location: "Zoom" },
      { title: "Lunch", start: "2026-06-16T19:00:00.000Z" },
    ],
  });
  assert.ok(evText.includes("Upcoming events (2)"), "header counts events");
  assert.ok(evText.includes("Standup at 2026-06-16T17:00:00.000Z @ Zoom"), "location rendered");
  assert.ok(evText.includes("Lunch at 2026-06-16T19:00:00.000Z"), "no-location line ok");

  assert.equal(formatEvents({ items: [], reason: "free" }), "free", "empty uses reason");
  assert.equal(formatEvents({ items: [] }), "Nothing on the calendar.", "empty default");
}

// ---- ToolDefs are read-only + connector-silent -----------------------------
{
  for (const tool of [CHECK_EMAIL_TOOL, CHECK_CALENDAR_TOOL]) {
    assert.deepEqual(tool.input_schema, { type: "object", properties: {} }, "read-only, no inputs");
    const desc = tool.description.toLowerCase();
    for (const banned of ["composio", "tool", "api", "gmail", "calendar api", "oauth"]) {
      assert.ok(!desc.includes(banned), `description must not mention "${banned}"`);
    }
  }
  assert.equal(CHECK_EMAIL_TOOL.name, "check_email");
  assert.equal(CHECK_CALENDAR_TOOL.name, "check_calendar");
}

// ---- readRecentEmails (orchestration, stub deps) ---------------------------
function deps(over: Partial<ConnectorDeps> = {}): ConnectorDeps {
  return {
    activeToolkits: async () => new Set([GMAIL_TOOLKIT, CALENDAR_TOOLKIT]),
    executeTool: async (_u, slug) => {
      if (slug.startsWith("GMAIL")) {
        return {
          data: { messages: [{ from: "a@x.com", subject: "Hi", internalDate: NOW }] },
          error: null,
          successful: true,
        } satisfies ToolResult;
      }
      return {
        data: { events: [{ summary: "Standup", start: { dateTime: new Date(NOW + 600_000).toISOString() } }] },
        error: null,
        successful: true,
      } satisfies ToolResult;
    },
    ...over,
  };
}

async function main() {
  // ---- readRecentEmails (orchestration, stub deps) -------------------------
  // happy path
  const mail = await readRecentEmails("u1", deps(), { nowMs: NOW });
  assert.equal(mail.items.length, 1, "email read returns mapped item");
  assert.equal(mail.items[0].subject, "Hi");
  assert.equal(mail.reason, undefined, "happy path has no reason");

  // not connected
  const noMail = await readRecentEmails("u1", deps({ activeToolkits: async () => new Set([CALENDAR_TOOLKIT]) }), {
    nowMs: NOW,
  });
  assert.deepEqual(noMail.items, [], "no gmail connection → empty");
  assert.ok(noMail.reason && /connected/.test(noMail.reason), "not-connected reason given");

  // activeToolkits throws → empty, never throws
  const threw = await readRecentEmails("u1", deps({ activeToolkits: async () => { throw new Error("db"); } }), {
    nowMs: NOW,
  });
  assert.deepEqual(threw.items, [], "thrown dep → empty");
  assert.ok(threw.reason, "thrown dep → reason");

  // unsuccessful tool result → empty
  const failed = await readRecentEmails(
    "u1",
    deps({ executeTool: async () => ({ data: {}, error: "auth expired", successful: false }) }),
    { nowMs: NOW },
  );
  assert.deepEqual(failed.items, [], "unsuccessful result → empty");
  assert.ok(failed.reason, "unsuccessful result → reason");

  // executeTool throws → empty
  const execThrew = await readRecentEmails(
    "u1",
    deps({ executeTool: async () => { throw new Error("500"); } }),
    { nowMs: NOW },
  );
  assert.deepEqual(execThrew.items, [], "thrown executeTool → empty");

  // ---- readUpcomingEvents (orchestration, stub deps) -----------------------
  const cal = await readUpcomingEvents("u1", deps(), { nowMs: NOW });
  assert.equal(cal.items.length, 1, "event read returns mapped item");
  assert.equal(cal.items[0].title, "Standup");

  // past event filtered out → empty with reason
  const pastDeps = deps({
    executeTool: async () => ({
      data: { events: [{ summary: "Old", start: { dateTime: new Date(NOW - 600_000).toISOString() } }] },
      error: null,
      successful: true,
    }),
  });
  const past = await readUpcomingEvents("u1", pastDeps, { nowMs: NOW });
  assert.deepEqual(past.items, [], "past event filtered out");
  assert.ok(past.reason, "filtered-empty → reason");

  // not connected
  const noCal = await readUpcomingEvents("u1", deps({ activeToolkits: async () => new Set([GMAIL_TOOLKIT]) }), {
    nowMs: NOW,
  });
  assert.deepEqual(noCal.items, [], "no calendar connection → empty");
  assert.ok(noCal.reason && /connected/.test(noCal.reason), "not-connected reason");
}

main()
  .then(() => console.log("agent-connectors: all assertions passed"))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
