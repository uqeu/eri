"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activateApply = activateApply;
const vscode = require("vscode");
const orchestrator_1 = require("./orchestrator");
const pendingEditsView_1 = require("./pendingEditsView");
const diffPreview_1 = require("./diffPreview");
function activateApply(context, getSidecar) {
    const orchestrator = new orchestrator_1.ApplyOrchestrator(getSidecar);
    const provider = new pendingEditsView_1.PendingEditsTreeDataProvider();
    const view = vscode.window.createTreeView("eri.pendingEdits", {
        treeDataProvider: provider,
        showCollapseAll: true,
    });
    const emitter = new vscode.EventEmitter();
    const stage = async (modelOutput) => {
        const edits = await orchestrator.stage(modelOutput);
        provider.setEdits(edits);
        emitter.fire({ kind: "staged", edits });
        return edits;
    };
    const applyAccepted = async () => {
        const accepted = provider.getEdits().filter((e) => e.accepted === true);
        if (accepted.length === 0) {
            vscode.window.showInformationMessage("No accepted edits to apply.");
            const empty = { applied: [], failed: [], checkpointId: null };
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
        }
        catch (err) {
            vscode.window.showErrorMessage(`Failed to apply edits: ${getErrorMessage(err)}`);
            throw err;
        }
    };
    const acceptAll = () => {
        provider.updateAll(true);
    };
    const rejectAll = () => {
        provider.updateAll(false);
    };
    const discardAll = () => {
        provider.clear();
        emitter.fire({ kind: "cleared" });
    };
    const showDiff = async (arg) => {
        const editId = resolveEditId(arg);
        if (!editId) {
            return;
        }
        const edit = provider.findEdit(editId);
        if (!edit) {
            return;
        }
        try {
            await (0, diffPreview_1.openDiff)(edit);
        }
        catch (err) {
            vscode.window.showErrorMessage(`Failed to open diff: ${getErrorMessage(err)}`);
        }
    };
    const acceptBlock = (arg) => {
        const id = resolveEditId(arg);
        if (id) {
            provider.updateAcceptance(id, true);
        }
    };
    const rejectBlock = (arg) => {
        const id = resolveEditId(arg);
        if (id) {
            provider.updateAcceptance(id, false);
        }
    };
    const resetBlock = (arg) => {
        const id = resolveEditId(arg);
        if (id) {
            provider.updateAcceptance(id, null);
        }
    };
    const revert = async () => {
        const checkpointId = orchestrator.lastCheckpoint();
        if (!checkpointId) {
            vscode.window.showWarningMessage("No checkpoint to revert.");
            return;
        }
        const choice = await vscode.window.showWarningMessage("Revert to the checkpoint created before the last apply?", { modal: true }, "Revert", "Cancel");
        if (choice !== "Revert") {
            return;
        }
        try {
            await orchestrator.revert(checkpointId);
            vscode.window.showInformationMessage("Reverted to checkpoint.");
        }
        catch (err) {
            vscode.window.showErrorMessage(`Failed to revert: ${getErrorMessage(err)}`);
        }
    };
    context.subscriptions.push(view, emitter, vscode.commands.registerCommand("eri.apply.acceptAll", acceptAll), vscode.commands.registerCommand("eri.apply.rejectAll", rejectAll), vscode.commands.registerCommand("eri.apply.applyAccepted", applyAccepted), vscode.commands.registerCommand("eri.apply.discardAll", discardAll), vscode.commands.registerCommand("eri.apply.showDiff", showDiff), vscode.commands.registerCommand("eri.apply.acceptBlock", acceptBlock), vscode.commands.registerCommand("eri.apply.rejectBlock", rejectBlock), vscode.commands.registerCommand("eri.apply.resetBlock", resetBlock), vscode.commands.registerCommand("eri.apply.revert", revert));
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
function reportApplyResult(result) {
    if (result.failed.length > 0) {
        const detail = result.failed
            .slice(0, 3)
            .map((f) => `${f.path}: ${f.reason}`)
            .join("; ");
        const extra = result.failed.length > 3 ? ` (+${result.failed.length - 3} more)` : "";
        vscode.window.showWarningMessage(`Applied ${result.applied.length}, ${result.failed.length} failed — ${detail}${extra}`);
        return;
    }
    if (result.applied.length === 0) {
        return;
    }
    vscode.window.showInformationMessage(`Applied ${result.applied.length} edit${result.applied.length === 1 ? "" : "s"}.`);
}
function resolveEditId(arg) {
    if (arg instanceof pendingEditsView_1.BlockNode) {
        return arg.edit.id;
    }
    if (arg instanceof pendingEditsView_1.FileGroupNode) {
        return null;
    }
    if (typeof arg === "string") {
        return arg;
    }
    return null;
}
function getErrorMessage(err) {
    if (err instanceof Error) {
        return err.message;
    }
    return "Unknown error";
}
//# sourceMappingURL=index.js.map