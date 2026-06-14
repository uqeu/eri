import { strict as assert } from "node:assert";
import { extractPairingCode, normalizeE164 } from "../imessage/identity";

// E.164 normalization: accept clean + punctuated, reject junk.
{
  assert.equal(normalizeE164("+16475497552"), "+16475497552");
  assert.equal(normalizeE164(" +1 (647) 549-7552 "), "+16475497552");
  assert.equal(normalizeE164("6475497552"), null, "missing + is rejected");
  assert.equal(normalizeE164("+0123"), null, "leading 0 after + is invalid");
  assert.equal(normalizeE164("not a phone"), null);
  // @ts-expect-error — non-string input must be handled, not throw
  assert.equal(normalizeE164(null), null);
}

// Pairing-code extraction: bare code, `pair ` prefix, case-insensitive; else null.
{
  assert.equal(extractPairingCode("ABC123"), "ABC123");
  assert.equal(extractPairingCode("  abc123 "), "ABC123");
  assert.equal(extractPairingCode("pair zk7q2m"), "ZK7Q2M");
  assert.equal(extractPairingCode("hey what's up?"), null, "a real message is not a code");
  assert.equal(extractPairingCode("PAIR"), null, "too short to be a code");
}

// eslint-disable-next-line no-console
console.log("imessage-identity.test.ts: all assertions passed");
