// Webview panel lifecycle + message routing for the Visual Editor. This file
// owns the WebviewPanel instance, the picked-element state, the TweakStore,
// and the connection between voice/gaze bridges and the iframe shim.

import * as vscode from "vscode";
import { SidecarNotification } from "../sidecar";
import { applyTweaksToSource, sendPromptToChat } from "./applyToSource";
import { GazeBridge } from "./gazeBridge";
import {
  HostToWebviewMessage,
  PickedElement,
  ShimInbound,
  StyleChange,
  VoiceState,
  parseWebviewMessage,
} from "./pickerBridge";
import { TweakStore } from "./styleTweaker";
import { VoiceBridge } from "./voiceBridge";

const VIEW_TYPE = "eri.visualEditor";
const RECENT_URLS_KEY = "eri.visualEditor.recentUrls";
const MAX_RECENT_URLS = 8;

interface SessionLogger {
  readonly logChange: (change: StyleChange) => Promise<void>;
}

interface PanelDeps {
  readonly context: vscode.ExtensionContext;
  readonly sessionLogger: SessionLogger;
}

export class VisualEditorPanel {
  private panel: vscode.WebviewPanel | null = null;
  private readonly tweaks = new TweakStore();
  private picked: PickedElement | null = null;
  private voiceBridge: VoiceBridge | null = null;
  private gazeBridge: GazeBridge | null = null;
  private disposables: vscode.Disposable[] = [];

  constructor(private readonly deps: PanelDeps) {}

