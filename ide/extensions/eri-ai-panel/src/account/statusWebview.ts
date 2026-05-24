// Webview that renders sign-in status, plan, and current-period token usage.
//
// Loaded HTML lives at media/account/status.html; the webview is hydrated via
// postMessage so we never inline secrets in the HTML.

import * as fs from "fs";
import * as vscode from "vscode";
import { EriSession, TIER_LABELS, UsageSummary } from "./types";

interface AccountStatusPayload {
  readonly signedIn: boolean;
  readonly email: string | null;
  readonly tierLabel: string | null;
  readonly tierKey: EriSession["tier"] | null;
  readonly usage: UsageSummary | null;
  readonly billingUrl: string;
}

export interface AccountStatusPanelDeps {
  readonly context: vscode.ExtensionContext;
  readonly getSession: () => EriSession | null;
  readonly getUsage: () => UsageSummary | null;
  readonly openBilling: () => void;
  readonly signOut: () => Promise<void>;
  readonly refresh: () => Promise<void>;
  readonly billingUrl: string;
}

export class AccountStatusPanel {
  private panel: vscode.WebviewPanel | null = null;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly deps: AccountStatusPanelDeps) {}

  show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
      this.push();
      return;
    }
    this.panel = vscode.window.createWebviewPanel(
      "eri.account.status",
      "eri Account",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: false,
        localResourceRoots: [
          vscode.Uri.joinPath(this.deps.context.extensionUri, "media", "account"),
        ],
      },
    );
    this.panel.webview.html = this.loadHtml();
    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((raw: unknown) => {
        void this.onMessage(raw);
      }),
      this.panel.onDidDispose(() => {
        this.panel = null;
        for (const d of this.disposables.splice(0)) {
          d.dispose();
        }
      }),
    );
    this.push();
  }

  /** Re-render with the current session + usage snapshot. */
  push(): void {
    if (!this.panel) return;
    const session = this.deps.getSession();
    const payload: AccountStatusPayload = {
      signedIn: session !== null,
      email: session?.email ?? null,
      tierLabel: session ? TIER_LABELS[session.tier] : null,
      tierKey: session?.tier ?? null,
      usage: this.deps.getUsage(),
      billingUrl: this.deps.billingUrl,
    };
    void this.panel.webview.postMessage({ type: "state", state: payload });
  }

  dispose(): void {
    for (const d of this.disposables.splice(0)) {
      d.dispose();
    }
    this.panel?.dispose();
    this.panel = null;
  }

  private async onMessage(raw: unknown): Promise<void> {
    if (typeof raw !== "object" || raw === null) return;
    const msg = raw as { type?: unknown };
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
      default:
        return;
    }
  }

  private loadHtml(): string {
    const htmlPath = vscode.Uri.joinPath(
      this.deps.context.extensionUri,
      "media",
      "account",
      "status.html",
    );
    return fs.readFileSync(htmlPath.fsPath, "utf8");
  }
}
