"use strict";
// Persistence + in-memory state for the terminal organization layer.
// Keeps the *structural* metadata (groups, names, locks) — the terminals
// themselves are owned by VS Code.
Object.defineProperty(exports, "__esModule", { value: true });
exports.TerminalStateStore = void 0;
exports.addGroup = addGroup;
exports.updateGroup = updateGroup;
exports.removeGroup = removeGroup;
exports.upsertTerminal = upsertTerminal;
exports.removeTerminal = removeTerminal;
exports.moveTerminal = moveTerminal;
exports.findGroup = findGroup;
exports.findTerminal = findTerminal;
exports.terminalKeyFromNative = terminalKeyFromNative;
exports.generateGroupId = generateGroupId;
exports.serializeSnapshot = serializeSnapshot;
exports.deserializeSnapshot = deserializeSnapshot;
const vscode = require("vscode");
const STATE_VERSION = 1;
const STORAGE_PREFIX = "eri.terminals.state";
function storageKey(workspaceFsPath) {
    return `${STORAGE_PREFIX}::${workspaceFsPath ?? "<global>"}`;
}
function emptySnapshot() {
    return { groups: [], terminals: [] };
}
// Pure helpers (immutable updates) ----------------------------------------
function addGroup(snapshot, group) {
    if (snapshot.groups.some((g) => g.id === group.id)) {
        return snapshot;
    }
    return { ...snapshot, groups: [...snapshot.groups, group] };
}
function updateGroup(snapshot, id, patch) {
    return {
        ...snapshot,
        groups: snapshot.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)),
    };
}
function removeGroup(snapshot, id) {
    return {
        groups: snapshot.groups.filter((g) => g.id !== id),
        terminals: snapshot.terminals.filter((t) => t.groupId !== id),
    };
}
function upsertTerminal(snapshot, record) {
    const existing = snapshot.terminals.find((t) => t.key === record.key);
    if (existing) {
        return {
            ...snapshot,
            terminals: snapshot.terminals.map((t) => t.key === record.key ? { ...t, ...record } : t),
        };
    }
    return { ...snapshot, terminals: [...snapshot.terminals, record] };
}
function removeTerminal(snapshot, key) {
    return {
        ...snapshot,
        terminals: snapshot.terminals.filter((t) => t.key !== key),
    };
}
function moveTerminal(snapshot, key, groupId) {
    return {
        ...snapshot,
        terminals: snapshot.terminals.map((t) => t.key === key ? { ...t, groupId } : t),
    };
}
function findGroup(snapshot, id) {
    return snapshot.groups.find((g) => g.id === id);
}
function findTerminal(snapshot, key) {
    return snapshot.terminals.find((t) => t.key === key);
}
// Identity ----------------------------------------------------------------
// Stable-ish key for a terminal across reloads. VS Code reuses the
// processId only within a session, so we combine name + cwd + a per-session
// counter falling back gracefully.
function terminalKeyFromNative(terminal, counter) {
    const cwd = (terminal.shellIntegration?.cwd?.fsPath ?? "") || "";
    return `${terminal.name}::${cwd}::${counter}`;
}
function generateGroupId() {
    const rand = Math.random().toString(36).slice(2, 8);
    return `g_${Date.now().toString(36)}_${rand}`;
}
// Storage round-trip ------------------------------------------------------
function serializeSnapshot(snapshot) {
    return {
        version: STATE_VERSION,
        groups: snapshot.groups,
        terminals: snapshot.terminals,
    };
}
function deserializeSnapshot(raw) {
    if (!raw || typeof raw !== "object") {
        return emptySnapshot();
    }
    const candidate = raw;
    const groups = (candidate.groups ?? [])
        .map(toGroupRecord)
        .filter((g) => g !== null);
    const groupIds = new Set(groups.map((g) => g.id));
    const terminals = (candidate.terminals ?? [])
        .map(toTerminalRecord)
        .filter((t) => t !== null && groupIds.has(t.groupId));
    return { groups, terminals };
}
function toGroupRecord(value) {
    if (!value || typeof value.id !== "string" || typeof value.name !== "string") {
        return null;
    }
    return {
        id: value.id,
        name: value.name,
        icon: typeof value.icon === "string" ? value.icon : undefined,
        expanded: value.expanded !== false,
        auto: value.auto === true,
        cwd: typeof value.cwd === "string" ? value.cwd : undefined,
        createdAtMs: typeof value.createdAtMs === "number" ? value.createdAtMs : Date.now(),
    };
}
function toTerminalRecord(value) {
    if (!value ||
        typeof value.key !== "string" ||
        typeof value.groupId !== "string" ||
        typeof value.name !== "string") {
        return null;
    }
    return {
        key: value.key,
        groupId: value.groupId,
        name: value.name,
        nameLocked: value.nameLocked === true,
        cwd: typeof value.cwd === "string" ? value.cwd : undefined,
        icon: typeof value.icon === "string" ? value.icon : undefined,
        createdAtMs: typeof value.createdAtMs === "number" ? value.createdAtMs : Date.now(),
    };
}
// Workspace-scoped store --------------------------------------------------
class TerminalStateStore {
    memento;
    workspaceFsPath;
    snapshot = emptySnapshot();
    emitter = new vscode.EventEmitter();
    onDidChange = this.emitter.event;
    constructor(memento, workspaceFsPath) {
        this.memento = memento;
        this.workspaceFsPath = workspaceFsPath;
        this.snapshot = deserializeSnapshot(this.memento.get(storageKey(this.workspaceFsPath)));
    }
    current() {
        return this.snapshot;
    }
    async apply(next) {
        if (next === this.snapshot) {
            return;
        }
        this.snapshot = next;
        await this.memento.update(storageKey(this.workspaceFsPath), serializeSnapshot(next));
        this.emitter.fire(next);
    }
    dispose() {
        this.emitter.dispose();
    }
}
exports.TerminalStateStore = TerminalStateStore;
//# sourceMappingURL=state.js.map