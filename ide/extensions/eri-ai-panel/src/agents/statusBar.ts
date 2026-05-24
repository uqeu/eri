// Status-bar indicator for the active agent. Sits to the LEFT of the
// account-tier item, click → switch agent.

import * as vscode from "vscode";
import { AgentRegistry } from "./registry";
import { AgentDescriptor } from "./types";

export interface AgentStatusBarHandle extends vscode.Disposable {
  refresh(): void;
}

export function activateAgentStatusBar(
  context: vscode.ExtensionContext,
  registry: AgentRegistry,
): AgentStatusBarHandle {
  const item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    99,
  );
  item.command = "eri.agents.switch";

  const render = (): void => {
    const active = registry.active();
    item.text = `$(${codiconFor(active)}) ${active.label}`;
    item.tooltip = buildTooltip(active);
    item.show();
  };

  render();
  const subscription = registry.onChange(render);
  context.subscriptions.push(item, subscription);

  return {
    refresh: render,
    dispose: (): void => {
      subscription.dispose();
      item.dispose();
    },
  };
}

function codiconFor(d: AgentDescriptor): string {
  switch (d.kind) {
    case "cli":
      return "terminal";
    case "byok":
      return "key";
    case "auto":
      return "rocket";
    case "mercury":
      return "zap";
    case "proxy":
      return "rocket";
    default:
      return "circle-large";
  }
}

function buildTooltip(d: AgentDescriptor): vscode.MarkdownString {
  const md = new vscode.MarkdownString(
    `**${d.label}** (${d.vendor})\n\n${d.description}\n\n` +
      `kind: \`${d.kind}\` · free: \`${d.free}\``,
  );
  md.isTrusted = true;
  return md;
}
