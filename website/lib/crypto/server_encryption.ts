import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * At-rest encryption for the Tier-A personalization profile (ADR-0001).
 *
 * Unlike the Tier-B memory blob (`/api/v1/memory/sync`), which is opaque E2E
 * ciphertext the server never reads, the Tier-A profile is **server-readable**:
 * phone eri injects it into its system prompt. We still encrypt it at rest with
 * an application-managed key `K_server` so a leaked database dump alone reveals
 * nothing — defense in depth, not E2E.
 *
 * AES-256-GCM, with the blob laid out as `version (1) || iv (12) || authTag (16)
 * || ciphertext`. The version byte makes key rotation survivable (security M-5):
 * a future rotation can write v2 while still reading v1. An `aad` (the user id)
 * binds each ciphertext to its owner, so a leaked/compromised server cannot swap
 * user A's blob into user B's row undetected (security M-1) — K_server is shared
 * across users, so the AAD is what isolates them at the crypto layer.
 *
 * The pure `seal`/`open` take the key + aad explicitly so they're testable
 * without touching the environment; `encryptAtRest`/`decryptAtRest` wrap them
 * with the env-loaded key for route use.
 */

const ALGORITHM = "aes-256-gcm";
const VERSION = 0x01;
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
const HEADER_LEN = 1 + IV_LEN + TAG_LEN;
const KEY_ENV = "ERI_SERVER_ENCRYPTION_KEY";

/**
 * Encrypt `plaintext` under `key`, binding `aad` as additional authenticated
 * data. Returns `version || iv || authTag || ciphertext`.
 */
export function seal(key: Buffer, plaintext: string, aad?: Buffer): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  if (aad) cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([VERSION]), iv, authTag, ciphertext]);
}

/**
 * Decrypt a `seal()` blob under `key` + `aad`. Throws on a wrong key, a wrong
 * aad, any tampering (GCM authenticates), an unknown version byte, or a blob too
 * short to hold the header.
 */
export function open(key: Buffer, blob: Buffer, aad?: Buffer): string {
  if (blob.length < HEADER_LEN) {
    throw new Error("at-rest blob is malformed");
  }
  if (blob[0] !== VERSION) {
    throw new Error(`unsupported at-rest blob version ${blob[0]}`);
  }
  const iv = blob.subarray(1, 1 + IV_LEN);
  const authTag = blob.subarray(1 + IV_LEN, HEADER_LEN);
  const ciphertext = blob.subarray(HEADER_LEN);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  if (aad) decipher.setAAD(aad);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/**
 * Load + validate `K_server` from `ERI_SERVER_ENCRYPTION_KEY` (base64 of 32
 * bytes). Fails fast — a misconfigured key must never silently degrade to
 * weaker or no encryption.
 */
export function serverKey(): Buffer {
  const raw = process.env[KEY_ENV];
  if (!raw) {
    throw new Error(`${KEY_ENV} must be set (base64 of 32 random bytes)`);
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_LEN) {
    throw new Error(`${KEY_ENV} must decode to ${KEY_LEN} bytes, got ${key.length}`);
  }
  return key;
}

/** Stable AAD for a user's Tier-A row — binds ciphertext to its owner. */
function profileAad(userId: string): Buffer {
  return Buffer.from(`tier-a:${userId}`, "utf8");
}

/** Encrypt `plaintext` at rest with `K_server`, bound to `userId`. */
export function encryptAtRest(plaintext: string, userId: string): Buffer {
  return seal(serverKey(), plaintext, profileAad(userId));
}

/** Decrypt a `userId`'s at-rest blob with `K_server`. */
export function decryptAtRest(blob: Buffer, userId: string): string {
  return open(serverKey(), blob, profileAad(userId));
}
