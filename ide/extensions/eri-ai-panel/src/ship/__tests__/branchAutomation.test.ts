// Tests for the slugifier used to derive a branch name from /ship
// instructions. The actual `git switch` call is integration-level and
// not exercised here.

import { branchName, slugifyInstructions } from "../branchAutomation";
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

console.log("branchAutomation.test.ts");

run("strips punctuation and lowercases", () => {
  assert.equal(slugifyInstructions("Add Stripe Checkout!"), "add-stripe-checkout");
  assert.equal(slugifyInstructions("Refactor src/auth/"), "refactor-srcauth");
  assert.equal(slugifyInstructions("FIX: typo in README"), "fix-typo-in-readme");
});

run("collapses whitespace and hyphens", () => {
  assert.equal(slugifyInstructions("a   b   c"), "a-b-c");
  assert.equal(slugifyInstructions("a---b"), "a-b");
  assert.equal(slugifyInstructions("- leading and trailing -"), "leading-and-trailing");
});

run("caps length at 50 characters", () => {
  const long = "a".repeat(120);
  assert.equal(slugifyInstructions(long).length, 50);
});

run("falls back to ship for empty / punctuation-only inputs", () => {
  assert.equal(slugifyInstructions(""), "ship");
  assert.equal(slugifyInstructions("   "), "ship");
  assert.equal(slugifyInstructions("!!! ???"), "ship");
});

run("branchName has expected shape", () => {
  const name = branchName("Add Stripe Checkout");
  assert.match(name, /^eri\/ship-add-stripe-checkout-[a-z0-9]{2,4}$/);
});

console.log("done.");
