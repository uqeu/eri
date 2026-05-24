"use strict";
// Tests for the file-touching parts of the installer that don't require the
// vscode module. We stub the config path resolver via the same JSON shape the
// installer writes, then exercise readMcpConfig against missing/malformed
// files.
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = require("node:assert");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const configFile_1 = require("../configFile");
async function withTempDir(body) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eri-mcp-presets-"));
    try {
        return await body(dir);
    }
    finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
}
async function testMissingFileReturnsEmptyConfig() {
    await withTempDir(async (dir) => {
        const target = path.join(dir, "does-not-exist.json");
        const result = await (0, configFile_1.readMcpConfig)(target);
        node_assert_1.strict.deepEqual(result, { mcpServers: {} });
    });
}
async function testReadsExistingConfig() {
    await withTempDir(async (dir) => {
        const target = path.join(dir, "mcp.json");
        const payload = {
            mcpServers: {
                existing: { command: "echo", args: ["hi"] },
            },
            customRoot: "preserved",
        };
        await fs.writeFile(target, JSON.stringify(payload), "utf8");
        const result = await (0, configFile_1.readMcpConfig)(target);
        node_assert_1.strict.equal(result.mcpServers?.["existing"]?.command, "echo");
        node_assert_1.strict.equal(result["customRoot"], "preserved");
    });
}
async function testWriteThenReadRoundtripsExtras() {
    await withTempDir(async (dir) => {
        const target = path.join(dir, "nested", "mcp.json");
        await (0, configFile_1.writeMcpConfig)(target, {
            mcpServers: {
                a: { command: "x", args: [], env: {}, transport: "stdio" },
            },
            extra: "kept",
        });
        const round = await (0, configFile_1.readMcpConfig)(target);
        node_assert_1.strict.equal(round["extra"], "kept");
        node_assert_1.strict.equal(round.mcpServers?.["a"]?.command, "x");
    });
}
async function testMalformedJsonPropagatesError() {
    await withTempDir(async (dir) => {
        const target = path.join(dir, "mcp.json");
        await fs.writeFile(target, "{ not valid json", "utf8");
        let threw = false;
        try {
            await (0, configFile_1.readMcpConfig)(target);
        }
        catch {
            threw = true;
        }
        node_assert_1.strict.equal(threw, true, "malformed JSON should throw");
    });
}
async function main() {
    await testMissingFileReturnsEmptyConfig();
    await testReadsExistingConfig();
    await testWriteThenReadRoundtripsExtras();
    await testMalformedJsonPropagatesError();
    console.log("installer.test ok");
}
void main().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=installer.test.js.map