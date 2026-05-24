import * as vscode from "vscode";
import { Sidecar } from "../sidecar";
import { GraphClient, currentWorkspaceFsPath } from "./api";
import { GraphTreeDataProvider, GraphTreeNode } from "./view";
import { registerGraphCommands } from "./commands";

export interface GraphHandle {
  readonly view: vscode.TreeView<GraphTreeNode>;
  refresh(): Promise<void>;
  dispose(): void;
}

// Wire the eri.graph tree view + commands into the activity bar. Lives next
// to Codemaps under the eri activity-bar container.
export function activateGraph(
  context: vscode.ExtensionContext,
  getSidecar: () => Sidecar | null,
): GraphHandle {
  const client = new GraphClient(getSidecar, currentWorkspaceFsPath);
  const provider = new GraphTreeDataProvider(client);

  const view = vscode.window.createTreeView<GraphTreeNode>("eri.graph", {
    treeDataProvider: provider,
    showCollapseAll: true,
  });

  registerGraphCommands(context, provider, client);
  context.subscriptions.push(view);

  // Fire and forget — first paint just shows a placeholder until refresh
  // completes, so the user never sees an empty tree.
  void provider.refresh();

  return {
    view,
    refresh: () => provider.refresh(),
    dispose: () => view.dispose(),
  };
}

export type { GraphClient } from "./api";
