"use strict";
// Tests for terminal-gaze attention picker and EMA smoothing.
Object.defineProperty(exports, "__esModule", { value: true });
require("./vscodeStub");
const node_assert_1 = require("node:assert");
const vscodeStub_1 = require("./vscodeStub");
const gaze_1 = require("../gaze");
function makeContext() {
    return { subscriptions: [] };
}
function testNoTerminalsNoAttention() {
    (0, vscodeStub_1.resetMockState)();
    const ctx = makeContext();
    const events = [];
    const handle = (0, gaze_1.activateTerminalGaze)(ctx);
    handle.onAttention((e) => events.push(e.terminalId));
    handle.ingestPointForTest({ nx: 0.5, ny: 0.9, tMs: 1000 });
    handle.ingestPointForTest({ nx: 0.5, ny: 0.9, tMs: 1500 });
    node_assert_1.strict.equal(events.length, 0, "no terminals means no attention events");
    node_assert_1.strict.equal(handle.attendedTerminalId(), undefined);
}
function testGazeOnTerminalBandFires() {
    (0, vscodeStub_1.resetMockState)();
    const state = (0, vscodeStub_1.getMockState)();
    state.terminals.push((0, vscodeStub_1.makeTerminal)("a", "tid-a"));
    state.terminals.push((0, vscodeStub_1.makeTerminal)("b", "tid-b"));
    // Dwell threshold is 200ms in test config.
    const ctx = makeContext();
    const events = [];
    const handle = (0, gaze_1.activateTerminalGaze)(ctx);
    handle.onAttention((e) => events.push(e.terminalId));
    // nx=0.75 → right half → terminal "b"
    handle.ingestPointForTest({ nx: 0.75, ny: 0.85, tMs: 1000 });
    handle.ingestPointForTest({ nx: 0.75, ny: 0.85, tMs: 1100 });
    handle.ingestPointForTest({ nx: 0.75, ny: 0.85, tMs: 1300 });
    node_assert_1.strict.ok(events.length >= 1, "should fire at least one attention event");
    node_assert_1.strict.equal(handle.attendedTerminalId(), "tid-b");
}
function testGazeOutsideBandClears() {
    (0, vscodeStub_1.resetMockState)();
    const state = (0, vscodeStub_1.getMockState)();
    state.terminals.push((0, vscodeStub_1.makeTerminal)("a", "tid-a"));
    const ctx = makeContext();
    const events = [];
    const handle = (0, gaze_1.activateTerminalGaze)(ctx);
    handle.onAttention((e) => events.push(e.terminalId));
    // Build up attention first.
    handle.ingestPointForTest({ nx: 0.5, ny: 0.85, tMs: 1000 });
    handle.ingestPointForTest({ nx: 0.5, ny: 0.85, tMs: 1100 });
    handle.ingestPointForTest({ nx: 0.5, ny: 0.85, tMs: 1300 });
    node_assert_1.strict.equal(handle.attendedTerminalId(), "tid-a");
    // Now look away (top of screen) — EMA decays.
    for (let i = 0; i < 8; i += 1) {
        handle.ingestPointForTest({ nx: 0.5, ny: 0.1, tMs: 2000 + i * 50 });
    }
    node_assert_1.strict.equal(handle.attendedTerminalId(), undefined, "attention should clear after looking away");
}
function testGazeDisabledShortCircuits() {
    (0, vscodeStub_1.resetMockState)();
    const state = (0, vscodeStub_1.getMockState)();
    state.config["eri.terminals"].gazeTargeting = false;
    state.terminals.push((0, vscodeStub_1.makeTerminal)("a", "tid-a"));
    const ctx = makeContext();
    const events = [];
    const handle = (0, gaze_1.activateTerminalGaze)(ctx);
    handle.onAttention((e) => events.push(e.terminalId));
    for (let i = 0; i < 10; i += 1) {
        handle.ingestPointForTest({ nx: 0.5, ny: 0.85, tMs: 1000 + i * 100 });
    }
    node_assert_1.strict.equal(events.length, 0, "no events when gaze targeting disabled");
}
function run() {
    testNoTerminalsNoAttention();
    testGazeOnTerminalBandFires();
    testGazeOutsideBandClears();
    testGazeDisabledShortCircuits();
    process.stdout.write("gaze.test.ts: 4 cases passed\n");
}
run();
//# sourceMappingURL=gaze.test.js.map