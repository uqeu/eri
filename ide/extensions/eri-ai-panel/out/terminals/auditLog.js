"use strict";
// Local-only, append-only audit log. One JSON object per line. Never
// transmitted off-machine. Survives restart; safe under concurrent writes
// because we serialize through a per-process write queue.
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryAuditSink = exports.FileAuditSink = void 0;
exports.makeEvent = makeEvent;
const fs = require("node:fs/promises");
const path = require("node:path");
// JSONL writer with a single-flight queue. Safe under concurrent append
// because all writes are serialized through `queue`.
class FileAuditSink {
    filePath;
    queue = Promise.resolve();
    disposed = false;
    constructor(filePath) {
        this.filePath = filePath;
    }
    append(event) {
        if (this.disposed) {
            return Promise.resolve();
        }
        const line = `${JSON.stringify(event)}\n`;
        const next = this.queue.then(() => this.write(line)).catch(() => undefined);
        this.queue = next;
        return next;
    }
    async write(line) {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        await fs.appendFile(this.filePath, line, { encoding: "utf8" });
    }
    dispose() {
        this.disposed = true;
    }
}
exports.FileAuditSink = FileAuditSink;
// In-memory sink (tests / no-workspace fallback).
class MemoryAuditSink {
    events = [];
    append(event) {
        this.events.push(event);
        return Promise.resolve();
    }
    dispose() {
        this.events.length = 0;
    }
}
exports.MemoryAuditSink = MemoryAuditSink;
function makeEvent(kind, data) {
    return {
        kind,
        at: new Date().toISOString(),
        data,
    };
}
//# sourceMappingURL=auditLog.js.map