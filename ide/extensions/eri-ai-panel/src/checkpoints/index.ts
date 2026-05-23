import * as vscode from "vscode";
import { Sidecar } from "../sidecar";
import {
  Checkpoint,
  CheckpointFileChange,
  CheckpointsService,
  readFileAtRevision,
  resolveWorkspaceCwd,
} from "./checkpointsService";
import {
  CheckpointFileTreeItem,
  CheckpointNode,
  CheckpointTreeItem,
  CheckpointsTreeDataProvider,
  getErrorMessage,
} from "./checkpointsView";

export interface CheckpointsHandle {
  readonly view: vscode.TreeView<CheckpointNode>;
  readonly service: CheckpointsService;
  refresh(): Promise<void>;
  createAutoCheckpoint(label: string): Promise<string>;
  dispose(): void;
}

const DEFAULT_PRUNE_KEEP = 50;

export function activateCheckpoints(
  context: vscode.ExtensionContext,
  getSidecar: () => Sidecar | null,
): CheckpointsHandle {
  const service = new CheckpointsService(getSidecar);
  const provider = new CheckpointsTreeDataProvider(service);

  const view = vscode.window.createTreeView<CheckpointNode>("eri.checkpoints", {
    treeDataProvider: provider,
    showCollapseAll: true,
  });

  // Initial fetch — fire and forget; errors surface as a placeholder row.
  void provider.refresh();

  const refresh = (): Promise<void> => provider.refresh();

  const createAutoCheckpoint = async (label: string): Promise<string> => {
    const checkpoint = await service.create(label);
    provider.registerLocalCheckpoint(checkpoint);
    return checkpoint.id;
  };

  context.subscriptions.push(
    view,
    vscode.commands.registerCommand("eri.checkpoints.refresh", refresh),
    vscode.commands.registerCommand("eri.checkpoints.create", () =>
      runCreate(service, provider),
    ),
    vscode.commands.registerCommand("eri.checkpoints.prune", () =>
      runPrune(service, refresh),
    ),
    vscode.commands.registerCommand("eri.checkpoints.restore", (item: unknown) =>
      runRestore(service, refresh, item),
    ),
    vscode.commands.registerCommand("eri.checkpoints.delete", (item: unknown) =>
      runDelete(service, refresh, item),
    ),
    vscode.commands.registerCommand("eri.checkpoints.copySha", (item: unknown) =>
      runCopySha(item),
    ),
    vscode.commands.registerCommand("eri.checkpoints.diff", (item: unknown) =>
      runDiff(service, item),
    ),
    vscode.commands.registerCommand("eri.checkpoints.openFile", (item: unknown) =>
      runOpenFile(item),
    ),
    vscode.commands.registerCommand("eri.checkpoints.diffFile", (item: unknown) =>
      runDiffFile(item),
    ),
  );

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

function isCheckpointItem(item: unknown): item is CheckpointTreeItem {
  return item instanceof CheckpointTreeItem;
}

function isCheckpointFileItem(item: unknown): item is CheckpointFileTreeItem {
  return item instanceof CheckpointFileTreeItem;
}

async function runCreate(
  service: CheckpointsService,
  provider: CheckpointsTreeDataProvider,
): Promise<void> {
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
    vscode.window.showInformationMessage(
      `Checkpoint created: ${cp.label || "Untitled"} (${cp.sha.slice(0, 7)})`,
    );
  } catch (err) {
    vscode.window.showErrorMessage(
      `Failed to create checkpoint: ${getErrorMessage(err)}`,
    );
  }
}

