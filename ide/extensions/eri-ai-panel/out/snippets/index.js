"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activateSnippets = activateSnippets;
const fs = require("fs");
const os = require("os");
const path = require("path");
const vscode = require("vscode");
const USER_DIR = path.join(os.homedir(), ".eri", "snippets");
const PROJECT_REL = path.join(".eri", "snippets");
function activateSnippets(context) {
    const list = async () => {
        const merged = new Map();
        for (const s of await readSnippetsFromDir(USER_DIR, "user")) {
            merged.set(s.name, s);
        }
        // Project snippets override user-wide ones with the same name.
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (folder) {
            const projectDir = path.join(folder.uri.fsPath, PROJECT_REL);
            for (const s of await readSnippetsFromDir(projectDir, "project")) {
                merged.set(s.name, s);
            }
        }
        return Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name));
    };
    const pick = async () => {
        const all = await list();
        if (all.length === 0) {
            vscode.window.showInformationMessage("No snippets yet. Create files under ~/.eri/snippets/ or .eri/snippets/ (one per snippet).");
            return undefined;
        }
        const item = await vscode.window.showQuickPick(all.map((s) => ({
            label: `#${s.name}`,
            description: s.source,
            detail: previewBody(s.body),
            snippet: s,
        })), {
            placeHolder: "Pick a snippet",
            matchOnDescription: true,
            matchOnDetail: true,
        });
        if (!item) {
            return undefined;
        }
        // Side-effect: drop the body on the system clipboard so the user can paste
        // it wherever they want (composer, terminal, anywhere). Cleanest minimal UX.
        await vscode.env.clipboard.writeText(item.snippet.body);
        vscode.window.showInformationMessage(`Copied #${item.snippet.name} (${item.snippet.body.length} chars)`);
        return item.snippet;
    };
    const resolve = async (name) => {
        const all = await list();
        return all.find((s) => s.name === name)?.body;
    };
    context.subscriptions.push(vscode.commands.registerCommand("eri.snippets.pick", pick), vscode.commands.registerCommand("eri.snippets.openUserDir", async () => {
        await fs.promises.mkdir(USER_DIR, { recursive: true });
        await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(USER_DIR));
    }));
    return {
        list,
        pick,
        resolve,
        dispose: () => {
            // Commands disposed via context.subscriptions.
        },
    };
}
async function readSnippetsFromDir(dir, source) {
    let entries;
    try {
        entries = await fs.promises.readdir(dir);
    }
    catch {
        return [];
    }
    const out = [];
    for (const entry of entries) {
        if (!entry.toLowerCase().endsWith(".txt")) {
            continue;
        }
        const full = path.join(dir, entry);
        try {
            const stat = await fs.promises.stat(full);
            if (!stat.isFile() || stat.size > 64 * 1024) {
                continue;
            }
            const body = await fs.promises.readFile(full, "utf8");
            out.push({
                name: entry.slice(0, -".txt".length),
                source,
                path: full,
                body,
            });
        }
        catch {
            // skip unreadable
        }
    }
    return out;
}
function previewBody(body) {
    const oneline = body.replace(/\s+/g, " ").trim();
    return oneline.length > 80 ? oneline.slice(0, 77) + "…" : oneline;
}
//# sourceMappingURL=index.js.map