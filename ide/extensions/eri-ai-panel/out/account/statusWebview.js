"use strict";
// Webview that renders sign-in status, plan, and current-period token usage.
//
// Loaded HTML lives at media/account/status.html; the webview is hydrated via
// postMessage so we never inline secrets in the HTML.
Object.defineProperty(exports, "__esModule", { value: true });
exports.AccountStatusPanel = void 0;
const fs = require("fs");
const vscode = require("vscode");
const types_1 = require("./types");
class AccountStatusPanel {
    deps;
    panel = null;
    disposables = [];
    constructor(deps) {
        this.deps = deps;
    }
    show() {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.Active);
            this.push();
            return;
        }
        this.panel = vscode.window.createWebviewPanel("eri.account.status", "eri Account", vscode.ViewColumn.Active, {
            enableScripts: true,
            retainContextWhenHidden: false,
            localResourceRoots: [
                vscode.Uri.joinPath(this.deps.context.extensionUri, "media", "account"),
            ],
        });
        this.panel.webview.html = this.loadHtml();
        this.disposables.push(this.panel.webview.onDidReceiveMessage((raw) => {
            void this.onMessage(raw);
        }), this.panel.onDidDispose(() => {
            this.panel = null;
            for (const d of this.disposables.splice(0)) {
                d.dispose();
            }
        }));
        this.push();
    }
    /** Re-render with the current session + usage snapshot. */
    push() {
        if (!this.panel)
            return;
        const session = this.deps.getSession();
        const payload = {
            signedIn: session !== null,
            email: session?.email ?? null,
            tierLabel: session ? types_1.TIER_LABELS[session.tier] : null,
            tierKey: session?.tier ?? null,
            usage: this.deps.getUsage(),
            billingUrl: this.deps.billingUrl,
        };
        void this.panel.webview.postMessage({ type: "state", state: payload });
    }
    dispose() {
        for (const d of this.disposables.splice(0)) {
            d.dispose();
        }
        this.panel?.dispose();
        this.panel = null;
    }
    async onMessage(raw) {
        if (typeof raw !== "object" || raw === null)
            return;
        const msg = raw;
        switch (msg.type) {
            case "ready":
                this.push();
                return;
            case "refresh":
                await this.deps.refresh();
                this.push();
                return;
            case "openBilling":
                this.deps.openBilling();
                return;
            case "signOut":
                await this.deps.signOut();
                this.push();
                return;
            case "switchPlan": {
                const slug = raw.slug;
                if (typeof slug !== "string" || slug.length === 0) {
                    return;
                }
                // `slug` is constrained to one of the 4 tier slugs by the webview's
                // tier list — anything else is dropped here as a guard.
                const allowed = new Set(["free", "starter", "pro", "pro_plus"]);
                if (!allowed.has(slug)) {
                    return;
                }
                const url = `${this.deps.billingUrl}/api/billing/checkout?plan=${encodeURIComponent(slug)}&billing=monthly`;
                await vscode.env.openExternal(vscode.Uri.parse(url));
                return;
            }
            default:
                return;
        }
    }
    loadHtml() {
        const htmlPath = vscode.Uri.joinPath(this.deps.context.extensionUri, "media", "account", "status.html");
        return fs.readFileSync(htmlPath.fsPath, "utf8");
    }
}
exports.AccountStatusPanel = AccountStatusPanel;
//# sourceMappingURL=statusWebview.js.map