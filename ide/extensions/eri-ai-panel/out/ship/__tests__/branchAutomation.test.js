"use strict";
// Tests for the slugifier used to derive a branch name from /ship
// instructions. The actual `git switch` call is integration-level and
// not exercised here.
Object.defineProperty(exports, "__esModule", { value: true });
const branchAutomation_1 = require("../branchAutomation");
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
console.log("branchAutomation.test.ts");
run("strips punctuation and lowercases", () => {
    assert.equal((0, branchAutomation_1.slugifyInstructions)("Add Stripe Checkout!"), "add-stripe-checkout");
    assert.equal((0, branchAutomation_1.slugifyInstructions)("Refactor src/auth/"), "refactor-srcauth");
    assert.equal((0, branchAutomation_1.slugifyInstructions)("FIX: typo in README"), "fix-typo-in-readme");
});
run("collapses whitespace and hyphens", () => {
    assert.equal((0, branchAutomation_1.slugifyInstructions)("a   b   c"), "a-b-c");
    assert.equal((0, branchAutomation_1.slugifyInstructions)("a---b"), "a-b");
    assert.equal((0, branchAutomation_1.slugifyInstructions)("- leading and trailing -"), "leading-and-trailing");
});
run("caps length at 50 characters", () => {
    const long = "a".repeat(120);
    assert.equal((0, branchAutomation_1.slugifyInstructions)(long).length, 50);
});
run("falls back to ship for empty / punctuation-only inputs", () => {
    assert.equal((0, branchAutomation_1.slugifyInstructions)(""), "ship");
    assert.equal((0, branchAutomation_1.slugifyInstructions)("   "), "ship");
    assert.equal((0, branchAutomation_1.slugifyInstructions)("!!! ???"), "ship");
});
run("branchName has expected shape", () => {
    const name = (0, branchAutomation_1.branchName)("Add Stripe Checkout");
    assert.match(name, /^eri\/ship-add-stripe-checkout-[a-z0-9]{2,4}$/);
});
console.log("done.");
//# sourceMappingURL=branchAutomation.test.js.map