// Pure-function tests for the voice view-intent classifier.
// Runs without a test runner: `node out/terminals/__tests__/viewIntents.test.js`.

import { strict as assert } from "node:assert";
import { matchTerminalIntent, TerminalSnapshot } from "../intentMatcher";
import { matchViewIntent, looksLikeViewIntent } from "../viewIntents";

function snap(over: Partial<TerminalSnapshot> & { id: string; name: string }): TerminalSnapshot {
  return {
    group: "default",
    cwd: "/tmp",
    blocks: [],
    ...over,
  };
}

interface ZoomCase {
  readonly transcript: string;
  readonly direction: "in" | "out";
  readonly magnitude: "small" | "big";
}

const ZOOM_CASES: ReadonlyArray<ZoomCase> = [
  { transcript: "zoom in a little", direction: "in", magnitude: "small" },
  { transcript: "zoom in a lot", direction: "in", magnitude: "big" },
  { transcript: "zoom out a bit", direction: "out", magnitude: "small" },
  { transcript: "make it bigger", direction: "in", magnitude: "small" },
  { transcript: "make it smaller please", direction: "out", magnitude: "small" },
];

interface ScrollCase {
  readonly transcript: string;
  readonly direction: "up" | "down" | "left" | "right";
  readonly magnitude: "small" | "big";
}

const SCROLL_CASES: ReadonlyArray<ScrollCase> = [
  { transcript: "scroll down a little", direction: "down", magnitude: "small" },
  { transcript: "scroll up a lot", direction: "up", magnitude: "big" },
  { transcript: "scroll left", direction: "left", magnitude: "small" },
  { transcript: "scroll right slightly", direction: "right", magnitude: "small" },
  { transcript: "go to the bottom", direction: "down", magnitude: "big" },
  { transcript: "go to the top", direction: "up", magnitude: "big" },
];

interface NavigateCase {
  readonly transcript: string;
  readonly target: string;
}

const NAVIGATE_CASES: ReadonlyArray<NavigateCase> = [
  { transcript: "show me extension.ts", target: "extension.ts" },
  { transcript: "show me the hero headline", target: "hero headline" },
  { transcript: "reveal handleNotification", target: "handleNotification" },
  { transcript: "go to package.json", target: "package.json" },
  { transcript: "open the pricing section", target: "pricing section" },
];

function testZoomClassification(): void {
  for (const c of ZOOM_CASES) {
    const intent = matchViewIntent(c.transcript);
    assert.ok(intent, `expected zoom match for "${c.transcript}"`);
    assert.equal(intent.kind, "zoom", `kind for "${c.transcript}"`);
    if (intent.kind === "zoom") {
      assert.equal(intent.direction, c.direction, `direction for "${c.transcript}"`);
      assert.equal(intent.magnitude, c.magnitude, `magnitude for "${c.transcript}"`);
    }
  }
}

function testScrollClassification(): void {
  for (const c of SCROLL_CASES) {
    const intent = matchViewIntent(c.transcript);
    assert.ok(intent, `expected scroll match for "${c.transcript}"`);
    assert.equal(intent.kind, "scroll", `kind for "${c.transcript}"`);
    if (intent.kind === "scroll") {
      assert.equal(intent.direction, c.direction, `direction for "${c.transcript}"`);
      assert.equal(intent.magnitude, c.magnitude, `magnitude for "${c.transcript}"`);
    }
  }
}

function testNavigateClassification(): void {
  for (const c of NAVIGATE_CASES) {
    const intent = matchViewIntent(c.transcript);
    assert.ok(intent, `expected navigate match for "${c.transcript}"`);
    assert.equal(intent.kind, "navigate", `kind for "${c.transcript}"`);
    if (intent.kind === "navigate") {
      assert.equal(intent.target, c.target, `target for "${c.transcript}"`);
    }
  }
}

function testTerminalShowRegressionGuard(): void {
  // "show me the dev terminal" must still classify as a terminal focus
  // intent, not a navigate intent. matchViewIntent should refuse it and
  // matchTerminalIntent should still claim it with kind=focus when a
  // matching terminal exists.
  const transcript = "show me the dev terminal";
  assert.equal(matchViewIntent(transcript), null, "view matcher must refuse terminal target");
  const terms: TerminalSnapshot[] = [
    snap({ id: "t1", name: "dev terminal", lastCommand: "npm run dev" }),
  ];
  const out = matchTerminalIntent(transcript, terms);
  assert.ok(out, "expected terminal match");
  assert.equal(out.kind, "focus");
  assert.equal(out.terminalId, "t1");
}

function testModeSwitchClassification(): void {
  const cases: ReadonlyArray<{ transcript: string; target: "coder" | "eri" }> = [
    { transcript: "switch to eri mode", target: "eri" },
    { transcript: "go to coder mode", target: "coder" },
    { transcript: "open eri mode", target: "eri" },
    { transcript: "enter coding mode", target: "coder" },
    { transcript: "flip to eri", target: "eri" },
  ];
  for (const c of cases) {
    const intent = matchViewIntent(c.transcript);
    assert.ok(intent, `expected mode match for "${c.transcript}"`);
    assert.equal(intent.kind, "mode", `kind for "${c.transcript}"`);
    if (intent.kind === "mode") {
      assert.equal(intent.target, c.target, `target for "${c.transcript}"`);
    }
  }
}

function testNoMatchOnPlainChat(): void {
  // Things that should NOT trigger view intents — they're chat.
  const noise = [
    "what do you think of this",
    "rename this to handleClick",
    "fix the bug in this file",
    "what does this function return",
  ];
  for (const text of noise) {
    const result = matchViewIntent(text);
    assert.equal(result, null, `expected null for noise: "${text}" got ${JSON.stringify(result)}`);
    assert.equal(looksLikeViewIntent(text), false, `looksLikeViewIntent should be false for "${text}"`);
  }
}

function run(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (err) {
    console.error(`fail ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

run("zoom intents classify correctly", testZoomClassification);
run("scroll intents classify correctly", testScrollClassification);
run("navigate intents classify correctly", testNavigateClassification);
run("mode switch intents classify correctly", testModeSwitchClassification);
run("terminal 'show me the dev terminal' regression guard", testTerminalShowRegressionGuard);
run("plain chat does not trigger view intents", testNoMatchOnPlainChat);
