"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCodemapCommands = registerCodemapCommands;
const vscode = require("vscode");
const view_1 = require("./view");
const webview_1 = require("./webview");
const KIND_CHOICES = [
    {
        id: "module",
        label: "$(symbol-namespace) Module",
        description: "Top-level directories and how they depend on each other",
    },
    {
        id: "hotspot",
        label: "$(flame) Hotspot",
        description: "Files ranked by chunk density and indexed bytes",
    },
    {
        id: "function",
        label: "$(symbol-method) Function (not yet implemented)",
        description: "Call graph rooted at a chosen function — coming soon",
    },
    {
        id: "data",
        label: "$(symbol-structure) Data (not yet implemented)",
        description: "Types and the files that define / use them — coming soon",
    },
];
function registerCodemapCommands(context, provider, getSidecar) {
    context.subscriptions.push(vscode.commands.registerCommand("eri.codemaps.refresh", () => provider.refresh()), vscode.commands.registerCommand("eri.codemaps.generate", () => runGenerate(provider, getSidecar)), vscode.commands.registerCommand("eri.codemaps.open", (nameOrItem) => runOpen(provider, getSidecar, nameOrItem)));
}
async function runGenerate(provider, getSidecar) {
    const sidecar = getSidecar();
    const workspace = (0, view_1.currentWorkspaceFsPath)();
    if (!sidecar || !workspace) {
        vscode.window.showWarningMessage("eri Codemaps — open a workspace and wait for the sidecar to start.");
        return;
    }
    const picked = await vscode.window.showQuickPick(KIND_CHOICES.map((entry) => ({
        label: entry.label,
        description: entry.description,
        id: entry.id,
    })), {
        placeHolder: "Generate codemap — pick a kind",
        matchOnDescription: true,
    });
    if (!picked) {
        return;
    }
    const params = {
        workspace,
        kind: picked.id,
    };
    if (picked.id === "function") {
        const root = await vscode.window.showInputBox({
            prompt: "Root function name",
            placeHolder: "main",
        });
        if (!root) {
            return;
        }
        params.root = root;
        params.depth = 2;
    }
    try {
        const result = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `eri · generating ${picked.id} codemap…`,
        }, () => sidecar.request("eri/codemaps/generate", params));
        await provider.refresh();
        vscode.window.showInformationMessage(`eri Codemap "${result.name}" — ${result.nodes} nodes, ${result.edges} edges`);
        await (0, webview_1.openCodemapWebview)(result.name, getSidecar);
    }
    catch (err) {
        vscode.window.showErrorMessage(`eri Codemaps — generate failed: ${errorMessage(err)}`);
    }
}
async function runOpen(provider, getSidecar, nameOrItem) {
    const name = await resolveName(provider, nameOrItem);
    if (!name) {
        return;
    }
    await (0, webview_1.openCodemapWebview)(name, getSidecar);
}
async function resolveName(provider, nameOrItem) {
    if (typeof nameOrItem === "string" && nameOrItem.trim().length > 0) {
        return nameOrItem;
    }
    if (nameOrItem &&
        typeof nameOrItem === "object" &&
        "summary" in nameOrItem &&
        nameOrItem.summary?.name) {
        const candidate = nameOrItem.summary
            .name;
        if (typeof candidate === "string") {
            return candidate;
        }
    }
    const available = provider.current();
    if (available.length === 0) {
        vscode.window.showInformationMessage("eri Codemaps — none saved yet. Run 'eri: Generate Codemap'.");
        return undefined;
    }
    const picked = await vscode.window.showQuickPick(available.map((summary) => ({
        label: summary.name,
        description: summary.kind,
    })), { placeHolder: "Open codemap" });
    return picked?.label;
}
function errorMessage(err) {
    if (err instanceof Error) {
        return err.message;
    }
    return String(err);
}
//# sourceMappingURL=commands.js.map