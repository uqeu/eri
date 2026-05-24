// Activation entry point for the eri account module.
//
// Wires together:
//   - SessionStore           (Keychain + globalState)
//   - DeepLinkSource         (eri://auth/callback intake)
//   - UsageClient            (periodic /api/v1/usage poll)
//   - AccountStatusPanel     (webview showing tier + tokens)
//   - Status bar binding     (tier label + remaining %)
//   - URI handler            (eri://auth/callback?code=…)
//   - Commands               (signIn / signOut / showStatus / openBilling)

import * as vscode from "vscode";
import { SessionStore } from "./sessionStore";
import { UsageClient } from "./usageClient";
import { AccountStatusPanel } from "./statusWebview";
import { activateAccountStatusBar, AccountStatusBarHandle } from "./statusBarBinding";
import { registerAccountCommands } from "./commands";
import { createDeepLinkSource } from "./deepLinkSource";
import { EriSession, UsageSummary } from "./types";

const DEFAULT_BASE_URL = "https://eri.dev";

export interface AccountHandle {
  readonly store: SessionStore;
  readonly usage: UsageClient;
  readonly statusBar: AccountStatusBarHandle;
  dispose(): void;
}

export function activateAccount(context: vscode.ExtensionContext): AccountHandle {
  const getBaseUrl = (): string => {
    const value = vscode.workspace
      .getConfiguration("eri.account")
      .get<string>("baseUrl", DEFAULT_BASE_URL);
    return (value && value.trim()) || DEFAULT_BASE_URL;
  };
  const getRefreshSec = (): number => {
    const value = vscode.workspace
      .getConfiguration("eri.account")
      .get<number>("autoRefreshUsageSec", 30);
    return typeof value === "number" && value >= 5 ? value : 30;
  };

  const store = new SessionStore(context.secrets, context.globalState);
  const deepLinkSource = createDeepLinkSource();

  const usage = new UsageClient({
    getSession: () => store.current(),
    baseUrl: getBaseUrl(),
    onUnauthorized: () => {
      void store.clear();
    },
  });

  const statusBar = activateAccountStatusBar(context);

  const panel = new AccountStatusPanel({
    context,
    getSession: () => store.current(),
    getUsage: () => usage.current(),
    openBilling: () => {
      const url = `${getBaseUrl().replace(/\/+$/, "")}/dashboard/billing`;
      void vscode.env.openExternal(vscode.Uri.parse(url));
    },
    signOut: async () => {
      await vscode.commands.executeCommand("eri.account.signOut");
    },
    refresh: async () => {
      await usage.fetchUsage();
    },
    billingUrl: `${getBaseUrl().replace(/\/+$/, "")}/dashboard/billing`,
  });

  const commandDisposables = registerAccountCommands({
    context,
    store,
    usage,
    panel,
    getBaseUrl,
    deepLinkSource: { next: () => deepLinkSource.next() },
  });
  for (const d of commandDisposables) {
    context.subscriptions.push(d);
  }

  // URI handler: eri://auth/callback?code=<device-code>
  const uriHandler = vscode.window.registerUriHandler({
    handleUri(uri: vscode.Uri): void {
      if (uri.path !== "/auth/callback") return;
      const code = new URLSearchParams(uri.query).get("code");
      if (code) {
        deepLinkSource.push(code);
      }
    },
  });
  context.subscriptions.push(uriHandler);

  // Reflect session into status bar + webview, and (re)start usage polling.
  let pollHandle: vscode.Disposable | null = null;
  const sessionListener = store.onChange((session: EriSession | null) => {
    statusBar.setSession(session);
    panel.push();
    pollHandle?.dispose();
    pollHandle = null;
    if (session) {
      pollHandle = usage.startPolling(getRefreshSec());
    } else {
      statusBar.setUsage(null);
    }
  });
  context.subscriptions.push(sessionListener);

  const usageListener = usage.onUsage((u: UsageSummary | null) => {
    statusBar.setUsage(u);
    panel.push();
  });
  context.subscriptions.push(usageListener);

  // Hydrate from persisted state without blocking activation.
  void store.hydrate().then(() => {
    const session = store.current();
    statusBar.setSession(session);
    if (session) {
      pollHandle = usage.startPolling(getRefreshSec());
    }
  });

  // React to baseUrl + interval config changes.
  const configListener = vscode.workspace.onDidChangeConfiguration((event) => {
    if (!event.affectsConfiguration("eri.account")) return;
    pollHandle?.dispose();
    pollHandle = null;
    if (store.current()) {
      pollHandle = usage.startPolling(getRefreshSec());
    }
  });
  context.subscriptions.push(configListener);

  return {
    store,
    usage,
    statusBar,
    dispose: (): void => {
      pollHandle?.dispose();
      pollHandle = null;
      sessionListener.dispose();
      usageListener.dispose();
      configListener.dispose();
      panel.dispose();
      statusBar.dispose();
      usage.dispose();
      store.dispose();
      deepLinkSource.dispose();
    },
  };
}

export type { EriSession, UsageSummary } from "./types";
