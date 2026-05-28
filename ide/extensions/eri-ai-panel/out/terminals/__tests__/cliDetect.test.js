"use strict";
// Tests for the CLI-binary detection used by the terminal runtime to
// surface "Claude Code is running here" glyphs and to let the agent
// router pipe prompts into an already-running CLI.
Object.defineProperty(exports, "__esModule", { value: true });
const cliDetect_1 = require("../cliDetect");
const assert = require("node:assert/strict");
function run(name, fn) {
    try {
        fn();
        console.log(`  ok   ${name}`);
    }
    catch (err) {
        console.error(`  fail ${name}`);
        console.error(err);
        process.exitCode = 1;
    }
}
console.log("cliDetect.test.ts");
run("detects bare invocations", () => {
    assert.equal((0, cliDetect_1.detectCli)("claude"), "claude");
    assert.equal((0, cliDetect_1.detectCli)("codex"), "codex");
    assert.equal((0, cliDetect_1.detectCli)("aider"), "aider");
});
run("strips paths", () => {
    assert.equal((0, cliDetect_1.detectCli)("/usr/local/bin/claude --workspace ."), "claude");
    assert.equal((0, cliDetect_1.detectCli)("~/.local/bin/codex"), "codex");
    assert.equal((0, cliDetect_1.detectCli)("./node_modules/.bin/aider --no-pretty"), "aider");
});
run("strips quotes", () => {
    assert.equal((0, cliDetect_1.detectCli)('"claude" --workspace .'), "claude");
    assert.equal((0, cliDetect_1.detectCli)("'codex' --json"), "codex");
});
run("ignores common wrappers", () => {
    assert.equal((0, cliDetect_1.detectCli)("npx claude --workspace ."), "claude");
    assert.equal((0, cliDetect_1.detectCli)("pnpm dlx codex"), "codex");
    assert.equal((0, cliDetect_1.detectCli)("uv run aider"), "aider");
    assert.equal((0, cliDetect_1.detectCli)("python -m aider"), "aider");
    assert.equal((0, cliDetect_1.detectCli)("sudo env CLI=1 claude"), "claude");
});
run("returns null for non-matching commands", () => {
    assert.equal((0, cliDetect_1.detectCli)("ls -la"), null);
    assert.equal((0, cliDetect_1.detectCli)("git status"), null);
    assert.equal((0, cliDetect_1.detectCli)(""), null);
    assert.equal((0, cliDetect_1.detectCli)(null), null);
    assert.equal((0, cliDetect_1.detectCli)(undefined), null);
});
run("doesn't match arbitrary substrings", () => {
    assert.equal((0, cliDetect_1.detectCli)("my-claude-helper"), null);
    assert.equal((0, cliDetect_1.detectCli)("aider-config"), null);
    assert.equal((0, cliDetect_1.detectCli)("codexer"), null);
});
run("handles aliases", () => {
    assert.equal((0, cliDetect_1.detectCli)("claude-code"), "claude");
    assert.equal((0, cliDetect_1.detectCli)("openai-codex --workspace ."), "codex");
});
run("strips common script extensions", () => {
    assert.equal((0, cliDetect_1.detectCli)("claude.js --foo"), "claude");
    assert.equal((0, cliDetect_1.detectCli)("/usr/local/bin/aider.py"), "aider");
});
console.log("done.");
//# sourceMappingURL=cliDetect.test.js.map