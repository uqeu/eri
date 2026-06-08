import { strict as assert } from "node:assert";
import {
  parse,
  signupSchema,
  loginSchema,
  turnRecordSchema,
} from "../validation";

// --- signup ---
assert.ok(parse(signupSchema, { email: "a@b.com", password: "12345678" }).ok);
assert.ok(!parse(signupSchema, { email: "notanemail", password: "12345678" }).ok);
assert.ok(!parse(signupSchema, { email: "a@b.com", password: "short" }).ok);
// .strict() rejects unknown keys (mass-assignment defense).
assert.ok(
  !parse(signupSchema, { email: "a@b.com", password: "12345678", is_admin: true }).ok,
  "unknown keys must be rejected",
);

// --- login ---
assert.ok(parse(loginSchema, { email: "a@b.com", password: "x" }).ok);
assert.ok(!parse(loginSchema, { email: "a@b.com" }).ok);

// --- turns/record ---
assert.ok(parse(turnRecordSchema, { kind: "voice" }).ok);
assert.ok(parse(turnRecordSchema, { kind: "cmdk", input_tokens: 5 }).ok);
assert.ok(!parse(turnRecordSchema, { kind: "bogus" }).ok, "bad kind rejected");
assert.ok(
  !parse(turnRecordSchema, { kind: "voice", input_tokens: -1 }).ok,
  "negative tokens rejected",
);
assert.ok(
  !parse(turnRecordSchema, { kind: "voice", surprise: 1 }).ok,
  "unknown keys rejected",
);

// parse() never throws on garbage.
assert.ok(!parse(signupSchema, null).ok);
assert.ok(!parse(signupSchema, "nope").ok);

// eslint-disable-next-line no-console
console.log("validation.test.ts: all assertions passed");
