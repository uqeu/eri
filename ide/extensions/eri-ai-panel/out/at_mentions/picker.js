"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AtMentionPicker = void 0;
exports.defaultDocSources = defaultDocSources;
exports.allDescriptors = allDescriptors;
const child_process_1 = require("child_process");
const util_1 = require("util");
const vscode = require("vscode");
const registry_1 = require("./registry");
const resolvers_1 = require("./resolvers");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
const FILE_PICK_LIMIT = 1000;
const SYMBOL_PICK_LIMIT = 200;
class AtMentionPicker {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    async openTopLevel() {
        const enabled = this.deps.registry.enabledKinds();
        if (enabled.length === 0) {
            vscode.window.showInformationMessage("eri @-mentions — all mention types are disabled. Run 'eri: Manage @-mentions' to enable some.");
            return undefined;
        }
        const picked = await vscode.window.showQuickPick(enabled.map((descriptor) => ({
            label: `${descriptor.icon} ${descriptor.token}`,
            description: descriptor.description,
            kindId: descriptor.id,
        })), {
            placeHolder: "Add context — pick a mention kind",
            matchOnDescription: true,
        });
        if (!picked) {
            return undefined;
        }
        return this.openKind(picked.kindId);
    }
    async openKind(kind) {
        const descriptor = this.deps.registry.descriptor(kind);
        if (!descriptor) {
            return undefined;
        }
        if (!this.deps.registry.isEnabled(kind)) {
            vscode.window.showInformationMessage(`eri @-mentions — ${descriptor.token} is disabled. Enable it via 'eri: Manage @-mentions'.`);
            return undefined;
        }
        switch (kind) {
            case "file": return this.pickFile(descriptor);
            case "folder": return this.pickFolder(descriptor);
            case "code": return this.pickCode(descriptor);
            case "docs": return this.pickDocs(descriptor);
            case "web": return this.pickWeb(descriptor);
            case "codebase": return this.pickCodebase(descriptor);
            case "git": return this.pickGit(descriptor);
            case "pastChats": return this.pickPastChats(descriptor);
            case "recentChanges": return this.pickRecentChanges(descriptor);
            case "linterErrors": return this.pickLinterErrors(descriptor);
            case "definitions": return this.pickDefinitions(descriptor);
            case "codemap": return this.pickCodemap(descriptor);
            case "image": return this.pickImage(descriptor);
            default: return undefined;
        }
    }
    /**
     * Multimodal image attachment. Opens a native file picker filtered to
     * PNG / JPEG / WebP / GIF, reads the file, encodes it as a `data:` URI
     * the model providers can ingest as an image content block. We do NOT
     * upload anywhere — the URI travels with the next turn and stays in
     * memory; nothing persists.
     */
    async pickImage(_descriptor) {
        const uris = await vscode.window.showOpenDialog({
            title: "@Image — pick a screenshot or design",
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: {
                "Images": ["png", "jpg", "jpeg", "webp", "gif"],
            },
        });
        if (!uris || uris.length === 0)
            return undefined;
        const uri = uris[0];
        try {
            const bytes = await vscode.workspace.fs.readFile(uri);
            const mime = guessImageMime(uri.fsPath);
            // Bound the payload — 8MB is way more than any frontier model
            // accepts as a single image, and avoids accidental memory blow-ups.
            if (bytes.byteLength > 8 * 1024 * 1024) {
                vscode.window.showWarningMessage("Image too large (>8MB). Resize or screenshot a smaller area.");
                return undefined;
            }
            const base64 = Buffer.from(bytes).toString("base64");
            const dataUri = `data:${mime};base64,${base64}`;
            const name = uri.fsPath.split(/[/\\]/).pop() ?? "image";
            return {
                kind: "image",
                label: name,
                subtitle: `${mime} · ${formatBytes(bytes.byteLength)}`,
                payload: { mime, dataUri, name, sizeBytes: bytes.byteLength },
            };
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`eri @Image — failed to read file: ${msg}`);
            return undefined;
        }
    }
    async pickCodemap(_descriptor) {
        // The actual list comes from the sidecar at resolve time; the picker
        // only collects a free-form name from the user. This keeps the picker
        // synchronous and avoids round-tripping over JSON-RPC just to fill in a
        // dropdown — names tend to be short ("module", "hotspot", etc.).
        const name = await vscode.window.showInputBox({
            prompt: "Codemap name (e.g. 'module' or 'hotspot')",
            placeHolder: "module",
        });
        if (!name) {
            return undefined;
        }
        return {
            kind: "codemap",
            label: name,
            subtitle: "codemap",
            payload: { name },
        };
    }
    // ---------- individual pickers ----------
    async pickFile(_descriptor) {
        const uris = await vscode.workspace.findFiles("**/*", "**/{node_modules,.git,target,dist,out,build}/**", FILE_PICK_LIMIT);
        if (uris.length === 0) {
            vscode.window.showInformationMessage("eri @File — no files in this workspace");
            return undefined;
        }
        const items = uris.map((uri) => ({
            label: vscode.workspace.asRelativePath(uri),
            description: uri.fsPath,
            uri,
        }));
        const picked = await vscode.window.showQuickPick(items, {
            placeHolder: "@File — pick a file",
            matchOnDescription: true,
        });
        if (!picked) {
            return undefined;
        }
        return {
            kind: "file",
            label: picked.label,
            subtitle: picked.uri.fsPath,
            payload: { fsPath: picked.uri.fsPath },
        };
    }
    async pickFolder(_descriptor) {
        const folders = vscode.workspace.workspaceFolders ?? [];
        if (folders.length === 0) {
            vscode.window.showInformationMessage("eri @Folder — open a folder first");
            return undefined;
        }
        const files = await vscode.workspace.findFiles("**/*", "**/{node_modules,.git,target,dist,out,build}/**", FILE_PICK_LIMIT);
        const directories = new Set();
        directories.add(".");
        for (const file of files) {
            const relative = vscode.workspace.asRelativePath(file);
            const parts = relative.split("/");
            parts.pop();
            let accumulator = "";
            for (const part of parts) {
                accumulator = accumulator.length === 0 ? part : `${accumulator}/${part}`;
                directories.add(accumulator);
            }
        }
        const items = Array.from(directories).sort().map((value) => ({
            label: value,
        }));
        const picked = await vscode.window.showQuickPick(items, {
            placeHolder: "@Folder — pick a folder",
        });
        if (!picked) {
            return undefined;
        }
        return {
            kind: "folder",
            label: picked.label,
            payload: { path: picked.label },
        };
    }
    async pickCode(_descriptor) {
        const query = await vscode.window.showInputBox({
            prompt: "@Code — search workspace symbols",
            placeHolder: "Type a class, function, or variable name",
        });
        if (query === undefined) {
            return undefined;
        }
        const symbols = (await vscode.commands.executeCommand("vscode.executeWorkspaceSymbolProvider", query)) ?? [];
        if (symbols.length === 0) {
            vscode.window.showInformationMessage(`eri @Code — no symbols matched "${query}"`);
            return undefined;
        }
        const items = symbols.slice(0, SYMBOL_PICK_LIMIT).map((symbol) => ({
            label: symbol.name,
            description: vscode.SymbolKind[symbol.kind] ?? "Symbol",
            detail: vscode.workspace.asRelativePath(symbol.location.uri),
            symbol,
        }));
        const picked = await vscode.window.showQuickPick(items, {
            placeHolder: "@Code — pick a symbol",
            matchOnDetail: true,
        });
        if (!picked) {
            return undefined;
        }
        const location = picked.symbol.location;
        return {
            kind: "code",
            label: picked.symbol.name,
            subtitle: `${picked.detail}:${location.range.start.line + 1}`,
            payload: {
                name: picked.symbol.name,
                fsPath: location.uri.fsPath,
                startLine: location.range.start.line,
                endLine: location.range.end.line,
            },
        };
    }
    async pickDocs(_descriptor) {
        const sources = this.deps.listDocSources();
        if (sources.length === 0) {
            vscode.window.showInformationMessage("eri @Docs — no doc sources configured. Run 'eri: Add Doc Source'.");
            return undefined;
        }
        const items = sources.map((source) => ({
            label: source.label,
            description: source.url,
            slug: source.slug,
        }));
        const picked = await vscode.window.showQuickPick(items, {
            placeHolder: "@Docs — pick a documentation source",
            matchOnDescription: true,
        });
        if (!picked) {
            return undefined;
        }
        return {
            kind: "docs",
            label: picked.label,
            subtitle: picked.description,
            payload: { slug: picked.slug, url: picked.description },
        };
    }
    async pickWeb(_descriptor) {
        const editor = vscode.window.activeTextEditor;
        const selection = editor && !editor.selection.isEmpty
            ? editor.document.getText(editor.selection).trim()
            : "";
        const query = await vscode.window.showInputBox({
            prompt: "@Web — what should I search for?",
            placeHolder: "Question or topic",
            value: selection,
        });
        if (!query || query.trim().length === 0) {
            return undefined;
        }
        const trimmed = query.trim();
        return {
            kind: "web",
            label: trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed,
            subtitle: "web search",
            payload: { query: trimmed },
        };
    }
    async pickCodebase(_descriptor) {
        const query = await vscode.window.showInputBox({
            prompt: "@Codebase — semantic search",
            placeHolder: "Describe what you want to find",
        });
        if (!query || query.trim().length === 0) {
            return undefined;
        }
        const trimmed = query.trim();
        return {
            kind: "codebase",
            label: trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed,
            subtitle: "semantic search",
            payload: { query: trimmed },
        };
    }
    async pickGit(_descriptor) {
        const subKind = await vscode.window.showQuickPick([
            { label: "Commit", description: "Pick from the last 50 commits", id: "commit" },
            { label: "Branch", description: "Pick a branch and attach recent history", id: "branch" },
            { label: "Diff", description: "Diff against a ref (default: HEAD)", id: "diff" },
        ], { placeHolder: "@Git — what do you want to attach?" });
        if (!subKind) {
            return undefined;
        }
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!cwd) {
            vscode.window.showInformationMessage("eri @Git — open a folder first");
            return undefined;
        }
        if (subKind.id === "commit") {
            try {
                const { stdout } = await execAsync('git log --pretty=format:"%h%x09%an%x09%s" -n 50', { cwd });
                const items = stdout
                    .split("\n")
                    .filter((line) => line.trim().length > 0)
                    .map((line) => {
                    const [sha, author, ...subjectParts] = line.split("\t");
                    const subject = subjectParts.join("\t");
                    return {
                        label: sha,
                        description: subject,
                        detail: author,
                        sha,
                    };
                });
                const picked = await vscode.window.showQuickPick(items, {
                    placeHolder: "@Git — pick a commit",
                    matchOnDescription: true,
                    matchOnDetail: true,
                });
                if (!picked) {
                    return undefined;
                }
                return {
                    kind: "git",
                    label: `commit ${picked.sha}`,
                    subtitle: picked.description,
                    payload: { gitKind: "commit", ref: picked.sha },
                };
            }
            catch (err) {
                vscode.window.showWarningMessage(`eri @Git — ${errorMessage(err)}`);
                return undefined;
            }
        }
        if (subKind.id === "branch") {
            try {
                const { stdout } = await execAsync("git branch --list --all", { cwd });
                const branches = stdout
                    .split("\n")
                    .map((line) => line.replace(/^[\s*]+/, "").trim())
                    .filter((line) => line.length > 0);
                const picked = await vscode.window.showQuickPick(branches, {
                    placeHolder: "@Git — pick a branch",
                });
                if (!picked) {
                    return undefined;
                }
                return {
                    kind: "git",
                    label: `branch ${picked}`,
                    payload: { gitKind: "branch", ref: picked },
                };
            }
            catch (err) {
                vscode.window.showWarningMessage(`eri @Git — ${errorMessage(err)}`);
                return undefined;
            }
        }
        const ref = await vscode.window.showInputBox({
            prompt: "@Git diff — ref to diff against",
            value: "HEAD",
        });
        if (ref === undefined) {
            return undefined;
        }
        return {
            kind: "git",
            label: `diff ${ref}`,
            payload: { gitKind: "diff", ref },
        };
    }
    async pickPastChats(_descriptor) {
        const chats = await this.deps.listPastChats();
        if (chats.length === 0) {
            vscode.window.showInformationMessage("eri @PastChats — no saved chats yet in this workspace");
            return undefined;
        }
        const items = chats.map((chat) => ({
            label: chat.title,
            description: chat.updatedAt ? new Date(chat.updatedAt).toLocaleString() : undefined,
            id: chat.id,
        }));
        const picked = await vscode.window.showQuickPick(items, {
            placeHolder: "@PastChats — pick a prior conversation",
        });
        if (!picked) {
            return undefined;
        }
        return {
            kind: "pastChats",
            label: picked.label,
            subtitle: picked.description,
            payload: { id: picked.id },
        };
    }
    async pickRecentChanges(_descriptor) {
        // No additional input required.
        return {
            kind: "recentChanges",
            label: "working tree",
            subtitle: "git status + diff --stat",
            payload: {},
        };
    }
    async pickLinterErrors(_descriptor) {
        return {
            kind: "linterErrors",
            label: "current diagnostics",
            subtitle: "errors + warnings",
            payload: {},
        };
    }
    async pickDefinitions(_descriptor) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage("eri @Definitions — place the cursor in an open editor first");
            return undefined;
        }
        const position = editor.selection.active;
        return {
            kind: "definitions",
            label: `${vscode.workspace.asRelativePath(editor.document.uri)}:${position.line + 1}`,
            subtitle: "near cursor",
            payload: {
                fsPath: editor.document.uri.fsPath,
                line: position.line,
                character: position.character,
            },
        };
    }
}
exports.AtMentionPicker = AtMentionPicker;
function defaultDocSources() {
    return resolvers_1.BUILT_IN_DOC_SOURCES;
}
// Re-export the descriptor list so callers can render UI without touching the
// registry.
function allDescriptors() {
    return registry_1.AT_MENTION_KINDS;
}
function errorMessage(err) {
    return err instanceof Error ? err.message : String(err);
}
function guessImageMime(filePath) {
    const ext = filePath.toLowerCase().split(".").pop() ?? "";
    switch (ext) {
        case "png":
            return "image/png";
        case "jpg":
        case "jpeg":
            return "image/jpeg";
        case "webp":
            return "image/webp";
        case "gif":
            return "image/gif";
        default:
            return "application/octet-stream";
    }
}
function formatBytes(n) {
    if (n < 1024)
        return `${n}B`;
    if (n < 1024 * 1024)
        return `${(n / 1024).toFixed(1)}KB`;
    return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}
//# sourceMappingURL=picker.js.map