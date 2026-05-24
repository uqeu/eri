import * as vscode from "vscode";
import { Sidecar } from "../sidecar";
import { registerAuditCommands } from "./commands";
import { AuditTreeDataProvider } from "./view";

export interface AuditHandle {
  readonly view: vscode.TreeView<vscode.TreeItem>;
  refresh(): Promise<void>;
  dispose(): void;
}

export function activateAudit(
  context: vscode.ExtensionContext,
  getSidecar: () => Sidecar | null,
): AuditHandle {
  const provider = new AuditTreeDataProvider();
  const view = vscode.window.createTreeView("eri.audit", {
    treeDataProvider: provider,
    showCollapseAll: true,
  });

  const handle = registerAuditCommands(context, getSidecar, provider);

  // Initial fetch — fire-and-forget; failures surface as placeholder rows.
  void handle.refresh();

  context.subscriptions.push(view);

  return {
    view,
    refresh: () => handle.refresh(),
    dispose: () => {
      view.dispose();
    },
  };
}
