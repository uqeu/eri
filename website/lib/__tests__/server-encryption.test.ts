import { strict as assert } from "node:assert";
import { randomBytes } from "node:crypto";
import { open, seal, serverKey } from "../crypto/server_encryption";

// The Tier-A personalization profile is server-READABLE (phone eri injects it),
// but encrypted AT REST with K_server so a leaked DB dump reveals nothing
// without the application key. These tests pin that crypto contract.

const KEY = randomBytes(32);

// Roundtrip: seal then open returns the original plaintext.
{
  const blob = seal(KEY, "today: shipped the overlay");
  assert.notEqual(blob.toString("utf8"), "today: shipped the overlay", "must be ciphertext");
  assert.equal(open(KEY, blob), "today: shipped the overlay");
}

// Wrong key cannot decrypt — the at-rest guarantee (DB dump alone is useless).
{
  const blob = seal(KEY, "name is Khai");
  assert.throws(() => open(randomBytes(32), blob), "wrong K_server must fail");
}

// Tampering is detected (GCM authenticates).
{
  const blob = seal(KEY, "do not tamper");
  blob[blob.length - 1] ^= 0xff;
  assert.throws(() => open(KEY, blob), "tampered blob must fail");
}

// AAD binds ciphertext to a context (the user id) — wrong/absent aad fails.
{
  const aadA = Buffer.from("tier-a:userA");
  const aadB = Buffer.from("tier-a:userB");
  const blob = seal(KEY, "user A's profile", aadA);
  assert.equal(open(KEY, blob, aadA), "user A's profile");
  assert.throws(() => open(KEY, blob, aadB), "user B's aad must not decrypt A's blob");
  assert.throws(() => open(KEY, blob), "missing aad must fail when sealed with aad");
}

// Versioned blob: first byte is the version; an unknown version is rejected.
{
  const blob = seal(KEY, "v1 payload");
  assert.equal(blob[0], 0x01, "blob carries a version byte");
  const future = Buffer.from(blob);
  future[0] = 0x02;
  assert.throws(() => open(KEY, future), "unsupported version must be rejected");
}

// Fresh IV per call — identical plaintext must not produce identical blobs.
{
  const a = seal(KEY, "same");
  const b = seal(KEY, "same");
  assert.notEqual(a.toString("hex"), b.toString("hex"), "IV reuse would leak repetition");
}

// serverKey() reads + validates ERI_SERVER_ENCRYPTION_KEY (base64, 32 bytes).
{
  const prev = process.env.ERI_SERVER_ENCRYPTION_KEY;

  process.env.ERI_SERVER_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  assert.equal(serverKey().length, 32, "valid 32-byte base64 key loads");

  delete process.env.ERI_SERVER_ENCRYPTION_KEY;
  assert.throws(() => serverKey(), "missing key must throw, not silently no-op");

  process.env.ERI_SERVER_ENCRYPTION_KEY = randomBytes(16).toString("base64");
  assert.throws(() => serverKey(), "a 16-byte key must be rejected (not AES-256)");

  if (prev === undefined) delete process.env.ERI_SERVER_ENCRYPTION_KEY;
  else process.env.ERI_SERVER_ENCRYPTION_KEY = prev;
}

// eslint-disable-next-line no-console
console.log("server-encryption.test.ts: all assertions passed");
