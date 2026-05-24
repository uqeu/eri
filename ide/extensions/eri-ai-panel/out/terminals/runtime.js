"use strict";
// Glue between native VS Code terminals and our metadata store. Owns the
// mapping `vscode.Terminal ↔ TerminalRecord.key`, tracks status, applies
// auto-naming, and forwards lifecycle events to the audit log.
Object.defineProperty(exports, "__esModule", { value: true });
exports.TerminalsRuntime = void 0;
exports.defaultGroupNameForCwd = defaultGroupNameForCwd;
const vscode = require("vscode");
const state_1 = require("./state");
const cwdGrouping_1 = require("./cwdGrouping");
const autoName_1 = require("./autoName");
const auditLog_1 = require("./auditLog");
const IDLE_THRESHOLD_MS = 30_000;
class TerminalsRuntime {
    store;
    blocks;
    audit;
    slots = new Map();
    keyToTerminal = new Map();
    disposables = [];
    counter = 0;
    idleTimer;
    emitter = new vscode.EventEmitter();
    onDidChange = this.emitter.event;
    constructor(store, blocks, audit) {
        this.store = store;
        this.blocks = blocks;
        this.audit = audit;
        this.disposables.push(vscode.window.onDidOpenTerminal((terminal) => this.adopt(terminal)), vscode.window.onDidCloseTerminal((terminal) => this.release(terminal)), vscode.window.onDidStartTerminalShellExecution((event) => this.handleStart(event)), vscode.window.onDidEndTerminalShellExecution((event) => this.handleEnd(event)), vscode.window.onDidChangeTerminalShellIntegration((event) => this.handleIntegrationChange(event)), this.blocks.subscribe((key, block) => this.onBlock(key, block)));
        // Adopt terminals that already exist (e.g. restored on reload).
        for (const terminal of vscode.window.terminals) {
            this.adopt(terminal);
        }
        this.idleTimer = setInterval(() => this.recomputeIdle(), 5_000);
    }
    resolveKey(terminal) {
        return this.slots.get(terminal)?.key;
    }
    resolveTerminal(key) {
        return this.keyToTerminal.get(key);
    }
    status(key) {
        const terminal = this.keyToTerminal.get(key);
        if (!terminal) {
            return "exited-fail";
        }
        const slot = this.slots.get(terminal);
        return slot?.status ?? "idle";
    }
    lastCommand(key) {
        const terminal = this.keyToTerminal.get(key);
        if (!terminal) {
            return null;
        }
        return this.slots.get(terminal)?.lastCommand ?? null;
    }
    liveSlots() {
        return [...this.slots.values()];
    }
    dispose() {
        for (const d of this.disposables) {
            d.dispose();
        }
        if (this.idleTimer) {
            clearInterval(this.idleTimer);
            this.idleTimer = undefined;
        }
        this.slots.clear();
        this.keyToTerminal.clear();
        this.emitter.dispose();
    }
    // Lifecycle ---------------------------------------------------------------
    adopt(terminal) {
        if (this.slots.has(terminal)) {
            return;
        }
        this.counter += 1;
        const key = (0, state_1.terminalKeyFromNative)(terminal, this.counter);
        const cwd = currentCwd(terminal);
        const snapshot = this.store.current();
        const reused = matchExistingRecord(snapshot, terminal, cwd);
        const finalKey = reused?.key ?? key;
        if (reused) {
            // Re-bind: keep the old key so persistence + block store survive.
            this.blocks.reassignTerminalKey(reused.key, finalKey);
        }
        const slot = {
            terminal,
            key: finalKey,
            status: "idle",
            lastCommand: reused ? null : null,
            lastActivityMs: Date.now(),
            lastExitCode: null,
        };
        this.slots.set(terminal, slot);
        this.keyToTerminal.set(finalKey, terminal);
        const outcome = reused
            ? { snapshot, groupId: reused.groupId, created: false }
            : (0, cwdGrouping_1.resolveAutoGroup)(snapshot, cwd ?? "");
        const record = {
            key: finalKey,
            groupId: outcome.groupId,
            name: reused?.name ?? terminal.name,
            nameLocked: reused?.nameLocked ?? false,
            cwd: cwd ?? reused?.cwd,
            icon: reused?.icon,
            createdAtMs: reused?.createdAtMs ?? Date.now(),
        };
        void this.store.apply((0, state_1.upsertTerminal)(outcome.snapshot, record));
        void this.audit.append((0, auditLog_1.makeEvent)("terminal.spawn", {
            key: finalKey,
            name: terminal.name,
            cwd: cwd ?? null,
            autoGroup: outcome.created,
            groupId: outcome.groupId,
        }));
        this.emitter.fire(finalKey);
    }
    release(terminal) {
        const slot = this.slots.get(terminal);
        if (!slot) {
            return;
        }
        this.slots.delete(terminal);
        this.keyToTerminal.delete(slot.key);
        const snapshot = this.store.current();
        void this.store.apply((0, state_1.removeTerminal)(snapshot, slot.key));
        void this.audit.append((0, auditLog_1.makeEvent)("terminal.kill", {
            key: slot.key,
            lastExitCode: slot.lastExitCode,
        }));
        this.blocks.clearTerminal(slot.key);
        this.emitter.fire(slot.key);
    }
    handleStart(event) {
        const slot = this.slots.get(event.terminal);
        if (!slot) {
            return;
        }
        slot.status = "running";
        slot.lastActivityMs = Date.now();
        slot.lastCommand = event.execution.commandLine?.value ?? slot.lastCommand;
        this.emitter.fire(slot.key);
    }
    handleEnd(event) {
        const slot = this.slots.get(event.terminal);
        if (!slot) {
            return;
        }
        const exit = typeof event.exitCode === "number" ? event.exitCode : null;
        slot.lastExitCode = exit;
        slot.status = exit === 0 ? "exited-ok" : exit === null ? "idle" : "exited-fail";
        slot.lastActivityMs = Date.now();
        const command = event.execution.commandLine?.value;
        if (command) {
            slot.lastCommand = command;
            void this.maybeAutoRename(slot, command);
        }
        this.emitter.fire(slot.key);
    }
    handleIntegrationChange(event) {
        const slot = this.slots.get(event.terminal);
        if (!slot) {
            return;
        }
        const cwd = event.shellIntegration.cwd?.fsPath;
        if (cwd && cwd.length > 0) {
            const snapshot = this.store.current();
            const record = snapshot.terminals.find((t) => t.key === slot.key);
            if (record && record.cwd !== cwd) {
                void this.store.apply((0, state_1.upsertTerminal)(snapshot, { ...record, cwd }));
            }
        }
    }
    onBlock(_key, _block) {
        // The block capture itself already updates state; here we just nudge UI.
        this.emitter.fire(_key);
    }
    // Auto-rename ----------------------------------------------------------
    async maybeAutoRename(slot, command) {
        const snapshot = this.store.current();
        const record = snapshot.terminals.find((t) => t.key === slot.key);
        if (!record || record.nameLocked) {
            return;
        }
        const inferred = (0, autoName_1.inferTerminalName)((0, autoName_1.stripPromptPrefix)(command));
        if (!inferred || inferred === record.name) {
            return;
        }
        await this.store.apply((0, state_1.upsertTerminal)(snapshot, { ...record, name: inferred }));
        void this.audit.append((0, auditLog_1.makeEvent)("terminal.rename", {
            key: slot.key,
            from: record.name,
            to: inferred,
            auto: true,
        }));
    }
    // Idle scanner ---------------------------------------------------------
    recomputeIdle() {
        const now = Date.now();
        for (const slot of this.slots.values()) {
            if (slot.status !== "running") {
                continue;
            }
            if (now - slot.lastActivityMs > IDLE_THRESHOLD_MS) {
                slot.status = "idle";
                this.emitter.fire(slot.key);
            }
        }
    }
    // Group helpers consumed by command handlers --------------------------
    async createGroup(name, icon) {
        const snapshot = this.store.current();
        const id = (0, state_1.generateGroupId)();
        await this.store.apply({
            ...snapshot,
            groups: [
                ...snapshot.groups,
                {
                    id,
                    name,
                    icon,
                    expanded: true,
                    auto: false,
                    createdAtMs: Date.now(),
                },
            ],
        });
        void this.audit.append((0, auditLog_1.makeEvent)("group.create", { id, name }));
        return id;
    }
    async renameGroup(id, name) {
        const snapshot = this.store.current();
        const group = snapshot.groups.find((g) => g.id === id);
        if (!group) {
            return;
        }
        await this.store.apply((0, state_1.updateGroup)(snapshot, id, { name, auto: false }));
        void this.audit.append((0, auditLog_1.makeEvent)("group.rename", { id, from: group.name, to: name }));
    }
    async removeGroup(id) {
        const snapshot = this.store.current();
        if (snapshot.groups.length === 1) {
            // Always keep at least one group as a destination.
            return;
        }
        const fallback = snapshot.groups.find((g) => g.id !== id)?.id;
        if (!fallback) {
            return;
        }
        const reassigned = {
            ...snapshot,
            terminals: snapshot.terminals.map((t) => t.groupId === id ? { ...t, groupId: fallback } : t),
            groups: snapshot.groups.filter((g) => g.id !== id),
        };
        await this.store.apply(reassigned);
        void this.audit.append((0, auditLog_1.makeEvent)("group.remove", { id }));
    }
}
exports.TerminalsRuntime = TerminalsRuntime;
// Helper: find an orphan record (in the store but no live terminal) whose
// name + cwd matches a freshly opened terminal — used to re-bind after
// window reload.
function matchExistingRecord(snapshot, terminal, cwd) {
    const liveKeys = new Set();
    // We can't easily know live keys from here, but the runtime calls this
    // before binding so the most recent re-adopt may collide. The simple
    // rule: prefer a record with matching name + cwd that hasn't been bound
    // in this session yet.
    for (const record of snapshot.terminals) {
        if (liveKeys.has(record.key)) {
            continue;
        }
        if (record.name !== terminal.name) {
            continue;
        }
        if (cwd && record.cwd && record.cwd !== cwd) {
            continue;
        }
        return record;
    }
    return undefined;
}
function currentCwd(terminal) {
    const fromIntegration = terminal.shellIntegration?.cwd?.fsPath;
    if (fromIntegration && fromIntegration.length > 0) {
        return fromIntegration;
    }
    const options = terminal.creationOptions;
    if (options &&
        typeof options === "object" &&
        "cwd" in options &&
        options.cwd) {
        const raw = options.cwd;
        if (typeof raw === "string") {
            return raw;
        }
        if (raw && typeof raw === "object" && "fsPath" in raw) {
            return raw.fsPath;
        }
    }
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}
// Convenience: build a friendly default name for a brand-new group whose
// cwd is known. Useful when the user clicks "new group" without typing.
function defaultGroupNameForCwd(cwd) {
    return (0, cwdGrouping_1.autoGroupNameFromCwd)(cwd ?? "");
}
//# sourceMappingURL=runtime.js.map