// Command wiring for the eri account module.
//
// Commands:
//   - eri.account.signIn       — kicks off device-code flow
//   - eri.account.signOut      — clears session + best-effort backend revoke
//   - eri.account.showStatus   — opens the usage webview panel
//   - eri.account.openBilling  — opens the dashboard billing portal

import * as vscode from "vscode";
import { DeviceCodeFlow, DeviceCodeError } from "./deviceCodeFlow";
import { SessionStore } from "./sessionStore";
import { UsageClient } from "./usageClient";
import { AccountStatusPanel } from "./statusWebview";
import { EriSession } from "./types";

export interface AccountCommandDeps {
  readonly context: vscode.ExtensionContext;
  readonly store: SessionStore;
  readonly usage: UsageClient;
  readonly panel: AccountStatusPanel;
  readonly getBaseUrl: () => string;
  readonly deepLinkSource: { next(): Promise<string | null> };
  readonly fetchImpl?: typeof fetch;
  readonly logger?: { warn: (msg: string) => void };
}

const BILLING_PATH = "/dashboard/billing";

export function registerAccountCommands(deps: AccountCommandDeps): vscode.Disposable[] {
  const log = deps.logger ?? { warn: (msg: string) => console.warn(`[eri.account] ${msg}`) };

  let activeFlow: DeviceCodeFlow | null = null;

  const signIn = vscode.commands.registerCommand("eri.account.signIn", async () => {
    if (activeFlow) {
      void vscode.window.showInformationMessage("eri: sign-in already in progress.");
      return;
    }
    const baseUrl = deps.getBaseUrl();
    const flow = new DeviceCodeFlow({
      baseUrl,
      fetchImpl: deps.fetchImpl,
      opener: {
        open: async (url) => {
          await vscode.env.openExternal(vscode.Uri.parse(url));
        },
      },
      ui: {
        show: (start) => {
          void vscode.window.showInformationMessage(
            `eri: approve sign-in in your browser (code: ${start.userCode})`,
            "Open again",
          ).then((pick) => {
            if (pick === "Open again") {
              void vscode.env.openExternal(vscode.Uri.parse(start.verifyUrl));
            }
          });
        },
        hide: () => undefined,
      },
      waitForDeepLink: () => deps.deepLinkSource.next(),
    });
    activeFlow = flow;
    try {
      const session = await flow.run();
      await deps.store.set(session);
      void deps.usage.fetchUsage();
      void vscode.window.showInformationMessage(`eri: signed in as ${session.email}.`);
    } catch (err) {
      activeFlow = null;
      if (err instanceof DeviceCodeError) {
        if (err.kind !== "timeout" && err.kind !== "denied") {
          log.warn(`sign-in failed: ${err.kind}`);
        }
        void vscode.window.showWarningMessage(`eri sign-in: ${humanError(err)}`);
        return;
      }
      log.warn(`sign-in failed: ${String(err)}`);
      void vscode.window.showErrorMessage("eri: sign-in failed. Check your network and try again.");
      return;
    }
    activeFlow = null;
  });

  const signOut = vscode.commands.registerCommand("eri.account.signOut", async () => {
    const session = await deps.store.get();
    await deps.store.clear();
    deps.panel.push();
    if (session) {
      void revokeBestEffort(deps.getBaseUrl(), session, deps.fetchImpl, log);
    }
    void vscode.window.showInformationMessage("eri: signed out.");
  });

  const showStatus = vscode.commands.registerCommand("eri.account.showStatus", () => {
    deps.panel.show();
  });

  const openBilling = vscode.commands.registerCommand("eri.account.openBilling", async () => {
    const url = `${deps.getBaseUrl().replace(/\/+$/, "")}${BILLING_PATH}`;
    await vscode.env.openExternal(vscode.Uri.parse(url));
  });

  return [signIn, signOut, showStatus, openBilling];
}

async function revokeBestEffort(
  baseUrl: string,
  session: EriSession,
  fetchImpl: typeof fetch = fetch,
  logger: { warn: (msg: string) => void },
): Promise<void> {
  try {
    await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/api/v1/auth/revoke`, {
      method: "POST",
      headers: { authorization: `Bearer ${session.token}` },
    });
  } catch (err: unknown) {
    logger.warn(`revoke failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function humanError(err: DeviceCodeError): string {
  switch (err.kind) {
    case "denied":
      return "request was denied.";
    case "expired":
      return "code expired — try again.";
    case "timeout":
      return "timed out waiting for approval.";
    case "network":
      return "couldn't reach eri.dev.";
    case "bad_response":
      return "got an unexpected response from eri.dev.";
    default:
      return err.message;
  }
}
