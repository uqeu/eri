// Tests for inferTerminalName — the first-command → name heuristic.
// Run via `node out/terminals/__tests__/autoName.test.js` after `npm run compile`.

import { strict as assert } from "node:assert";
import { inferTerminalName, stripPromptPrefix } from "../autoName";

function testFriendlyNpmDev(): void {
  assert.equal(inferTerminalName("npm run dev"), "dev server");
  assert.equal(inferTerminalName("npm run dev --watch"), "dev server");
  assert.equal(inferTerminalName("pnpm run dev"), "dev server");
}

function testFriendlyCargo(): void {
  assert.equal(inferTerminalName("cargo run"), "cargo run");
  assert.equal(
    inferTerminalName("cargo test --release -p foo"),
    "cargo test",
  );
}

function testTrivialCommandsReturnNull(): void {
  assert.equal(inferTerminalName("cd foo/bar"), null);
  assert.equal(inferTerminalName("clear"), null);
  assert.equal(inferTerminalName("ls"), null);
  assert.equal(inferTerminalName(""), null);
  assert.equal(inferTerminalName("   "), null);
}

function testFallbackTwoTokens(): void {
  const result = inferTerminalName("rg --hidden 'something'");
  assert.equal(result, "rg --hidden …");
}

function testTruncationAt24(): void {
  const long = inferTerminalName("npx some-very-long-package-name --flag");
  assert.ok(long);
  assert.ok(long.length <= 24, `length should be <=24, got ${long.length}`);
}

function testPsqlAlias(): void {
  assert.equal(inferTerminalName("psql my_db"), "psql");
}

function testStripPromptPrefix(): void {
  assert.equal(stripPromptPrefix("$ npm run dev"), "npm run dev");
  assert.equal(stripPromptPrefix("  > cargo test"), "cargo test");
  assert.equal(stripPromptPrefix("npm run dev"), "npm run dev");
}

function main(): void {
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
