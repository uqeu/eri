"use strict";
// Tests the audit log writer. Verifies each event produces exactly one
// JSONL line and that concurrent appends don't corrupt the file.
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = require("node:assert");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const auditLog_1 = require("../auditLog");
async function withTempDir(body) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eri-audit-"));
    try {
        return await body(dir);
    }
    finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
}
async function testOneLinePerEvent() {
    await withTempDir(async (dir) => {
        const file = path.join(dir, "audit.log");
        const sink = new auditLog_1.FileAuditSink(file);
        await sink.append((0, auditLog_1.makeEvent)("terminal.spawn", { key: "k1" }));
        await sink.append((0, auditLog_1.makeEvent)("terminal.kill", { key: "k1" }));
        sink.dispose();
        const text = await fs.readFile(file, "utf8");
        const lines = text.split("\n").filter((l) => l.length > 0);
        node_assert_1.strict.equal(lines.length, 2);
        const parsed1 = JSON.parse(lines[0]);
        node_assert_1.strict.equal(parsed1.kind, "terminal.spawn");
        node_assert_1.strict.equal(parsed1.data.key, "k1");
    });
}
async function testConcurrentAppendsAreSerialized() {
    await withTempDir(async (dir) => {
        const file = path.join(dir, "audit.log");
        const sink = new auditLog_1.FileAuditSink(file);
        const writes = [];
        for (let i = 0; i < 50; i += 1) {
            writes.push(sink.append((0, auditLog_1.makeEvent)("group.create", { id: `g${i}`, name: `group-${i}` })));
        }
        await Promise.all(writes);
        sink.dispose();
        const text = await fs.readFile(file, "utf8");
        const lines = text.split("\n").filter((l) => l.length > 0);
        node_assert_1.strict.equal(lines.length, 50);
        // Each line must be parseable JSON — proves no interleaving corruption.
        for (const line of lines) {
            const parsed = JSON.parse(line);
            node_assert_1.strict.equal(parsed.kind, "group.create");
            node_assert_1.strict.ok(typeof parsed.data.id === "string");
        }
    });
}
async function testMemorySinkRecordsAll() {
    const sink = new auditLog_1.MemoryAuditSink();
    await sink.append((0, auditLog_1.makeEvent)("block.captured", { blockId: "b1" }));
    await sink.append((0, auditLog_1.makeEvent)("block.sentToChat", { blockId: "b1" }));
    node_assert_1.strict.equal(sink.events.length, 2);
    node_assert_1.strict.equal(sink.events[0].kind, "block.captured");
}
async function testDisposeStopsAccepting() {
    await withTempDir(async (dir) => {
        const file = path.join(dir, "audit.log");
        const sink = new auditLog_1.FileAuditSink(file);
        sink.dispose();
        await sink.append((0, auditLog_1.makeEvent)("terminal.spawn", { key: "k" }));
        let exists = true;
        try {
            await fs.stat(file);
        }
        catch {
            exists = false;
        }
        node_assert_1.strict.equal(exists, false);
    });
}
async function main() {
    await testOneLinePerEvent();
    await testConcurrentAppendsAreSerialized();
    await testMemorySinkRecordsAll();
    await testDisposeStopsAccepting();
    console.log("auditLog tests: ok");
}
void main().catch((error) => {
    console.error(error);
    process.exit(1);
});
//# sourceMappingURL=auditLog.test.js.map