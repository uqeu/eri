"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CrashTreeDataProvider = void 0;
const vscode = require("vscode");
class CrashEntryNode extends vscode.TreeItem {
    entry;
    constructor(entry) {
        super(entry.message || entry.kind, vscode.TreeItemCollapsibleState.None);
        this.entry = entry;
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
    constructor(message, icon = "info") {
        super(message, vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon(icon);
        this.contextValue = "eri.crash.placeholder";
    }
}
function buildTooltip(entry) {
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
class CrashTreeDataProvider {
    emitter = new vscode.EventEmitter();
    onDidChangeTreeData = this.emitter.event;
    entries = [];
    placeholderMessage = "Loading crashes...";
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
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
    latest() {
        return this.entries.length > 0 ? this.entries[0] : null;
    }
}
exports.CrashTreeDataProvider = CrashTreeDataProvider;
//# sourceMappingURL=view.js.map