// Integration-style tests for the voice wiring. The vscode module is stubbed
// in vscodeStub.ts which must be imported FIRST so the require cache contains
// the stub before voice.ts loads.

import "./vscodeStub";
import { strict as assert } from "node:assert";
import { getMockState, makeTerminal, resetMockState } from "./vscodeStub";
import { activateTerminalVoice } from "../voice";

interface FakeContext {
  subscriptions: Array<{ dispose(): void }>;
}

function makeContext(): FakeContext {
  return { subscriptions: [] };
}

function testFocusOnDevServer(): void {
  resetMockState();
  const state = getMockState();
  const dev = makeTerminal("dev server", "id-dev");
  state.terminals.push(dev);

  const ctx = makeContext();
  const handle = activateTerminalVoice(ctx as never, {
    getSidecar: () => null,
  });
  handle.forward({
    method: "eri/voice/final",
    params: { text: "show me the dev server" },
  });

  const cast = dev as unknown as { _showCount?: number };
  assert.equal(cast._showCount, 1, "terminal.show should be called once");
  assert.ok(
    state.statusMessages.some((m) => m.text.includes("dev server")),
    "status bar message should mention dev server",
  );
}

function testKillSendsCtrlCByDefault(): void {
  resetMockState();
  const state = getMockState();
  const cargo = makeTerminal("shell", "id-cargo");
  state.terminals.push(cargo);
  // We need the snapshot to expose lastCommand. The voice module pulls
  // lastCommand from a blocks provider — supply one.
  const ctx = makeContext();
  const handle = activateTerminalVoice(ctx as never, {
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
  const cast = cargo as unknown as { _sent?: string[]; _disposed?: boolean };
  assert.ok(cast._sent && cast._sent.length === 1, "should send one chunk");
  assert.equal(cast._sent[0], String.fromCharCode(3), "should send Ctrl+C byte");
  assert.notEqual(cast._disposed, true, "soft kill should not dispose");
}

function testKillHardDisposes(): void {
  resetMockState();
  const state = getMockState();
  state.config["eri.terminals"]!.killSoftCtrlC = false;
  const t = makeTerminal("runner", "id-runner");
  state.terminals.push(t);
  const ctx = makeContext();
  const handle = activateTerminalVoice(ctx as never, {
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
  const cast = t as unknown as { _disposed?: boolean };
  assert.equal(cast._disposed, true, "hard kill should dispose terminal");
}

function testSendTypesPayload(): void {
  resetMockState();
  const state = getMockState();
  const rust = makeTerminal("rust shell", "id-rust");
  state.terminals.push(rust);
  const ctx = makeContext();
  const handle = activateTerminalVoice(ctx as never, {
    getSidecar: () => null,
  });
  handle.forward({
    method: "eri/voice/final",
    params: { text: "in the rust shell type cargo test" },
  });
  const cast = rust as unknown as { _sent?: string[] };
  assert.deepEqual(cast._sent, ["cargo test"]);
}

function testSpawnLayoutDispatchesCommand(): void {
  resetMockState();
  const state = getMockState();
  const ctx = makeContext();
  const handle = activateTerminalVoice(ctx as never, {
    getSidecar: () => null,
  });
  handle.forward({
    method: "eri/voice/final",
    params: { text: "spawn my rust stack" },
  });
  // Allow the async dispatch to settle.
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      const cmd = state.executedCommands.find(
        (c) => c.command === "eri.terminals.restoreLayout",
      );
      assert.ok(cmd, "restoreLayout command should be dispatched");
      assert.ok(
        typeof cmd.args[0] === "string" && (cmd.args[0] as string).includes("rust"),
        `payload should mention rust, got: ${String(cmd.args[0])}`,
      );
      resolve();
    }, 10);
  }) as unknown as void;
}

function testVoiceDisabledShortCircuits(): void {
  resetMockState();
  const state = getMockState();
  state.config["eri.terminals"]!.voiceTargeting = false;
  const dev = makeTerminal("dev server", "id-dev");
  state.terminals.push(dev);

  const ctx = makeContext();
  const handle = activateTerminalVoice(ctx as never, {
    getSidecar: () => null,
  });
  handle.forward({
    method: "eri/voice/final",
    params: { text: "show me the dev server" },
  });
  const cast = dev as unknown as { _showCount?: number };
  assert.notEqual(cast._showCount, 1, "must not act when voice disabled");
}

async function run(): Promise<void> {
  testFocusOnDevServer();
  testKillSendsCtrlCByDefault();
  testKillHardDisposes();
  testSendTypesPayload();
  await (testSpawnLayoutDispatchesCommand() as unknown as Promise<void>);
  testVoiceDisabledShortCircuits();
  process.stdout.write("voice.test.ts: 6 cases passed\n");
}

run().catch((err) => {
  process.stderr.write(`voice.test.ts FAILED: ${String(err)}\n`);
  process.exit(1);
});
