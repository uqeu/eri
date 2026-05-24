// Tests for the pure merge logic. No vscode dependency — runs under plain node.

import { strict as assert } from "node:assert";
import { getPreset } from "../catalog";
import { mergePreset, RawConfigRoot } from "../merge";

function testInsertsNewServerIntoEmptyConfig(): void {
  const preset = getPreset("filesystem");
  assert.ok(preset);
  const input: RawConfigRoot = {};
  const result = mergePreset(input, preset, {
    plainEnv: {},
    workspaceFolder: "/tmp/work",
  });
  assert.ok(result.mcpServers);
  const entry = result.mcpServers["filesystem"];
  assert.ok(entry);
  assert.equal(entry.command, "npx");
  assert.deepEqual(entry.args, [
    "-y",
    "@modelcontextprotocol/server-filesystem",
    "/tmp/work",
  ]);
  assert.equal(entry.disabled, false);
}

function testPreservesUnrelatedServers(): void {
  const preset = getPreset("memory");
  assert.ok(preset);
  const input: RawConfigRoot = {
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
  const result = mergePreset(input, preset, {
    plainEnv: {},
    workspaceFolder: "/tmp/w",
  });
  assert.ok(result.mcpServers);
  const custom = result.mcpServers["custom-thing"];
  assert.ok(custom);
  assert.equal(custom.command, "python");
  assert.equal((custom as Record<string, unknown>)["notes"], "do not touch");
  assert.deepEqual(custom.env, { SOME_FLAG: "1" });
  assert.ok(result.mcpServers["memory"]);
}

function testPreservesExtraFieldsOnSameServer(): void {
  const preset = getPreset("memory");
  assert.ok(preset);
  const input: RawConfigRoot = {
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
  const result = mergePreset(input, preset, {
    plainEnv: {},
    workspaceFolder: "/tmp",
  });
  const entry = result.mcpServers?.["memory"];
  assert.ok(entry);
  assert.equal(entry.command, "npx"); // overwritten
  assert.deepEqual(
    (entry as Record<string, unknown>)["metadata"],
    { addedBy: "user" },
  );
}

function testSecretEnvVarsBecomePlaceholdersNotPlaintext(): void {
  const preset = getPreset("github");
  assert.ok(preset);
  const input: RawConfigRoot = {};
  const result = mergePreset(input, preset, {
    plainEnv: {},
    workspaceFolder: "/tmp",
  });
  const entry = result.mcpServers?.["github"];
  assert.ok(entry);
  const env = entry.env as Record<string, string>;
  assert.equal(
    env["GITHUB_PERSONAL_ACCESS_TOKEN"],
    "${secret:github/GITHUB_PERSONAL_ACCESS_TOKEN}",
  );
  // Make absolutely sure no token leaked into args/command either.
  const serialized = JSON.stringify(entry);
  assert.ok(!serialized.includes("ghp_"));
}

function testDoesNotMutateInput(): void {
  const preset = getPreset("time");
  assert.ok(preset);
  const input: RawConfigRoot = { mcpServers: { foo: { command: "echo" } } };
  const snapshot = JSON.stringify(input);
  mergePreset(input, preset, { plainEnv: {}, workspaceFolder: "/tmp" });
  assert.equal(JSON.stringify(input), snapshot);
}

function main(): void {
  testInsertsNewServerIntoEmptyConfig();
  testPreservesUnrelatedServers();
  testPreservesExtraFieldsOnSameServer();
  testSecretEnvVarsBecomePlaceholdersNotPlaintext();
  testDoesNotMutateInput();
  console.log("merge.test ok");
}

main();
