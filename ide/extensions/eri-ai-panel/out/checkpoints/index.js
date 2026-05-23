"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activateCheckpoints = activateCheckpoints;
const vscode = require("vscode");
const checkpointsService_1 = require("./checkpointsService");
const checkpointsView_1 = require("./checkpointsView");
const DEFAULT_PRUNE_KEEP = 50;
function activateCheckpoints(context, getSidecar) {
    const service = new checkpointsService_1.CheckpointsService(getSidecar);
    const provider = new checkpointsView_1.CheckpointsTreeDataProvider(service);
    const view = vscode.window.createTreeView("eri.checkpoints", {
        treeDataProvider: provider,
        showCollapseAll: true,
    });
    // Initial fetch — fire and forget; errors surface as a placeholder row.
    void provider.refresh();
    const refresh = () => provider.refresh();
    const createAutoCheckpoint = async (label) => {
        const checkpoint = await service.create(label);
        provider.registerLocalCheckpoint(checkpoint);
        return checkpoint.id;
    };
    context.subscriptions.push(view, vscode.commands.registerCommand("eri.checkpoints.refresh", refresh), vscode.commands.registerCommand("eri.checkpoints.create", () => runCreate(service, provider)), vscode.commands.registerCommand("eri.checkpoints.prune", () => runPrune(service, refresh)), vscode.commands.registerCommand("eri.checkpoints.restore", (item) => runRestore(service, refresh, item)), vscode.commands.registerCommand("eri.checkpoints.delete", (item) => runDelete(service, refresh, item)), vscode.commands.registerCommand("eri.checkpoints.copySha", (item) => runCopySha(item)), vscode.commands.registerCommand("eri.checkpoints.diff", (item) => runDiff(service, item)), vscode.commands.registerCommand("eri.checkpoints.openFile", (item) => runOpenFile(item)), vscode.commands.registerCommand("eri.checkpoints.diffFile", (item) => runDiffFile(item)));
    return {
        view,
        service,
        refresh,
        createAutoCheckpoint,
        dispose: () => {
            view.dispose();
        },
    };
}
function isCheckpointItem(item) {
    return item instanceof checkpointsView_1.CheckpointTreeItem;
}
function isCheckpointFileItem(item) {
    return item instanceof checkpointsView_1.CheckpointFileTreeItem;
}
async function runCreate(service, provider) {
    const label = await vscode.window.showInputBox({
        prompt: "Label for this checkpoint",
        placeHolder: "e.g., before refactor",
    });
    if (label === undefined) {
        return; // user cancelled
    }
    try {
        const cp = await service.create(label);
        provider.registerLocalCheckpoint(cp);
        vscode.window.showInformationMessage(`Checkpoint created: ${cp.label || "Untitled"} (${cp.sha.slice(0, 7)})`);
    }
    catch (err) {
        vscode.window.showErrorMessage(`Failed to create checkpoint: ${(0, checkpointsView_1.getErrorMessage)(err)}`);
    }
}
async function runPrune(service, refresh) {
    const input = await vscode.window.showInputBox({
        prompt: "Keep how many recent checkpoints?",
        value: String(DEFAULT_PRUNE_KEEP),
        validateInput: (value) => {
            const n = Number(value);
            if (!Number.isInteger(n) || n < 0) {
                return "Enter a non-negative integer";
            }
            return null;
        },
    });
    if (input === undefined) {
        return;
    }
    const keep = Number(input);
    try {
        const result = await service.prune(keep);
        await refresh();
        vscode.window.showInformationMessage(`Pruned ${result.pruned} checkpoint${result.pruned === 1 ? "" : "s"}.`);
    }
    catch (err) {
        vscode.window.showErrorMessage(`Failed to prune: ${(0, checkpointsView_1.getErrorMessage)(err)}`);
    }
}
async function runRestore(service, refresh, item) {
    if (!isCheckpointItem(item)) {
        return;
    }
    const cp = item.checkpoint;
    const choice = await vscode.window.showWarningMessage("Restore checkpoint? Uncommitted changes since this checkpoint will be lost.", { modal: true }, "Restore", "Cancel");
    if (choice !== "Restore") {
        return;
    }
    await doRestore(service, refresh, cp.id, false);
}
async function doRestore(service, refresh, id, force) {
    try {
        const result = await service.restore(id, { force });
        if (result.filesSkipped.length > 0) {
            const preview = result.filesSkipped.slice(0, 5).join(", ");
            const more = result.filesSkipped.length > 5
                ? ` (+${result.filesSkipped.length - 5} more)`
                : "";
            const followup = await vscode.window.showWarningMessage(`Skipped ${result.filesSkipped.length} file${result.filesSkipped.length === 1 ? "" : "s"}: ${preview}${more}`, "Force restore", "Cancel");
            if (followup === "Force restore") {
                await doRestore(service, refresh, id, true);
                return;
            }
        }
        else {
            vscode.window.showInformationMessage(`Restored ${result.filesRestored.length} file${result.filesRestored.length === 1 ? "" : "s"}.`);
        }
        await refresh();
    }
    catch (err) {
        vscode.window.showErrorMessage(`Failed to restore checkpoint: ${(0, checkpointsView_1.getErrorMessage)(err)}`);
    }
}
async function runDelete(service, refresh, item) {
    if (!isCheckpointItem(item)) {
        return;
    }
    const cp = item.checkpoint;
    const choice = await vscode.window.showWarningMessage(`Delete checkpoint "${cp.label || "Untitled"}"?`, { modal: true }, "Delete", "Cancel");
    if (choice !== "Delete") {
        return;
    }
    try {
        await service.delete(cp.id);
        await refresh();
    }
    catch (err) {
        vscode.window.showErrorMessage(`Failed to delete checkpoint: ${(0, checkpointsView_1.getErrorMessage)(err)}`);
    }
}
async function runCopySha(item) {
    if (!isCheckpointItem(item)) {
        return;
    }
    await vscode.env.clipboard.writeText(item.checkpoint.sha);
    vscode.window.showInformationMessage(`Copied SHA: ${item.checkpoint.sha.slice(0, 7)}`);
}
async function runDiff(service, item) {
    if (!isCheckpointItem(item)) {
        return;
    }
    try {
        const show = await service.show(item.checkpoint.id);
        if (show.filesChanged.length === 0) {
            vscode.window.showInformationMessage("Checkpoint has no file changes.");
            return;
        }
        const first = show.filesChanged[0];
        await openDiffForFile(item.checkpoint, first);
    }
    catch (err) {
        vscode.window.showErrorMessage(`Failed to open diff: ${(0, checkpointsView_1.getErrorMessage)(err)}`);
    }
}
async function runOpenFile(item) {
    if (!isCheckpointFileItem(item)) {
        return;
    }
    try {
        const doc = await loadCheckpointDocument(item.checkpoint, item.file.path);
        await vscode.window.showTextDocument(doc, { preview: true });
    }
    catch (err) {
        vscode.window.showErrorMessage(`Failed to open file: ${(0, checkpointsView_1.getErrorMessage)(err)}`);
    }
}
async function runDiffFile(item) {
    if (!isCheckpointFileItem(item)) {
        return;
    }
    try {
        await openDiffForFile(item.checkpoint, item.file);
    }
    catch (err) {
        vscode.window.showErrorMessage(`Failed to open diff: ${(0, checkpointsView_1.getErrorMessage)(err)}`);
    }
}
async function openDiffForFile(checkpoint, file) {
    const cwd = (0, checkpointsService_1.resolveWorkspaceCwd)();
    if (!cwd) {
        vscode.window.showWarningMessage("Open a workspace folder to diff checkpoints.");
        return;
    }
    const checkpointDoc = await loadCheckpointDocument(checkpoint, file.path);
    const headUri = vscode.Uri.file(join(cwd, file.path));
    const title = `${file.path} (HEAD ↔ ${shortSha(checkpoint.sha)})`;
    await vscode.commands.executeCommand("vscode.diff", headUri, checkpointDoc.uri, title);
}
async function loadCheckpointDocument(checkpoint, filePath) {
    const cwd = (0, checkpointsService_1.resolveWorkspaceCwd)();
    if (!cwd) {
        throw new Error("no workspace folder");
    }
    const content = await (0, checkpointsService_1.readFileAtRevision)(cwd, checkpoint.sha, filePath);
    // Untitled scheme keeps the snapshot read-only-by-convention and out of the
    // user's working tree. Title encodes path + short sha for clarity.
    return vscode.workspace.openTextDocument({
        content,
        language: undefined,
    });
}
function shortSha(sha) {
    return sha.length > 7 ? sha.slice(0, 7) : sha;
}
function join(cwd, relative) {
    if (relative.startsWith("/")) {
        return relative;
    }
    const sep = cwd.endsWith("/") ? "" : "/";
    return `${cwd}${sep}${relative}`;
}
//# sourceMappingURL=index.js.map