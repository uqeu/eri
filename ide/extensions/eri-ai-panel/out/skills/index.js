"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activateSkills = activateSkills;
const vscode = require("vscode");
const skillsView_1 = require("./skillsView");
function activateSkills(context, getSidecar) {
    const provider = new skillsView_1.SkillsTreeDataProvider();
    const view = vscode.window.createTreeView("eri.skills", {
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
            provider.setError("Open a workspace folder to load skills.");
            return;
        }
        try {
            const result = await sidecar.request("eri/skills/list", {
                workspace,
            });
            const parsed = parseSkills(result?.skills);
            provider.setSkills(parsed);
        }
        catch (err) {
            provider.setError(`Failed to load skills: ${getErrorMessage(err)}`);
        }
    };
    // Initial fetch — fire and forget; errors surface as a placeholder row.
    void refresh();
    context.subscriptions.push(view, vscode.commands.registerCommand("eri.skills.refresh", refresh));
    return {
        view,
        refresh,
        dispose: () => {
            view.dispose();
        },
    };
}
function resolveWorkspace() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        return null;
    }
    return folders[0].uri.fsPath;
}
function parseSkills(raw) {
    if (!Array.isArray(raw)) {
        return [];
    }
    const out = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== "object") {
            continue;
        }
        const obj = entry;
        const name = typeof obj.name === "string" ? obj.name : null;
        if (!name) {
            continue;
        }
        const description = typeof obj.description === "string" ? obj.description : "";
        const when = Array.isArray(obj.when)
            ? obj.when.filter((w) => typeof w === "string")
            : [];
        out.push({ name, description, when });
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