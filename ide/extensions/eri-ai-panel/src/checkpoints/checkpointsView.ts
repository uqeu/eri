import * as vscode from "vscode";
import {
  Checkpoint,
  CheckpointFileChange,
  CheckpointsService,
  FileChangeKind,
} from "./checkpointsService";
import { formatFullTimestamp, formatRelativeTime } from "./relativeTime";

export type CheckpointNode = CheckpointTreeItem | CheckpointFileTreeItem | PlaceholderTreeItem;

export class CheckpointTreeItem extends vscode.TreeItem {
  readonly kind = "checkpoint" as const;

  constructor(public readonly checkpoint: Checkpoint) {
    super(
      checkpoint.label.trim().length > 0 ? checkpoint.label : "Untitled checkpoint",
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    this.description = formatRelativeTime(checkpoint.createdAtMs);
    this.tooltip = buildCheckpointTooltip(checkpoint);
    this.contextValue = "eri.checkpoint";
    this.iconPath = new vscode.ThemeIcon("history");
    this.id = `checkpoint:${checkpoint.id}`;
  }
}

export class CheckpointFileTreeItem extends vscode.TreeItem {
  readonly kind = "file" as const;

  constructor(
    public readonly checkpoint: Checkpoint,
    public readonly file: CheckpointFileChange,
  ) {
    super(file.path, vscode.TreeItemCollapsibleState.None);
    this.description = describeFileChange(file);
    this.tooltip = buildFileTooltip(checkpoint, file);
    this.contextValue = "eri.checkpoint.file";
    this.iconPath = pickFileIcon(file.kind);
    this.id = `checkpoint:${checkpoint.id}:${file.path}`;
  }
}

export class PlaceholderTreeItem extends vscode.TreeItem {
  readonly kind = "placeholder" as const;

  constructor(label: string, icon: string = "info") {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "eri.checkpoint.placeholder";
    this.iconPath = new vscode.ThemeIcon(icon);
  }
}

function buildCheckpointTooltip(checkpoint: Checkpoint): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, false);
  md.isTrusted = false;
  const label = checkpoint.label.trim().length > 0 ? checkpoint.label : "Untitled checkpoint";
  md.appendMarkdown(`**${label}**\n\n`);
  md.appendMarkdown(`Created: ${formatFullTimestamp(checkpoint.createdAtMs)}\n\n`);
  md.appendMarkdown(`SHA: \`${shortSha(checkpoint.sha)}\``);
  return md;
}

function buildFileTooltip(
  checkpoint: Checkpoint,
  file: CheckpointFileChange,
): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, false);
  md.isTrusted = false;
  md.appendMarkdown(`**${file.path}**\n\n`);
  md.appendMarkdown(`Change: ${file.kind}\n\n`);
  md.appendMarkdown(`+${file.added} / -${file.removed}\n\n`);
  md.appendMarkdown(`Checkpoint: \`${shortSha(checkpoint.sha)}\``);
  return md;
}

function describeFileChange(file: CheckpointFileChange): string {
  const kindShort = file.kind === "modified" ? "M" : file.kind[0].toUpperCase();
  return `${kindShort}  +${file.added} −${file.removed}`;
}

function pickFileIcon(kind: FileChangeKind): vscode.ThemeIcon {
  switch (kind) {
    case "added":
      return new vscode.ThemeIcon("diff-added", new vscode.ThemeColor("charts.green"));
    case "deleted":
      return new vscode.ThemeIcon("diff-removed", new vscode.ThemeColor("charts.red"));
    case "renamed":
      return new vscode.ThemeIcon("diff-renamed", new vscode.ThemeColor("charts.blue"));
    case "modified":
    default:
      return new vscode.ThemeIcon("diff-modified", new vscode.ThemeColor("charts.yellow"));
  }
}

function shortSha(sha: string): string {
  return sha.length > 7 ? sha.slice(0, 7) : sha;
}

export class CheckpointsTreeDataProvider implements vscode.TreeDataProvider<CheckpointNode> {
  private readonly emitter = new vscode.EventEmitter<CheckpointNode | undefined>();
  readonly onDidChangeTreeData: vscode.Event<CheckpointNode | undefined> = this.emitter.event;

  private checkpoints: ReadonlyArray<Checkpoint> = [];
  private lastError: string | null = null;
  private readonly filesCache: Map<string, ReadonlyArray<CheckpointFileChange>> = new Map();

  constructor(private readonly service: CheckpointsService) {}

  getTreeItem(element: CheckpointNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: CheckpointNode): Promise<CheckpointNode[]> {
    if (!element) {
      return this.getRoot();
    }
    if (element.kind === "checkpoint") {
      return this.getFileChildren(element.checkpoint);
    }
    return [];
  }

  private getRoot(): CheckpointNode[] {
    if (this.lastError) {
      return [new PlaceholderTreeItem(this.lastError, "error")];
    }
    if (this.checkpoints.length === 0) {
      return [new PlaceholderTreeItem("No checkpoints yet")];
    }
    return this.checkpoints.map((cp) => new CheckpointTreeItem(cp));
  }

  private async getFileChildren(checkpoint: Checkpoint): Promise<CheckpointNode[]> {
    const cached = this.filesCache.get(checkpoint.id);
    if (cached) {
      return cached.map((file) => new CheckpointFileTreeItem(checkpoint, file));
    }
    try {
      const result = await this.service.show(checkpoint.id);
      this.filesCache.set(checkpoint.id, result.filesChanged);
      if (result.filesChanged.length === 0) {
        return [new PlaceholderTreeItem("No file changes")];
      }
      return result.filesChanged.map(
        (file) => new CheckpointFileTreeItem(checkpoint, file),
      );
    } catch (err) {
      return [new PlaceholderTreeItem(getErrorMessage(err), "error")];
    }
  }

  async refresh(): Promise<void> {
    try {
      this.checkpoints = await this.service.list();
      this.lastError = null;
    } catch (err) {
      this.checkpoints = [];
      this.lastError = getErrorMessage(err);
    }
    this.filesCache.clear();
    this.emitter.fire(undefined);
  }

  /** Local-only update: insert a checkpoint without a round-trip. */
  registerLocalCheckpoint(checkpoint: Checkpoint): void {
    const merged = [checkpoint, ...this.checkpoints.filter((c) => c.id !== checkpoint.id)];
    merged.sort((a, b) => b.createdAtMs - a.createdAtMs);
    this.checkpoints = merged;
    this.filesCache.delete(checkpoint.id);
    this.emitter.fire(undefined);
  }
}

export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return "Unknown error";
}
