"use strict";
// Warp-style "block" capture: each completed shell command becomes an
// addressable record with its command line, output, exit code, duration.
//
// Requires VS Code shell integration (1.85+). When unavailable, the
// capture is silently a no-op — the rest of the module still works.
Object.defineProperty(exports, "__esModule", { value: true });
exports.BlockCapture = exports.BlockStore = void 0;
exports.stripAnsi = stripAnsi;
const vscode = require("vscode");
const auditLog_1 = require("./auditLog");
const MAX_BLOCKS_IN_MEMORY = 200;
const MAX_BLOCKS_PERSISTED = 50;
const MAX_OUTPUT_BYTES_PER_TERMINAL = 200 * 1024;
const STORAGE_KEY = "eri.terminals.blocks";
class BlockStore {
    memento;
    perTerminal = new Map();
    subscribers = new Set();
    emitter = new vscode.EventEmitter();
    onDidChange = this.emitter.event;
    constructor(memento) {
        this.memento = memento;
        this.restore();
    }
    list(terminalKey, limit = 30) {
        const blocks = this.perTerminal.get(terminalKey) ?? [];
        return blocks.slice(-limit).reverse();
    }
    allTerminals() {
        return [...this.perTerminal.keys()];
    }
    // Returns the latest block list across all terminals, newest first.
    flatten(limit = 200) {
        const all = [];
        for (const list of this.perTerminal.values()) {
            all.push(...list);
        }
        all.sort((a, b) => b.endedAtMs - a.endedAtMs);
        return all.slice(0, limit);
    }
    subscribe(handler) {
        this.subscribers.add(handler);
        return { dispose: () => this.subscribers.delete(handler) };
    }
    push(terminalKey, block) {
        const current = this.perTerminal.get(terminalKey) ?? [];
        const next = [...current, block];
        while (next.length > MAX_BLOCKS_IN_MEMORY) {
            next.shift();
        }
        // Trim by total output bytes (oldest first).
        let totalBytes = next.reduce((sum, b) => sum + Buffer.byteLength(b.output, "utf8"), 0);
        while (next.length > 1 && totalBytes > MAX_OUTPUT_BYTES_PER_TERMINAL) {
            const dropped = next.shift();
            if (dropped) {
                totalBytes -= Buffer.byteLength(dropped.output, "utf8");
            }
        }
        this.perTerminal.set(terminalKey, next);
        void this.persist();
        this.emitter.fire(terminalKey);
        for (const sub of this.subscribers) {
            try {
                sub(terminalKey, block);
            }
            catch {
                // Subscriber errors must not break the store.
            }
        }
    }
    reassignTerminalKey(oldKey, newKey) {
        if (oldKey === newKey) {
            return;
        }
        const blocks = this.perTerminal.get(oldKey);
        if (!blocks) {
            return;
        }
        this.perTerminal.delete(oldKey);
        this.perTerminal.set(newKey, blocks.map((b) => ({ ...b, terminalKey: newKey })));
        void this.persist();
    }
    clearTerminal(terminalKey) {
        this.perTerminal.delete(terminalKey);
        void this.persist();
        this.emitter.fire(terminalKey);
    }
    dispose() {
        this.subscribers.clear();
        this.emitter.dispose();
    }
    restore() {
        const raw = this.memento.get(STORAGE_KEY);
        if (!raw || typeof raw !== "object" || !raw.perTerminal) {
            return;
        }
        for (const [key, list] of Object.entries(raw.perTerminal)) {
            if (Array.isArray(list)) {
                this.perTerminal.set(key, list.filter((b) => isValidBlock(b)));
            }
        }
    }
    async persist() {
        const trimmed = {};
        for (const [key, list] of this.perTerminal) {
            trimmed[key] = list.slice(-MAX_BLOCKS_PERSISTED);
        }
        const stored = { version: 1, perTerminal: trimmed };
        await this.memento.update(STORAGE_KEY, stored);
    }
}
exports.BlockStore = BlockStore;
function isValidBlock(value) {
    if (!value || typeof value !== "object") {
        return false;
    }
    const candidate = value;
    return (typeof candidate.id === "string" &&
        typeof candidate.terminalKey === "string" &&
        typeof candidate.command === "string" &&
        typeof candidate.output === "string");
}
// Wires shell integration to push blocks into the store.
class BlockCapture {
    store;
    resolveKey;
    audit;
    disposables = [];
    constructor(store, resolveKey, audit) {
        this.store = store;
        this.resolveKey = resolveKey;
        this.audit = audit;
        this.disposables.push(vscode.window.onDidStartTerminalShellExecution((event) => this.handleStart(event)), vscode.window.onDidEndTerminalShellExecution((event) => this.handleEnd(event)));
    }
    inflight = new Map();
    handleStart(event) {
        const buffer = {
            startedAtMs: Date.now(),
            output: "",
        };
        this.inflight.set(event.terminal, buffer);
        void this.consumeStream(event, buffer);
    }
    async consumeStream(event, buffer) {
        try {
            const stream = event.execution.read();
            for await (const chunk of stream) {
                buffer.output += stripAnsi(chunk);
                if (buffer.output.length > MAX_OUTPUT_BYTES_PER_TERMINAL) {
                    buffer.output =
                        buffer.output.slice(-MAX_OUTPUT_BYTES_PER_TERMINAL) +
                            "\n…(truncated)";
                }
            }
        }
        catch {
            // Stream interrupted — keep whatever output we already buffered.
        }
    }
    handleEnd(event) {
        const buffer = this.inflight.get(event.terminal);
        this.inflight.delete(event.terminal);
        const key = this.resolveKey(event.terminal);
        if (!key) {
            return;
        }
        const startedAtMs = buffer?.startedAtMs ?? Date.now();
        const endedAtMs = Date.now();
        const commandLine = event.execution.commandLine?.value ?? "";
        if (!commandLine) {
            return;
        }
        const block = {
            id: `b_${endedAtMs.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
            terminalKey: key,
            command: commandLine,
            output: buffer?.output ?? "",
            exitCode: typeof event.exitCode === "number" ? event.exitCode : null,
            startedAtMs,
            endedAtMs,
            durationMs: endedAtMs - startedAtMs,
        };
        this.store.push(key, block);
        void this.audit.append((0, auditLog_1.makeEvent)("block.captured", {
            terminal: key,
            command: commandLine,
            exitCode: block.exitCode,
            durationMs: block.durationMs,
        }));
    }
    dispose() {
        for (const d of this.disposables) {
            d.dispose();
        }
        this.inflight.clear();
    }
}
exports.BlockCapture = BlockCapture;
// Strip common ANSI escape sequences from terminal output.
function stripAnsi(input) {
    // eslint-disable-next-line no-control-regex
    return input.replace(/\[[0-9;?]*[ -/]*[@-~]/g, "");
}
//# sourceMappingURL=blocks.js.map