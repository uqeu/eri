"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.activateAccount = activateAccount;
const vscode = require("vscode");
const sessionStore_1 = require("./sessionStore");
const usageClient_1 = require("./usageClient");
const statusWebview_1 = require("./statusWebview");
const statusBarBinding_1 = require("./statusBarBinding");
const commands_1 = require("./commands");
const deepLinkSource_1 = require("./deepLinkSource");
const DEFAULT_BASE_URL = "https://eri.dev";
function activateAccount(context, options = {}) {
    const getBaseUrl = () => {
        const value = vscode.workspace
            .getConfiguration("eri.account")
            .get("baseUrl", DEFAULT_BASE_URL);
        return (value && value.trim()) || DEFAULT_BASE_URL;
    };
    const getRefreshSec = () => {
        const value = vscode.workspace
            .getConfiguration("eri.account")
            .get("autoRefreshUsageSec", 30);
        return typeof value === "number" && value >= 5 ? value : 30;
    };
    const store = new sessionStore_1.SessionStore(context.secrets, context.globalState);
    const deepLinkSource = (0, deepLinkSource_1.createDeepLinkSource)();
    const usage = new usageClient_1.UsageClient({
        getSession: () => store.current(),
        baseUrl: getBaseUrl(),
        onUnauthorized: () => {
            void store.clear();
        },
    });
    const statusBar = (0, statusBarBinding_1.activateAccountStatusBar)(context);
    const panel = new statusWebview_1.AccountStatusPanel({
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
    const commandDisposables = (0, commands_1.registerAccountCommands)({
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
        handleUri(uri) {
            if (uri.path !== "/auth/callback")
                return;
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
    const pushSession = (session) => {
        const sidecar = options.getSidecar?.();
        if (!sidecar)
            return;
        const method = session ? "eri/account/setSession" : "eri/account/clearSession";
        const params = session ? { userId: session.userId } : {};
        sidecar
            .request(method, params)
            .catch((err) => console.warn(`[eri] ${method} push failed`, err));
    };
    // Reflect session into status bar + webview, and (re)start usage polling.
    let pollHandle = null;
    const sessionListener = store.onChange((session) => {
        statusBar.setSession(session);
        panel.push();
        pushSession(session);
        pollHandle?.dispose();
        pollHandle = null;
        if (session) {
            pollHandle = usage.startPolling(getRefreshSec());
        }
        else {
            statusBar.setUsage(null);
        }
    });
    context.subscriptions.push(sessionListener);
    const usageListener = usage.onUsage((u) => {
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
        if (!event.affectsConfiguration("eri.account"))
            return;
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
        dispose: () => {
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
//# sourceMappingURL=index.js.map