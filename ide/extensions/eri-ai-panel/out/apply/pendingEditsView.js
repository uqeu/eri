"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PendingEditsTreeDataProvider = exports.PlaceholderNode = exports.BlockNode = exports.FileGroupNode = void 0;
const vscode = require("vscode");
class FileGroupNode extends vscode.TreeItem {
    relPath;
    edits;
    kind = "file";
    constructor(relPath, edits) {
        super(relPath, vscode.TreeItemCollapsibleState.Expanded);
        this.relPath = relPath;
        this.edits = edits;
        this.id = `eri.apply.file:${relPath}`;
        this.contextValue = "eri.apply.file";
        this.description = describeFileGroup(edits);
        this.iconPath = new vscode.ThemeIcon("file");
        this.tooltip = `${edits.length} pending edit${edits.length === 1 ? "" : "s"}`;
    }
}
exports.FileGroupNode = FileGroupNode;
class BlockNode extends vscode.TreeItem {
    edit;
    kind = "block";
    constructor(edit) {
        super(blockLabel(edit), vscode.TreeItemCollapsibleState.None);
        this.edit = edit;
        this.id = `eri.apply.block:${edit.id}`;
        this.contextValue = buildContextValue(edit);
        this.description = describeBlock(edit);
        this.iconPath = iconForBlock(edit);
        this.tooltip = buildBlockTooltip(edit);
        this.command = {
            command: "eri.apply.showDiff",
            title: "Show Diff",
            arguments: [edit.id],
        };
    }
}
exports.BlockNode = BlockNode;
class PlaceholderNode extends vscode.TreeItem {
    kind = "placeholder";
    constructor(label, icon = "info") {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.id = `eri.apply.placeholder:${label}`;
        this.contextValue = "eri.apply.placeholder";
        this.iconPath = new vscode.ThemeIcon(icon);
    }
}
exports.PlaceholderNode = PlaceholderNode;
function blockLabel(edit) {
    const firstSearchLine = edit.search.split("\n", 1)[0]?.trim() ?? "";
    if (firstSearchLine.length === 0) {
        return `Edit ${edit.id}`;
    }
    return firstSearchLine.length > 60 ? `${firstSearchLine.slice(0, 57)}…` : firstSearchLine;
}
function describeBlock(edit) {
    const status = edit.accepted === true ? "accepted" : edit.accepted === false ? "rejected" : "pending";
    if (!edit.preview.hasPreview) {
        return `${status} · no preview`;
    }
    return status;
}
function describeFileGroup(edits) {
    let accepted = 0;
    let rejected = 0;
    let pending = 0;
    for (const e of edits) {
        if (e.accepted === true) {
            accepted++;
        }
        else if (e.accepted === false) {
            rejected++;
        }
        else {
            pending++;
        }
    }
    const parts = [];
    if (accepted > 0) {
        parts.push(`${accepted} ok`);
    }
    if (rejected > 0) {
        parts.push(`${rejected} skip`);
    }
    if (pending > 0) {
        parts.push(`${pending} pending`);
    }
    return parts.join(" · ");
}
function iconForBlock(edit) {
    if (edit.accepted === true) {
        return new vscode.ThemeIcon("check", new vscode.ThemeColor("charts.green"));
    }
    if (edit.accepted === false) {
        return new vscode.ThemeIcon("x", new vscode.ThemeColor("charts.red"));
    }
    if (!edit.preview.hasPreview) {
        return new vscode.ThemeIcon("warning", new vscode.ThemeColor("charts.yellow"));
    }
    return new vscode.ThemeIcon("diff-modified", new vscode.ThemeColor("charts.blue"));
}
function buildContextValue(edit) {
    if (edit.accepted === true) {
        return "eri.apply.block.accepted";
    }
    if (edit.accepted === false) {
        return "eri.apply.block.rejected";
    }
    return "eri.apply.block.pending";
}
function buildBlockTooltip(edit) {
    const md = new vscode.MarkdownString(undefined, false);
    md.isTrusted = false;
    md.appendMarkdown(`**${edit.path}**\n\n`);
    if (edit.preview.reason) {
        md.appendMarkdown(`_${edit.preview.reason}_\n\n`);
    }
    md.appendCodeblock(truncate(edit.search, 600), "diff");
    return md;
}
function truncate(text, max) {
    return text.length > max ? `${text.slice(0, max)}\n…` : text;
}
class PendingEditsTreeDataProvider {
    emitter = new vscode.EventEmitter();
    onDidChangeTreeData = this.emitter.event;
    edits = [];
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        if (!element) {
            return this.getRoot();
        }
        if (element.kind === "file") {
            return element.edits.map((edit) => new BlockNode(edit));
        }
        return [];
    }
    // Replace the current set of pending edits with a new batch.
    setEdits(edits) {
        this.edits = edits.map((e) => ({ ...e }));
        this.emitter.fire(undefined);
    }
    clear() {
        this.edits = [];
        this.emitter.fire(undefined);
    }
    getEdits() {
        return this.edits;
    }
    findEdit(id) {
        return this.edits.find((e) => e.id === id);
    }
    updateAcceptance(id, accepted) {
        const idx = this.edits.findIndex((e) => e.id === id);
        if (idx === -1) {
            return;
        }
        const current = this.edits[idx];
        this.edits[idx] = { ...current, accepted };
        this.emitter.fire(undefined);
    }
    updateAll(accepted) {
        this.edits = this.edits.map((edit) => ({ ...edit, accepted }));
        this.emitter.fire(undefined);
    }
    removeEdit(id) {
        this.edits = this.edits.filter((e) => e.id !== id);
        this.emitter.fire(undefined);
    }
    getRoot() {
        if (this.edits.length === 0) {
            return [new PlaceholderNode("No pending edits")];
        }
        const groups = new Map();
        for (const edit of this.edits) {
            const bucket = groups.get(edit.path);
            if (bucket) {
                bucket.push(edit);
            }
            else {
                groups.set(edit.path, [edit]);
            }
        }
        const out = [];
        for (const [relPath, edits] of groups) {
            out.push(new FileGroupNode(relPath, edits));
        }
        return out;
    }
}
exports.PendingEditsTreeDataProvider = PendingEditsTreeDataProvider;
//# sourceMappingURL=pendingEditsView.js.map