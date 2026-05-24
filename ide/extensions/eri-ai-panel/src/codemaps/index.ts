import * as vscode from "vscode";
import { Sidecar } from "../sidecar";
import { CodemapsTreeDataProvider, type CodemapNode } from "./view";
import { registerCodemapCommands } from "./commands";

export interface CodemapsHandle {
  readonly view: vscode.TreeView<CodemapNode>;
  refresh(): Promise<void>;
  dispose(): void;
}

// Wire the Codemaps tree view + commands into the activity bar. The view
// lives next to Checkpoints under the eri activity bar container.
export function activateCodemaps(
  context: vscode.ExtensionContext,
  getSidecar: () => Sidecar | null,
): CodemapsHandle {
  const provider = new CodemapsTreeDataProvider(getSidecar);
  const view = vscode.window.createTreeView<CodemapNode>("eri.codemaps", {
    treeDataProvider: provider,
    showCollapseAll: false,
  });

  registerCodemapCommands(context, provider, getSidecar);
  context.subscriptions.push(view);

  // Fire and forget — first paint just shows a placeholder until refresh
  // completes, so the user never sees a blank tree.
  void provider.refresh();

  return {
    view,
    refresh: () => provider.refresh(),
    dispose: () => view.dispose(),
  };
}

export type { CodemapSummary } from "./view";
