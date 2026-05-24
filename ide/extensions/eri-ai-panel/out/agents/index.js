"use strict";
// Activation entry point for the multi-agent picker.
//
// Wires together:
//   - AgentRegistry          (built-ins + user file)
//   - Agent backends         (Mercury / proxy / BYOK / CLI / auto)
//   - Status bar item        (active agent indicator)
//   - Tree view              (eri.agents sidebar)
//   - Commands               (switch / detectCli / addCustom / showCurrent / setActive)
//   - Picker UI bridge       (panel webview can request the picker)
//   - Config sync            (eri.agents.default)
Object.defineProperty(exports, "__esModule", { value: true });
exports.activateAgents = activateAgents;
const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const registry_1 = require("./registry");
const mercuryAgent_1 = require("./mercuryAgent");
const proxyAgent_1 = require("./proxyAgent");
const byokAgent_1 = require("./byokAgent");
const cliAgent_1 = require("./cliAgent");
const autoAgent_1 = require("./autoAgent");
const picker_1 = require("./picker");
const statusBar_1 = require("./statusBar");
const view_1 = require("./view");
const DEFAULT_ENV_BLOCKLIST = [
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GOOGLE_API_KEY",
    "GEMINI_API_KEY",
];
function activateAgents(context, opts) {
    const registry = new registry_1.AgentRegistry({
        session: opts.session,
        secrets: opts.secrets,
        globalState: context.globalState,
        getWorkspaceRoot: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    });
    const envBlocklist = readEnvBlocklist();
    const mercury = new mercuryAgent_1.MercuryAgent({ getSidecar: opts.getSidecar });
    const proxy = new proxyAgent_1.ProxyAgent({ getSidecar: opts.getSidecar });
    const byok = new byokAgent_1.ByokAgent({ getSidecar: opts.getSidecar });
    const cli = new cliAgent_1.CliAgent({ envBlocklist });
    const auto = new autoAgent_1.AutoAgent({
        getSidecar: opts.getSidecar,
        resolve: (id) => registry.get(id),
        mercury,
        proxy,
    });
    const pick = (descriptor) => {
        switch (descriptor.kind) {
            case "auto":
                return auto;
            case "mercury":
                return mercury;
            case "byok":
                return byok;
            case "cli":
                return cli;
            case "proxy":
            default:
                return proxy;
        }
    };
    const treeProvider = new view_1.AgentsTreeProvider(registry);
    const treeView = vscode.window.createTreeView("eri.agents", {
        treeDataProvider: treeProvider,
    });
    context.subscriptions.push(treeView);
    let statusBar = (0, statusBar_1.activateAgentStatusBar)(context, registry);
    // Notify chat composer / external listeners.
    const changeListener = registry.onChange((descriptor) => {
        opts.onActiveChanged?.(descriptor);
    });
    context.subscriptions.push(changeListener);
    // Refresh on session sign-in/out and on config change.
    const sessionListener = opts.session.onChange(() => {
        void registry.refreshAvailability();
    });
    context.subscriptions.push(sessionListener);
    const configListener = vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("eri.agents")) {
            void registry.refreshAvailability();
        }
    });
    context.subscriptions.push(configListener);
    // Initial async detection. Best-effort; doesn't block activation.
    void registry.refreshAvailability();
    // Auto-detect on launch if configured.
    if (vscode.workspace.getConfiguration("eri.agents.detectCli").get("onLaunch", true)) {
        // Already triggered by refreshAvailability above — but re-running is harmless.
    }
    // Commands ---------------------------------------------------------------
    context.subscriptions.push(vscode.commands.registerCommand("eri.agents.switch", () => (0, picker_1.showAgentPicker)(registry)), vscode.commands.registerCommand("eri.agents.detectCli", async () => {
        await registry.refreshAvailability();
        const cliCount = registry.list().filter((d) => d.kind === "cli" && d.available).length;
        vscode.window.showInformationMessage(`eri: detected ${cliCount} local CLI agent(s).`);
    }), vscode.commands.registerCommand("eri.agents.addCustom", () => openCustomAgentsFile()), vscode.commands.registerCommand("eri.agents.showCurrent", () => {
        const active = registry.active();
        vscode.window.showInformationMessage(`eri agent: ${active.label} (${active.kind}, ${active.vendor})`);
    }), vscode.commands.registerCommand("eri.agents.setActive", async (id) => {
        if (typeof id === "string") {
            await registry.setActive(id);
        }
    }));
    return {
        registry,
        dispatch(turn, signal) {
            const descriptor = registry.active();
            const backend = pick(descriptor);
            const controller = signal ?? new AbortController().signal;
            return backend.run(descriptor, turn, controller);
        },
        dispose: () => {
            statusBar?.dispose();
            statusBar = null;
            treeView.dispose();
            registry.dispose();
        },
    };
}
function readEnvBlocklist() {
    const configured = vscode.workspace
        .getConfiguration("eri.agents")
        .get("cliEnvBlocklist", [...DEFAULT_ENV_BLOCKLIST]);
    if (!Array.isArray(configured)) {
        return DEFAULT_ENV_BLOCKLIST;
    }
    return configured.filter((entry) => typeof entry === "string");
}
async function openCustomAgentsFile() {
    const folder = vscode.workspace.workspaceFolders?.[0];
    const target = folder
        ? vscode.Uri.joinPath(folder.uri, ".eri", "agents.json")
        : vscode.Uri.file(path.join(process.env.HOME ?? "", ".eri", "agents.json"));
    const dir = path.dirname(target.fsPath);
    try {
        fs.mkdirSync(dir, { recursive: true });
    }
    catch {
        // ignore — open will surface the real error.
    }
    if (!fs.existsSync(target.fsPath)) {
        const stub = JSON.stringify({
            agents: [
                {
                    id: "my-agent",
                    label: "My Agent",
                    kind: "cli",
                    binary: "/usr/local/bin/my-agent",
                    binaryArgs: ["--workspace", "${workspaceRoot}"],
                },
            ],
        }, null, 2);
        fs.writeFileSync(target.fsPath, stub, "utf8");
    }
    const doc = await vscode.workspace.openTextDocument(target);
    await vscode.window.showTextDocument(doc);
}
//# sourceMappingURL=index.js.map