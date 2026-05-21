import * as vscode from "vscode";

export type McpServerState = "online" | "offline" | "error";

export interface McpServerStatus {
  readonly name: string;
  readonly command: string;
  readonly transport: "stdio" | "sse" | "http";
  readonly state: McpServerState;
  readonly toolCount: number;
  readonly detail?: string;
}

export class McpServerNode extends vscode.TreeItem {
  constructor(public readonly server: McpServerStatus) {
    super(server.name, vscode.TreeItemCollapsibleState.None);
    this.description = describeRow(server);
    this.tooltip = buildTooltip(server);
    this.contextValue = `eri.mcp.server.${server.state}`;
    this.iconPath = pickIcon(server.state);
  }
}

function describeRow(server: McpServerStatus): string {
  const tools = `${server.toolCount} tool${server.toolCount === 1 ? "" : "s"}`;
  const state = server.state === "online" ? "online" : server.state;
  return `${state} · ${tools}`;
}

function buildTooltip(server: McpServerStatus): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = false;
  md.appendMarkdown(`**${server.name}** — \`${server.transport}\`\n\n`);
  md.appendMarkdown(`State: \`${server.state}\`\n\n`);
  md.appendMarkdown(`Tools: ${server.toolCount}\n\n`);
  md.appendMarkdown(`Command: \`${server.command}\`\n`);
  if (server.detail) {
    md.appendMarkdown(`\n${server.detail}`);
  }
  return md;
}

function pickIcon(state: McpServerState): vscode.ThemeIcon {
  switch (state) {
    case "online":
      // eri-accent green-yellow signals healthy
      return new vscode.ThemeIcon("circle-filled", new vscode.ThemeColor("charts.green"));
    case "error":
      return new vscode.ThemeIcon("error", new vscode.ThemeColor("charts.red"));
    case "offline":
    default:
      return new vscode.ThemeIcon("circle-outline", new vscode.ThemeColor("charts.foreground"));
  }
}

export class McpTreeDataProvider implements vscode.TreeDataProvider<McpServerNode> {
  private readonly emitter = new vscode.EventEmitter<McpServerNode | undefined>();
  readonly onDidChangeTreeData: vscode.Event<McpServerNode | undefined> = this.emitter.event;

  private servers: ReadonlyMap<string, McpServerStatus> = new Map();

  getTreeItem(element: McpServerNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: McpServerNode): vscode.ProviderResult<McpServerNode[]> {
    if (element) {
      return [];
    }
    if (this.servers.size === 0) {
      return [emptyPlaceholder()];
    }
    const nodes: McpServerNode[] = [];
    for (const server of this.servers.values()) {
      nodes.push(new McpServerNode(server));
    }
    return nodes;
  }

  setServers(servers: ReadonlyArray<McpServerStatus>): void {
    const next = new Map<string, McpServerStatus>();
    for (const server of servers) {
      next.set(server.name, server);
    }
    this.servers = next;
    this.emitter.fire(undefined);
  }

  updateServer(update: Partial<McpServerStatus> & { name: string }): void {
    const existing = this.servers.get(update.name);
    if (!existing) {
      return;
    }
    const merged: McpServerStatus = {
      ...existing,
      ...update,
    };
    const next = new Map(this.servers);
    next.set(update.name, merged);
    this.servers = next;
    this.emitter.fire(undefined);
  }
}

function emptyPlaceholder(): McpServerNode {
  const node = new McpServerNode({
    name: "No MCP servers configured",
    command: "",
    transport: "stdio",
    state: "offline",
    toolCount: 0,
    detail: "Run `eri: Open MCP Config` to add one.",
  });
  node.contextValue = "eri.mcp.empty";
  node.description = "";
  node.iconPath = new vscode.ThemeIcon("info");
  return node;
}
