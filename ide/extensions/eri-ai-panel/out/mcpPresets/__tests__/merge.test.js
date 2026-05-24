"use strict";
// Tests for the pure merge logic. No vscode dependency — runs under plain node.
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = require("node:assert");
const catalog_1 = require("../catalog");
const merge_1 = require("../merge");
function testInsertsNewServerIntoEmptyConfig() {
    const preset = (0, catalog_1.getPreset)("filesystem");
    node_assert_1.strict.ok(preset);
    const input = {};
    const result = (0, merge_1.mergePreset)(input, preset, {
        plainEnv: {},
        workspaceFolder: "/tmp/work",
    });
    node_assert_1.strict.ok(result.mcpServers);
    const entry = result.mcpServers["filesystem"];
    node_assert_1.strict.ok(entry);
    node_assert_1.strict.equal(entry.command, "npx");
    node_assert_1.strict.deepEqual(entry.args, [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/tmp/work",
    ]);
    node_assert_1.strict.equal(entry.disabled, false);
}
function testPreservesUnrelatedServers() {
    const preset = (0, catalog_1.getPreset)("memory");
    node_assert_1.strict.ok(preset);
    const input = {
        mcpServers: {
            "custom-thing": {
                command: "python",
                args: ["-m", "my.server"],
                env: { SOME_FLAG: "1" },
                transport: "stdio",
                // user-added field we must not drop
                notes: "do not touch",
            },
        },
    };
    const result = (0, merge_1.mergePreset)(input, preset, {
        plainEnv: {},
        workspaceFolder: "/tmp/w",
    });
    node_assert_1.strict.ok(result.mcpServers);
    const custom = result.mcpServers["custom-thing"];
    node_assert_1.strict.ok(custom);
    node_assert_1.strict.equal(custom.command, "python");
    node_assert_1.strict.equal(custom["notes"], "do not touch");
    node_assert_1.strict.deepEqual(custom.env, { SOME_FLAG: "1" });
    node_assert_1.strict.ok(result.mcpServers["memory"]);
}
function testPreservesExtraFieldsOnSameServer() {
    const preset = (0, catalog_1.getPreset)("memory");
    node_assert_1.strict.ok(preset);
    const input = {
        mcpServers: {
            memory: {
                command: "old",
                args: [],
                env: {},
                transport: "stdio",
                metadata: { addedBy: "user" },
            },
        },
    };
    const result = (0, merge_1.mergePreset)(input, preset, {
        plainEnv: {},
        workspaceFolder: "/tmp",
    });
    const entry = result.mcpServers?.["memory"];
    node_assert_1.strict.ok(entry);
    node_assert_1.strict.equal(entry.command, "npx"); // overwritten
    node_assert_1.strict.deepEqual(entry["metadata"], { addedBy: "user" });
}
function testSecretEnvVarsBecomePlaceholdersNotPlaintext() {
    const preset = (0, catalog_1.getPreset)("github");
    node_assert_1.strict.ok(preset);
    const input = {};
    const result = (0, merge_1.mergePreset)(input, preset, {
        plainEnv: {},
        workspaceFolder: "/tmp",
    });
    const entry = result.mcpServers?.["github"];
    node_assert_1.strict.ok(entry);
    const env = entry.env;
    node_assert_1.strict.equal(env["GITHUB_PERSONAL_ACCESS_TOKEN"], "${secret:github/GITHUB_PERSONAL_ACCESS_TOKEN}");
    // Make absolutely sure no token leaked into args/command either.
    const serialized = JSON.stringify(entry);
    node_assert_1.strict.ok(!serialized.includes("ghp_"));
}
function testDoesNotMutateInput() {
    const preset = (0, catalog_1.getPreset)("time");
    node_assert_1.strict.ok(preset);
    const input = { mcpServers: { foo: { command: "echo" } } };
    const snapshot = JSON.stringify(input);
    (0, merge_1.mergePreset)(input, preset, { plainEnv: {}, workspaceFolder: "/tmp" });
    node_assert_1.strict.equal(JSON.stringify(input), snapshot);
}
function main() {
    testInsertsNewServerIntoEmptyConfig();
    testPreservesUnrelatedServers();
    testPreservesExtraFieldsOnSameServer();
    testSecretEnvVarsBecomePlaceholdersNotPlaintext();
    testDoesNotMutateInput();
    console.log("merge.test ok");
}
main();
//# sourceMappingURL=merge.test.js.map