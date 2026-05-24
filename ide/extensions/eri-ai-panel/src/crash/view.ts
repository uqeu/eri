import * as vscode from "vscode";

export interface CrashEntry {
  readonly at_ms: number;
  readonly kind: string;
  readonly message: string;
  readonly thread?: string;
  readonly location?: string;
  readonly backtrace?: string;
}

type Node = CrashEntryNode | PlaceholderNode;

class CrashEntryNode extends vscode.TreeItem {
  constructor(public readonly entry: CrashEntry) {
    super(entry.message || entry.kind, vscode.TreeItemCollapsibleState.None);
    const time = new Date(entry.at_ms).toLocaleString();
    this.description = `${time}${entry.thread ? ` · ${entry.thread}` : ""}`;
    this.tooltip = buildTooltip(entry);
    this.iconPath = new vscode.ThemeIcon("bug");
    this.contextValue = "eri.crash.entry";
    this.command = {
      command: "eri.crash.showEntry",
      title: "Show Crash Entry",
      arguments: [entry],
    };
  }
}

class PlaceholderNode extends vscode.TreeItem {
  constructor(message: string, icon: string = "info") {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(icon);
    this.contextValue = "eri.crash.placeholder";
  }
}

function buildTooltip(entry: CrashEntry): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = false;
  md.appendMarkdown(`**${entry.kind}**\n\n`);
  md.appendMarkdown(`- At: \`${new Date(entry.at_ms).toISOString()}\`\n`);
  if (entry.thread) {
    md.appendMarkdown(`- Thread: \`${entry.thread}\`\n`);
  }
  if (entry.location) {
    md.appendMarkdown(`- Location: \`${entry.location}\`\n`);
  }
  md.appendMarkdown(`- Message: \`${entry.message}\`\n`);
  return md;
}

export class CrashTreeDataProvider implements vscode.TreeDataProvider<Node> {
  private readonly emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData: vscode.Event<Node | undefined> =
    this.emitter.event;

  private entries: ReadonlyArray<CrashEntry> = [];
  private placeholderMessage: string | null = "Loading crashes...";

  getTreeItem(element: Node): vscode.TreeItem {
    return element;
  }

  getChildren(element?: Node): vscode.ProviderResult<Node[]> {
    if (element) {
      return [];
    }
    if (this.placeholderMessage && this.entries.length === 0) {
      return [new PlaceholderNode(this.placeholderMessage)];
    }
    if (this.entries.length === 0) {
      return [new PlaceholderNode("No crashes recorded.", "pass")];
    }
    return this.entries.map((entry) => new CrashEntryNode(entry));
  }

  setEntries(entries: ReadonlyArray<CrashEntry>): void {
    this.entries = entries;
    this.placeholderMessage = null;
    this.emitter.fire(undefined);
  }

  setError(message: string): void {
    this.placeholderMessage = message;
    this.entries = [];
    this.emitter.fire(undefined);
  }

  latest(): CrashEntry | null {
    return this.entries.length > 0 ? this.entries[0] : null;
  }
}
