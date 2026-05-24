"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activateHooks = activateHooks;
const vscode = require("vscode");
const path = require("path");
const hooksView_1 = require("./hooksView");
function activateHooks(context, getSidecar) {
    const provider = new hooksView_1.HooksTreeDataProvider();
    const view = vscode.window.createTreeView("eri.hooks", {
        treeDataProvider: provider,
        showCollapseAll: false,
    });
    const refresh = async () => {
        const sidecar = getSidecar();
        if (!sidecar) {
            provider.setError("Sidecar not running.");
            return;
        }
        const workspace = resolveWorkspace();
        if (!workspace) {
            provider.setError("Open a workspace folder to load hooks.");
            return;
        }
        try {
            const result = await sidecar.request("eri/hooks/list", {
                workspace,
            });
            const parsed = parseHooks(result?.hooks);
            provider.setHooks(parsed);
        }
        catch (err) {
            provider.setError(`Failed to load hooks: ${getErrorMessage(err)}`);
        }
    };
    const openConfig = async () => {
        const workspace = resolveWorkspace();
        if (!workspace) {
            void vscode.window.showWarningMessage("Open a workspace folder to edit hooks.");
            return;
        }
        const configPath = path.join(workspace, ".eri", "hooks.json");
        const uri = vscode.Uri.file(configPath);
        try {
            await vscode.workspace.fs.stat(uri);
        }
        catch {
            // Create the directory and file with a stub the user can edit.
            const dir = vscode.Uri.file(path.join(workspace, ".eri"));
            try {
                await vscode.workspace.fs.createDirectory(dir);
            }
            catch {
                // ignore — file open will surface a clearer error
            }
            const stub = new TextEncoder().encode(STUB_HOOKS_JSON);
            await vscode.workspace.fs.writeFile(uri, stub);
        }
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: false });
    };
    // Initial fetch — fire and forget; errors surface as a placeholder row.
    void refresh();
    context.subscriptions.push(view, vscode.commands.registerCommand("eri.hooks.refresh", refresh), vscode.commands.registerCommand("eri.hooks.openConfig", openConfig));
    return {
        view,
        refresh,
        dispose: () => {
            view.dispose();
        },
    };
}
const STUB_HOOKS_JSON = `{
  "SessionStart": [],
  "SessionEnd": [],
  "UserPromptSubmit": [],
  "PreToolUse": [],
  "PostToolUse": [],
  "PostToolError": []
}
`;
function resolveWorkspace() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        return null;
    }
    return folders[0].uri.fsPath;
}
function parseHooks(raw) {
    if (!Array.isArray(raw)) {
        return [];
    }
    const out = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== "object") {
            continue;
        }
        const obj = entry;
        const event = typeof obj.event === "string" ? obj.event : null;
        const command = typeof obj.command === "string" ? obj.command : null;
        if (!event || !command) {
            continue;
        }
        const matcher = typeof obj.matcher === "string" ? obj.matcher : null;
        const background = obj.background === true;
        const timeoutMs = typeof obj.timeoutMs === "number" && Number.isFinite(obj.timeoutMs)
            ? obj.timeoutMs
            : 0;
        out.push({ event, matcher, command, background, timeoutMs });
    }
    return out;
}
function getErrorMessage(err) {
    if (err instanceof Error) {
        return err.message;
    }
    if (typeof err === "string") {
        return err;
    }
    return "unknown error";
}
//# sourceMappingURL=index.js.map