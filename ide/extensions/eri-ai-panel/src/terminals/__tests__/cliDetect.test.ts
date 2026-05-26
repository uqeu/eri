// Tests for the CLI-binary detection used by the terminal runtime to
// surface "Claude Code is running here" glyphs and to let the agent
// router pipe prompts into an already-running CLI.

import { detectCli } from "../cliDetect";
import * as assert from "node:assert/strict";

function run(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    console.error(`  fail ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log("cliDetect.test.ts");

run("detects bare invocations", () => {
  assert.equal(detectCli("claude"), "claude");
  assert.equal(detectCli("codex"), "codex");
  assert.equal(detectCli("aider"), "aider");
});

run("strips paths", () => {
  assert.equal(detectCli("/usr/local/bin/claude --workspace ."), "claude");
  assert.equal(detectCli("~/.local/bin/codex"), "codex");
  assert.equal(detectCli("./node_modules/.bin/aider --no-pretty"), "aider");
});

run("strips quotes", () => {
  assert.equal(detectCli('"claude" --workspace .'), "claude");
  assert.equal(detectCli("'codex' --json"), "codex");
});

run("ignores common wrappers", () => {
  assert.equal(detectCli("npx claude --workspace ."), "claude");
  assert.equal(detectCli("pnpm dlx codex"), "codex");
  assert.equal(detectCli("uv run aider"), "aider");
  assert.equal(detectCli("python -m aider"), "aider");
  assert.equal(detectCli("sudo env CLI=1 claude"), "claude");
});

run("returns null for non-matching commands", () => {
  assert.equal(detectCli("ls -la"), null);
  assert.equal(detectCli("git status"), null);
  assert.equal(detectCli(""), null);
  assert.equal(detectCli(null), null);
  assert.equal(detectCli(undefined), null);
});

run("doesn't match arbitrary substrings", () => {
  assert.equal(detectCli("my-claude-helper"), null);
  assert.equal(detectCli("aider-config"), null);
  assert.equal(detectCli("codexer"), null);
});

run("handles aliases", () => {
  assert.equal(detectCli("claude-code"), "claude");
  assert.equal(detectCli("openai-codex --workspace ."), "codex");
});

run("strips common script extensions", () => {
  assert.equal(detectCli("claude.js --foo"), "claude");
  assert.equal(detectCli("/usr/local/bin/aider.py"), "aider");
});

console.log("done.");
