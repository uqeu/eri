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

/**
 * Minimal sidecar surface we need from `activateAccount`. Defined here
 * rather than importing `Sidecar` directly so the account module stays
 * independent of the sidecar transport implementation (and so tests can
 * stub it with a single-method fake).
 */
export interface AccountSidecar {
  request<T = unknown>(method: string, params?: unknown): Promise<T>;
}

export interface AccountOptions {
  /**
   * Resolve the live sidecar handle on demand. The sidecar can be `null`
   * during start-up or after a crash; callers swallow errors so account
   * activity never blocks on the session-push side channel.
   */
  readonly getSidecar?: () => AccountSidecar | null;
}

export interface AccountHandle {
  readonly store: SessionStore;
  readonly usage: UsageClient;
  readonly statusBar: AccountStatusBarHandle;
  dispose(): void;
}

export function activateAccount(
  context: vscode.ExtensionContext,
  options: AccountOptions = {},
): AccountHandle {
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

  // Push the sign-in's user_id into the sidecar so per-user state (local
  // memory partition today) resolves to the right scope. Best-effort —
  // sidecar may be null during start-up or after a crash; swallow errors
  // so the UI flow is never gated on the side-channel push.
  const pushSession = (session: EriSession | null): void => {
    const sidecar = options.getSidecar?.();
    if (!sidecar) return;
    const method = session ? "eri/account/setSession" : "eri/account/clearSession";
    const params = session ? { userId: session.userId } : {};
    sidecar
      .request(method, params)
      .catch((err) => console.warn(`[eri] ${method} push failed`, err));
  };

  // Reflect session into status bar + webview, and (re)start usage polling.
  let pollHandle: vscode.Disposable | null = null;
  const sessionListener = store.onChange((session: EriSession | null) => {
    statusBar.setSession(session);
    panel.push();
    pushSession(session);
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
    // Push the hydrated session into the sidecar so the sidecar's memory
    // partition is correct from the first JSON-RPC call. If hydrate runs
    // before the sidecar finishes start-up the push is a no-op; the
    // sessionListener above re-fires whenever the user signs in/out so
    // the sidecar always catches up.
    pushSession(session);
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
