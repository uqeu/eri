"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditTreeDataProvider = void 0;
const vscode = require("vscode");
class StatusNode extends vscode.TreeItem {
    status;
    constructor(status) {
        super(status.enabled ? "Audit: enabled" : "Audit: disabled", vscode.TreeItemCollapsibleState.None);
        this.status = status;
        this.description = humanSize(status.sizeBytes);
        this.tooltip = buildStatusTooltip(status);
        this.iconPath = new vscode.ThemeIcon(status.enabled ? "shield" : "shield-off");
        this.contextValue = "eri.audit.status";
    }
}
class KindGroupNode extends vscode.TreeItem {
    kind;
    entries;
    constructor(kind, entries) {
        super(kind, vscode.TreeItemCollapsibleState.Expanded);
        this.kind = kind;
        this.entries = entries;
        this.description = `${entries.length}`;
        this.iconPath = new vscode.ThemeIcon("symbol-event");
        this.contextValue = "eri.audit.group";
    }
}
class EntryNode extends vscode.TreeItem {
    entry;
    constructor(entry) {
        super(entry.method ?? entry.kind, vscode.TreeItemCollapsibleState.None);
        this.entry = entry;
        const time = new Date(entry.at_ms).toLocaleTimeString();
        const dur = typeof entry.duration_ms === "number" ? ` (${entry.duration_ms}ms)` : "";
        this.description = `${time}${dur} · ${entry.status}`;
        this.tooltip = buildEntryTooltip(entry);
        this.iconPath = new vscode.ThemeIcon(statusIcon(entry.status));
        this.contextValue = "eri.audit.entry";
        this.command = {
            command: "eri.audit.showEntry",
            title: "Show Audit Entry",
            arguments: [entry],
        };
    }
}
class PlaceholderNode extends vscode.TreeItem {
    constructor(message, icon = "info") {
        super(message, vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon(icon);
        this.contextValue = "eri.audit.placeholder";
    }
}
function statusIcon(status) {
    switch (status) {
        case "ok":
            return "pass";
        case "error":
            return "error";
        case "skipped":
            return "circle-slash";
    }
}
function humanSize(bytes) {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
function buildStatusTooltip(status) {
    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = false;
    md.appendMarkdown(`**Audit log**\n\n`);
    md.appendMarkdown(`- Enabled: \`${status.enabled}\`\n`);
    md.appendMarkdown(`- Path: \`${status.path}\`\n`);
    md.appendMarkdown(`- Size: \`${humanSize(status.sizeBytes)}\`\n`);
    md.appendMarkdown(`- Rotations: \`${status.rotations}\`\n`);
    if (status.dropped > 0) {
        md.appendMarkdown(`- Dropped: \`${status.dropped}\` (write errors)\n`);
    }
    return md;
}
function buildEntryTooltip(entry) {
    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = false;
    md.appendMarkdown(`**${entry.method ?? entry.kind}**\n\n`);
    md.appendMarkdown(`- At: \`${new Date(entry.at_ms).toISOString()}\`\n`);
    md.appendMarkdown(`- Status: \`${entry.status}\`\n`);
    if (typeof entry.duration_ms === "number") {
        md.appendMarkdown(`- Duration: \`${entry.duration_ms}ms\`\n`);
    }
    if (entry.workspace) {
        md.appendMarkdown(`- Workspace: \`${entry.workspace}\`\n`);
    }
    return md;
}
class AuditTreeDataProvider {
    emitter = new vscode.EventEmitter();
    onDidChangeTreeData = this.emitter.event;
    status = null;
    entries = [];
    placeholderMessage = "Loading audit log...";
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        if (element instanceof KindGroupNode) {
            return element.entries.map((entry) => new EntryNode(entry));
        }
        if (element) {
            return [];
        }
        const nodes = [];
        if (this.status) {
            nodes.push(new StatusNode(this.status));
        }
        if (this.placeholderMessage && this.entries.length === 0) {
            nodes.push(new PlaceholderNode(this.placeholderMessage));
            return nodes;
        }
        if (this.entries.length === 0) {
            nodes.push(new PlaceholderNode(this.status?.enabled
                ? "No events recorded yet today."
                : "Audit is disabled. Use eri.audit.enable to turn it on.", this.status?.enabled ? "info" : "shield-off"));
            return nodes;
        }
        const grouped = groupByKind(this.entries);
        for (const [kind, group] of grouped) {
            nodes.push(new KindGroupNode(kind, group));
        }
        return nodes;
    }
    setStatus(status) {
        this.status = status;
        this.placeholderMessage = null;
        this.emitter.fire(undefined);
    }
    setEntries(entries) {
        this.entries = entries;
        this.placeholderMessage = null;
        this.emitter.fire(undefined);
    }
    setError(message) {
        this.placeholderMessage = message;
        this.entries = [];
        this.emitter.fire(undefined);
    }
}
exports.AuditTreeDataProvider = AuditTreeDataProvider;
function groupByKind(entries) {
    const map = new Map();
    for (const entry of entries) {
        const existing = map.get(entry.kind);
        if (existing) {
            existing.push(entry);
        }
        else {
            map.set(entry.kind, [entry]);
        }
    }
    return Array.from(map.entries());
}
//# sourceMappingURL=view.js.map