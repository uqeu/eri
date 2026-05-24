"use strict";
// CLI binary detection + user-defined agent file loading.
//
// Kept side-effect free where possible so unit tests can exercise the
// parsing logic without touching the filesystem.
Object.defineProperty(exports, "__esModule", { value: true });
exports.which = void 0;
exports.detectCliBinaries = detectCliBinaries;
exports.loadUserAgentFiles = loadUserAgentFiles;
const child_process_1 = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
/**
 * Default `which` implementation — spawns `/usr/bin/which`. Returns the
 * absolute path or null when not found. Never throws.
 */
const which = (binary) => new Promise((resolve) => {
    const proc = (0, child_process_1.spawn)("/usr/bin/which", [binary], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    proc.stdout.on("data", (chunk) => {
        out += chunk.toString("utf8");
    });
    proc.on("error", () => resolve(null));
    proc.on("close", (code) => {
        if (code !== 0) {
            resolve(null);
            return;
        }
        const line = out.split("\n").map((l) => l.trim()).find(Boolean);
        resolve(line ?? null);
    });
});
exports.which = which;
async function detectCliBinaries(binaries, runner = exports.which) {
    const entries = [];
    await Promise.all(binaries.map(async (binary) => {
        const found = await runner(binary);
        if (found && found.length > 0) {
            entries.push([binary, found]);
        }
    }));
    return { binaries: new Map(entries) };
}
/**
 * Load user-defined agents from `<workspaceRoot>/.eri/agents.json` and
 * `~/.eri/agents.json`. Workspace overrides home for duplicate ids.
 *
 * Returns an empty array (and never throws) when either file is missing
 * or malformed — agent registration is best-effort.
 */
function loadUserAgentFiles(workspaceRoot) {
    const paths = [];
    const home = process.env.HOME ?? os.homedir();
    if (home) {
        paths.push(path.join(home, ".eri", "agents.json"));
    }
    if (workspaceRoot) {
        paths.push(path.join(workspaceRoot, ".eri", "agents.json"));
    }
    const merged = new Map();
    for (const filePath of paths) {
        const parsed = readAgentFile(filePath);
        for (const entry of parsed) {
            merged.set(entry.id, entry);
        }
    }
    return { agents: Array.from(merged.values()) };
}
function readAgentFile(filePath) {
    let raw;
    try {
        raw = fs.readFileSync(filePath, "utf8");
    }
    catch {
        return [];
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return [];
    }
    if (typeof parsed !== "object" || parsed === null) {
        return [];
    }
    const list = parsed.agents;
    if (!Array.isArray(list)) {
        return [];
    }
    const out = [];
    for (const item of list) {
        const validated = validateUserAgent(item);
        if (validated) {
            out.push(validated);
        }
    }
    return out;
}
function validateUserAgent(value) {
    if (typeof value !== "object" || value === null) {
        return null;
    }
    const obj = value;
    if (typeof obj.id !== "string" || obj.id.length === 0)
        return null;
    if (typeof obj.label !== "string" || obj.label.length === 0)
        return null;
    const kind = obj.kind;
    if (kind !== "cli" && kind !== "proxy" && kind !== "byok" && kind !== "mercury" && kind !== "auto") {
        return null;
    }
    const binary = typeof obj.binary === "string" ? obj.binary : undefined;
    const args = Array.isArray(obj.binaryArgs)
        ? obj.binaryArgs.filter((a) => typeof a === "string")
        : undefined;
    const description = typeof obj.description === "string" ? obj.description : undefined;
    const vendor = typeof obj.vendor === "string" ? obj.vendor : undefined;
    const model = typeof obj.model === "string" ? obj.model : undefined;
    return {
        id: obj.id,
        label: obj.label,
        kind,
        ...(binary ? { binary } : {}),
        ...(args ? { binaryArgs: args } : {}),
        ...(description ? { description } : {}),
        ...(vendor ? { vendor } : {}),
        ...(model ? { model } : {}),
    };
}
//# sourceMappingURL=detection.js.map