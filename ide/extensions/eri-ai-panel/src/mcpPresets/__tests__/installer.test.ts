// Tests for the file-touching parts of the installer that don't require the
// vscode module. We stub the config path resolver via the same JSON shape the
// installer writes, then exercise readMcpConfig against missing/malformed
// files.

import { strict as assert } from "node:assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { readMcpConfig, writeMcpConfig } from "../configFile";

async function withTempDir<T>(body: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eri-mcp-presets-"));
  try {
    return await body(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function testMissingFileReturnsEmptyConfig(): Promise<void> {
  await withTempDir(async (dir) => {
    const target = path.join(dir, "does-not-exist.json");
    const result = await readMcpConfig(target);
    assert.deepEqual(result, { mcpServers: {} });
  });
}

async function testReadsExistingConfig(): Promise<void> {
  await withTempDir(async (dir) => {
    const target = path.join(dir, "mcp.json");
    const payload = {
      mcpServers: {
        existing: { command: "echo", args: ["hi"] },
      },
      customRoot: "preserved",
    };
    await fs.writeFile(target, JSON.stringify(payload), "utf8");
    const result = await readMcpConfig(target);
    assert.equal(result.mcpServers?.["existing"]?.command, "echo");
    assert.equal((result as Record<string, unknown>)["customRoot"], "preserved");
  });
}

async function testWriteThenReadRoundtripsExtras(): Promise<void> {
  await withTempDir(async (dir) => {
    const target = path.join(dir, "nested", "mcp.json");
    await writeMcpConfig(target, {
      mcpServers: {
        a: { command: "x", args: [], env: {}, transport: "stdio" },
      },
      extra: "kept",
    });
    const round = await readMcpConfig(target);
    assert.equal((round as Record<string, unknown>)["extra"], "kept");
    assert.equal(round.mcpServers?.["a"]?.command, "x");
  });
}

async function testMalformedJsonPropagatesError(): Promise<void> {
  await withTempDir(async (dir) => {
    const target = path.join(dir, "mcp.json");
    await fs.writeFile(target, "{ not valid json", "utf8");
    let threw = false;
    try {
      await readMcpConfig(target);
    } catch {
      threw = true;
    }
    assert.equal(threw, true, "malformed JSON should throw");
  });
}

async function main(): Promise<void> {
  await testMissingFileReturnsEmptyConfig();
  await testReadsExistingConfig();
  await testWriteThenReadRoundtripsExtras();
  await testMalformedJsonPropagatesError();
  console.log("installer.test ok");
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
