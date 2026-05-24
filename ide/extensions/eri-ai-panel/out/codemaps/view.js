"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CodemapsTreeDataProvider = exports.PlaceholderItem = exports.CodemapTreeItem = void 0;
exports.currentWorkspaceFsPath = currentWorkspaceFsPath;
const vscode = require("vscode");
// Tree item representing a single saved codemap.
class CodemapTreeItem extends vscode.TreeItem {
    summary;
    kind = "codemap";
    constructor(summary) {
        super(summary.name, vscode.TreeItemCollapsibleState.None);
        this.summary = summary;
        this.description = `${summary.kind} · ${formatRelative(summary.generatedAtMs)}`;
        this.tooltip = `${summary.name} (${summary.kind}) — generated ${new Date(summary.generatedAtMs).toISOString()}`;
        this.contextValue = "eri.codemap";
        this.iconPath = new vscode.ThemeIcon("graph");
        this.id = `codemap:${summary.name}`;
        this.command = {
            command: "eri.codemaps.open",
            title: "Open codemap",
            arguments: [summary.name],
        };
    }
}
exports.CodemapTreeItem = CodemapTreeItem;
class PlaceholderItem extends vscode.TreeItem {
    kind = "placeholder";
    constructor(label) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.contextValue = "eri.codemaps.placeholder";
        this.iconPath = new vscode.ThemeIcon("info");
    }
}
exports.PlaceholderItem = PlaceholderItem;
class CodemapsTreeDataProvider {
    getSidecar;
    emitter = new vscode.EventEmitter();
    onDidChangeTreeData = this.emitter.event;
    items = [
        new PlaceholderItem("(no codemaps generated yet)"),
    ];
    constructor(getSidecar) {
        this.getSidecar = getSidecar;
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren(element) {
        if (element) {
            return [];
        }
        return [...this.items];
    }
    async refresh() {
        const sidecar = this.getSidecar();
        const workspace = currentWorkspaceFsPath();
        if (!sidecar || !workspace) {
            this.items = [new PlaceholderItem("(open a workspace to see codemaps)")];
            this.emitter.fire(undefined);
            return;
        }
        try {
            const result = await sidecar.request("eri/codemaps/list", {
                workspace,
            });
            const list = Array.isArray(result?.codemaps) ? result.codemaps : [];
            if (list.length === 0) {
                this.items = [new PlaceholderItem("(no codemaps generated yet)")];
            }
            else {
                this.items = list.map((summary) => new CodemapTreeItem(summary));
            }
        }
        catch (err) {
            this.items = [
                new PlaceholderItem(`(failed to load codemaps: ${errorMessage(err)})`),
            ];
        }
        this.emitter.fire(undefined);
    }
    current() {
        const out = [];
        for (const item of this.items) {
            if (item.kind === "codemap") {
                out.push(item.summary);
            }
        }
        return out;
    }
}
exports.CodemapsTreeDataProvider = CodemapsTreeDataProvider;
function currentWorkspaceFsPath() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        return undefined;
    }
    return folders[0].uri.fsPath;
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