"use strict";
// Lightweight unit tests for applySearchReplace.
// Runs without a test runner: `node out/apply/__tests__/searchReplace.test.js`.
// Uses node's built-in assert — no extra dev dependencies.
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = require("node:assert");
const searchReplace_1 = require("../searchReplace");
function testExactMatch() {
    const before = "const a = 1;\nconst b = 2;\nconst c = 3;\n";
    const outcome = (0, searchReplace_1.applySearchReplace)(before, "const b = 2;", "const b = 20;");
    node_assert_1.strict.ok(outcome, "expected outcome for exact match");
    node_assert_1.strict.equal(outcome.matchKind, "exact");
    node_assert_1.strict.equal(outcome.after, "const a = 1;\nconst b = 20;\nconst c = 3;\n");
}
function testAmbiguousExactMatchReturnsNull() {
    const before = "x = 1\nfoo\nx = 1\n";
    const outcome = (0, searchReplace_1.applySearchReplace)(before, "x = 1", "x = 2");
    node_assert_1.strict.equal(outcome, null, "ambiguous exact match must return null");
}
function testWhitespaceTolerantMatch() {
    const before = "function   greet(name)   {\n  return name;\n}\n";
    const outcome = (0, searchReplace_1.applySearchReplace)(before, "function greet(name) {", "function greet(name: string) {");
    node_assert_1.strict.ok(outcome, "expected outcome for whitespace-tolerant match");
    node_assert_1.strict.equal(outcome.matchKind, "whitespace");
    node_assert_1.strict.ok(outcome.after.includes("function greet(name: string) {"), "replacement must be in result");
}
function testFuzzyMatchAppliesReplacement() {
    // Same logical content but whitespace differs — must still apply via the
    // whitespace-tolerant or trimmed-lines fallback.
    const before = "class A {\n    foo() {\n        return 1;\n    }\n}\n";
    const outcome = (0, searchReplace_1.applySearchReplace)(before, "foo() {\n    return 1;\n}", "foo() {\n    return 2;\n}");
    node_assert_1.strict.ok(outcome, "expected outcome for fuzzy match");
    node_assert_1.strict.ok(outcome.matchKind === "whitespace" || outcome.matchKind === "trimmed", `expected fuzzy match kind, got ${outcome.matchKind}`);
    node_assert_1.strict.ok(outcome.after.includes("return 2;"), "replacement must contain new value");
}
function testEmptySearchReturnsNull() {
    const outcome = (0, searchReplace_1.applySearchReplace)("anything", "", "x");
    node_assert_1.strict.equal(outcome, null);
}
function run() {
    testExactMatch();
    testAmbiguousExactMatchReturnsNull();
    testWhitespaceTolerantMatch();
    testFuzzyMatchAppliesReplacement();
    testEmptySearchReturnsNull();
    process.stdout.write("searchReplace.test.ts: 5 cases passed\n");
}
run();
//# sourceMappingURL=searchReplace.test.js.map