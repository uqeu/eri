import * as vscode from "vscode";
import { Sidecar } from "../sidecar";
import { registerCrashCommands } from "./commands";
import { CrashTreeDataProvider } from "./view";

export interface CrashHandle {
  readonly view: vscode.TreeView<vscode.TreeItem>;
  refresh(): Promise<void>;
  dispose(): void;
}

export function activateCrash(
  context: vscode.ExtensionContext,
  getSidecar: () => Sidecar | null,
): CrashHandle {
  const provider = new CrashTreeDataProvider();
  const view = vscode.window.createTreeView("eri.crashes", {
    treeDataProvider: provider,
    showCollapseAll: false,
  });

  const handle = registerCrashCommands(context, getSidecar, provider);

  // Initial fetch — failures surface as placeholder rows in the tree.
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
