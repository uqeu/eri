import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { TIER_TOKEN_BUDGETS, type TierName } from "../tiers";

// tiers.json (repo root) is the SINGLE SOURCE OF TRUTH for per-tier numbers,
// shared with the Rust window_for() and scripts/pricing_model.py. This test
// fails if tiers.ts drifts from it — the drift a passing unit test in another
// language can't catch.
const json = JSON.parse(
  readFileSync(new URL("../../../tiers.json", import.meta.url), "utf8"),
) as {
  tiers: Array<{
    name: string;
    creditsIncluded: number;
    creditsGhost: number;
  }>;
};

for (const t of json.tiers) {
  const name = t.name as TierName;
  const budget = TIER_TOKEN_BUDGETS[name];
  assert.ok(budget, `tiers.ts is missing a budget for ${name}`);
  assert.equal(
    budget.included,
    t.creditsIncluded,
    `${name} included credits drifted from tiers.json`,
  );
  assert.equal(
    budget.ghost,
    t.creditsGhost,
    `${name} ghost credits drifted from tiers.json`,
  );
}

// No EXTRA tiers in tiers.ts beyond tiers.json (catches a stray re-added Teams).
assert.equal(
  Object.keys(TIER_TOKEN_BUDGETS).length,
  json.tiers.length,
  "tiers.ts and tiers.json disagree on the set of tiers",
);

// eslint-disable-next-line no-console
console.log("tiers-json.test.ts: tiers.ts matches tiers.json");
