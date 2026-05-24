"use strict";
// Pure-logic tests for the eri agents module. Run with:
//   node out/agents/__tests__/agents.test.js
//
// Strategy mirrors src/account/__tests__/account.test.ts: stub the
// `vscode` module in require cache so importing registry / picker
// modules succeeds without an extension host.
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent) {
    if (request === "vscode")
        return "vscode";
    return originalResolve.call(this, request, parent);
};
class StubEmitter {
    listeners = [];
    fire(v) {
        for (const l of this.listeners)
            l(v);
    }
    get event() {
        return (l) => {
            this.listeners.push(l);
            return { dispose: () => undefined };
        };
    }
    dispose() {
        this.listeners.length = 0;
    }
}
Module._cache["vscode"] = {
    exports: {
        EventEmitter: StubEmitter,
        Disposable: class {
            fn;
            constructor(fn) {
                this.fn = fn;
            }
            dispose() {
                this.fn();
            }
        },
        workspace: {
            getConfiguration: () => ({ get: (_, d) => d }),
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
            id;
            constructor(id) {
                this.id = id;
            }
        },
        TreeItem: class {
            label;
            collapsibleState;
            description = "";
            tooltip = "";
            contextValue = "";
            iconPath = undefined;
            command = undefined;
            constructor(label, collapsibleState) {
                this.label = label;
                this.collapsibleState = collapsibleState;
            }
        },
        TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
        MarkdownString: class {
            value;
            isTrusted = false;
            constructor(value) {
                this.value = value;
            }
        },
        Uri: {
            parse: (s) => ({ toString: () => s, fsPath: s }),
            file: (s) => ({ toString: () => s, fsPath: s }),
            joinPath: (base, ...parts) => ({
                fsPath: path.join(base.fsPath, ...parts),
            }),
        },
    },
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AgentRegistry } = require("../registry");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AGENT_ID, builtinDescriptors } = require("../builtins");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseNdjsonLine } = require("../cliAgent");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { detectCliBinaries, loadUserAgentFiles } = require("../detection");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { CliAgent } = require("../cliAgent");
class FakeMemento {
    map = new Map();
    get(k) {
        return this.map.get(k);
    }
    update(k, v) {
        if (v === undefined)
            this.map.delete(k);
        else
            this.map.set(k, v);
        return Promise.resolve();
    }
}
class FakeSession {
    signedIn;
    constructor(signedIn) {
        this.signedIn = signedIn;
    }
    isSignedIn() {
        return this.signedIn;
    }
}
class FakeSecrets {
    stored;
    constructor(stored = new Map()) {
        this.stored = stored;
    }
    async has(providerId, fieldKey) {
        return this.stored.get(`${providerId}.${fieldKey}`) === true;
    }
}
async function testRegistryLoadsBuiltins() {
    const registry = new AgentRegistry({
        session: new FakeSession(false),
        secrets: new FakeSecrets(),
        globalState: new FakeMemento(),
        getWorkspaceRoot: () => undefined,
        which: async () => null,
    });
    const list = registry.list();
    node_assert_1.strict.equal(list.length, builtinDescriptors().length);
    node_assert_1.strict.ok(registry.get(AGENT_ID.mercury));
    node_assert_1.strict.ok(registry.get(AGENT_ID.auto));
}
async function testProxyAvailableOnlyWhenSignedIn() {
    const offline = new AgentRegistry({
        session: new FakeSession(false),
        secrets: new FakeSecrets(),
        globalState: new FakeMemento(),
        getWorkspaceRoot: () => undefined,
        which: async () => null,
    });
    await offline.refreshAvailability();
    node_assert_1.strict.equal(offline.get(AGENT_ID.claudeProxy)?.available, false);
    const online = new AgentRegistry({
        session: new FakeSession(true),
        secrets: new FakeSecrets(),
        globalState: new FakeMemento(),
        getWorkspaceRoot: () => undefined,
        which: async () => null,
    });
    await online.refreshAvailability();
    node_assert_1.strict.equal(online.get(AGENT_ID.claudeProxy)?.available, true);
}
async function testCliDetectionMakesAgentAvailable() {
    const which = async (binary) => {
        return binary === "claude" ? "/usr/local/bin/claude" : null;
    };
    const detection = await detectCliBinaries(["claude", "codex", "aider"], which);
    node_assert_1.strict.equal(detection.binaries.get("claude"), "/usr/local/bin/claude");
    node_assert_1.strict.equal(detection.binaries.has("codex"), false);
    const registry = new AgentRegistry({
        session: new FakeSession(true),
        secrets: new FakeSecrets(),
        globalState: new FakeMemento(),
        getWorkspaceRoot: () => undefined,
        which,
    });
    await registry.refreshAvailability();
    const claude = registry.get(AGENT_ID.claudeCode);
    node_assert_1.strict.ok(claude);
    node_assert_1.strict.equal(claude?.available, true);
    node_assert_1.strict.equal(claude?.binary, "/usr/local/bin/claude");
    node_assert_1.strict.equal(registry.get(AGENT_ID.codex)?.available, false);
}
async function testByokAvailabilityFromSecrets() {
    const stored = new Map([["anthropic.anthropic-api-key", true]]);
    const registry = new AgentRegistry({
        session: new FakeSession(false),
        secrets: new FakeSecrets(stored),
        globalState: new FakeMemento(),
        getWorkspaceRoot: () => undefined,
        which: async () => null,
    });
    await registry.refreshAvailability();
    node_assert_1.strict.equal(registry.get(AGENT_ID.claudeByok)?.available, true);
    node_assert_1.strict.equal(registry.get(AGENT_ID.gptByok)?.available, false);
}
async function testActiveAgentPersists() {
    const memento = new FakeMemento();
    const registry1 = new AgentRegistry({
        session: new FakeSession(true),
        secrets: new FakeSecrets(),
        globalState: memento,
        getWorkspaceRoot: () => undefined,
        which: async () => "/usr/local/bin/claude",
    });
    await registry1.refreshAvailability();
    await registry1.setActive(AGENT_ID.claudeCode);
    node_assert_1.strict.equal(registry1.active().id, AGENT_ID.claudeCode);
    const registry2 = new AgentRegistry({
        session: new FakeSession(true),
        secrets: new FakeSecrets(),
        globalState: memento,
        getWorkspaceRoot: () => undefined,
        which: async () => "/usr/local/bin/claude",
    });
    await registry2.refreshAvailability();
    node_assert_1.strict.equal(registry2.active().id, AGENT_ID.claudeCode);
}
async function testCustomAgentFromUserFile() {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "eri-agents-"));
    const dir = path.join(tmpRoot, ".eri");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "agents.json"), JSON.stringify({
        agents: [
            {
                id: "my-custom",
                label: "My Custom",
                kind: "cli",
                binary: "/bin/echo",
                binaryArgs: ["--workspace", "${workspaceRoot}"],
            },
        ],
    }));
    const file = loadUserAgentFiles(tmpRoot);
    node_assert_1.strict.equal(file.agents.length, 1);
    node_assert_1.strict.equal(file.agents[0].id, "my-custom");
    const registry = new AgentRegistry({
        session: new FakeSession(true),
        secrets: new FakeSecrets(),
        globalState: new FakeMemento(),
        getWorkspaceRoot: () => tmpRoot,
        which: async () => null,
    });
    await registry.refreshAvailability();
    const custom = registry.get("my-custom");
    node_assert_1.strict.ok(custom);
    node_assert_1.strict.equal(custom?.source, "user");
}
function testNdjsonParser() {
    const delta = parseNdjsonLine(JSON.stringify({ type: "content_block_delta", delta: { text: "Hello" } }));
    node_assert_1.strict.equal(delta.kind, "token");
    node_assert_1.strict.deepEqual(delta.payload, { text: "Hello" });
    const tool = parseNdjsonLine(JSON.stringify({ type: "tool_use", name: "ls" }));
    node_assert_1.strict.equal(tool.kind, "tool_call");
    const malformed = parseNdjsonLine("not json");
    node_assert_1.strict.equal(malformed.kind, "token");
    node_assert_1.strict.deepEqual(malformed.payload, { text: "not json" });
}
async function testCliAgentMissingBinary() {
    const cliAgent = new CliAgent({ envBlocklist: [] });
    const events = [];
    for await (const event of cliAgent.run({
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
    }, { prompt: "hi", context: { files: [] } }, new AbortController().signal)) {
        events.push(event);
        if (events.length > 10)
            break;
    }
    // We expect at least an error or done with non-zero exit code.
    node_assert_1.strict.ok(events.length > 0);
    const errored = events.some((e) => e.kind === "error" ||
        (e.kind === "done" && e.payload.exit_code !== 0));
    node_assert_1.strict.ok(errored, `expected error event, got ${JSON.stringify(events)}`);
}
(async () => {
    const tests = [
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
        }
        catch (err) {
            failed += 1;
            process.stdout.write(`fail ${name}: ${err.message}\n`);
        }
    }
    if (failed > 0) {
        process.exit(1);
    }
})();
//# sourceMappingURL=agents.test.js.map