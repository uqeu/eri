import * as vscode from "vscode";
import { Sidecar } from "../sidecar";
import { ApplyOrchestrator, ApplyResult, PendingEdit } from "./orchestrator";
import {
  BlockNode,
  FileGroupNode,
  PendingEditNode,
  PendingEditsTreeDataProvider,
} from "./pendingEditsView";
import { openDiff } from "./diffPreview";

export interface ApplyEvent {
  readonly kind: "staged" | "committed" | "cleared";
  readonly edits?: ReadonlyArray<PendingEdit>;
  readonly result?: ApplyResult;
}

export interface ApplyHandle {
  readonly orchestrator: ApplyOrchestrator;
  readonly view: vscode.TreeView<PendingEditNode>;
  readonly onDidChange: vscode.Event<ApplyEvent>;
  stage(modelOutput: string): Promise<ReadonlyArray<PendingEdit>>;
  applyAccepted(): Promise<ApplyResult>;
  dispose(): void;
}

export function activateApply(
  context: vscode.ExtensionContext,
  getSidecar: () => Sidecar | null,
): ApplyHandle {
  const orchestrator = new ApplyOrchestrator(getSidecar);
  const provider = new PendingEditsTreeDataProvider();

  const view = vscode.window.createTreeView<PendingEditNode>("eri.pendingEdits", {
    treeDataProvider: provider,
    showCollapseAll: true,
  });

  const emitter = new vscode.EventEmitter<ApplyEvent>();

  const stage = async (modelOutput: string): Promise<ReadonlyArray<PendingEdit>> => {
    const edits = await orchestrator.stage(modelOutput);
    provider.setEdits(edits);
    emitter.fire({ kind: "staged", edits });
    return edits;
  };

  const applyAccepted = async (): Promise<ApplyResult> => {
    const accepted = provider.getEdits().filter((e) => e.accepted === true);
    if (accepted.length === 0) {
      vscode.window.showInformationMessage("No accepted edits to apply.");
      const empty: ApplyResult = { applied: [], failed: [], checkpointId: null };
      return empty;
    }
    try {
      const result = await orchestrator.commit(accepted);
      emitter.fire({ kind: "committed", result });
      // Remove the just-applied edits from the pending list, leave rejects.
      for (const edit of accepted) {
        provider.removeEdit(edit.id);
      }
      reportApplyResult(result);
      return result;
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to apply edits: ${getErrorMessage(err)}`);
      throw err;
    }
  };

  const acceptAll = (): void => {
    provider.updateAll(true);
  };
  const rejectAll = (): void => {
    provider.updateAll(false);
  };
  const discardAll = (): void => {
    provider.clear();
    emitter.fire({ kind: "cleared" });
  };

  const showDiff = async (arg: unknown): Promise<void> => {
    const editId = resolveEditId(arg);
    if (!editId) {
      return;
    }
    const edit = provider.findEdit(editId);
    if (!edit) {
      return;
    }
    try {
      await openDiff(edit);
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to open diff: ${getErrorMessage(err)}`);
    }
  };

  const acceptBlock = (arg: unknown): void => {
    const id = resolveEditId(arg);
    if (id) {
      provider.updateAcceptance(id, true);
    }
  };
  const rejectBlock = (arg: unknown): void => {
    const id = resolveEditId(arg);
    if (id) {
      provider.updateAcceptance(id, false);
    }
  };
  const resetBlock = (arg: unknown): void => {
    const id = resolveEditId(arg);
    if (id) {
      provider.updateAcceptance(id, null);
    }
  };

  const revert = async (): Promise<void> => {
    const checkpointId = orchestrator.lastCheckpoint();
    if (!checkpointId) {
      vscode.window.showWarningMessage("No checkpoint to revert.");
      return;
    }
    const choice = await vscode.window.showWarningMessage(
      "Revert to the checkpoint created before the last apply?",
      { modal: true },
      "Revert",
      "Cancel",
    );
    if (choice !== "Revert") {
      return;
    }
    try {
      await orchestrator.revert(checkpointId);
      vscode.window.showInformationMessage("Reverted to checkpoint.");
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to revert: ${getErrorMessage(err)}`);
    }
  };

  context.subscriptions.push(
    view,
    emitter,
    vscode.commands.registerCommand("eri.apply.acceptAll", acceptAll),
    vscode.commands.registerCommand("eri.apply.rejectAll", rejectAll),
    vscode.commands.registerCommand("eri.apply.applyAccepted", applyAccepted),
    vscode.commands.registerCommand("eri.apply.discardAll", discardAll),
    vscode.commands.registerCommand("eri.apply.showDiff", showDiff),
    vscode.commands.registerCommand("eri.apply.acceptBlock", acceptBlock),
    vscode.commands.registerCommand("eri.apply.rejectBlock", rejectBlock),
    vscode.commands.registerCommand("eri.apply.resetBlock", resetBlock),
    vscode.commands.registerCommand("eri.apply.revert", revert),
  );

  return {
    orchestrator,
    view,
    onDidChange: emitter.event,
    stage,
    applyAccepted,
    dispose: () => {
      view.dispose();
      emitter.dispose();
    },
  };
}

function reportApplyResult(result: ApplyResult): void {
  if (result.failed.length > 0) {
    const detail = result.failed
      .slice(0, 3)
      .map((f) => `${f.path}: ${f.reason}`)
      .join("; ");
    const extra = result.failed.length > 3 ? ` (+${result.failed.length - 3} more)` : "";
    vscode.window.showWarningMessage(
      `Applied ${result.applied.length}, ${result.failed.length} failed — ${detail}${extra}`,
    );
    return;
  }
  if (result.applied.length === 0) {
    return;
  }
  vscode.window.showInformationMessage(
    `Applied ${result.applied.length} edit${result.applied.length === 1 ? "" : "s"}.`,
  );
}

function resolveEditId(arg: unknown): string | null {
  if (arg instanceof BlockNode) {
    return arg.edit.id;
  }
  if (arg instanceof FileGroupNode) {
    return null;
  }
  if (typeof arg === "string") {
    return arg;
  }
  return null;
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return "Unknown error";
}
