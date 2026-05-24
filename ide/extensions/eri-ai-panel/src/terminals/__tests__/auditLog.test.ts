// Tests the audit log writer. Verifies each event produces exactly one
// JSONL line and that concurrent appends don't corrupt the file.

import { strict as assert } from "node:assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { FileAuditSink, makeEvent, MemoryAuditSink } from "../auditLog";

async function withTempDir<T>(
  body: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eri-audit-"));
  try {
    return await body(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function testOneLinePerEvent(): Promise<void> {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "audit.log");
    const sink = new FileAuditSink(file);
    await sink.append(makeEvent("terminal.spawn", { key: "k1" }));
    await sink.append(makeEvent("terminal.kill", { key: "k1" }));
    sink.dispose();
    const text = await fs.readFile(file, "utf8");
    const lines = text.split("\n").filter((l) => l.length > 0);
    assert.equal(lines.length, 2);
    const parsed1 = JSON.parse(lines[0]);
    assert.equal(parsed1.kind, "terminal.spawn");
    assert.equal(parsed1.data.key, "k1");
  });
}

async function testConcurrentAppendsAreSerialized(): Promise<void> {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "audit.log");
    const sink = new FileAuditSink(file);
    const writes: Promise<void>[] = [];
    for (let i = 0; i < 50; i += 1) {
      writes.push(
        sink.append(
          makeEvent("group.create", { id: `g${i}`, name: `group-${i}` }),
        ),
      );
    }
    await Promise.all(writes);
    sink.dispose();
    const text = await fs.readFile(file, "utf8");
    const lines = text.split("\n").filter((l) => l.length > 0);
    assert.equal(lines.length, 50);
    // Each line must be parseable JSON — proves no interleaving corruption.
    for (const line of lines) {
      const parsed = JSON.parse(line);
      assert.equal(parsed.kind, "group.create");
      assert.ok(typeof parsed.data.id === "string");
    }
  });
}

async function testMemorySinkRecordsAll(): Promise<void> {
  const sink = new MemoryAuditSink();
  await sink.append(makeEvent("block.captured", { blockId: "b1" }));
  await sink.append(makeEvent("block.sentToChat", { blockId: "b1" }));
  assert.equal(sink.events.length, 2);
  assert.equal(sink.events[0].kind, "block.captured");
}

async function testDisposeStopsAccepting(): Promise<void> {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "audit.log");
    const sink = new FileAuditSink(file);
    sink.dispose();
    await sink.append(makeEvent("terminal.spawn", { key: "k" }));
    let exists = true;
    try {
      await fs.stat(file);
    } catch {
      exists = false;
    }
    assert.equal(exists, false);
  });
}

async function main(): Promise<void> {
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
