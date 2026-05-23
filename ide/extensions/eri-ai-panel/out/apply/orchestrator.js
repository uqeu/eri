"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApplyOrchestrator = void 0;
const vscode = require("vscode");
const searchReplace_1 = require("./searchReplace");
const KNOWN_KINDS = new Set([
    "created",
    "modified",
    "deleted",
    "replaced",
]);
class ApplyOrchestrator {
    getSidecar;
    lastCheckpointId = null;
    lastResult = null;
    editCounter = 0;
    constructor(getSidecar) {
        this.getSidecar = getSidecar;
    }
    // Parse model output through the sidecar, then build per-edit JS previews.
    async stage(modelOutput) {
        const sidecar = this.getSidecar();
        if (!sidecar) {
            throw new Error("eri sidecar not running");
        }
        const root = this.workspaceRoot();
        const parsed = await sidecar.request("eri/apply/parse", {
            text: modelOutput,
        });
        const blocks = (parsed.edits ?? [])
            .filter((e) => typeof e.path === "string" &&
            typeof e.search === "string" &&
            typeof e.replace === "string")
            .map((e) => ({ path: e.path, search: e.search, replace: e.replace }));
        const out = [];
        // Track running buffer per file so multi-block previews compound.
        const buffers = new Map();
        for (const block of blocks) {
            const abs = this.resolveAbsolute(root, block.path);
            const before = buffers.get(block.path) ?? (await readFileText(abs));
            const outcome = (0, searchReplace_1.applySearchReplace)(before, block.search, block.replace);
            const preview = outcome
                ? { before, after: outcome.after, hasPreview: true }
                : {
                    before,
                    after: before,
                    hasPreview: false,
                    reason: "Could not locate SEARCH in current file — sidecar will retry on apply.",
                };
            if (outcome) {
                buffers.set(block.path, outcome.after);
            }
            out.push({
                id: `edit-${++this.editCounter}`,
                path: block.path,
                absolutePath: abs,
                search: block.search,
                replace: block.replace,
                preview,
                accepted: null,
            });
        }
        return out;
    }
    // Apply the accepted edits via the sidecar; auto-create a checkpoint first.
    async commit(accepted) {
        const sidecar = this.getSidecar();
        if (!sidecar) {
            throw new Error("eri sidecar not running");
        }
        if (accepted.length === 0) {
            const empty = { applied: [], failed: [], checkpointId: null };
            this.lastResult = empty;
            return empty;
        }
        const root = this.workspaceRoot();
        const checkpointId = await this.createCheckpoint(sidecar, root);
        const response = await sidecar.request("eri/apply/run", {
            root,
            edits: accepted.map((edit) => ({
                path: edit.path,
                search: edit.search,
                replace: edit.replace,
            })),
        });
        const applied = (response.applied ?? [])
            .filter((a) => typeof a.path === "string" &&
            typeof a.kind === "string" &&
            typeof a.bytesBefore === "number" &&
            typeof a.bytesAfter === "number")
            .map((a) => ({
            path: a.path,
            kind: KNOWN_KINDS.has(a.kind) ? a.kind : "modified",
            bytesBefore: a.bytesBefore,
            bytesAfter: a.bytesAfter,
        }));
        const failed = (response.failed ?? [])
            .filter((f) => typeof f.path === "string" && typeof f.reason === "string")
            .map((f) => ({
            path: f.path,
            reason: f.reason,
            ...(typeof f.detail === "string" ? { detail: f.detail } : {}),
        }));
        const result = { applied, failed, checkpointId };
        this.lastResult = result;
        return result;
    }
    async revert(checkpointId) {
        const sidecar = this.getSidecar();
        if (!sidecar) {
            throw new Error("eri sidecar not running");
        }
        const root = this.workspaceRoot();
        await sidecar.request("eri/checkpoints/restore", {
            workspace: root,
            id: checkpointId,
            force: true,
        });
    }
    lastCheckpoint() {
        return this.lastCheckpointId;
    }
    lastBatch() {
        return this.lastResult;
    }
    async createCheckpoint(sidecar, root) {
        try {
            const cp = await sidecar.request("eri/checkpoints/create", {
                workspace: root,
                label: "Before edit",
            });
            const id = typeof cp.id === "string" ? cp.id : null;
            this.lastCheckpointId = id;
            return id;
        }
        catch {
            // Checkpoints are a nice-to-have for revert; failure shouldn't block apply.
            this.lastCheckpointId = null;
            return null;
        }
    }
    workspaceRoot() {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) {
            throw new Error("eri: no workspace folder open");
        }
        return folder.uri.fsPath;
    }
    resolveAbsolute(root, relPath) {
        return vscode.Uri.joinPath(vscode.Uri.file(root), relPath).fsPath;
    }
}
exports.ApplyOrchestrator = ApplyOrchestrator;
async function readFileText(absolutePath) {
    try {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(absolutePath));
        return Buffer.from(bytes).toString("utf8");
    }
    catch {
        return "";
    }
}
//# sourceMappingURL=orchestrator.js.map