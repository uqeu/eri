"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HooksTreeDataProvider = exports.HookNode = void 0;
const vscode = require("vscode");
class HookNode extends vscode.TreeItem {
    hook;
    constructor(hook) {
        super(hook.event, vscode.TreeItemCollapsibleState.None);
        this.hook = hook;
        this.description = preview(hook.command);
        this.tooltip = buildTooltip(hook);
        this.contextValue = "eri.hook";
        this.iconPath = new vscode.ThemeIcon(hook.background ? "sync~spin" : "zap");
    }
}
exports.HookNode = HookNode;
function preview(command) {
    const limit = 60;
    if (command.length <= limit) {
        return command;
    }
    return `${command.slice(0, limit)}…`;
}
function buildTooltip(hook) {
    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = false;
    md.appendMarkdown(`**${hook.event}**\n\n`);
    if (hook.matcher) {
        md.appendMarkdown(`Matcher: \`${hook.matcher}\`\n\n`);
    }
    md.appendCodeblock(hook.command, "shell");
    md.appendMarkdown(`\n_${hook.background ? "background" : "foreground"} • ${hook.timeoutMs}ms_`);
    return md;
}
class HooksTreeDataProvider {
    emitter = new vscode.EventEmitter();
    onDidChangeTreeData = this.emitter.event;
    hooks = [];
    placeholderMessage = "No hooks configured.";
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        if (element) {
            return [];
        }
        if (this.hooks.length === 0) {
            const placeholder = new HookNode({
                event: this.placeholderMessage ?? "No hooks found.",
                matcher: null,
                command: "Edit .eri/hooks.json to add a hook",
                background: false,
                timeoutMs: 0,
            });
            placeholder.contextValue = "eri.hook.placeholder";
            placeholder.iconPath = new vscode.ThemeIcon("info");
            return [placeholder];
        }
        return this.hooks.map((hook) => new HookNode(hook));
    }
    setHooks(hooks) {
        this.hooks = hooks;
        this.placeholderMessage = null;
        this.emitter.fire(undefined);
    }
    setError(message) {
        this.hooks = [];
        this.placeholderMessage = message;
        this.emitter.fire(undefined);
    }
}
exports.HooksTreeDataProvider = HooksTreeDataProvider;
//# sourceMappingURL=hooksView.js.map