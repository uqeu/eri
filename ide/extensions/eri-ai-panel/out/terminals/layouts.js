"use strict";
// iTerm-style saved arrangements. A layout is a JSON file under
// `<workspace>/.eri/terminal-layouts/<name>.json` capturing groups and
// their member terminals.
Object.defineProperty(exports, "__esModule", { value: true });
exports.LAYOUTS_DIRNAME = void 0;
exports.layoutsDir = layoutsDir;
exports.safeFileName = safeFileName;
exports.parseLayout = parseLayout;
exports.serializeLayout = serializeLayout;
exports.cloneLayout = cloneLayout;
exports.listLayouts = listLayouts;
exports.readLayout = readLayout;
exports.writeLayout = writeLayout;
exports.deleteLayout = deleteLayout;
const fs = require("node:fs/promises");
const path = require("node:path");
exports.LAYOUTS_DIRNAME = path.join(".eri", "terminal-layouts");
function layoutsDir(workspaceFsPath) {
    return path.join(workspaceFsPath, exports.LAYOUTS_DIRNAME);
}
function safeFileName(name) {
    const cleaned = name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-_ ]+/g, "")
        .replace(/\s+/g, "-");
    return cleaned.length > 0 ? cleaned : `layout-${Date.now()}`;
}
// Strict deserializer that fills in sane defaults for missing fields.
function parseLayout(raw) {
    if (!raw || typeof raw !== "object") {
        return null;
    }
    const candidate = raw;
    if (typeof candidate.name !== "string" || candidate.name.length === 0) {
        return null;
    }
    const groups = Array.isArray(candidate.groups)
        ? candidate.groups
            .map(parseLayoutGroup)
            .filter((g) => g !== null)
        : [];
    return {
        name: candidate.name,
        description: typeof candidate.description === "string"
            ? candidate.description
            : undefined,
        groups,
    };
}
function parseLayoutGroup(raw) {
    if (!raw || typeof raw !== "object") {
        return null;
    }
    const candidate = raw;
    if (typeof candidate.name !== "string" || candidate.name.length === 0) {
        return null;
    }
    const terminals = Array.isArray(candidate.terminals)
        ? candidate.terminals
            .map(parseLayoutTerminal)
            .filter((t) => t !== null)
        : [];
    return {
        name: candidate.name,
        icon: typeof candidate.icon === "string" ? candidate.icon : undefined,
        terminals,
    };
}
function parseLayoutTerminal(raw) {
    if (!raw || typeof raw !== "object") {
        return null;
    }
    const candidate = raw;
    if (typeof candidate.name !== "string" || candidate.name.length === 0) {
        return null;
    }
    return {
        name: candidate.name,
        cwd: typeof candidate.cwd === "string" ? candidate.cwd : "",
        command: typeof candidate.command === "string" ? candidate.command : undefined,
        icon: typeof candidate.icon === "string" ? candidate.icon : undefined,
    };
}
function serializeLayout(layout) {
    return `${JSON.stringify(layout, null, 2)}\n`;
}
// Round-trip helper used by tests.
function cloneLayout(layout) {
    return parseLayout(JSON.parse(serializeLayout(layout)));
}
async function listLayouts(workspaceFsPath) {
    const dir = layoutsDir(workspaceFsPath);
    let entries;
    try {
        entries = await fs.readdir(dir);
    }
    catch (error) {
        if (error.code === "ENOENT") {
            return [];
        }
        throw error;
    }
    return entries
        .filter((name) => name.endsWith(".json"))
        .map((file) => ({
        name: file.slice(0, -".json".length),
        filePath: path.join(dir, file),
    }));
}
async function readLayout(filePath) {
    const raw = await fs.readFile(filePath, "utf8");
    try {
        return parseLayout(JSON.parse(raw));
    }
    catch {
        return null;
    }
}
async function writeLayout(workspaceFsPath, layout) {
    const dir = layoutsDir(workspaceFsPath);
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${safeFileName(layout.name)}.json`);
    await fs.writeFile(filePath, serializeLayout(layout), "utf8");
    return filePath;
}
async function deleteLayout(filePath) {
    try {
        await fs.unlink(filePath);
    }
    catch (error) {
        if (error.code !== "ENOENT") {
            throw error;
        }
    }
}
//# sourceMappingURL=layouts.js.map