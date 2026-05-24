"use strict";
// Tests for inferTerminalName — the first-command → name heuristic.
// Run via `node out/terminals/__tests__/autoName.test.js` after `npm run compile`.
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = require("node:assert");
const autoName_1 = require("../autoName");
function testFriendlyNpmDev() {
    node_assert_1.strict.equal((0, autoName_1.inferTerminalName)("npm run dev"), "dev server");
    node_assert_1.strict.equal((0, autoName_1.inferTerminalName)("npm run dev --watch"), "dev server");
    node_assert_1.strict.equal((0, autoName_1.inferTerminalName)("pnpm run dev"), "dev server");
}
function testFriendlyCargo() {
    node_assert_1.strict.equal((0, autoName_1.inferTerminalName)("cargo run"), "cargo run");
    node_assert_1.strict.equal((0, autoName_1.inferTerminalName)("cargo test --release -p foo"), "cargo test");
}
function testTrivialCommandsReturnNull() {
    node_assert_1.strict.equal((0, autoName_1.inferTerminalName)("cd foo/bar"), null);
    node_assert_1.strict.equal((0, autoName_1.inferTerminalName)("clear"), null);
    node_assert_1.strict.equal((0, autoName_1.inferTerminalName)("ls"), null);
    node_assert_1.strict.equal((0, autoName_1.inferTerminalName)(""), null);
    node_assert_1.strict.equal((0, autoName_1.inferTerminalName)("   "), null);
}
function testFallbackTwoTokens() {
    const result = (0, autoName_1.inferTerminalName)("rg --hidden 'something'");
    node_assert_1.strict.equal(result, "rg --hidden …");
}
function testTruncationAt24() {
    const long = (0, autoName_1.inferTerminalName)("npx some-very-long-package-name --flag");
    node_assert_1.strict.ok(long);
    node_assert_1.strict.ok(long.length <= 24, `length should be <=24, got ${long.length}`);
}
function testPsqlAlias() {
    node_assert_1.strict.equal((0, autoName_1.inferTerminalName)("psql my_db"), "psql");
}
function testStripPromptPrefix() {
    node_assert_1.strict.equal((0, autoName_1.stripPromptPrefix)("$ npm run dev"), "npm run dev");
    node_assert_1.strict.equal((0, autoName_1.stripPromptPrefix)("  > cargo test"), "cargo test");
    node_assert_1.strict.equal((0, autoName_1.stripPromptPrefix)("npm run dev"), "npm run dev");
}
function main() {
    testFriendlyNpmDev();
    testFriendlyCargo();
    testTrivialCommandsReturnNull();
    testFallbackTwoTokens();
    testTruncationAt24();
    testPsqlAlias();
    testStripPromptPrefix();
    console.log("autoName tests: ok");
}
main();
//# sourceMappingURL=autoName.test.js.map