import { strict as assert } from "node:assert";
import { canonicalizeEmail } from "../email-normalize";

// Plus-addressing all collapses to one identity -> no free-account farming.
assert.equal(canonicalizeEmail("a+1@x.com"), "a@x.com");
assert.equal(canonicalizeEmail("a+anything+more@x.com"), "a@x.com");
assert.equal(canonicalizeEmail("Person+Tag@Gmail.com"), "person@gmail.com");

// No plus tag -> unchanged (besides lowercase/trim).
assert.equal(canonicalizeEmail("  Bob@Example.com "), "bob@example.com");

// Dots are NOT stripped (provider-specific; avoid false collisions).
assert.equal(canonicalizeEmail("a.b@x.com"), "a.b@x.com");

// Malformed input doesn't throw.
assert.equal(canonicalizeEmail("notanemail"), "notanemail");
assert.equal(canonicalizeEmail("@x.com"), "@x.com");

// eslint-disable-next-line no-console
console.log("email-normalize.test.ts: all assertions passed");