async function runPrune(
  service: CheckpointsService,
  refresh: () => Promise<void>,
): Promise<void> {
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
    vscode.window.showInformationMessage(
      `Pruned ${result.pruned} checkpoint${result.pruned === 1 ? "" : "s"}.`,
    );
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to prune: ${getErrorMessage(err)}`);
  }
}

async function runRestore(
  service: CheckpointsService,
  refresh: () => Promise<void>,
  item: unknown,
): Promise<void> {
  if (!isCheckpointItem(item)) {
    return;
  }
  const cp = item.checkpoint;
  const choice = await vscode.window.showWarningMessage(
    "Restore checkpoint? Uncommitted changes since this checkpoint will be lost.",
    { modal: true },
    "Restore",
    "Cancel",
  );
  if (choice !== "Restore") {
    return;
  }
  await doRestore(service, refresh, cp.id, false);
}

async function doRestore(
  service: CheckpointsService,
  refresh: () => Promise<void>,
  id: string,
  force: boolean,
): Promise<void> {
  try {
    const result = await service.restore(id, { force });
    if (result.filesSkipped.length > 0) {
      const preview = result.filesSkipped.slice(0, 5).join(", ");
      const more =
        result.filesSkipped.length > 5
          ? ` (+${result.filesSkipped.length - 5} more)`
          : "";
      const followup = await vscode.window.showWarningMessage(
        `Skipped ${result.filesSkipped.length} file${result.filesSkipped.length === 1 ? "" : "s"}: ${preview}${more}`,
        "Force restore",
        "Cancel",
      );
      if (followup === "Force restore") {
        await doRestore(service, refresh, id, true);
        return;
      }
    } else {
      vscode.window.showInformationMessage(
        `Restored ${result.filesRestored.length} file${result.filesRestored.length === 1 ? "" : "s"}.`,
      );
    }
    await refresh();
  } catch (err) {
    vscode.window.showErrorMessage(
      `Failed to restore checkpoint: ${getErrorMessage(err)}`,
    );
  }
}

async function runDelete(
  service: CheckpointsService,
  refresh: () => Promise<void>,
  item: unknown,
): Promise<void> {
  if (!isCheckpointItem(item)) {
    return;
  }
  const cp = item.checkpoint;
  const choice = await vscode.window.showWarningMessage(
    `Delete checkpoint "${cp.label || "Untitled"}"?`,
    { modal: true },
    "Delete",
    "Cancel",
  );
  if (choice !== "Delete") {
    return;
  }
  try {
    await service.delete(cp.id);
    await refresh();
  } catch (err) {
    vscode.window.showErrorMessage(
      `Failed to delete checkpoint: ${getErrorMessage(err)}`,
    );
  }
}

async function runCopySha(item: unknown): Promise<void> {
  if (!isCheckpointItem(item)) {
    return;
  }
  await vscode.env.clipboard.writeText(item.checkpoint.sha);
  vscode.window.showInformationMessage(
    `Copied SHA: ${item.checkpoint.sha.slice(0, 7)}`,
  );
}

async function runDiff(service: CheckpointsService, item: unknown): Promise<void> {
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
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to open diff: ${getErrorMessage(err)}`);
  }
}

async function runOpenFile(item: unknown): Promise<void> {
  if (!isCheckpointFileItem(item)) {
    return;
  }
  try {
    const doc = await loadCheckpointDocument(item.checkpoint, item.file.path);
    await vscode.window.showTextDocument(doc, { preview: true });
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to open file: ${getErrorMessage(err)}`);
  }
}

async function runDiffFile(item: unknown): Promise<void> {
  if (!isCheckpointFileItem(item)) {
    return;
  }
  try {
    await openDiffForFile(item.checkpoint, item.file);
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to open diff: ${getErrorMessage(err)}`);
  }
}

async function openDiffForFile(
  checkpoint: Checkpoint,
  file: CheckpointFileChange,
): Promise<void> {
  const cwd = resolveWorkspaceCwd();
  if (!cwd) {
    vscode.window.showWarningMessage("Open a workspace folder to diff checkpoints.");
    return;
  }
  const checkpointDoc = await loadCheckpointDocument(checkpoint, file.path);
  const headUri = vscode.Uri.file(join(cwd, file.path));
  const title = `${file.path} (HEAD ↔ ${shortSha(checkpoint.sha)})`;
  await vscode.commands.executeCommand("vscode.diff", headUri, checkpointDoc.uri, title);
}

async function loadCheckpointDocument(
  checkpoint: Checkpoint,
  filePath: string,
): Promise<vscode.TextDocument> {
  const cwd = resolveWorkspaceCwd();
  if (!cwd) {
    throw new Error("no workspace folder");
  }
  const content = await readFileAtRevision(cwd, checkpoint.sha, filePath);
  // Untitled scheme keeps the snapshot read-only-by-convention and out of the
  // user's working tree. Title encodes path + short sha for clarity.
  return vscode.workspace.openTextDocument({
    content,
    language: undefined,
  });
}

function shortSha(sha: string): string {
  return sha.length > 7 ? sha.slice(0, 7) : sha;
}

function join(cwd: string, relative: string): string {
  if (relative.startsWith("/")) {
    return relative;
  }
  const sep = cwd.endsWith("/") ? "" : "/";
  return `${cwd}${sep}${relative}`;
}
