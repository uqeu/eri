import { strict as assert } from "node:assert";
import { buildRecallPayload, buildSystemPrompt, currentDateText, extractText, extractToolUses } from "../agent/run_core";

// buildRecallPayload emits the structured {query, as_of} spec the computer parses.
{
  const plain = JSON.parse(buildRecallPayload("the Henderson deal"));
  assert.equal(plain.query, "the Henderson deal");
  assert.equal(plain.as_of, undefined, "no scope without as_of");

  const scoped = JSON.parse(buildRecallPayload("my standup notes", "last Tuesday"));
  assert.equal(scoped.query, "my standup notes");
  assert.equal(scoped.as_of, "last Tuesday");

  // Blank/whitespace as_of collapses to undefined.
  assert.equal(buildRecallPayload("x", "   "), buildRecallPayload("x"));
}

// extractToolUses pulls only well-formed tool_use blocks.
{
  const content = [
    { type: "text", text: "on it" },
    { type: "tool_use", id: "t1", name: "control_computer", input: { goal: "open Spotify" } },
    { type: "tool_use", name: "missing_id" }, // dropped (no id)
  ];
  const uses = extractToolUses(content);
  assert.equal(uses.length, 1);
  assert.equal(uses[0].name, "control_computer");
  assert.deepEqual(uses[0].input, { goal: "open Spotify" });
  assert.deepEqual(extractToolUses(undefined), []);
}

// extractText concatenates + trims text blocks, ignoring tool_use.
{
  assert.equal(
    extractText([{ type: "text", text: "hi " }, { type: "tool_use", id: "x", name: "y" }, { type: "text", text: "there" }]),
    "hi there",
  );
  assert.equal(extractText(undefined), "");
}

// No profile → just the base persona, no injected block.
{
  const sys = buildSystemPrompt(null, null);
  assert.ok(sys.includes("You are eri"));
  assert.ok(!sys.includes("What I know about you"), "no block when nothing is known");
}

// Facts + preferences + dynamic_context are injected as a fenced block.
{
  const sys = buildSystemPrompt(
    { facts: ["name is Khai", "builds eri"], preferences: ["accepts most edits"] },
    "Today: shipped the overlay",
  );
  assert.ok(sys.includes("What I know about you"));
  assert.ok(sys.includes("- name is Khai"));
  assert.ok(sys.includes("- builds eri"));
  assert.ok(sys.includes("- accepts most edits"));
  assert.ok(sys.includes("- Today: shipped the overlay"));
  // fenced so the model treats it as context, not instructions
  assert.ok(sys.includes("```"));
}

// Empty/whitespace entries are filtered; an all-empty profile omits the block.
{
  const sys = buildSystemPrompt({ facts: ["", "  "], preferences: [] }, "   ");
  assert.ok(!sys.includes("What I know about you"));
}

// Dynamic context alone still produces a block.
{
  const sys = buildSystemPrompt(null, "Right now: in a planning session");
  assert.ok(sys.includes("Right now: in a planning session"));
}

// Learned communication style is injected as a "mirror this" line.
{
  const sys = buildSystemPrompt(
    { communication_style: "lowercase, terse, uses emoji" },
    null,
  );
  assert.ok(sys.includes("How you write (mirror this): lowercase, terse, uses emoji"));
}

// nowText is injected so eri answers date/time itself instead of dispatching it.
{
  const sys = buildSystemPrompt(null, null, "Monday, June 16, 2026 at 7:13 PM EDT");
  assert.ok(sys.includes("Right now it is Monday, June 16, 2026 at 7:13 PM EDT"));
  // and it still works alongside a known-profile block
  const sys2 = buildSystemPrompt({ facts: ["name is Khai"] }, null, "Tuesday, June 17, 2026");
  assert.ok(sys2.includes("Right now it is Tuesday, June 17, 2026"));
  assert.ok(sys2.includes("- name is Khai"));
  // blank nowText is omitted (no dangling "Right now it is .")
  assert.ok(!buildSystemPrompt(null, null, "   ").includes("Right now it is"));
}

// currentDateText produces a real, non-empty date string (smoke).
{
  const now = currentDateText();
  assert.ok(typeof now === "string" && now.length > 0);
  assert.ok(/2026|2027/.test(now), "includes a plausible year");
}

// eslint-disable-next-line no-console
console.log("run-core.test.ts: all assertions passed");
