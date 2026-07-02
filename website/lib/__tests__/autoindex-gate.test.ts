import { strict as assert } from "node:assert";
import { autoIndexAllowedWith } from "../connections/autoindex_gate";

// Flag ON → everyone allowed (full rollout).
assert.equal(autoIndexAllowedWith("usr_x", "a@b.com", { enabled: true, allowlist: [] }), true);

// Flag OFF + empty allowlist → FAIL-CLOSED (nobody indexed).
assert.equal(autoIndexAllowedWith("usr_x", "a@b.com", { enabled: false, allowlist: [] }), false);

// Flag OFF + allowlisted by user id → allowed (the test-user carve-out).
assert.equal(autoIndexAllowedWith("usr_118", "a@b.com", { enabled: false, allowlist: ["usr_118"] }), true);

// Flag OFF + allowlisted by email, case-insensitive.
assert.equal(autoIndexAllowedWith("usr_x", "Bell@Kaizen.com", { enabled: false, allowlist: ["bell@kaizen.com"] }), true);

// Flag OFF + NOT in allowlist → blocked (a stranger's inbox stays un-indexed).
assert.equal(autoIndexAllowedWith("usr_y", "y@b.com", { enabled: false, allowlist: ["usr_118"] }), false);

// Null email + not allowlisted → blocked, no crash.
assert.equal(autoIndexAllowedWith("usr_y", null, { enabled: false, allowlist: ["usr_118"] }), false);

// eslint-disable-next-line no-console
console.log("autoindex-gate.test.ts: all assertions passed");
