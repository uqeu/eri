import * as vscode from "vscode";
import { Sidecar } from "../sidecar";
import { ReviewFindingsProvider, ReviewNode } from "./findingsView";
import { registerReviewCommands } from "./commands";

export interface ReviewHandle {
  readonly view: vscode.TreeView<ReviewNode>;
  dispose(): void;
}

/**
 * Activate the eri-review surface: tree view, panel, and commands. Returns a
 * handle the extension owner can dispose on deactivate.
 */
export function activateReview(
  context: vscode.ExtensionContext,
  getSidecar: () => Sidecar | null,
): ReviewHandle {
  const provider = new ReviewFindingsProvider();
  const view = vscode.window.createTreeView<ReviewNode>("eri.review", {
    treeDataProvider: provider,
    showCollapseAll: true,
  });

  const commandDisposables = registerReviewCommands(context, provider, getSidecar);

  for (const d of commandDisposables) {
    context.subscriptions.push(d);
  }
  context.subscriptions.push(view);

  return {
    view,
    dispose: () => {
      view.dispose();
      provider.dispose();
    },
  };
}

export { ReviewFindingsProvider } from "./findingsView";
export * from "./types";
