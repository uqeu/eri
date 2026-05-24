// Pure-logic tests for the eri agents module. Run with:
//   node out/agents/__tests__/agents.test.js
//
// Strategy mirrors src/account/__tests__/account.test.ts: stub the
// `vscode` module in require cache so importing registry / picker
// modules succeeds without an extension host.

import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const Module = require("module") as {
  _resolveFilename: (req: string, parent: unknown) => string;
  _cache: Record<string, unknown>;
};
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request: string, parent: unknown) {
  if (request === "vscode") return "vscode";
  return originalResolve.call(this, request, parent);
};

class StubEmitter<T> {
  private readonly listeners: Array<(v: T) => void> = [];
  fire(v: T): void {
    for (const l of this.listeners) l(v);
  }
  get event(): (l: (v: T) => void) => { dispose: () => void } {
    return (l) => {
      this.listeners.push(l);
      return { dispose: () => undefined };
    };
  }
  dispose(): void {
    this.listeners.length = 0;
  }
}

Module._cache["vscode"] = {
  exports: {
    EventEmitter: StubEmitter,
    Disposable: class {
      constructor(private readonly fn: () => void) {}
      dispose(): void {
        this.fn();
      }
    },
    workspace: {
      getConfiguration: () => ({ get: <T>(_: string, d: T) => d }),
      workspaceFolders: undefined,
      onDidChangeConfiguration: () => ({ dispose: () => undefined }),
    },
    window: {
      createStatusBarItem: () => ({
        text: "",
        tooltip: "",
        command: "",
        show: () => undefined,
        hide: () => undefined,
        dispose: () => undefined,
      }),
      createTreeView: () => ({ dispose: () => undefined }),
      showInformationMessage: () => Promise.resolve(undefined),
      showQuickPick: () => Promise.resolve(undefined),
    },
    commands: { registerCommand: () => ({ dispose: () => undefined }) },
    env: {},
    StatusBarAlignment: { Left: 1, Right: 2 },
    ThemeIcon: class {
      constructor(public readonly id: string) {}
    },
    TreeItem: class {
      label: string;
      collapsibleState: number;
      description = "";
      tooltip = "";
      contextValue = "";
      iconPath: unknown = undefined;
      command: unknown = undefined;
      constructor(label: string, collapsibleState: number) {
        this.label = label;
        this.collapsibleState = collapsibleState;
      }
    },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    MarkdownString: class {
      isTrusted = false;
      constructor(public readonly value: string) {}
    },
    Uri: {
      parse: (s: string) => ({ toString: () => s, fsPath: s }),
      file: (s: string) => ({ toString: () => s, fsPath: s }),
      joinPath: (base: { fsPath: string }, ...parts: string[]) => ({
        fsPath: path.join(base.fsPath, ...parts),
      }),
    },
  },
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AgentRegistry } = require("../registry") as typeof import("../registry");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AGENT_ID, builtinDescriptors } = require("../builtins") as typeof import("../builtins");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseNdjsonLine } = require("../cliAgent") as typeof import("../cliAgent");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { detectCliBinaries, loadUserAgentFiles } = require("../detection") as typeof import("../detection");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { CliAgent } = require("../cliAgent") as typeof import("../cliAgent");

class FakeMemento {
  private readonly map = new Map<string, unknown>();
  get<T>(k: string): T | undefined {
    return this.map.get(k) as T | undefined;
  }
  update(k: string, v: unknown): Promise<void> {
    if (v === undefined) this.map.delete(k);
    else this.map.set(k, v);
    return Promise.resolve();
  }
}
class FakeSession {
  constructor(private readonly signedIn: boolean) {}
  isSignedIn(): boolean {
    return this.signedIn;
  }
}
class FakeSecrets {
  constructor(private readonly stored: ReadonlyMap<string, boolean> = new Map()) {}
  async has(providerId: string, fieldKey: string): Promise<boolean> {
    return this.stored.get(`${providerId}.${fieldKey}`) === true;
  }
}

async function testRegistryLoadsBuiltins(): Promise<void> {
  const registry = new AgentRegistry({
    session: new FakeSession(false),
    secrets: new FakeSecrets(),
    globalState: new FakeMemento() as unknown as import("vscode").Memento,
    getWorkspaceRoot: () => undefined,
    which: async () => null,
  });
  const list = registry.list();
  assert.equal(list.length, builtinDescriptors().length);
  assert.ok(registry.get(AGENT_ID.mercury));
  assert.ok(registry.get(AGENT_ID.auto));
}

async function testProxyAvailableOnlyWhenSignedIn(): Promise<void> {
  const offline = new AgentRegistry({
    session: new FakeSession(false),
    secrets: new FakeSecrets(),
    globalState: new FakeMemento() as unknown as import("vscode").Memento,
    getWorkspaceRoot: () => undefined,
    which: async () => null,
  });
  await offline.refreshAvailability();
  assert.equal(offline.get(AGENT_ID.claudeProxy)?.available, false);

  const online = new AgentRegistry({
    session: new FakeSession(true),
    secrets: new FakeSecrets(),
    globalState: new FakeMemento() as unknown as import("vscode").Memento,
    getWorkspaceRoot: () => undefined,
    which: async () => null,
  });
  await online.refreshAvailability();
  assert.equal(online.get(AGENT_ID.claudeProxy)?.available, true);
}

