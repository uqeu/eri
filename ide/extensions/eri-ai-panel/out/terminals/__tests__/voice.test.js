"use strict";
// Integration-style tests for the voice wiring. The vscode module is stubbed
// in vscodeStub.ts which must be imported FIRST so the require cache contains
// the stub before voice.ts loads.
Object.defineProperty(exports, "__esModule", { value: true });
require("./vscodeStub");
const node_assert_1 = require("node:assert");
const vscodeStub_1 = require("./vscodeStub");
const voice_1 = require("../voice");
function makeContext() {
    return { subscriptions: [] };
}
function testFocusOnDevServer() {
    (0, vscodeStub_1.resetMockState)();
    const state = (0, vscodeStub_1.getMockState)();
    const dev = (0, vscodeStub_1.makeTerminal)("dev server", "id-dev");
    state.terminals.push(dev);
    const ctx = makeContext();
    const handle = (0, voice_1.activateTerminalVoice)(ctx, {
        getSidecar: () => null,
    });
    handle.forward({
        method: "eri/voice/final",
        params: { text: "show me the dev server" },
    });
    const cast = dev;
    node_assert_1.strict.equal(cast._showCount, 1, "terminal.show should be called once");
    node_assert_1.strict.ok(state.statusMessages.some((m) => m.text.includes("dev server")), "status bar message should mention dev server");
}
function testKillSendsCtrlCByDefault() {
    (0, vscodeStub_1.resetMockState)();
    const state = (0, vscodeStub_1.getMockState)();
    const cargo = (0, vscodeStub_1.makeTerminal)("shell", "id-cargo");
    state.terminals.push(cargo);
    // We need the snapshot to expose lastCommand. The voice module pulls
    // lastCommand from a blocks provider — supply one.
    const ctx = makeContext();
    const handle = (0, voice_1.activateTerminalVoice)(ctx, {
        getSidecar: () => null,
        blocks: {
            blocksForTerminal: () => [{ command: "cargo build" }],
            lastCommand: () => "cargo build",
        },
    });
    handle.forward({
        method: "eri/voice/final",
        params: { text: "kill the build" },
    });
    const cast = cargo;
    node_assert_1.strict.ok(cast._sent && cast._sent.length === 1, "should send one chunk");
    node_assert_1.strict.equal(cast._sent[0], String.fromCharCode(3), "should send Ctrl+C byte");
    node_assert_1.strict.notEqual(cast._disposed, true, "soft kill should not dispose");
}
function testKillHardDisposes() {
    (0, vscodeStub_1.resetMockState)();
    const state = (0, vscodeStub_1.getMockState)();
    state.config["eri.terminals"].killSoftCtrlC = false;
    const t = (0, vscodeStub_1.makeTerminal)("runner", "id-runner");
    state.terminals.push(t);
    const ctx = makeContext();
    const handle = (0, voice_1.activateTerminalVoice)(ctx, {
        getSidecar: () => null,
        blocks: {
            blocksForTerminal: () => [{ command: "pytest" }],
            lastCommand: () => "pytest",
        },
    });
    handle.forward({
        method: "eri/voice/final",
        params: { text: "kill the runner" },
    });
    const cast = t;
    node_assert_1.strict.equal(cast._disposed, true, "hard kill should dispose terminal");
}
function testSendTypesPayload() {
    (0, vscodeStub_1.resetMockState)();
    const state = (0, vscodeStub_1.getMockState)();
    const rust = (0, vscodeStub_1.makeTerminal)("rust shell", "id-rust");
    state.terminals.push(rust);
    const ctx = makeContext();
    const handle = (0, voice_1.activateTerminalVoice)(ctx, {
        getSidecar: () => null,
    });
    handle.forward({
        method: "eri/voice/final",
        params: { text: "in the rust shell type cargo test" },
    });
    const cast = rust;
    node_assert_1.strict.deepEqual(cast._sent, ["cargo test"]);
}
function testSpawnLayoutDispatchesCommand() {
    (0, vscodeStub_1.resetMockState)();
    const state = (0, vscodeStub_1.getMockState)();
    const ctx = makeContext();
    const handle = (0, voice_1.activateTerminalVoice)(ctx, {
        getSidecar: () => null,
    });
    handle.forward({
        method: "eri/voice/final",
        params: { text: "spawn my rust stack" },
    });
    // Allow the async dispatch to settle.
    return new Promise((resolve) => {
        setTimeout(() => {
            const cmd = state.executedCommands.find((c) => c.command === "eri.terminals.restoreLayout");
            node_assert_1.strict.ok(cmd, "restoreLayout command should be dispatched");
            node_assert_1.strict.ok(typeof cmd.args[0] === "string" && cmd.args[0].includes("rust"), `payload should mention rust, got: ${String(cmd.args[0])}`);
            resolve();
        }, 10);
    });
}
function testVoiceDisabledShortCircuits() {
    (0, vscodeStub_1.resetMockState)();
    const state = (0, vscodeStub_1.getMockState)();
    state.config["eri.terminals"].voiceTargeting = false;
    const dev = (0, vscodeStub_1.makeTerminal)("dev server", "id-dev");
    state.terminals.push(dev);
    const ctx = makeContext();
    const handle = (0, voice_1.activateTerminalVoice)(ctx, {
        getSidecar: () => null,
    });
    handle.forward({
        method: "eri/voice/final",
        params: { text: "show me the dev server" },
    });
    const cast = dev;
    node_assert_1.strict.notEqual(cast._showCount, 1, "must not act when voice disabled");
}
async function run() {
    testFocusOnDevServer();
    testKillSendsCtrlCByDefault();
    testKillHardDisposes();
    testSendTypesPayload();
    await testSpawnLayoutDispatchesCommand();
    testVoiceDisabledShortCircuits();
    process.stdout.write("voice.test.ts: 6 cases passed\n");
}
run().catch((err) => {
    process.stderr.write(`voice.test.ts FAILED: ${String(err)}\n`);
    process.exit(1);
});
//# sourceMappingURL=voice.test.js.map