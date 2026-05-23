import * as vscode from "vscode";
import * as fs from "node:fs";
import {
  buildSettingsHubState,
  coerceConfigValue,
  coerceWorkspaceValue,
  isAllowedConfigKey,
  isAllowedWorkspaceKey,
  type AccountSummary,
  type AboutInfo,
  type ConfigSource,
  type IndexSummary,
  type McpSummary,
  type ProviderSummary,
  type SettingsHubState,
  type StateSource,
} from "./state";

type IncomingMessage =
  | { type: "ready" }
  | { type: "update"; scope: "config" | "workspace"; key: string; value: unknown }
  | { type: "action"; action: string };

interface ContextSources {
  readonly providers: ReadonlyArray<ProviderSummary>;
  readonly indexSummary: IndexSummary;
  readonly mcp: ReadonlyArray<McpSummary>;
  readonly rulesCount: number;
  readonly micPermission: "granted" | "denied" | "prompt" | "unknown";
  readonly account: AccountSummary;
  readonly about: AboutInfo;
}

const DEFAULT_SOURCES: ContextSources = {
  providers: [],
  indexSummary: { files: 0, chunks: 0 },
  mcp: [],
  rulesCount: 0,
  micPermission: "unknown",
  account: { signedIn: false, tier: "Free", billingUrl: "https://eri.dev/billing" },
  about: { version: "0.1.0", buildDate: "2026-05-23", channel: "Stable" },
};

export class SettingsHubProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "eri.settingsHub";

  private view: vscode.WebviewView | null = null;
  private sources: ContextSources = DEFAULT_SOURCES;
  private readonly configListener: vscode.Disposable;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.configListener = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("eri")) {
        this.pushState();
      }
    });
    context.subscriptions.push(this.configListener);
  }

  public updateSources(patch: Partial<ContextSources>): void {
    this.sources = { ...this.sources, ...patch };
    this.pushState();
  }

  public resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const mediaRoot = vscode.Uri.joinPath(this.context.extensionUri, "media", "settingsHub");
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [mediaRoot],
    };
    view.webview.html = this.renderHtml(view.webview, mediaRoot);
    view.webview.onDidReceiveMessage((message: IncomingMessage) => {
      this.handleMessage(message).catch((err) => {
        console.error("[eri.settingsHub] message handler failed", err);
      });
    });
    view.onDidDispose(() => {
      this.view = null;
    });
    this.pushState();
  }

  private renderHtml(webview: vscode.Webview, mediaRoot: vscode.Uri): string {
    const htmlPath = vscode.Uri.joinPath(mediaRoot, "index.html").fsPath;
    let template: string;
    try {
      template = fs.readFileSync(htmlPath, "utf8");
    } catch (err) {
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

  private renderFallback(message: string): string {
    const safe = message.replace(/[&<>]/g, (c) =>
      c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;",
    );
    return `<!DOCTYPE html><html><body style="font-family: var(--vscode-font-family); padding: 16px;">${safe}</body></html>`;
  }

  private buildState(): SettingsHubState {
    const config: ConfigSource = wrapConfig(vscode.workspace.getConfiguration("eri"));
    const workspaceState: StateSource = {
      get: <T>(key: string) => this.context.workspaceState.get<T>(key),
    };
    return buildSettingsHubState({
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

  public pushState(): void {
    if (!this.view) return;
    const state = this.buildState();
    this.view.webview.postMessage({ type: "state", state }).then(
      undefined,
      (err) => console.error("[eri.settingsHub] postMessage failed", err),
    );
  }

  public reveal(): void {
    this.view?.show?.(true);
  }

  private async handleMessage(message: IncomingMessage): Promise<void> {
    if (!message || typeof message !== "object") return;
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

  private async handleUpdate(
    scope: "config" | "workspace",
    key: string,
    value: unknown,
  ): Promise<void> {
    if (typeof key !== "string") return;
    if (scope === "config") {
      if (!isAllowedConfigKey(key)) return;
      const coerced = coerceConfigValue(key, value);
      if (coerced === undefined) return;
      const target =
        vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
          ? vscode.ConfigurationTarget.Workspace
          : vscode.ConfigurationTarget.Global;
      try {
        await vscode.workspace.getConfiguration("eri").update(key, coerced, target);
      } catch (err) {
        console.error("[eri.settingsHub] failed to update config", key, err);
      }
      // onDidChangeConfiguration will trigger pushState
      return;
    }
    if (scope === "workspace") {
      if (!isAllowedWorkspaceKey(key)) return;
      const coerced = coerceWorkspaceValue(key, value);
      if (coerced === undefined) return;
      try {
        await this.context.workspaceState.update(key, coerced);
      } catch (err) {
        console.error("[eri.settingsHub] failed to update workspace state", key, err);
      }
      this.pushState();
      return;
    }
  }

  private async handleAction(action: string): Promise<void> {
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
        await vscode.window.showInformationMessage(
          `eri: "${action}" UI is not yet implemented.`,
        );
        return;
      default:
        return;
    }
  }

  public dispose(): void {
    this.configListener.dispose();
    this.view = null;
  }
}

function wrapConfig(cfg: vscode.WorkspaceConfiguration): ConfigSource {
  return {
    get<T>(key: string): T | undefined {
      return cfg.get<T>(key);
    },
  };
}

