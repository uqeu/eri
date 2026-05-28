"use strict";
// Tree data provider + drag-and-drop controller for the eri.terminals view.
// Mirrors the live VS Code terminal list — never owns or persists terminal
// instances themselves.
Object.defineProperty(exports, "__esModule", { value: true });
exports.TerminalsTreeProvider = exports.PlaceholderNode = exports.LayoutNode = exports.LayoutsRootNode = exports.TerminalNode = exports.GroupNode = void 0;
const vscode = require("vscode");
const state_1 = require("./state");
const cliDetect_1 = require("./cliDetect");
class GroupNode extends vscode.TreeItem {
    group;
    kind = "group";
    constructor(group, terminalCount) {
        super(group.name, group.expanded
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed);
        this.group = group;
        this.id = `group:${group.id}`;
        this.contextValue = group.auto ? "eri.terminal.group.auto" : "eri.terminal.group";
        this.description = `${terminalCount}`;
        this.iconPath = new vscode.ThemeIcon(group.icon ?? "folder");
        this.tooltip = group.cwd ? `${group.name} — ${group.cwd}` : group.name;
    }
}
exports.GroupNode = GroupNode;
class TerminalNode extends vscode.TreeItem {
    record;
    terminal;
    kind = "terminal";
    constructor(record, terminal, status, lastCommand, cliKind = null) {
        super(record.name, vscode.TreeItemCollapsibleState.None);
        this.record = record;
        this.terminal = terminal;
        this.id = `terminal:${record.key}`;
        this.contextValue = record.nameLocked
            ? "eri.terminal.locked"
            : "eri.terminal";
        this.iconPath = cliKind
            ? new vscode.ThemeIcon((0, cliDetect_1.cliGlyph)(cliKind), new vscode.ThemeColor("charts.purple"))
            : iconForStatus(status, record.icon);
        this.description = describe(status, lastCommand, cliKind);
        this.tooltip = buildTooltip(record, status, lastCommand, cliKind);
        if (terminal) {
            this.command = {
                command: "eri.terminals.reveal",
                title: "Show terminal",
                arguments: [record.key],
            };
        }
    }
}
exports.TerminalNode = TerminalNode;
class LayoutsRootNode extends vscode.TreeItem {
    kind = "layoutsRoot";
    constructor(count) {
        super("Layouts", vscode.TreeItemCollapsibleState.Collapsed);
        this.id = "layouts-root";
        this.contextValue = "eri.terminal.layouts.root";
        this.description = `${count}`;
        this.iconPath = new vscode.ThemeIcon("layers");
    }
}
exports.LayoutsRootNode = LayoutsRootNode;
class LayoutNode extends vscode.TreeItem {
    layout;
    kind = "layout";
    constructor(layout) {
        super(layout.name, vscode.TreeItemCollapsibleState.None);
        this.layout = layout;
        this.id = `layout:${layout.filePath}`;
        this.contextValue = "eri.terminal.layout";
        this.iconPath = new vscode.ThemeIcon("save");
        this.tooltip = layout.filePath;
        this.command = {
            command: "eri.terminals.restoreLayout",
            title: "Restore layout",
            arguments: [layout.filePath],
        };
    }
}
exports.LayoutNode = LayoutNode;
class PlaceholderNode extends vscode.TreeItem {
    kind = "placeholder";
    constructor(label) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.contextValue = "eri.terminal.placeholder";
        this.iconPath = new vscode.ThemeIcon("info");
    }
}
exports.PlaceholderNode = PlaceholderNode;
function iconForStatus(status, customIcon) {
    if (customIcon) {
        return new vscode.ThemeIcon(customIcon);
    }
    switch (status) {
        case "running":
            return new vscode.ThemeIcon("loading~spin", new vscode.ThemeColor("charts.green"));
        case "idle":
            return new vscode.ThemeIcon("terminal");
        case "exited-ok":
            return new vscode.ThemeIcon("check", new vscode.ThemeColor("charts.green"));
        case "exited-fail":
            return new vscode.ThemeIcon("error", new vscode.ThemeColor("charts.red"));
    }
}
function describe(status, lastCommand, cliKind) {
    const badge = (() => {
        switch (status) {
            case "running":
                return "● running";
            case "idle":
                return "○ idle";
            case "exited-ok":
                return "✓ exit 0";
            case "exited-fail":
                return "✗ failed";
        }
    })();
    const cliBadge = cliKind ? `🤖 ${(0, cliDetect_1.cliLabel)(cliKind)} · ` : "";
    if (lastCommand && lastCommand.length > 0) {
        return `${cliBadge}${badge} · ${lastCommand}`;
    }
    return `${cliBadge}${badge}`;
}
function buildTooltip(record, status, lastCommand, cliKind) {
    const parts = [
        `Name: ${record.name}${record.nameLocked ? " (locked)" : ""}`,
        `Status: ${status}`,
    ];
    if (cliKind) {
        parts.push(`Running: ${(0, cliDetect_1.cliLabel)(cliKind)}`);
    }
    if (record.cwd) {
        parts.push(`Cwd: ${record.cwd}`);
    }
    if (lastCommand) {
        parts.push(`Last: ${lastCommand}`);
    }
    return parts.join("\n");
}
// Provider ----------------------------------------------------------------
const MIME_TERMINAL = "application/vnd.eri.terminal";
class TerminalsTreeProvider {
    store;
    runtime;
    blocks;
    dropMimeTypes = [MIME_TERMINAL];
    dragMimeTypes = [MIME_TERMINAL];
    emitter = new vscode.EventEmitter();
    onDidChangeTreeData = this.emitter.event;
    layouts = [];
    constructor(store, runtime, blocks) {
        this.store = store;
        this.runtime = runtime;
        this.blocks = blocks;
        this.store.onDidChange(() => this.refresh());
        this.blocks.onDidChange(() => this.refresh());
    }
    setLayouts(layouts) {
        this.layouts = layouts;
        this.refresh();
    }
    refresh() {
        this.emitter.fire(undefined);
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren(element) {
        const snapshot = this.store.current();
        if (!element) {
            return this.rootNodes(snapshot);
        }
        if (element.kind === "group") {
            return this.terminalsInGroup(snapshot, element.group.id);
        }
        if (element.kind === "layoutsRoot") {
            return this.layouts.map((layout) => new LayoutNode(layout));
        }
        return [];
    }
    rootNodes(snapshot) {
        if (snapshot.groups.length === 0 && this.layouts.length === 0) {
            return [
                new PlaceholderNode("(no terminals yet — open one to start auto-grouping)"),
            ];
        }
        const nodes = [];
        for (const group of snapshot.groups) {
            const members = snapshot.terminals.filter((t) => t.groupId === group.id);
            nodes.push(new GroupNode(group, members.length));
        }
        nodes.push(new LayoutsRootNode(this.layouts.length));
        return nodes;
    }
    terminalsInGroup(snapshot, groupId) {
        const members = snapshot.terminals.filter((t) => t.groupId === groupId);
        if (members.length === 0) {
            return [new PlaceholderNode("(empty group)")];
        }
        return members.map((record) => {
            const status = this.runtime.status(record.key);
            const lastCommand = this.runtime.lastCommand(record.key);
            const cliKind = this.runtime.cliKind?.(record.key) ?? null;
            const terminal = this.runtime.resolveTerminal(record.key);
            return new TerminalNode(record, terminal, status, lastCommand, cliKind);
        });
    }
    // Drag-and-drop --------------------------------------------------------
    handleDrag(source, dataTransfer) {
        const keys = source
            .filter((node) => node.kind === "terminal")
            .map((node) => node.record.key);
        if (keys.length === 0) {
            return;
        }
        dataTransfer.set(MIME_TERMINAL, new vscode.DataTransferItem(JSON.stringify(keys)));
    }
    async handleDrop(target, dataTransfer) {
        const item = dataTransfer.get(MIME_TERMINAL);
        if (!item) {
            return;
        }
        const raw = await item.asString();
        let keys;
        try {
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) {
                return;
            }
            keys = parsed.filter((k) => typeof k === "string");
        }
        catch {
            return;
        }
        if (keys.length === 0) {
            return;
        }
        const snapshot = this.store.current();
        const groupId = this.resolveDropTargetGroup(snapshot, target);
        if (!groupId) {
            return;
        }
        let next = snapshot;
        for (const key of keys) {
            next = (0, state_1.moveTerminal)(next, key, groupId);
        }
        await this.store.apply(next);
    }
    resolveDropTargetGroup(snapshot, target) {
        if (!target) {
            return snapshot.groups[0]?.id;
        }
        if (target.kind === "group") {
            return target.group.id;
        }
        if (target.kind === "terminal") {
            return target.record.groupId;
        }
        return undefined;
    }
    // Persistence shim used by collapse/expand events.
    async setGroupExpanded(groupId, expanded) {
        const snapshot = this.store.current();
        const group = snapshot.groups.find((g) => g.id === groupId);
        if (!group || group.expanded === expanded) {
            return;
        }
        await this.store.apply((0, state_1.updateGroup)(snapshot, groupId, { expanded }));
    }
}
exports.TerminalsTreeProvider = TerminalsTreeProvider;
//# sourceMappingURL=treeProvider.js.map