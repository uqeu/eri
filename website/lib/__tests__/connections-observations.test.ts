import { strict as assert } from "node:assert";
import {
  calendarToObservation,
  emailToObservation,
  fetchObservations,
  looksLikeSecret,
  type Observation,
} from "../connections/observations";
import type { ConnectorDeps, ToolResult } from "../agent/connectors";

// --- email mapper ---
{
  const o = emailToObservation({
    messageId: "m1",
    sender: "Priya Nair <priya@x.com>",
    subject: "atlas sync",
    messageText: "can we move standup?",
    messageTimestamp: "2026-06-25T10:00:00Z",
  });
  assert.ok(o);
  assert.equal(o!.sourceId, "gmail:m1");
  assert.equal(o!.kind, "email");
  assert.equal(o!.text, "Email from Priya Nair <priya@x.com>: atlas sync — can we move standup?");
  assert.equal(o!.ts, Date.parse("2026-06-25T10:00:00Z"));
  // missing subject → null; non-record → null
  assert.equal(emailToObservation({ messageId: "m2", sender: "x" }), null);
  assert.equal(emailToObservation("nope"), null);
}

// --- calendar mapper (nested gcal start + attendees) ---
{
  const o = calendarToObservation({
    id: "e1",
    summary: "Standup",
    start: { dateTime: "2026-06-25T13:00:00Z" },
    attendees: [{ displayName: "Sam" }, { email: "priya@x.com" }],
  });
  assert.ok(o);
  assert.equal(o!.sourceId, "gcal:e1");
  assert.equal(o!.kind, "calendar");
  assert.ok(o!.text.startsWith("Standup with Sam, priya@x.com at "));
  assert.equal(o!.ts, Date.parse("2026-06-25T13:00:00Z"));
  assert.equal(calendarToObservation({ id: "e2" }), null); // no title/start
}

// --- defense-in-depth secret screen ---
{
  assert.equal(looksLikeSecret("Email from Bank: your verification code is 123456"), true);
  assert.equal(looksLikeSecret("Email from Priya: lunch tomorrow?"), false);
}

function depsWith(
  toolkits: string[],
  exec: (slug: string) => ToolResult,
): ConnectorDeps {
  return {
    activeToolkits: async () => new Set(toolkits),
    executeTool: async (_userId: string, slug: string) => exec(slug),
  };
}

async function run() {
  const exec = (slug: string): ToolResult =>
    slug.includes("GMAIL")
      ? {
          successful: true,
          error: null,
          data: {
            messages: [
              { messageId: "m1", sender: "Priya <p@x.com>", subject: "atlas", messageText: "hi", messageTimestamp: "2026-06-25T10:00:00Z" },
              { messageId: "secret", sender: "Bank <b@x.com>", subject: "code", messageText: "your verification code is 999111", messageTimestamp: "2026-06-25T11:00:00Z" },
            ],
          },
        }
      : {
          successful: true,
          error: null,
          data: { events: [{ id: "e1", summary: "Standup", start: { dateTime: "2026-06-25T09:00:00Z" }, attendees: [{ displayName: "Sam" }] }] },
        };

  // Merges email + calendar, drops the secret, sorts ascending by ts.
  const r = await fetchObservations("usr_x", depsWith(["gmail", "googlecalendar"], exec), {
    since: Date.parse("2026-06-01T00:00:00Z"),
    limit: 50,
  });
  assert.equal(r.observations.length, 2, "secret dropped → 2 survive");
  assert.equal(r.observations[0].sourceId, "gcal:e1", "09:00 sorts first");
  assert.equal(r.observations[1].sourceId, "gmail:m1", "10:00 next");
  assert.ok(!r.observations.some((o: Observation) => o.sourceId === "gmail:secret"), "secret dropped");
  assert.equal(r.nextCursor, null, "under limit → exhausted");

  // limit hit → nextCursor is the last returned ts.
  const limited = await fetchObservations("usr_x", depsWith(["gmail", "googlecalendar"], exec), { since: 0, limit: 1 });
  assert.equal(limited.observations.length, 1);
  assert.equal(limited.nextCursor, limited.observations[0].ts);

  // Unconnected → empty, never an error.
  const none = await fetchObservations(
    "usr_x",
    depsWith([], () => ({ successful: true, error: null, data: {} })),
    { since: 0, limit: 50 },
  );
  assert.deepEqual(none.observations, []);
  assert.equal(none.nextCursor, null);

  // eslint-disable-next-line no-console
  console.log("connections-observations.test.ts: all assertions passed");
}

run();