async function testCliDetectionMakesAgentAvailable(): Promise<void> {
  const which = async (binary: string): Promise<string | null> => {
    return binary === "claude" ? "/usr/local/bin/claude" : null;
  };
  const detection = await detectCliBinaries(["claude", "codex", "aider"], which);
  assert.equal(detection.binaries.get("claude"), "/usr/local/bin/claude");
  assert.equal(detection.binaries.has("codex"), false);

  const registry = new AgentRegistry({
    session: new FakeSession(true),
    secrets: new FakeSecrets(),
    globalState: new FakeMemento() as unknown as import("vscode").Memento,
    getWorkspaceRoot: () => undefined,
    which,
  });
  await registry.refreshAvailability();
  const claude = registry.get(AGENT_ID.claudeCode);
  assert.ok(claude);
  assert.equal(claude?.available, true);
  assert.equal(claude?.binary, "/usr/local/bin/claude");
  assert.equal(registry.get(AGENT_ID.codex)?.available, false);
}

async function testByokAvailabilityFromSecrets(): Promise<void> {
  const stored = new Map<string, boolean>([["anthropic.anthropic-api-key", true]]);
  const registry = new AgentRegistry({
    session: new FakeSession(false),
    secrets: new FakeSecrets(stored),
    globalState: new FakeMemento() as unknown as import("vscode").Memento,
    getWorkspaceRoot: () => undefined,
    which: async () => null,
  });
  await registry.refreshAvailability();
  assert.equal(registry.get(AGENT_ID.claudeByok)?.available, true);
  assert.equal(registry.get(AGENT_ID.gptByok)?.available, false);
}

async function testActiveAgentPersists(): Promise<void> {
  const memento = new FakeMemento();
  const registry1 = new AgentRegistry({
    session: new FakeSession(true),
    secrets: new FakeSecrets(),
    globalState: memento as unknown as import("vscode").Memento,
    getWorkspaceRoot: () => undefined,
    which: async () => "/usr/local/bin/claude",
  });
  await registry1.refreshAvailability();
  await registry1.setActive(AGENT_ID.claudeCode);
  assert.equal(registry1.active().id, AGENT_ID.claudeCode);

  const registry2 = new AgentRegistry({
    session: new FakeSession(true),
    secrets: new FakeSecrets(),
    globalState: memento as unknown as import("vscode").Memento,
    getWorkspaceRoot: () => undefined,
    which: async () => "/usr/local/bin/claude",
  });
  await registry2.refreshAvailability();
  assert.equal(registry2.active().id, AGENT_ID.claudeCode);
}

async function testCustomAgentFromUserFile(): Promise<void> {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "eri-agents-"));
  const dir = path.join(tmpRoot, ".eri");
  fs.mkdirSync(dir);
  fs.writeFileSync(
    path.join(dir, "agents.json"),
    JSON.stringify({
      agents: [
        {
          id: "my-custom",
          label: "My Custom",
          kind: "cli",
          binary: "/bin/echo",
          binaryArgs: ["--workspace", "${workspaceRoot}"],
        },
      ],
    }),
  );
  const file = loadUserAgentFiles(tmpRoot);
  assert.equal(file.agents.length, 1);
  assert.equal(file.agents[0].id, "my-custom");

  const registry = new AgentRegistry({
    session: new FakeSession(true),
    secrets: new FakeSecrets(),
    globalState: new FakeMemento() as unknown as import("vscode").Memento,
    getWorkspaceRoot: () => tmpRoot,
    which: async () => null,
  });
  await registry.refreshAvailability();
  const custom = registry.get("my-custom");
  assert.ok(custom);
  assert.equal(custom?.source, "user");
}

function testNdjsonParser(): void {
  const delta = parseNdjsonLine(
    JSON.stringify({ type: "content_block_delta", delta: { text: "Hello" } }),
  );
  assert.equal(delta.kind, "token");
  assert.deepEqual(delta.payload, { text: "Hello" });

  const tool = parseNdjsonLine(JSON.stringify({ type: "tool_use", name: "ls" }));
  assert.equal(tool.kind, "tool_call");

  const malformed = parseNdjsonLine("not json");
  assert.equal(malformed.kind, "token");
  assert.deepEqual(malformed.payload, { text: "not json" });
}

async function testCliAgentMissingBinary(): Promise<void> {
  const cliAgent = new CliAgent({ envBlocklist: [] });
  const events: import("../types").AgentStreamEvent[] = [];
  for await (const event of cliAgent.run(
    {
      id: "bogus",
      label: "Bogus",
      vendor: "local",
      kind: "cli",
      description: "missing",
      available: false,
      free: true,
      source: "user",
      binary: "/does/not/exist/eri-bogus-binary",
      binaryArgs: [],
    },
    { prompt: "hi", context: { files: [] } },
    new AbortController().signal,
  )) {
    events.push(event);
    if (events.length > 10) break;
  }
  // We expect at least an error or done with non-zero exit code.
  assert.ok(events.length > 0);
  const errored = events.some(
    (e) =>
      e.kind === "error" ||
      (e.kind === "done" && (e.payload as { exit_code?: number }).exit_code !== 0),
  );
  assert.ok(errored, `expected error event, got ${JSON.stringify(events)}`);
}

(async () => {
  const tests: Array<[string, () => Promise<void> | void]> = [
    ["registry loads built-in agents", testRegistryLoadsBuiltins],
    ["proxy available only when signed in", testProxyAvailableOnlyWhenSignedIn],
    ["cli detection makes agent available", testCliDetectionMakesAgentAvailable],
    ["byok availability from secrets", testByokAvailabilityFromSecrets],
    ["active agent persists across activations", testActiveAgentPersists],
    ["custom agent loaded from .eri/agents.json", testCustomAgentFromUserFile],
    ["cli agent parses NDJSON lines", testNdjsonParser],
    ["cli agent handles missing binary gracefully", testCliAgentMissingBinary],
  ];
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      process.stdout.write(`ok ${name}\n`);
    } catch (err) {
      failed += 1;
      process.stdout.write(`fail ${name}: ${(err as Error).message}\n`);
    }
  }
  if (failed > 0) {
    process.exit(1);
  }
})();
