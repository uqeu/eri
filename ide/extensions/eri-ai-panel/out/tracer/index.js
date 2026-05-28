"use strict";
// `/tracer <github-url> <query>` — Nia parity (Phase 21a).
//
// Clones a remote repo into an ephemeral sandbox under
// `~/.eri/sandboxes/<sha>/`, runs the sidecar's `eri/index/sync` over
// it, executes `eri/index/search` with the user's query, then deletes
// the sandbox once the user dismisses the result panel. The
// resulting search hits are streamed into a markdown buffer + shown
// in a webview so the user can click through to source lines.
//
// Discipline:
//   - Sandbox lives under HOME (never inside the user's workspace) so
//     a misbehaving git push from inside the sandbox can't accidentally
//     touch the user's repo.
//   - Shallow clone (--depth=1) — we're answering a search query, not
//     reproducing history.
//   - Per-tracer lock: only one tracer per URL at a time. Repeated
//     /tracer for the same URL within the same session reuses the
//     already-cloned sandbox until dismissed.
//   - On any error, the sandbox is cleaned up. The user sees a clear
//     message + the option to retry.
Object.defineProperty(exports, "__esModule", { value: true });
exports.sandboxPathFor = exports.renderTracerMarkdown = exports.parseTracerArgs = exports.looksLikeRepoUrl = void 0;
exports.runTracer = runTracer;
exports.showTracerResultDocument = showTracerResultDocument;
const fs = require("node:fs/promises");
const node_child_process_1 = require("node:child_process");
const vscode = require("vscode");
const pure_1 = require("./pure");
var pure_2 = require("./pure");
Object.defineProperty(exports, "looksLikeRepoUrl", { enumerable: true, get: function () { return pure_2.looksLikeRepoUrl; } });
Object.defineProperty(exports, "parseTracerArgs", { enumerable: true, get: function () { return pure_2.parseTracerArgs; } });
Object.defineProperty(exports, "renderTracerMarkdown", { enumerable: true, get: function () { return pure_2.renderTracerMarkdown; } });
Object.defineProperty(exports, "sandboxPathFor", { enumerable: true, get: function () { return pure_2.sandboxPathFor; } });
async function runTracer(opts) {
    const { url, query, sidecar } = opts;
    if (!(0, pure_1.looksLikeRepoUrl)(url)) {
        throw new Error(`unrecognised git URL: ${url}. Try github.com / gitlab.com / bitbucket.org.`);
    }
    const sandbox = (0, pure_1.sandboxPathFor)(url);
    const cleanup = async () => {
        try {
            await fs.rm(sandbox, { recursive: true, force: true });
        }
        catch (err) {
            console.warn("[eri /tracer] cleanup failed", err);
        }
    };
    try {
        await fs.mkdir((0, pure_1.sandboxRoot)(), { recursive: true });
        const existing = await dirExists(sandbox);
        if (!existing) {
            await runGitClone(url, sandbox);
        }
        await sidecar.request("eri/index/sync", { workspace: sandbox });
        const result = await sidecar.request("eri/index/search", { workspace: sandbox, query, topK: 20 });
        return {
            url,
            query,
            sandboxPath: sandbox,
            hits: result.results ?? [],
            cleanup,
        };
    }
    catch (err) {
        await cleanup();
        throw err;
    }
}
async function dirExists(p) {
    try {
        const stat = await fs.stat(p);
        return stat.isDirectory();
    }
    catch {
        return false;
    }
}
function runGitClone(url, dest) {
    return new Promise((resolve, reject) => {
        // spawn with an args array — no shell interpolation, so a crafted
        // URL is passed as a single argv slot to git directly.
        const child = (0, node_child_process_1.spawn)("git", ["clone", "--depth", "1", "--no-tags", url, dest], { stdio: "ignore" });
        child.on("error", (err) => reject(err));
        child.on("exit", (code) => {
            if (code === 0)
                resolve();
            else
                reject(new Error(`git clone exited with code ${code}`));
        });
    });
}
async function showTracerResultDocument(result) {
    const md = (0, pure_1.renderTracerMarkdown)(result);
    const doc = await vscode.workspace.openTextDocument({
        content: md,
        language: "markdown",
    });
    await vscode.window.showTextDocument(doc, { preview: false });
}
//# sourceMappingURL=index.js.map