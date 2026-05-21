"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.McpTreeDataProvider = exports.McpServerNode = void 0;
const vscode = require("vscode");
class McpServerNode extends vscode.TreeItem {
    server;
    constructor(server) {
        super(server.name, vscode.TreeItemCollapsibleState.None);
        this.server = server;
        this.description = describeRow(server);
        this.tooltip = buildTooltip(server);
        this.contextValue = `eri.mcp.server.${server.state}`;
        this.iconPath = pickIcon(server.state);
    }
}
exports.McpServerNode = McpServerNode;
function describeRow(server) {
    const tools = `${server.toolCount} tool${server.toolCount === 1 ? "" : "s"}`;
    const state = server.state === "online" ? "online" : server.state;
    return `${state} · ${tools}`;
}
function buildTooltip(server) {
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
function pickIcon(state) {
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
class McpTreeDataProvider {
    emitter = new vscode.EventEmitter();
    onDidChangeTreeData = this.emitter.event;
    servers = new Map();
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        if (element) {
            return [];
        }
        if (this.servers.size === 0) {
            return [emptyPlaceholder()];
        }
        const nodes = [];
        for (const server of this.servers.values()) {
            nodes.push(new McpServerNode(server));
        }
        return nodes;
    }
    setServers(servers) {
        const next = new Map();
        for (const server of servers) {
            next.set(server.name, server);
        }
        this.servers = next;
        this.emitter.fire(undefined);
    }
    updateServer(update) {
        const existing = this.servers.get(update.name);
        if (!existing) {
            return;
        }
        const merged = {
            ...existing,
            ...update,
        };
        const next = new Map(this.servers);
        next.set(update.name, merged);
        this.servers = next;
        this.emitter.fire(undefined);
    }
}
exports.McpTreeDataProvider = McpTreeDataProvider;
function emptyPlaceholder() {
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
//# sourceMappingURL=mcpView.js.map