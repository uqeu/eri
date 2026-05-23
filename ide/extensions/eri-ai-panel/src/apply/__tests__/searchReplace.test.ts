// Lightweight unit tests for applySearchReplace.
// Runs without a test runner: `node out/apply/__tests__/searchReplace.test.js`.
// Uses node's built-in assert — no extra dev dependencies.

import { strict as assert } from "node:assert";
import { applySearchReplace } from "../searchReplace";

function testExactMatch(): void {
  const before = "const a = 1;\nconst b = 2;\nconst c = 3;\n";
  const outcome = applySearchReplace(before, "const b = 2;", "const b = 20;");
  assert.ok(outcome, "expected outcome for exact match");
  assert.equal(outcome.matchKind, "exact");
  assert.equal(outcome.after, "const a = 1;\nconst b = 20;\nconst c = 3;\n");
}

function testAmbiguousExactMatchReturnsNull(): void {
  const before = "x = 1\nfoo\nx = 1\n";
  const outcome = applySearchReplace(before, "x = 1", "x = 2");
  assert.equal(outcome, null, "ambiguous exact match must return null");
}

function testWhitespaceTolerantMatch(): void {
  const before = "function   greet(name)   {\n  return name;\n}\n";
  const outcome = applySearchReplace(
    before,
    "function greet(name) {",
    "function greet(name: string) {",
  );
  assert.ok(outcome, "expected outcome for whitespace-tolerant match");
  assert.equal(outcome.matchKind, "whitespace");
  assert.ok(
    outcome.after.includes("function greet(name: string) {"),
    "replacement must be in result",
  );
}

function testFuzzyMatchAppliesReplacement(): void {
  // Same logical content but whitespace differs — must still apply via the
  // whitespace-tolerant or trimmed-lines fallback.
  const before = "class A {\n    foo() {\n        return 1;\n    }\n}\n";
  const outcome = applySearchReplace(
    before,
    "foo() {\n    return 1;\n}",
    "foo() {\n    return 2;\n}",
  );
  assert.ok(outcome, "expected outcome for fuzzy match");
  assert.ok(
    outcome.matchKind === "whitespace" || outcome.matchKind === "trimmed",
    `expected fuzzy match kind, got ${outcome.matchKind}`,
  );
  assert.ok(outcome.after.includes("return 2;"), "replacement must contain new value");
}

function testEmptySearchReturnsNull(): void {
  const outcome = applySearchReplace("anything", "", "x");
  assert.equal(outcome, null);
}

function run(): void {
  testExactMatch();
  testAmbiguousExactMatchReturnsNull();
  testWhitespaceTolerantMatch();
  testFuzzyMatchAppliesReplacement();
  testEmptySearchReturnsNull();
  process.stdout.write("searchReplace.test.ts: 5 cases passed\n");
}

run();
