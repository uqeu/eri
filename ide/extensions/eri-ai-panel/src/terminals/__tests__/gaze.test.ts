// Tests for terminal-gaze attention picker and EMA smoothing.

import "./vscodeStub";
import { strict as assert } from "node:assert";
import { getMockState, makeTerminal, resetMockState } from "./vscodeStub";
import { activateTerminalGaze } from "../gaze";

interface FakeContext {
  subscriptions: Array<{ dispose(): void }>;
}

function makeContext(): FakeContext {
  return { subscriptions: [] };
}

function testNoTerminalsNoAttention(): void {
  resetMockState();
  const ctx = makeContext();
  const events: Array<string | null> = [];
  const handle = activateTerminalGaze(ctx as never);
  handle.onAttention((e) => events.push(e.terminalId));
  handle.ingestPointForTest({ nx: 0.5, ny: 0.9, tMs: 1000 });
  handle.ingestPointForTest({ nx: 0.5, ny: 0.9, tMs: 1500 });
  assert.equal(events.length, 0, "no terminals means no attention events");
  assert.equal(handle.attendedTerminalId(), undefined);
}

function testGazeOnTerminalBandFires(): void {
  resetMockState();
  const state = getMockState();
  state.terminals.push(makeTerminal("a", "tid-a"));
  state.terminals.push(makeTerminal("b", "tid-b"));
  // Dwell threshold is 200ms in test config.
  const ctx = makeContext();
  const events: Array<string | null> = [];
  const handle = activateTerminalGaze(ctx as never);
  handle.onAttention((e) => events.push(e.terminalId));
  // nx=0.75 → right half → terminal "b"
  handle.ingestPointForTest({ nx: 0.75, ny: 0.85, tMs: 1000 });
  handle.ingestPointForTest({ nx: 0.75, ny: 0.85, tMs: 1100 });
  handle.ingestPointForTest({ nx: 0.75, ny: 0.85, tMs: 1300 });
  assert.ok(events.length >= 1, "should fire at least one attention event");
  assert.equal(handle.attendedTerminalId(), "tid-b");
}

function testGazeOutsideBandClears(): void {
  resetMockState();
  const state = getMockState();
  state.terminals.push(makeTerminal("a", "tid-a"));
  const ctx = makeContext();
  const events: Array<string | null> = [];
  const handle = activateTerminalGaze(ctx as never);
  handle.onAttention((e) => events.push(e.terminalId));
  // Build up attention first.
  handle.ingestPointForTest({ nx: 0.5, ny: 0.85, tMs: 1000 });
  handle.ingestPointForTest({ nx: 0.5, ny: 0.85, tMs: 1100 });
  handle.ingestPointForTest({ nx: 0.5, ny: 0.85, tMs: 1300 });
  assert.equal(handle.attendedTerminalId(), "tid-a");
  // Now look away (top of screen) — EMA decays.
  for (let i = 0; i < 8; i += 1) {
    handle.ingestPointForTest({ nx: 0.5, ny: 0.1, tMs: 2000 + i * 50 });
  }
  assert.equal(handle.attendedTerminalId(), undefined, "attention should clear after looking away");
}

function testGazeDisabledShortCircuits(): void {
  resetMockState();
  const state = getMockState();
  state.config["eri.terminals"]!.gazeTargeting = false;
  state.terminals.push(makeTerminal("a", "tid-a"));
  const ctx = makeContext();
  const events: Array<string | null> = [];
  const handle = activateTerminalGaze(ctx as never);
  handle.onAttention((e) => events.push(e.terminalId));
  for (let i = 0; i < 10; i += 1) {
    handle.ingestPointForTest({ nx: 0.5, ny: 0.85, tMs: 1000 + i * 100 });
  }
  assert.equal(events.length, 0, "no events when gaze targeting disabled");
}

function run(): void {
  testNoTerminalsNoAttention();
  testGazeOnTerminalBandFires();
  testGazeOutsideBandClears();
  testGazeDisabledShortCircuits();
  process.stdout.write("gaze.test.ts: 4 cases passed\n");
}

run();
