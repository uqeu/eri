"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlaceholderItem = exports.NodeItem = exports.KindGroupItem = exports.SessionItem = exports.GraphTreeDataProvider = void 0;
const vscode = require("vscode");
class GraphTreeDataProvider {
    client;
    emitter = new vscode.EventEmitter();
    onDidChangeTreeData = this.emitter.event;
    sessions = [];
    nodesBySession = new Map();
    placeholder = "(open a workspace to see the graph)";
    constructor(client) {
        this.client = client;
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren(element) {
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
    async refresh() {
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
                this.nodesBySession.set(session.id, neighbors.map((n) => n.node));
            }
        }
        catch (err) {
            this.placeholder = `(failed to load graph: ${errorMessage(err)})`;
            this.sessions = [];
            this.nodesBySession.clear();
        }
        this.emitter.fire(undefined);
    }
    setOfflinePlaceholder(message) {
        this.placeholder = message;
        this.sessions = [];
        this.nodesBySession.clear();
        this.emitter.fire(undefined);
    }
}
exports.GraphTreeDataProvider = GraphTreeDataProvider;
class SessionItem extends vscode.TreeItem {
    session;
    kind = "session";
    constructor(session) {
        super(sessionLabel(session), vscode.TreeItemCollapsibleState.Collapsed);
        this.session = session;
        this.description = formatRelative(session.created_at_ms);
        this.tooltip = `session ${session.id} — started ${new Date(session.created_at_ms).toISOString()}`;
        this.contextValue = "eri.graph.session";
        this.iconPath = new vscode.ThemeIcon("history");
        this.id = `session:${session.id}`;
    }
}
exports.SessionItem = SessionItem;
class KindGroupItem extends vscode.TreeItem {
    kindName;
    items;
    kind = "kind-group";
    constructor(kindName, items) {
        super(`${kindName} (${items.length})`, vscode.TreeItemCollapsibleState.Collapsed);
        this.kindName = kindName;
        this.items = items;
        this.contextValue = "eri.graph.kindGroup";
        this.iconPath = new vscode.ThemeIcon(iconForKind(kindName));
        this.id = `kind:${kindName}:${items.length}`;
    }
}
exports.KindGroupItem = KindGroupItem;
class NodeItem extends vscode.TreeItem {
    node;
    kind = "node";
    constructor(node) {
        super(nodeLabel(node), vscode.TreeItemCollapsibleState.None);
        this.node = node;
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
exports.NodeItem = NodeItem;
class PlaceholderItem extends vscode.TreeItem {
    kind = "placeholder";
    constructor(label) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.contextValue = "eri.graph.placeholder";
        this.iconPath = new vscode.ThemeIcon("info");
    }
}
exports.PlaceholderItem = PlaceholderItem;
function groupByKind(nodes) {
    const out = new Map();
    for (const node of nodes) {
        const bucket = out.get(node.kind);
        if (bucket) {
            bucket.push(node);
        }
        else {
            out.set(node.kind, [node]);
        }
    }
    // Sort each bucket most-recent-first.
    const sorted = new Map();
    for (const [k, v] of out.entries()) {
        sorted.set(k, [...v].sort((a, b) => b.created_at_ms - a.created_at_ms));
    }
    return sorted;
}
function sessionLabel(session) {
    const d = new Date(session.created_at_ms);
    return `Session · ${d.toLocaleString()}`;
}
function nodeLabel(node) {
    const body = node.body;
    if (body && typeof body === "object") {
        const obj = body;
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
function nodeTooltip(node) {
    let body;
    try {
        body = JSON.stringify(node.body, null, 2);
    }
    catch {
        body = String(node.body);
    }
    return `${node.kind}\nid: ${node.id}\n${body}`;
}
function iconForKind(kind) {
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
function truncate(input, max) {
    if (input.length <= max) {
        return input;
    }
    return input.slice(0, max - 1) + "…";
}
function formatRelative(ms) {
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
function errorMessage(err) {
    if (err instanceof Error) {
        return err.message;
    }
    return String(err);
}
//# sourceMappingURL=view.js.map