"use strict";
// Tree view for the `eri.agents` sidebar — lists agents grouped by
// Available / Unavailable, with context-menu actions.
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentsTreeProvider = void 0;
const vscode = require("vscode");
class AgentsTreeProvider {
    registry;
    emitter = new vscode.EventEmitter();
    onDidChangeTreeData = this.emitter.event;
    constructor(registry) {
        this.registry = registry;
        registry.onChange(() => this.emitter.fire());
    }
    refresh() {
        this.emitter.fire();
    }
    getTreeItem(node) {
        if (node.kind === "group") {
            const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
            item.contextValue = `eri.agents.group.${node.id}`;
            return item;
        }
        const d = node.descriptor;
        const item = new vscode.TreeItem(d.label, vscode.TreeItemCollapsibleState.None);
        item.description = describe(d) + (node.isActive ? " · active" : "");
        item.tooltip = d.description;
        item.contextValue = d.available ? "eri.agents.agent.available" : "eri.agents.agent.unavailable";
        item.iconPath = new vscode.ThemeIcon(iconFor(d));
        item.command = d.available
            ? { command: "eri.agents.setActive", title: "Set active", arguments: [d.id] }
            : undefined;
        return item;
    }
    getChildren(parent) {
        if (!parent) {
            return [
                { kind: "group", id: "available", label: "Available" },
                { kind: "group", id: "unavailable", label: "Unavailable" },
            ];
        }
        if (parent.kind !== "group") {
            return [];
        }
        const active = this.registry.active();
        return this.registry
            .list()
            .filter((d) => (parent.id === "available" ? d.available : !d.available))
            .sort((a, b) => a.label.localeCompare(b.label))
            .map((d) => ({
            kind: "agent",
            descriptor: d,
            isActive: d.id === active.id,
        }));
    }
}
exports.AgentsTreeProvider = AgentsTreeProvider;
function iconFor(d) {
    if (d.kind === "cli")
        return "terminal";
    if (d.kind === "byok")
        return "key";
    if (d.kind === "auto")
        return "rocket";
    return "zap";
}
function describe(d) {
    if (!d.available)
        return "unavailable";
    switch (d.kind) {
        case "mercury":
        case "auto":
            return "free";
        case "proxy":
            return "metered";
        case "byok":
            return "your key";
        case "cli":
            return "local";
        default:
            return "";
    }
}
//# sourceMappingURL=view.js.map