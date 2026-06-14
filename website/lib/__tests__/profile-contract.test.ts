import { strict as assert } from "node:assert";
import {
  MAX_DYNAMIC_BYTES,
  MAX_PROFILE_BYTES,
  parseProfileUpload,
} from "../memory/profile_contract";

// A valid profile + dynamic_context is accepted and canonically serialized.
{
  const r = parseProfileUpload({
    profile: { facts: ["name is Khai"], preferences: ["accepts 75% of edits"] },
    dynamic_context: "Today: shipped the overlay",
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.dynamicContext, "Today: shipped the overlay");
    assert.deepEqual(JSON.parse(r.profileJson), {
      facts: ["name is Khai"],
      preferences: ["accepts 75% of edits"],
    });
  }
}

// dynamic_context is optional — defaults to "" so a static-only push works.
{
  const r = parseProfileUpload({ profile: { facts: [] } });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.dynamicContext, "");
}

// Non-object / array / missing profile is rejected (it must be the Profile object).
for (const bad of [undefined, null, "str", 7, [], { profile: [1, 2] }, { profile: "x" }]) {
  const r = parseProfileUpload(bad);
  assert.equal(r.ok, false, `should reject ${JSON.stringify(bad)}`);
}

// dynamic_context of the wrong type is rejected.
{
  const r = parseProfileUpload({ profile: {}, dynamic_context: 123 });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error, "invalid_dynamic_context");
}

// Oversize payloads are rejected (anti-bloat — the projection stays small).
{
  const huge = parseProfileUpload({ profile: { blob: "x".repeat(MAX_PROFILE_BYTES + 1) } });
  assert.equal(huge.ok, false);
  if (!huge.ok) assert.equal(huge.error, "profile_too_large");

  const hugeDyn = parseProfileUpload({
    profile: {},
    dynamic_context: "x".repeat(MAX_DYNAMIC_BYTES + 1),
  });
  assert.equal(hugeDyn.ok, false);
  if (!hugeDyn.ok) assert.equal(hugeDyn.error, "dynamic_context_too_large");
}

// eslint-disable-next-line no-console
console.log("profile-contract.test.ts: all assertions passed");
