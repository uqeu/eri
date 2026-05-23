"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CheckpointsService = void 0;
exports.readFileAtRevision = readFileAtRevision;
exports.resolveWorkspaceCwd = resolveWorkspaceCwd;
const child_process_1 = require("child_process");
const util_1 = require("util");
const vscode = require("vscode");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
function isFileChangeKind(value) {
    return (value === "added" || value === "modified" || value === "deleted" || value === "renamed");
}
function asNumber(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function asString(value, fallback) {
    return typeof value === "string" ? value : fallback;
}
function asStringArray(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((item) => typeof item === "string");
}
function parseCheckpoint(raw) {
    if (!raw || typeof raw !== "object") {
        return null;
    }
    const obj = raw;
    const id = asString(obj.id, "");
    const sha = asString(obj.sha, "");
    if (!id || !sha) {
        return null;
    }
    return {
        id,
        sha,
        createdAtMs: asNumber(obj.createdAtMs, 0),
        label: asString(obj.label, ""),
    };
}
function parseFileChange(raw) {
    if (!raw || typeof raw !== "object") {
        return null;
    }
    const obj = raw;
    const path = asString(obj.path, "");
    if (!path) {
        return null;
    }
    const kind = isFileChangeKind(obj.kind) ? obj.kind : "modified";
    return {
        path,
        kind,
        added: asNumber(obj.added, 0),
        removed: asNumber(obj.removed, 0),
    };
}
class CheckpointsService {
    getSidecar;
    constructor(getSidecar) {
        this.getSidecar = getSidecar;
    }
    requireSidecar() {
        const sidecar = this.getSidecar();
        if (!sidecar) {
            throw new Error("eri sidecar is not running");
        }
        return sidecar;
    }
    async list() {
        const sidecar = this.requireSidecar();
        const result = await sidecar.request("eri/checkpoints/list", {});
        if (!Array.isArray(result?.checkpoints)) {
            return [];
        }
        const parsed = [];
        for (const item of result.checkpoints) {
            const cp = parseCheckpoint(item);
            if (cp) {
                parsed.push(cp);
            }
        }
        parsed.sort((a, b) => b.createdAtMs - a.createdAtMs);
        return parsed;
    }
    async show(id) {
        const sidecar = this.requireSidecar();
        const result = await sidecar.request("eri/checkpoints/show", { id });
        if (!Array.isArray(result?.filesChanged)) {
            return { filesChanged: [] };
        }
        const parsed = [];
        for (const item of result.filesChanged) {
            const change = parseFileChange(item);
            if (change) {
                parsed.push(change);
            }
        }
        return { filesChanged: parsed };
    }
    async restore(id, options) {
        const sidecar = this.requireSidecar();
        const result = await sidecar.request("eri/checkpoints/restore", { id, force: options.force });
        return {
            filesRestored: asStringArray(result?.filesRestored),
            filesSkipped: asStringArray(result?.filesSkipped),
        };
    }
    async create(label) {
        const sidecar = this.requireSidecar();
        const result = await sidecar.request("eri/checkpoints/create", { label });
        const parsed = parseCheckpoint(result);
        if (!parsed) {
            throw new Error("sidecar returned an invalid checkpoint payload");
        }
        return parsed;
    }
    async delete(id) {
        const sidecar = this.requireSidecar();
        await sidecar.request("eri/checkpoints/delete", { id });
    }
    async prune(keep) {
        const sidecar = this.requireSidecar();
        const result = await sidecar.request("eri/checkpoints/prune", { keep });
        return { pruned: asNumber(result?.pruned, 0) };
    }
}
exports.CheckpointsService = CheckpointsService;
/**
 * Read the contents of a file at a given git revision via `git show <sha>:<path>`.
 *
 * Side-effect-free: never writes to disk, never mutates refs. The output is
 * placed into an untitled in-memory document by the caller.
 */
async function readFileAtRevision(cwd, sha, filePath) {
    if (!/^[a-f0-9]{4,64}$/i.test(sha)) {
        throw new Error(`invalid sha: ${sha}`);
    }
    // Use execFile (not exec) and pass args as array — no shell, no injection surface.
    const { stdout } = await execFileAsync("git", ["show", `${sha}:${filePath}`], {
        cwd,
        maxBuffer: 64 * 1024 * 1024,
        encoding: "utf8",
    });
    return stdout;
}
function resolveWorkspaceCwd() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        return null;
    }
    return folders[0]?.uri.fsPath ?? null;
}
//# sourceMappingURL=checkpointsService.js.map