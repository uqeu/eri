import { strict as assert } from "node:assert";
import { buildSystemPrompt } from "../agent/run_core";

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

// eslint-disable-next-line no-console
console.log("run-core.test.ts: all assertions passed");