  open(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
      return;
    }
    const url = currentUrl();
    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      "eri - Visual Editor",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.deps.context.extensionUri, "media", "visualEditor"),
        ],
      },
    );
    this.panel = panel;
    panel.iconPath = vscode.Uri.joinPath(this.deps.context.extensionUri, "media", "eri-icon.svg");
    panel.webview.html = renderHtml(panel.webview, this.deps.context, url);

    this.voiceBridge = new VoiceBridge({
      getPickedElement: () => this.picked,
      tweaks: this.tweaks,
      applyStyles: (styles) => this.relayApplyStyles(styles),
      relayToChat: (prompt) => sendPromptToChat(prompt).then(() => undefined),
      showStatus: (text, tone) => this.postStatus(text, tone),
    });

    this.gazeBridge = new GazeBridge({
      isPanelActive: () => this.panel?.active === true,
      relayToShim: (m) => this.relayShimMessage(m),
      getDwellMs: () => readDwellMs(),
      showStatus: (text, tone) => this.postStatus(text, tone),
    });

    panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
    panel.webview.onDidReceiveMessage(
      (raw: unknown) => this.handleWebviewMessage(raw),
      undefined,
      this.disposables,
    );

    // Push initial state to the webview once it signals ready.
    this.sendToWebview({
      kind: "init",
      url,
      recentUrls: this.readRecentUrls(),
    });
  }

  forwardSidecar(notification: SidecarNotification): void {
    if (!this.panel || !this.gazeBridge || !this.voiceBridge) {
      return;
    }
    if (
      notification.method === "eri/voice/final" ||
      notification.method === "voice/transcript"
    ) {
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
    if (
      notification.method === "eri/gaze/target" ||
      notification.method === "eri/gaze/lost" ||
      notification.method === "eri/gaze/point"
    ) {
      if (!gazePickEnabled()) {
        return;
      }
      this.gazeBridge.forward({
        method: notification.method,
        params: notification.params,
      });
    }
  }

  async pickElement(): Promise<void> {
    this.open();
    this.sendToWebview({ kind: "pickStart" });
    this.postStatus("pick mode: click an element in the preview", "info");
  }

  async setUrl(): Promise<void> {
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

  async applyAccumulated(): Promise<void> {
    if (!this.picked) {
      this.postStatus("no element picked", "warn");
      return;
    }
    if (this.tweaks.list().length === 0) {
      this.postStatus("no tweaks to apply", "warn");
      return;
    }
    const outcome = await applyTweaksToSource(this.picked, this.tweaks);
    await this.logToGraph();
    this.postStatus(
      outcome.via === "chat" ? "sent to chat" : "copied to clipboard",
      "info",
    );
  }

  dispose(): void {
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

  private handleWebviewMessage(raw: unknown): void {
    const message = parseWebviewMessage(raw);
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

  private async logToGraph(): Promise<void> {
    if (!this.picked) {
      return;
    }
    const change: StyleChange = {
      selector: this.picked.selector,
      styles: this.tweaks.toJson(),
    };
    try {
      await this.deps.sessionLogger.logChange(change);
    } catch {
      // graph is best-effort - never block the UX.
    }
  }

  private relayApplyStyles(styles: Readonly<Record<string, string>>): void {
    if (!this.picked) {
      return;
    }
    this.sendToWebview({
      kind: "applyStyles",
      change: { selector: this.picked.selector, styles },
    });
  }

  private relayShimMessage(message: ShimInbound): void {
    // Reuses the existing message channel; the webview script forwards every
    // host->webview message to the iframe when the message kind is one of the
    // shim-bound kinds.
    if (
      message.kind === "applyStyles" ||
      message.kind === "highlightAtPoint" ||
      message.kind === "clearHighlight" ||
      message.kind === "pickStart" ||
      message.kind === "pickStop"
    ) {
      this.sendToWebview(message as HostToWebviewMessage);
    }
  }

  private sendToWebview(message: HostToWebviewMessage): void {
    this.panel?.webview.postMessage(message);
  }

  private postStatus(text: string, tone?: "info" | "warn" | "error"): void {
    this.sendToWebview({ kind: "showStatus", text, tone: tone ?? "info" });
  }

  private postVoiceState(state: VoiceState): void {
    this.sendToWebview({ kind: "setVoiceState", state });
  }

  private readRecentUrls(): ReadonlyArray<string> {
    return this.deps.context.globalState.get<ReadonlyArray<string>>(
      RECENT_URLS_KEY,
      [],
    );
  }

  private async persistUrl(url: string): Promise<void> {
    const recent = [
      url,
      ...this.readRecentUrls().filter((u) => u !== url),
    ].slice(0, MAX_RECENT_URLS);
    await this.deps.context.globalState.update(RECENT_URLS_KEY, recent);
  }
}

// ---------- helpers ----------

const STATIC_URL_CHOICES: ReadonlyArray<{ url: string; label: string }> = [
  { url: "http://localhost:5173", label: "Vite (5173)" },
  { url: "http://localhost:3000", label: "Next.js (3000)" },
  { url: "http://localhost:6006", label: "Storybook (6006)" },
  { url: "http://localhost:4321", label: "Astro (4321)" },
  { url: "http://localhost:8080", label: "Generic (8080)" },
];

async function promptForUrl(
  recent: ReadonlyArray<string>,
): Promise<string | undefined> {
  interface UrlPick extends vscode.QuickPickItem {
    readonly url: string | null;
  }
  const items: UrlPick[] = [];
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

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function currentUrl(): string {
  return (
    vscode.workspace
      .getConfiguration("eri.visualEditor")
      .get<string>("url", "http://localhost:5173") || "http://localhost:5173"
  );
}

function voiceEditEnabled(): boolean {
  return vscode.workspace
    .getConfiguration("eri.visualEditor")
    .get<boolean>("voiceEdit", true);
}

function gazePickEnabled(): boolean {
  return vscode.workspace
    .getConfiguration("eri.visualEditor")
    .get<boolean>("gazePick", true);
}

function readDwellMs(): number {
  return vscode.workspace
    .getConfiguration("eri.visualEditor")
    .get<number>("gazeDwellMs", 800);
}

function parseTranscript(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const params = raw as Record<string, unknown>;
  const candidate =
    typeof params.text === "string"
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

function renderHtml(
  webview: vscode.Webview,
  context: vscode.ExtensionContext,
  initialUrl: string,
): string {
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

function generateNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < 32; i += 1) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
