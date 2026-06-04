import { strict as assert } from "node:assert";
import { creditCost, OUTPUT_WEIGHT, TIER_TOKEN_BUDGETS } from "../tiers";

// The no-loss meter: output is weighted 5x input (all Claude families price
// output at 5x). A credit's real cost is then bounded by Sonnet's $3/M
// regardless of in/out mix.
assert.equal(OUTPUT_WEIGHT, 5);

// Pure formula: in + 5*out.
assert.equal(creditCost(0, 0), 0);
assert.equal(creditCost(1000, 0), 1000); // input-only
assert.equal(creditCost(0, 1000), 5000); // output-only -> 5x
assert.equal(creditCost(2000, 10000), 52000); // the plan's worked example
assert.equal(creditCost(100, 100), 600);

// The old 1:1 bug would have deducted in+out (12000) for the worked example;
// the weighted meter deducts 52000. Guard the regression explicitly.
assert.notEqual(creditCost(2000, 10000), 2000 + 10000);

// Malformed usage reports can never refund credits or crash the deduction.
assert.equal(creditCost(-50, -50), 0);
assert.equal(creditCost(Number.NaN, 100), 500);
assert.equal(creditCost(100, Number.NaN), 100);
assert.equal(creditCost(Number.POSITIVE_INFINITY, 100), 500);

// Worst-case Sonnet COGS per tier stays margin-positive: included credits x
// $3/M. These are the numbers documented in tiers.ts / arch doc 6b.
const sonnetPerCredit = 3 / 1_000_000; // $/credit at Sonnet input rate
const maxCost = (tier: keyof typeof TIER_TOKEN_BUDGETS): number =>
  TIER_TOKEN_BUDGETS[tier].included * sonnetPerCredit;
assert.equal(Math.round(maxCost("Pro+") * 100) / 100, 12); // $12
assert.equal(Math.round(maxCost("Teams") * 100) / 100, 9); // $9
assert.equal(Math.round(maxCost("Pro") * 100) / 100, 2.25); // $2.25
assert.equal(Math.round(maxCost("Starter") * 100) / 100, 0.6); // $0.60

// eslint-disable-next-line no-console
console.log("credits.test.ts: all assertions passed");
