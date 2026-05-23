import * as vscode from "vscode";
import { PendingEdit } from "./orchestrator";

// One pending block under a file group, or the file group itself.
export type PendingEditNode = FileGroupNode | BlockNode | PlaceholderNode;

export class FileGroupNode extends vscode.TreeItem {
  readonly kind = "file" as const;

  constructor(
    public readonly relPath: string,
    public readonly edits: ReadonlyArray<PendingEdit>,
  ) {
    super(relPath, vscode.TreeItemCollapsibleState.Expanded);
    this.id = `eri.apply.file:${relPath}`;
    this.contextValue = "eri.apply.file";
    this.description = describeFileGroup(edits);
    this.iconPath = new vscode.ThemeIcon("file");
    this.tooltip = `${edits.length} pending edit${edits.length === 1 ? "" : "s"}`;
  }
}

export class BlockNode extends vscode.TreeItem {
  readonly kind = "block" as const;

  constructor(public readonly edit: PendingEdit) {
    super(blockLabel(edit), vscode.TreeItemCollapsibleState.None);
    this.id = `eri.apply.block:${edit.id}`;
    this.contextValue = buildContextValue(edit);
    this.description = describeBlock(edit);
    this.iconPath = iconForBlock(edit);
    this.tooltip = buildBlockTooltip(edit);
    this.command = {
      command: "eri.apply.showDiff",
      title: "Show Diff",
      arguments: [edit.id],
    };
  }
}

export class PlaceholderNode extends vscode.TreeItem {
  readonly kind = "placeholder" as const;

  constructor(label: string, icon: string = "info") {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.id = `eri.apply.placeholder:${label}`;
    this.contextValue = "eri.apply.placeholder";
    this.iconPath = new vscode.ThemeIcon(icon);
  }
}

function blockLabel(edit: PendingEdit): string {
  const firstSearchLine = edit.search.split("\n", 1)[0]?.trim() ?? "";
  if (firstSearchLine.length === 0) {
    return `Edit ${edit.id}`;
  }
  return firstSearchLine.length > 60 ? `${firstSearchLine.slice(0, 57)}…` : firstSearchLine;
}

function describeBlock(edit: PendingEdit): string {
  const status =
    edit.accepted === true ? "accepted" : edit.accepted === false ? "rejected" : "pending";
  if (!edit.preview.hasPreview) {
    return `${status} · no preview`;
  }
  return status;
}

function describeFileGroup(edits: ReadonlyArray<PendingEdit>): string {
  let accepted = 0;
  let rejected = 0;
  let pending = 0;
  for (const e of edits) {
    if (e.accepted === true) {
      accepted++;
    } else if (e.accepted === false) {
      rejected++;
    } else {
      pending++;
    }
  }
  const parts: string[] = [];
  if (accepted > 0) {
    parts.push(`${accepted} ok`);
  }
  if (rejected > 0) {
    parts.push(`${rejected} skip`);
  }
  if (pending > 0) {
    parts.push(`${pending} pending`);
  }
  return parts.join(" · ");
}

function iconForBlock(edit: PendingEdit): vscode.ThemeIcon {
  if (edit.accepted === true) {
    return new vscode.ThemeIcon("check", new vscode.ThemeColor("charts.green"));
  }
  if (edit.accepted === false) {
    return new vscode.ThemeIcon("x", new vscode.ThemeColor("charts.red"));
  }
  if (!edit.preview.hasPreview) {
    return new vscode.ThemeIcon("warning", new vscode.ThemeColor("charts.yellow"));
  }
  return new vscode.ThemeIcon("diff-modified", new vscode.ThemeColor("charts.blue"));
}

function buildContextValue(edit: PendingEdit): string {
  if (edit.accepted === true) {
    return "eri.apply.block.accepted";
  }
  if (edit.accepted === false) {
    return "eri.apply.block.rejected";
  }
  return "eri.apply.block.pending";
}

function buildBlockTooltip(edit: PendingEdit): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, false);
  md.isTrusted = false;
  md.appendMarkdown(`**${edit.path}**\n\n`);
  if (edit.preview.reason) {
    md.appendMarkdown(`_${edit.preview.reason}_\n\n`);
  }
  md.appendCodeblock(truncate(edit.search, 600), "diff");
  return md;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n…` : text;
}

export class PendingEditsTreeDataProvider
  implements vscode.TreeDataProvider<PendingEditNode>
{
  private readonly emitter = new vscode.EventEmitter<PendingEditNode | undefined>();
  readonly onDidChangeTreeData: vscode.Event<PendingEditNode | undefined> = this.emitter.event;

  private edits: PendingEdit[] = [];

  getTreeItem(element: PendingEditNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: PendingEditNode): PendingEditNode[] {
    if (!element) {
      return this.getRoot();
    }
    if (element.kind === "file") {
      return element.edits.map((edit) => new BlockNode(edit));
    }
    return [];
  }

  // Replace the current set of pending edits with a new batch.
  setEdits(edits: ReadonlyArray<PendingEdit>): void {
    this.edits = edits.map((e) => ({ ...e }));
    this.emitter.fire(undefined);
  }

  clear(): void {
    this.edits = [];
    this.emitter.fire(undefined);
  }

  getEdits(): ReadonlyArray<PendingEdit> {
    return this.edits;
  }

  findEdit(id: string): PendingEdit | undefined {
    return this.edits.find((e) => e.id === id);
  }

  updateAcceptance(id: string, accepted: boolean | null): void {
    const idx = this.edits.findIndex((e) => e.id === id);
    if (idx === -1) {
      return;
    }
    const current = this.edits[idx];
    this.edits[idx] = { ...current, accepted };
    this.emitter.fire(undefined);
  }

  updateAll(accepted: boolean | null): void {
    this.edits = this.edits.map((edit) => ({ ...edit, accepted }));
    this.emitter.fire(undefined);
  }

  removeEdit(id: string): void {
    this.edits = this.edits.filter((e) => e.id !== id);
    this.emitter.fire(undefined);
  }

  private getRoot(): PendingEditNode[] {
    if (this.edits.length === 0) {
      return [new PlaceholderNode("No pending edits")];
    }
    const groups = new Map<string, PendingEdit[]>();
    for (const edit of this.edits) {
      const bucket = groups.get(edit.path);
      if (bucket) {
        bucket.push(edit);
      } else {
        groups.set(edit.path, [edit]);
      }
    }
    const out: PendingEditNode[] = [];
    for (const [relPath, edits] of groups) {
      out.push(new FileGroupNode(relPath, edits));
    }
    return out;
  }
}
