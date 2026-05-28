"use strict";
// Pure helpers for the /tracer flow — extracted from the main module
// so unit tests can import them without pulling `vscode`.
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseTracerArgs = parseTracerArgs;
exports.sandboxPathFor = sandboxPathFor;
exports.sandboxRoot = sandboxRoot;
exports.looksLikeRepoUrl = looksLikeRepoUrl;
exports.renderTracerMarkdown = renderTracerMarkdown;
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const SANDBOX_ROOT = path.join(os.homedir(), ".eri", "sandboxes");
function parseTracerArgs(args) {
    const trimmed = args.trim();
    if (!trimmed)
        return null;
    const match = trimmed.match(/^(\S+)\s+(.+)$/);
    if (!match)
        return null;
    const url = match[1] ?? "";
    const query = (match[2] ?? "").trim();
    if (!url || !query)
        return null;
    return { url, query };
}
function sandboxPathFor(url) {
    const sha = crypto.createHash("sha256").update(url).digest("hex").slice(0, 16);
    return path.join(SANDBOX_ROOT, sha);
}
function sandboxRoot() {
    return SANDBOX_ROOT;
}
function looksLikeRepoUrl(url) {
    return (/^https:\/\/(github|gitlab)\.com\//.test(url) ||
        /^https:\/\/codeberg\.org\//.test(url) ||
        /^https:\/\/bitbucket\.org\//.test(url) ||
        /^git@github\.com:/.test(url));
}
function renderTracerMarkdown(result) {
    const lines = [];
    lines.push(`# Tracer: ${result.query}`);
    lines.push("");
    lines.push(`Repo: ${result.url}`);
    lines.push(`Sandbox: \`${result.sandboxPath}\``);
    lines.push("");
    if (result.hits.length === 0) {
        lines.push("_No hits._");
        return lines.join("\n");
    }
    const sorted = [...result.hits].sort((a, b) => b.score - a.score);
    for (const hit of sorted) {
        lines.push(`## ${hit.path}:${hit.line_start}-${hit.line_end} (score: ${hit.score.toFixed(2)})`);
        lines.push("");
        lines.push("```");
        lines.push(hit.content.trim());
        lines.push("```");
        lines.push("");
    }
    return lines.join("\n");
}
//# sourceMappingURL=pure.js.map