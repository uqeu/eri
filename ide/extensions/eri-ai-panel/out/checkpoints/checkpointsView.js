"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CheckpointsTreeDataProvider = exports.PlaceholderTreeItem = exports.CheckpointFileTreeItem = exports.CheckpointTreeItem = void 0;
exports.getErrorMessage = getErrorMessage;
const vscode = require("vscode");
const relativeTime_1 = require("./relativeTime");
class CheckpointTreeItem extends vscode.TreeItem {
    checkpoint;
    kind = "checkpoint";
    constructor(checkpoint) {
        super(checkpoint.label.trim().length > 0 ? checkpoint.label : "Untitled checkpoint", vscode.TreeItemCollapsibleState.Collapsed);
        this.checkpoint = checkpoint;
        this.description = (0, relativeTime_1.formatRelativeTime)(checkpoint.createdAtMs);
        this.tooltip = buildCheckpointTooltip(checkpoint);
        this.contextValue = "eri.checkpoint";
        this.iconPath = new vscode.ThemeIcon("history");
        this.id = `checkpoint:${checkpoint.id}`;
    }
}
exports.CheckpointTreeItem = CheckpointTreeItem;
class CheckpointFileTreeItem extends vscode.TreeItem {
    checkpoint;
    file;
    kind = "file";
    constructor(checkpoint, file) {
        super(file.path, vscode.TreeItemCollapsibleState.None);
        this.checkpoint = checkpoint;
        this.file = file;
        this.description = describeFileChange(file);
        this.tooltip = buildFileTooltip(checkpoint, file);
        this.contextValue = "eri.checkpoint.file";
        this.iconPath = pickFileIcon(file.kind);
        this.id = `checkpoint:${checkpoint.id}:${file.path}`;
    }
}
exports.CheckpointFileTreeItem = CheckpointFileTreeItem;
class PlaceholderTreeItem extends vscode.TreeItem {
    kind = "placeholder";
    constructor(label, icon = "info") {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.contextValue = "eri.checkpoint.placeholder";
        this.iconPath = new vscode.ThemeIcon(icon);
    }
}
exports.PlaceholderTreeItem = PlaceholderTreeItem;
function buildCheckpointTooltip(checkpoint) {
    const md = new vscode.MarkdownString(undefined, false);
    md.isTrusted = false;
    const label = checkpoint.label.trim().length > 0 ? checkpoint.label : "Untitled checkpoint";
    md.appendMarkdown(`**${label}**\n\n`);
    md.appendMarkdown(`Created: ${(0, relativeTime_1.formatFullTimestamp)(checkpoint.createdAtMs)}\n\n`);
    md.appendMarkdown(`SHA: \`${shortSha(checkpoint.sha)}\``);
    return md;
}
function buildFileTooltip(checkpoint, file) {
    const md = new vscode.MarkdownString(undefined, false);
    md.isTrusted = false;
    md.appendMarkdown(`**${file.path}**\n\n`);
    md.appendMarkdown(`Change: ${file.kind}\n\n`);
    md.appendMarkdown(`+${file.added} / -${file.removed}\n\n`);
    md.appendMarkdown(`Checkpoint: \`${shortSha(checkpoint.sha)}\``);
    return md;
}
function describeFileChange(file) {
    const kindShort = file.kind === "modified" ? "M" : file.kind[0].toUpperCase();
    return `${kindShort}  +${file.added} −${file.removed}`;
}
function pickFileIcon(kind) {
    switch (kind) {
        case "added":
            return new vscode.ThemeIcon("diff-added", new vscode.ThemeColor("charts.green"));
        case "deleted":
            return new vscode.ThemeIcon("diff-removed", new vscode.ThemeColor("charts.red"));
        case "renamed":
            return new vscode.ThemeIcon("diff-renamed", new vscode.ThemeColor("charts.blue"));
        case "modified":
        default:
            return new vscode.ThemeIcon("diff-modified", new vscode.ThemeColor("charts.yellow"));
    }
}
function shortSha(sha) {
    return sha.length > 7 ? sha.slice(0, 7) : sha;
}
class CheckpointsTreeDataProvider {
    service;
    emitter = new vscode.EventEmitter();
    onDidChangeTreeData = this.emitter.event;
    checkpoints = [];
    lastError = null;
    filesCache = new Map();
    constructor(service) {
        this.service = service;
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren(element) {
        if (!element) {
            return this.getRoot();
        }
        if (element.kind === "checkpoint") {
            return this.getFileChildren(element.checkpoint);
        }
        return [];
    }
    getRoot() {
        if (this.lastError) {
            return [new PlaceholderTreeItem(this.lastError, "error")];
        }
        if (this.checkpoints.length === 0) {
            return [new PlaceholderTreeItem("No checkpoints yet")];
        }
        return this.checkpoints.map((cp) => new CheckpointTreeItem(cp));
    }
    async getFileChildren(checkpoint) {
        const cached = this.filesCache.get(checkpoint.id);
        if (cached) {
            return cached.map((file) => new CheckpointFileTreeItem(checkpoint, file));
        }
        try {
            const result = await this.service.show(checkpoint.id);
            this.filesCache.set(checkpoint.id, result.filesChanged);
            if (result.filesChanged.length === 0) {
                return [new PlaceholderTreeItem("No file changes")];
            }
            return result.filesChanged.map((file) => new CheckpointFileTreeItem(checkpoint, file));
        }
        catch (err) {
            return [new PlaceholderTreeItem(getErrorMessage(err), "error")];
        }
    }
    async refresh() {
        try {
            this.checkpoints = await this.service.list();
            this.lastError = null;
        }
        catch (err) {
            this.checkpoints = [];
            this.lastError = getErrorMessage(err);
        }
        this.filesCache.clear();
        this.emitter.fire(undefined);
    }
    /** Local-only update: insert a checkpoint without a round-trip. */
    registerLocalCheckpoint(checkpoint) {
        const merged = [checkpoint, ...this.checkpoints.filter((c) => c.id !== checkpoint.id)];
        merged.sort((a, b) => b.createdAtMs - a.createdAtMs);
        this.checkpoints = merged;
        this.filesCache.delete(checkpoint.id);
        this.emitter.fire(undefined);
    }
}
exports.CheckpointsTreeDataProvider = CheckpointsTreeDataProvider;
function getErrorMessage(err) {
    if (err instanceof Error) {
        return err.message;
    }
    return "Unknown error";
}
//# sourceMappingURL=checkpointsView.js.map