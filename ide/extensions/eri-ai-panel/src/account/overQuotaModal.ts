import * as vscode from "vscode";

/**
 * Shared over-quota modal. Any code path that catches a 402 / JSON-RPC -32402
 * funnels through here so users see the same three options regardless of
 * which feature blew the cap: Upgrade, Use my own keys, Switch to Mercury-only.
 *
 * "Switch to Mercury-only" sets the active agent to `eri.agent.mercury`
 * so iteration keeps working with the diffusion engine (which is `bill: false`
 * and never touches the frontier token bucket).
 */

export interface OverQuotaModalOptions {
  readonly title?: string;
  readonly tier?: string;
  readonly remainingTokens?: number;
}

export async function showOverQuotaModal(
  opts: OverQuotaModalOptions = {},
): Promise<void> {
  const title = opts.title ?? "Token quota reached.";
  const detail = formatDetail(opts);

  const action = await vscode.window.showErrorMessage(
    title + (detail ? " " + detail : ""),
    { modal: false },
    "Upgrade",
    "Use my own keys",
    "Switch to Mercury-only",
  );

  if (action === "Upgrade") {
    await vscode.env.openExternal(
      vscode.Uri.parse("https://eri.dev/dashboard/billing"),
    );
  } else if (action === "Use my own keys") {
    await vscode.commands.executeCommand("eri.byok.setKey");
  } else if (action === "Switch to Mercury-only") {
    await vscode.commands.executeCommand(
      "eri.agents.setActive",
      "eri.agent.mercury",
    );
    vscode.window.showInformationMessage(
      "Switched to Mercury — iteration keeps working without frontier tokens.",
    );
  }
}

/**
 * Detect the OverQuota JSON-RPC code in an arbitrary error so callers can
 * pipe `e.message` here without parsing the wire format themselves.
 */
export function isOverQuotaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("-32402") || message.includes("OVER_QUOTA");
}

function formatDetail(opts: OverQuotaModalOptions): string {
  const parts: string[] = [];
  if (opts.tier) {
    parts.push(`tier=${opts.tier}`);
  }
  if (typeof opts.remainingTokens === "number") {
    parts.push(`remaining=${opts.remainingTokens.toLocaleString()} tokens`);
  }
  return parts.length > 0 ? `(${parts.join(", ")})` : "";
}
