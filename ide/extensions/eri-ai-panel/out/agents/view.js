"use strict";
// Tree view for the `eri.agents` sidebar — lists agents grouped by
// "eri" (default), "Bring your own keys", and "External CLIs", mirroring
// the QuickPick picker so the user sees the same surface everywhere.
//
// Internal proxy variants (surface === "hidden") are NEVER shown here —
// the brain layer dispatches to them under the hood when the active
// agent is the default eri router.
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentsTreeProvider = void 0;
const vscode = require("vscode");
const GROUP_LABEL = {
    default: "eri",
    byok: "Bring your own keys",
    cli: "External CLIs",
};
const GROUP_ORDER = ["default", "byok", "cli"];
function groupOf(d) {
    if (d.surface === "hidden")
        return "hidden";
    if (d.surface === "byok")
        return "byok";
    if (d.surface === "cli")
        return "cli";
    return "default";
}
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
        item.contextValue = d.available
            ? "eri.agents.agent.available"
            : "eri.agents.agent.unavailable";
        item.iconPath = new vscode.ThemeIcon(iconFor(d));
        item.command = d.available
            ? { command: "eri.agents.setActive", title: "Set active", arguments: [d.id] }
            : undefined;
        return item;
    }
    getChildren(parent) {
        if (!parent) {
            // Only render groups that actually have visible agents — keeps the
            // tree tight when (e.g.) the user hasn't set any BYOK keys yet.
            const counts = countPerGroup(this.registry.list());
            return GROUP_ORDER.filter((g) => counts[g] > 0).map((g) => ({
                kind: "group",
                id: g,
                label: GROUP_LABEL[g],
            }));
        }
        if (parent.kind !== "group") {
            return [];
        }
        const active = this.registry.active();
        return this.registry
            .list()
            .filter((d) => groupOf(d) === parent.id)
            .sort(sortByAvailabilityThenLabel)
            .map((d) => ({
            kind: "agent",
            descriptor: d,
            isActive: d.id === active.id,
        }));
    }
}
exports.AgentsTreeProvider = AgentsTreeProvider;
function countPerGroup(agents) {
    const counts = { default: 0, byok: 0, cli: 0 };
    for (const d of agents) {
        const g = groupOf(d);
        if (g === "hidden")
            continue;
        counts[g] += 1;
    }
    return counts;
}
function sortByAvailabilityThenLabel(a, b) {
    if (a.available !== b.available)
        return a.available ? -1 : 1;
    return a.label.localeCompare(b.label);
}
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
        case "auto":
            return "auto-routed";
        case "mercury":
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