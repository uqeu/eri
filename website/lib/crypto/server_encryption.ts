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
 * AES-256-GCM, with the blob laid out as `iv (12) || authTag (16) || ciphertext`.
 * The pure `seal`/`open` take the key explicitly so they're testable without
 * touching the environment; `encryptAtRest`/`decryptAtRest` wrap them with the
 * env-loaded key for route use.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
const KEY_ENV = "ERI_SERVER_ENCRYPTION_KEY";

/** Encrypt `plaintext` under `key`. Returns `iv || authTag || ciphertext`. */
export function seal(key: Buffer, plaintext: string): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
}

/**
 * Decrypt a `seal()` blob under `key`. Throws on a wrong key, any tampering
 * (GCM authenticates), or a blob too short to hold the iv + tag.
 */
export function open(key: Buffer, blob: Buffer): string {
  if (blob.length < IV_LEN + TAG_LEN) {
    throw new Error("at-rest blob is malformed");
  }
  const iv = blob.subarray(0, IV_LEN);
  const authTag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = blob.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
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

/** Encrypt `plaintext` at rest with the env-configured `K_server`. */
export function encryptAtRest(plaintext: string): Buffer {
  return seal(serverKey(), plaintext);
}

/** Decrypt an at-rest blob with the env-configured `K_server`. */
export function decryptAtRest(blob: Buffer): string {
  return open(serverKey(), blob);
}
