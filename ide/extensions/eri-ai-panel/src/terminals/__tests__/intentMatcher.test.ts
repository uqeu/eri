// Pure-function tests for the terminal intent matcher.
// Runs without a test runner: `node out/terminals/__tests__/intentMatcher.test.js`.

import { strict as assert } from "node:assert";
import {
  TerminalSnapshot,
  matchTerminalIntent,
} from "../intentMatcher";

function snap(over: Partial<TerminalSnapshot> & { id: string; name: string }): TerminalSnapshot {
  return {
    group: "default",
    cwd: "/tmp",
    blocks: [],
    ...over,
  };
}

function testFocusByName(): void {
  const terms: TerminalSnapshot[] = [
    snap({ id: "t1", name: "dev server", lastCommand: "npm run dev" }),
    snap({ id: "t2", name: "rust", lastCommand: "cargo check" }),
  ];
  const out = matchTerminalIntent("show me the dev server", terms);
  assert.ok(out, "expected match");
  assert.equal(out.kind, "focus");
  assert.equal(out.terminalId, "t1");
}

function testKillResolvesByLastCommand(): void {
  const terms: TerminalSnapshot[] = [
    snap({ id: "cargo", name: "shell", lastCommand: "cargo build" }),
    snap({ id: "vite", name: "frontend", lastCommand: "vite dev" }),
  ];
  const out = matchTerminalIntent("kill the build", terms);
  assert.ok(out, "expected kill match");
  assert.equal(out.kind, "kill");
  assert.equal(out.terminalId, "cargo");
}

function testKillCtrlCAlias(): void {
  const terms: TerminalSnapshot[] = [
    snap({ id: "runner", name: "test runner", lastCommand: "pytest" }),
  ];
  const out = matchTerminalIntent("ctrl-c the runner", terms);
  assert.ok(out, "expected match");
  assert.equal(out.kind, "kill");
  assert.equal(out.terminalId, "runner");
}

function testSendExtractsPayload(): void {
  const terms: TerminalSnapshot[] = [
    snap({ id: "dev", name: "dev terminal", lastCommand: "npm run dev" }),
    snap({ id: "rust", name: "rust shell", lastCommand: "cargo run" }),
  ];
  const out = matchTerminalIntent("in the dev terminal type cargo check", terms);
  assert.ok(out, "expected send match");
  assert.equal(out.kind, "send");
  assert.equal(out.terminalId, "dev");
  assert.equal(out.payload, "cargo check");
}

function testSendReverseShape(): void {
  const terms: TerminalSnapshot[] = [
    snap({ id: "rust", name: "rust shell", lastCommand: "cargo run" }),
    snap({ id: "node", name: "node repl", lastCommand: "node" }),
  ];
  const out = matchTerminalIntent("run cargo test in the rust shell", terms);
  assert.ok(out, "expected send match");
  assert.equal(out.kind, "send");
  assert.equal(out.terminalId, "rust");
  assert.equal(out.payload, "cargo test");
}

function testSpawnLayout(): void {
  const out = matchTerminalIntent("spawn my rust stack", []);
  assert.ok(out, "expected layout match");
  assert.equal(out.kind, "spawn-layout");
  assert.ok(
    out.payload?.includes("rust") ?? false,
    `payload should mention rust, got: ${out.payload ?? "<null>"}`,
  );
}

function testSpawnLayoutNoun(): void {
  const out = matchTerminalIntent("open my frontend layout", []);
  assert.ok(out, "expected layout match");
  assert.equal(out.kind, "spawn-layout");
  assert.ok(
    (out.payload ?? "").includes("frontend"),
    `payload should mention frontend, got: ${out.payload ?? "<null>"}`,
  );
}

function testAmbiguousReturnsNull(): void {
  // Two terminals with nothing in common with the transcript → no claim.
  const terms: TerminalSnapshot[] = [
    snap({ id: "a", name: "alpha" }),
    snap({ id: "b", name: "beta" }),
  ];
  const out = matchTerminalIntent("the weather is nice", terms);
  assert.equal(out, null, "unrelated transcript must return null");
}

function testPronounUsesGazeFallback(): void {
  const terms: TerminalSnapshot[] = [
    snap({ id: "a", name: "alpha" }),
    snap({ id: "b", name: "beta" }),
  ];
  const out = matchTerminalIntent("kill it", terms, {
    gazeAttendedTerminalId: "b",
  });
  assert.ok(out, "expected gaze fusion match");
  assert.equal(out.kind, "kill");
  assert.equal(out.terminalId, "b");
  assert.equal(out.resolvedViaGaze, true);
}

function testTieBreakerByRecency(): void {
  const terms: TerminalSnapshot[] = [
    snap({ id: "older", name: "shell", lastActiveAt: 1 }),
    snap({ id: "newer", name: "shell", lastActiveAt: 5 }),
  ];
  const out = matchTerminalIntent("open the shell", terms);
  assert.ok(out, "expected match");
  assert.equal(out.terminalId, "newer", "most recent should win ties");
}

function run(): void {
  testFocusByName();
  testKillResolvesByLastCommand();
  testKillCtrlCAlias();
  testSendExtractsPayload();
  testSendReverseShape();
  testSpawnLayout();
  testSpawnLayoutNoun();
  testAmbiguousReturnsNull();
  testPronounUsesGazeFallback();
  testTieBreakerByRecency();
  process.stdout.write("intentMatcher.test.ts: 10 cases passed\n");
}

run();
