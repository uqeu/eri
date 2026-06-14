/**
 * Phone↔user identity for phone eri (ADR-0002).
 *
 * The webhook only ever acts on a **verified** `phone_links` row — an unverified
 * or unknown number can never authenticate as a user. Pairing turns an unknown
 * number into a verified link: the user runs `eri phone link` (mints a code),
 * texts the code to the eri number, and the webhook binds + verifies it.
 *
 * `normalizeE164` is pure + unit-tested; the DB functions are thin and scoped to
 * a single phone/user so there's no cross-tenant surface.
 */

import { randomBytes } from "node:crypto";
import { sql } from "@/lib/db";

/**
 * Normalize a phone number to bare E.164 (`+` + digits). Strips spaces, dashes,
 * dots, and parens. Returns null if it isn't a plausible E.164 number, so a
 * malformed `from_number` can never match a row by accident.
 */
export function normalizeE164(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim().replace(/[\s().-]/g, "");
  if (!/^\+[1-9]\d{6,14}$/.test(cleaned)) return null;
  return cleaned;
}

export interface ResolvedUser {
  userId: string;
  tier: string;
}

/** Resolve the user behind a phone number — VERIFIED links only. */
export async function resolveUserByPhone(e164: string): Promise<ResolvedUser | null> {
  const rows = await sql()<{ user_id: string; tier: string }[]>`
    SELECT pl.user_id, u.tier
    FROM phone_links pl
    JOIN users u ON u.id = pl.user_id
    WHERE pl.phone_e164 = ${e164}
      AND pl.verified_at IS NOT NULL
    LIMIT 1
  `;
  const row = rows[0];
  return row ? { userId: row.user_id, tier: row.tier } : null;
}

/**
 * Try to redeem `code` as a pairing for `fromE164`: if an unexpired pairing
 * exists, bind the number to that user as a **verified** link and consume the
 * code (single-use). Returns the bound user id, or null if the code is unknown
 * or expired. Idempotent on the link via the unique `phone_e164` upsert.
 */
export async function consumePairing(
  code: string,
  fromE164: string,
): Promise<{ userId: string } | null> {
  const pairings = await sql()<{ user_id: string }[]>`
    DELETE FROM phone_pairings
    WHERE code = ${code} AND expires_at > now()
    RETURNING user_id
  `;
  const pairing = pairings[0];
  if (!pairing) return null;

  await sql()`
    INSERT INTO phone_links (id, user_id, phone_e164, verified_at, last_service)
    VALUES (${newLinkId()}, ${pairing.user_id}, ${fromE164}, now(), 'iMessage')
    ON CONFLICT (phone_e164) DO UPDATE SET
      user_id = EXCLUDED.user_id,
      verified_at = now(),
      last_service = 'iMessage'
  `;
  return { userId: pairing.user_id };
}

/** A pairing code as it appears in a text: case-insensitive, ignores a `pair ` prefix. */
export function extractPairingCode(content: string): string | null {
  const m = /^\s*(?:pair\s+)?([A-Za-z0-9]{6,10})\s*$/.exec(content);
  return m ? m[1].toUpperCase() : null;
}

function newLinkId(): string {
  return `pl_${randomBytes(16).toString("base64url")}`;
}
