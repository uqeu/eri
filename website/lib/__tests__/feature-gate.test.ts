import { strict as assert } from "node:assert";
import { isFeatureAllowed } from "../features";
import { featureLocked } from "../feature_gate";

// Free is strictly local-only: cloud sync is a paid feature, so a free account
// stores nothing in the cloud (1000s of free users cost ~nothing).
assert.equal(
  isFeatureAllowed("Free", "cloudSync"),
  false,
  "Free must not sync to the cloud",
);
assert.equal(featureLocked("free", "cloudSync"), true);

// Every paid tier syncs.
for (const tier of ["Starter", "Pro", "Pro+"] as const) {
  assert.equal(isFeatureAllowed(tier, "cloudSync"), true, `${tier} should sync`);
  assert.equal(featureLocked(tier.toLowerCase(), "cloudSync"), false);
}

// Free still gets the table-stakes LOCAL features (it's usable, just local).
assert.equal(isFeatureAllowed("Free", "voice"), true);
assert.equal(isFeatureAllowed("Free", "diffusionPreview"), true);
assert.equal(isFeatureAllowed("Free", "gaze"), true);

// eslint-disable-next-line no-console
console.log("feature-gate.test.ts: Free is local-only; paid tiers sync");
