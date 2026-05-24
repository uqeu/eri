import * as vscode from "vscode";
import { Sidecar } from "../sidecar";

export interface CodemapSummary {
  readonly name: string;
  readonly kind: string;
  readonly generatedAtMs: number;
}

interface ListResponse {
  readonly codemaps?: ReadonlyArray<CodemapSummary>;
}

// Tree item representing a single saved codemap.
export class CodemapTreeItem extends vscode.TreeItem {
  readonly kind = "codemap" as const;

  constructor(public readonly summary: CodemapSummary) {
    super(summary.name, vscode.TreeItemCollapsibleState.None);
    this.description = `${summary.kind} · ${formatRelative(summary.generatedAtMs)}`;
    this.tooltip = `${summary.name} (${summary.kind}) — generated ${new Date(
      summary.generatedAtMs,
    ).toISOString()}`;
    this.contextValue = "eri.codemap";
    this.iconPath = new vscode.ThemeIcon("graph");
    this.id = `codemap:${summary.name}`;
    this.command = {
      command: "eri.codemaps.open",
      title: "Open codemap",
      arguments: [summary.name],
    };
  }
}

export class PlaceholderItem extends vscode.TreeItem {
  readonly kind = "placeholder" as const;

  constructor(label: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "eri.codemaps.placeholder";
    this.iconPath = new vscode.ThemeIcon("info");
  }
}

type CodemapNode = CodemapTreeItem | PlaceholderItem;

export class CodemapsTreeDataProvider
  implements vscode.TreeDataProvider<CodemapNode>
{
  private readonly emitter = new vscode.EventEmitter<CodemapNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  private items: ReadonlyArray<CodemapNode> = [
    new PlaceholderItem("(no codemaps generated yet)"),
  ];

  constructor(private readonly getSidecar: () => Sidecar | null) {}

  getTreeItem(element: CodemapNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: CodemapNode): Promise<CodemapNode[]> {
    if (element) {
      return [];
    }
    return [...this.items];
  }

  async refresh(): Promise<void> {
    const sidecar = this.getSidecar();
    const workspace = currentWorkspaceFsPath();
    if (!sidecar || !workspace) {
      this.items = [new PlaceholderItem("(open a workspace to see codemaps)")];
      this.emitter.fire(undefined);
      return;
    }
    try {
      const result = await sidecar.request<ListResponse>("eri/codemaps/list", {
        workspace,
      });
      const list = Array.isArray(result?.codemaps) ? result!.codemaps! : [];
      if (list.length === 0) {
        this.items = [new PlaceholderItem("(no codemaps generated yet)")];
      } else {
        this.items = list.map((summary) => new CodemapTreeItem(summary));
      }
    } catch (err) {
      this.items = [
        new PlaceholderItem(`(failed to load codemaps: ${errorMessage(err)})`),
      ];
    }
    this.emitter.fire(undefined);
  }

  current(): ReadonlyArray<CodemapSummary> {
    const out: CodemapSummary[] = [];
    for (const item of this.items) {
      if (item.kind === "codemap") {
        out.push(item.summary);
      }
    }
    return out;
  }
}

export function currentWorkspaceFsPath(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return undefined;
  }
  return folders[0].uri.fsPath;
}

function formatRelative(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "unknown";
  }
  const diff = Date.now() - ms;
  if (diff < 60_000) {
    return "just now";
  }
  if (diff < 3_600_000) {
    return `${Math.floor(diff / 60_000)}m ago`;
  }
  if (diff < 86_400_000) {
    return `${Math.floor(diff / 3_600_000)}h ago`;
  }
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

export type { CodemapNode };
