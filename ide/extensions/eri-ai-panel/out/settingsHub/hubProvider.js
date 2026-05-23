"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SettingsHubProvider = void 0;
const vscode = require("vscode");
const fs = require("node:fs");
const state_1 = require("./state");
const DEFAULT_SOURCES = {
    providers: [],
    indexSummary: { files: 0, chunks: 0 },
    mcp: [],
    rulesCount: 0,
    micPermission: "unknown",
    account: { signedIn: false, tier: "Free", billingUrl: "https://eri.dev/billing" },
    about: { version: "0.1.0", buildDate: "2026-05-23", channel: "Stable" },
};
class SettingsHubProvider {
    context;
    static viewType = "eri.settingsHub";
    view = null;
    sources = DEFAULT_SOURCES;
    configListener;
    constructor(context) {
        this.context = context;
        this.configListener = vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration("eri")) {
                this.pushState();
            }
        });
        context.subscriptions.push(this.configListener);
    }
    updateSources(patch) {
        this.sources = { ...this.sources, ...patch };
        this.pushState();
    }
    resolveWebviewView(view) {
        this.view = view;
        const mediaRoot = vscode.Uri.joinPath(this.context.extensionUri, "media", "settingsHub");
        view.webview.options = {
            enableScripts: true,
            localResourceRoots: [mediaRoot],
        };
        view.webview.html = this.renderHtml(view.webview, mediaRoot);
        view.webview.onDidReceiveMessage((message) => {
            this.handleMessage(message).catch((err) => {
                console.error("[eri.settingsHub] message handler failed", err);
            });
        });
        view.onDidDispose(() => {
            this.view = null;
        });
        this.pushState();
    }
    renderHtml(webview, mediaRoot) {
        const htmlPath = vscode.Uri.joinPath(mediaRoot, "index.html").fsPath;
        let template;
        try {
            template = fs.readFileSync(htmlPath, "utf8");
        }
        catch (err) {
            console.error("[eri.settingsHub] failed to read index.html", err);
            return this.renderFallback("Settings hub assets missing.");
        }
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "style.css")).toString();
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "main.js")).toString();
        return template
            .replaceAll("${cspSource}", webview.cspSource)
            .replaceAll("${styleUri}", styleUri)
            .replaceAll("${scriptUri}", scriptUri);
    }
    renderFallback(message) {
        const safe = message.replace(/[&<>]/g, (c) => c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;");
        return `<!DOCTYPE html><html><body style="font-family: var(--vscode-font-family); padding: 16px;">${safe}</body></html>`;
    }
    buildState() {
        const config = wrapConfig(vscode.workspace.getConfiguration("eri"));
        const workspaceState = {
            get: (key) => this.context.workspaceState.get(key),
        };
        return (0, state_1.buildSettingsHubState)({
            config,
            workspaceState,
            account: this.sources.account,
            providers: this.sources.providers,
            micPermission: this.sources.micPermission,
            indexSummary: this.sources.indexSummary,
            mcp: this.sources.mcp,
            rulesCount: this.sources.rulesCount,
            about: this.sources.about,
        });
    }
    pushState() {
        if (!this.view)
            return;
        const state = this.buildState();
        this.view.webview.postMessage({ type: "state", state }).then(undefined, (err) => console.error("[eri.settingsHub] postMessage failed", err));
    }
    reveal() {
        this.view?.show?.(true);
    }
    async handleMessage(message) {
        if (!message || typeof message !== "object")
            return;
        switch (message.type) {
            case "ready":
                this.pushState();
                return;
            case "update":
                await this.handleUpdate(message.scope, message.key, message.value);
                return;
            case "action":
                await this.handleAction(message.action);
                return;
            default:
                return;
        }
    }
    async handleUpdate(scope, key, value) {
        if (typeof key !== "string")
            return;
        if (scope === "config") {
            if (!(0, state_1.isAllowedConfigKey)(key))
                return;
            const coerced = (0, state_1.coerceConfigValue)(key, value);
            if (coerced === undefined)
                return;
            const target = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
                ? vscode.ConfigurationTarget.Workspace
                : vscode.ConfigurationTarget.Global;
            try {
                await vscode.workspace.getConfiguration("eri").update(key, coerced, target);
            }
            catch (err) {
                console.error("[eri.settingsHub] failed to update config", key, err);
            }
            // onDidChangeConfiguration will trigger pushState
            return;
        }
        if (scope === "workspace") {
            if (!(0, state_1.isAllowedWorkspaceKey)(key))
                return;
            const coerced = (0, state_1.coerceWorkspaceValue)(key, value);
            if (coerced === undefined)
                return;
            try {
                await this.context.workspaceState.update(key, coerced);
            }
            catch (err) {
                console.error("[eri.settingsHub] failed to update workspace state", key, err);
            }
            this.pushState();
            return;
        }
    }
    async handleAction(action) {
        switch (action) {
            case "openBilling": {
                const url = this.sources.account.billingUrl || "https://eri.dev/billing";
                await vscode.env.openExternal(vscode.Uri.parse(url));
                return;
            }
            case "signIn":
                await vscode.commands.executeCommand("eri.signIn").then(undefined, () => undefined);
                return;
            case "openKeybindings":
                await vscode.commands.executeCommand("workbench.action.openGlobalKeybindings");
                return;
            case "openMcpConfig":
                await vscode.commands.executeCommand("eri.mcp.openConfig").then(undefined, () => undefined);
                return;
            case "recalibrate":
                await vscode.commands
                    .executeCommand("eri.gaze.recalibrate")
                    .then(undefined, () => undefined);
                return;
            case "manageKeys":
            case "manageRules":
                await vscode.window.showInformationMessage(`eri: "${action}" UI is not yet implemented.`);
                return;
            default:
                return;
        }
    }
    dispose() {
        this.configListener.dispose();
        this.view = null;
    }
}
exports.SettingsHubProvider = SettingsHubProvider;
function wrapConfig(cfg) {
    return {
        get(key) {
            return cfg.get(key);
        },
    };
}
//# sourceMappingURL=hubProvider.js.map