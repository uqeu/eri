import * as vscode from "vscode";
import { GraphClient, GraphNode } from "./api";

// Tree shape:
//   root -> Session(most-recent-first)
//             -> KindGroup ("prompt (3)", "intent (2)", ...)
//                  -> NodeItem

type Node =
  | SessionItem
  | KindGroupItem
  | NodeItem
  | PlaceholderItem;

export class GraphTreeDataProvider implements vscode.TreeDataProvider<Node> {
  private readonly emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  private sessions: ReadonlyArray<GraphNode> = [];
  private nodesBySession: Map<string, ReadonlyArray<GraphNode>> = new Map();
  private placeholder: string | null = "(open a workspace to see the graph)";

  constructor(private readonly client: GraphClient) {}

  getTreeItem(element: Node): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: Node): Promise<Node[]> {
    if (!element) {
      if (this.placeholder) {
        return [new PlaceholderItem(this.placeholder)];
      }
      if (this.sessions.length === 0) {
        return [new PlaceholderItem("(no graph activity yet)")];
      }
      return this.sessions.map((s) => new SessionItem(s));
    }
    if (element instanceof SessionItem) {
      const nodes = this.nodesBySession.get(element.session.id) ?? [];
      const byKind = groupByKind(nodes);
      return Array.from(byKind.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([kind, items]) => new KindGroupItem(kind, items));
    }
    if (element instanceof KindGroupItem) {
      return element.items.map((node) => new NodeItem(node));
    }
    return [];
  }

  async refresh(): Promise<void> {
    try {
      this.placeholder = null;
      const sessions = await this.client.queryByKind("session", 25);
      this.sessions = sessions;
      this.nodesBySession.clear();
      for (const session of sessions) {
        const neighbors = await this.client.neighbors(session.id, {
          edgeKind: "belongs_to_session",
          direction: "in",
        });
        this.nodesBySession.set(
          session.id,
          neighbors.map((n) => n.node),
        );
      }
    } catch (err) {
      this.placeholder = `(failed to load graph: ${errorMessage(err)})`;
      this.sessions = [];
      this.nodesBySession.clear();
    }
    this.emitter.fire(undefined);
  }

  setOfflinePlaceholder(message: string): void {
    this.placeholder = message;
    this.sessions = [];
    this.nodesBySession.clear();
    this.emitter.fire(undefined);
  }
}

export class SessionItem extends vscode.TreeItem {
  readonly kind = "session" as const;
  constructor(public readonly session: GraphNode) {
    super(sessionLabel(session), vscode.TreeItemCollapsibleState.Collapsed);
    this.description = formatRelative(session.created_at_ms);
    this.tooltip = `session ${session.id} — started ${new Date(
      session.created_at_ms,
    ).toISOString()}`;
    this.contextValue = "eri.graph.session";
    this.iconPath = new vscode.ThemeIcon("history");
    this.id = `session:${session.id}`;
  }
}

export class KindGroupItem extends vscode.TreeItem {
  readonly kind = "kind-group" as const;
  constructor(
    public readonly kindName: string,
    public readonly items: ReadonlyArray<GraphNode>,
  ) {
    super(
      `${kindName} (${items.length})`,
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    this.contextValue = "eri.graph.kindGroup";
    this.iconPath = new vscode.ThemeIcon(iconForKind(kindName));
    this.id = `kind:${kindName}:${items.length}`;
  }
}

export class NodeItem extends vscode.TreeItem {
  readonly kind = "node" as const;
  constructor(public readonly node: GraphNode) {
    super(nodeLabel(node), vscode.TreeItemCollapsibleState.None);
    this.description = formatRelative(node.created_at_ms);
    this.tooltip = nodeTooltip(node);
    this.contextValue = "eri.graph.node";
    this.iconPath = new vscode.ThemeIcon(iconForKind(node.kind));
    this.id = `node:${node.id}`;
    this.command = {
      command: "eri.graph.openNode",
      title: "Open graph node",
      arguments: [node.id],
    };
  }
}

export class PlaceholderItem extends vscode.TreeItem {
  readonly kind = "placeholder" as const;
  constructor(label: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "eri.graph.placeholder";
    this.iconPath = new vscode.ThemeIcon("info");
  }
}

function groupByKind(
  nodes: ReadonlyArray<GraphNode>,
): Map<string, ReadonlyArray<GraphNode>> {
  const out = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const bucket = out.get(node.kind);
    if (bucket) {
      bucket.push(node);
    } else {
      out.set(node.kind, [node]);
    }
  }
  // Sort each bucket most-recent-first.
  const sorted = new Map<string, ReadonlyArray<GraphNode>>();
  for (const [k, v] of out.entries()) {
    sorted.set(
      k,
      [...v].sort((a, b) => b.created_at_ms - a.created_at_ms),
    );
  }
  return sorted;
}

function sessionLabel(session: GraphNode): string {
  const d = new Date(session.created_at_ms);
  return `Session · ${d.toLocaleString()}`;
}

function nodeLabel(node: GraphNode): string {
  const body = node.body;
  if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    const candidates = ["text", "label", "summary", "message", "name", "path", "sha"];
    for (const key of candidates) {
      const value = obj[key];
      if (typeof value === "string" && value.length > 0) {
        return truncate(value, 60);
      }
    }
  }
  return node.kind;
}

function nodeTooltip(node: GraphNode): string {
  let body: string;
  try {
    body = JSON.stringify(node.body, null, 2);
  } catch {
    body = String(node.body);
  }
  return `${node.kind}\nid: ${node.id}\n${body}`;
}

function iconForKind(kind: string): string {
  switch (kind) {
    case "prompt":
      return "comment";
    case "voice_transcript":
      return "mic";
    case "intent":
      return "lightbulb";
    case "model_call":
      return "sync";
    case "model_response":
      return "comment-discussion";
    case "edit_proposed":
      return "edit";
    case "edit_applied":
      return "check";
    case "edit_rejected":
      return "close";
    case "file_touched":
      return "file";
    case "symbol":
      return "symbol-function";
    case "checkpoint":
      return "milestone";
    case "error":
      return "error";
    case "note":
      return "note";
    case "session":
      return "history";
    default:
      return "circle-outline";
  }
}

function truncate(input: string, max: number): string {
  if (input.length <= max) {
    return input;
  }
  return input.slice(0, max - 1) + "…";
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

export type { Node as GraphTreeNode };
