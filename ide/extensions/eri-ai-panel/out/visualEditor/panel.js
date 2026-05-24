"use strict";
// Webview panel lifecycle + message routing for the Visual Editor. This file
// owns the WebviewPanel instance, the picked-element state, the TweakStore,
// and the connection between voice/gaze bridges and the iframe shim.
Object.defineProperty(exports, "__esModule", { value: true });
exports.VisualEditorPanel = void 0;
const vscode = require("vscode");
const applyToSource_1 = require("./applyToSource");
const gazeBridge_1 = require("./gazeBridge");
const pickerBridge_1 = require("./pickerBridge");
const styleTweaker_1 = require("./styleTweaker");
const voiceBridge_1 = require("./voiceBridge");
const VIEW_TYPE = "eri.visualEditor";
const RECENT_URLS_KEY = "eri.visualEditor.recentUrls";
const MAX_RECENT_URLS = 8;
class VisualEditorPanel {
    deps;
    panel = null;
    tweaks = new styleTweaker_1.TweakStore();
    picked = null;
    voiceBridge = null;
    gazeBridge = null;
    disposables = [];
    constructor(deps) {
        this.deps = deps;
    }
    open() {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.Active);
            return;
        }
        const url = currentUrl();
        const panel = vscode.window.createWebviewPanel(VIEW_TYPE, "eri - Visual Editor", vscode.ViewColumn.Active, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.deps.context.extensionUri, "media", "visualEditor"),
            ],
        });
        this.panel = panel;
        panel.iconPath = vscode.Uri.joinPath(this.deps.context.extensionUri, "media", "eri-icon.svg");
        panel.webview.html = renderHtml(panel.webview, this.deps.context, url);
        this.voiceBridge = new voiceBridge_1.VoiceBridge({
            getPickedElement: () => this.picked,
            tweaks: this.tweaks,
            applyStyles: (styles) => this.relayApplyStyles(styles),
            relayToChat: (prompt) => (0, applyToSource_1.sendPromptToChat)(prompt).then(() => undefined),
            showStatus: (text, tone) => this.postStatus(text, tone),
        });
        this.gazeBridge = new gazeBridge_1.GazeBridge({
            isPanelActive: () => this.panel?.active === true,
            relayToShim: (m) => this.relayShimMessage(m),
            getDwellMs: () => readDwellMs(),
            showStatus: (text, tone) => this.postStatus(text, tone),
        });
        panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
        panel.webview.onDidReceiveMessage((raw) => this.handleWebviewMessage(raw), undefined, this.disposables);
        // Push initial state to the webview once it signals ready.
        this.sendToWebview({
            kind: "init",
            url,
            recentUrls: this.readRecentUrls(),
        });
    }
    forwardSidecar(notification) {
        if (!this.panel || !this.gazeBridge || !this.voiceBridge) {
            return;
        }
        if (notification.method === "eri/voice/final" ||
            notification.method === "voice/transcript") {
            if (!voiceEditEnabled()) {
                return;
            }
            if (this.panel.active !== true) {
                return;
            }
            const transcript = parseTranscript(notification.params);
            if (!transcript) {
                return;
            }
            this.postVoiceState("thinking");
            void this.voiceBridge.handleTranscript(transcript).then(() => {
                this.postVoiceState("applied");
                setTimeout(() => this.postVoiceState("idle"), 1200);
            });
            return;
        }
        if (notification.method === "eri/gaze/target" ||
            notification.method === "eri/gaze/lost" ||
            notification.method === "eri/gaze/point") {
            if (!gazePickEnabled()) {
                return;
            }
            this.gazeBridge.forward({
                method: notification.method,
                params: notification.params,
            });
        }
    }
    async pickElement() {
        this.open();
        this.sendToWebview({ kind: "pickStart" });
        this.postStatus("pick mode: click an element in the preview", "info");
    }
    async setUrl() {
        const url = await promptForUrl(this.readRecentUrls());
        if (!url) {
            return;
        }
        await this.persistUrl(url);
        await vscode.workspace
            .getConfiguration("eri.visualEditor")
            .update("url", url, vscode.ConfigurationTarget.Global);
        this.sendToWebview({
            kind: "setUrl",
            url,
            recentUrls: this.readRecentUrls(),
        });
        this.postStatus(`loaded ${url}`, "info");
    }
    async applyAccumulated() {
        if (!this.picked) {
            this.postStatus("no element picked", "warn");
            return;
        }
        if (this.tweaks.list().length === 0) {
            this.postStatus("no tweaks to apply", "warn");
            return;
        }
        const outcome = await (0, applyToSource_1.applyTweaksToSource)(this.picked, this.tweaks);
        await this.logToGraph();
        this.postStatus(outcome.via === "chat" ? "sent to chat" : "copied to clipboard", "info");
    }
    dispose() {
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables = [];
        this.gazeBridge?.dispose();
        this.gazeBridge = null;
        this.voiceBridge = null;
        this.panel = null;
        this.picked = null;
        this.tweaks.clear();
    }
    handleWebviewMessage(raw) {
        const message = (0, pickerBridge_1.parseWebviewMessage)(raw);
        if (!message) {
            return;
        }
        switch (message.kind) {
            case "ready":
                this.sendToWebview({
                    kind: "init",
                    url: currentUrl(),
                    recentUrls: this.readRecentUrls(),
                });
                break;
            case "pickResult":
                this.picked = message.element;
                this.tweaks.clear();
                this.sendToWebview({ kind: "syncTweaks", tweaks: [] });
                this.postStatus(`picked: ${message.element.selector}`, "info");
                break;
            case "pickCancelled":
                this.postStatus("pick cancelled", "info");
                break;
            case "shimError":
                this.postStatus(`shim: ${message.message}`, "warn");
                break;
            case "requestSetUrl":
                void this.setUrl();
                break;
            case "requestApplyToSource":
                void this.applyAccumulated();
                break;
            case "requestClearTweaks":
                this.tweaks.clear();
                this.sendToWebview({ kind: "syncTweaks", tweaks: [] });
                this.postStatus("cleared tweaks", "info");
                break;
            case "tweakChanged": {
                if (!this.picked) {
                    return;
                }
                this.tweaks.set({
                    property: message.property,
                    value: message.value,
                    source: message.property === "color" || message.property === "background"
                        ? "color"
                        : "slider",
                });
                this.relayApplyStyles({ [message.property]: message.value });
                break;
            }
            case "log":
                // Surfaced via developer tools; we drop here to keep stdout clean.
                break;
        }
    }
    async logToGraph() {
        if (!this.picked) {
            return;
        }
        const change = {
            selector: this.picked.selector,
            styles: this.tweaks.toJson(),
        };
        try {
            await this.deps.sessionLogger.logChange(change);
        }
        catch {
            // graph is best-effort - never block the UX.
        }
    }
    relayApplyStyles(styles) {
        if (!this.picked) {
            return;
        }
        this.sendToWebview({
            kind: "applyStyles",
            change: { selector: this.picked.selector, styles },
        });
    }
    relayShimMessage(message) {
        // Reuses the existing message channel; the webview script forwards every
        // host->webview message to the iframe when the message kind is one of the
        // shim-bound kinds.
        if (message.kind === "applyStyles" ||
            message.kind === "highlightAtPoint" ||
            message.kind === "clearHighlight" ||
            message.kind === "pickStart" ||
            message.kind === "pickStop") {
            this.sendToWebview(message);
        }
    }
    sendToWebview(message) {
        this.panel?.webview.postMessage(message);
    }
    postStatus(text, tone) {
        this.sendToWebview({ kind: "showStatus", text, tone: tone ?? "info" });
    }
    postVoiceState(state) {
        this.sendToWebview({ kind: "setVoiceState", state });
    }
    readRecentUrls() {
        return this.deps.context.globalState.get(RECENT_URLS_KEY, []);
    }
    async persistUrl(url) {
        const recent = [
            url,
            ...this.readRecentUrls().filter((u) => u !== url),
        ].slice(0, MAX_RECENT_URLS);
        await this.deps.context.globalState.update(RECENT_URLS_KEY, recent);
    }
}
exports.VisualEditorPanel = VisualEditorPanel;
// ---------- helpers ----------
const STATIC_URL_CHOICES = [
    { url: "http://localhost:5173", label: "Vite (5173)" },
    { url: "http://localhost:3000", label: "Next.js (3000)" },
    { url: "http://localhost:6006", label: "Storybook (6006)" },
    { url: "http://localhost:4321", label: "Astro (4321)" },
    { url: "http://localhost:8080", label: "Generic (8080)" },
];
async function promptForUrl(recent) {
    const items = [];
    for (const r of recent) {
        items.push({ label: r, description: "recent", url: r });
    }
    for (const choice of STATIC_URL_CHOICES) {
        if (!recent.includes(choice.url)) {
            items.push({ label: choice.url, description: choice.label, url: choice.url });
        }
    }
    items.push({ label: "$(edit) Enter custom URL...", url: null });
    const picked = await vscode.window.showQuickPick(items, {
        title: "eri Visual Editor - dev server URL",
        placeHolder: "Pick a recent URL or enter a custom one",
    });
    if (!picked) {
        return undefined;
    }
    if (picked.url) {
        return picked.url;
    }
    return await vscode.window.showInputBox({
        prompt: "Dev server URL",
        placeHolder: "http://localhost:5173",
        validateInput: (value) => (isValidHttpUrl(value) ? null : "Must be http/https URL"),
    });
}
function isValidHttpUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
    }
    catch {
        return false;
    }
}
function currentUrl() {
    return (vscode.workspace
        .getConfiguration("eri.visualEditor")
        .get("url", "http://localhost:5173") || "http://localhost:5173");
}
function voiceEditEnabled() {
    return vscode.workspace
        .getConfiguration("eri.visualEditor")
        .get("voiceEdit", true);
}
function gazePickEnabled() {
    return vscode.workspace
        .getConfiguration("eri.visualEditor")
        .get("gazePick", true);
}
function readDwellMs() {
    return vscode.workspace
        .getConfiguration("eri.visualEditor")
        .get("gazeDwellMs", 800);
}
function parseTranscript(raw) {
    if (!raw || typeof raw !== "object") {
        return null;
    }
    const params = raw;
    const candidate = typeof params.text === "string"
        ? params.text
        : typeof params.transcript === "string"
            ? params.transcript
            : null;
    if (!candidate) {
        return null;
    }
    const trimmed = candidate.trim();
    return trimmed.length === 0 ? null : trimmed;
}
function renderHtml(webview, context, initialUrl) {
    const mediaRoot = vscode.Uri.joinPath(context.extensionUri, "media", "visualEditor");
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "panel.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "panel.css"));
    const nonce = generateNonce();
    const csp = [
        `default-src 'none'`,
        `img-src ${webview.cspSource} https: data:`,
        `style-src ${webview.cspSource} 'unsafe-inline'`,
        `script-src 'nonce-${nonce}' ${webview.cspSource}`,
        `font-src ${webview.cspSource}`,
        `connect-src ${webview.cspSource} http: https:`,
        // Allow loading the user's own dev server inside the iframe. The iframe
        // gets its own browsing context and can only be inspected via postMessage.
        `frame-src http: https:`,
    ].join("; ");
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>eri Visual Editor</title>
<link rel="stylesheet" href="${styleUri}" />
</head>
<body>
<div id="ve-root">
  <header id="ve-toolbar">
    <button id="ve-url" class="pill" title="Change dev server URL">${escapeHtml(initialUrl)}</button>
    <button id="ve-pick" class="pill" title="Pick element">Pick</button>
    <button id="ve-apply" class="pill primary" title="Apply tweaks to source">Apply to source</button>
    <button id="ve-clear" class="pill" title="Clear tweaks">Clear</button>
    <span id="ve-status" class="status" aria-live="polite"></span>
    <span id="ve-voice" class="voice" data-state="idle">voice idle</span>
  </header>
  <main>
    <iframe id="ve-frame" src="${escapeAttr(initialUrl)}" sandbox="allow-scripts allow-same-origin allow-forms"></iframe>
    <aside id="ve-sidebar">
      <section>
        <h2>Inspector</h2>
        <div id="ve-inspector">No element picked yet.</div>
      </section>
      <section>
        <h2>Style tweaks</h2>
        <div id="ve-tweaks"></div>
      </section>
    </aside>
  </main>
</div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
function generateNonce() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let nonce = "";
    for (let i = 0; i < 32; i += 1) {
        nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return nonce;
}
function escapeHtml(value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
function escapeAttr(value) {
    return escapeHtml(value);
}
//# sourceMappingURL=panel.js.map