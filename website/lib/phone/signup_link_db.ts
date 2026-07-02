/**
 * Live DB wiring behind the (pure) magic-signup-link logic in signup_link.ts.
 * Kept separate so the hijack-proof decision stays unit-tested without a DB.
 */

import { randomBytes } from "node:crypto";
import { sql } from "@/lib/db";
import {
  hashToken,
  mintSignupToken,
  SIGNUP_TOKEN_TTL_MS,
  type SignupClaimDeps,
  type SignupTokenRow,
} from "@/lib/phone/signup_link";

function baseUrl(): string {
  return process.env.NEXT_PUBLIC_BASE_URL ?? "https://www.tryeri.ca";
}

/**
 * Mint + store a signup token for `e164`, returning the absolute /join link to
 * text back. Only the sha256 hash is persisted; the raw secret lives only in the
 * link (delivered to the number itself). Throws on a DB failure (caller falls back).
 */
export async function mintSignupLink(e164: string): Promise<string> {
  const { raw, hash } = mintSignupToken(Date.now());
  await sql()`
    INSERT INTO phone_signup_tokens (token_hash, phone_e164, expires_at)
    VALUES (${hash}, ${e164}, now() + ${`${Math.floor(SIGNUP_TOKEN_TTL_MS / 1000)} seconds`}::interval)
  `;
  const url = new URL("/join", baseUrl());
  url.searchParams.set("t", raw);
  return url.toString();
}

/** The live DB ops behind `claimSignupToken`. */
export function makeSignupClaimDeps(): SignupClaimDeps {
  return {
    findToken: async (tokenHash) => {
      const rows = await sql()<{ phone_e164: string; expires_ms: string; used_ms: string | null }[]>`
        SELECT phone_e164,
               extract(epoch from expires_at) * 1000 AS expires_ms,
               extract(epoch from used_at) * 1000 AS used_ms
        FROM phone_signup_tokens WHERE token_hash = ${tokenHash}
      `;
      const r = rows[0];
      if (!r) return null;
      return {
        phone_e164: r.phone_e164,
        expires_at: Number(r.expires_ms),
        used_at: r.used_ms != null ? Number(r.used_ms) : null,
      } satisfies SignupTokenRow;
    },
    // Atomic + race-proof on the phone_e164 UNIQUE index: first writer wins.
    bindPhoneSticky: async (userId, phone) => {
      const id = `pl_${randomBytes(16).toString("base64url")}`;
      const rows = await sql()<{ owner: string | null; inserted: boolean }[]>`
        WITH ins AS (
          INSERT INTO phone_links (id, user_id, phone_e164, verified_at, last_service)
          VALUES (${id}, ${userId}, ${phone}, now(), 'iMessage')
          ON CONFLICT (phone_e164) DO NOTHING
          RETURNING user_id
        )
        SELECT
          COALESCE((SELECT user_id FROM ins), (SELECT user_id FROM phone_links WHERE phone_e164 = ${phone})) AS owner,
          (SELECT count(*) FROM ins) > 0 AS inserted
      `;
      const r = rows[0];
      return { ownerUserId: r?.owner ?? userId, inserted: r?.inserted ?? false };
    },
    markTokenUsed: async (tokenHash) => {
      await sql()`UPDATE phone_signup_tokens SET used_at = now() WHERE token_hash = ${tokenHash} AND used_at IS NULL`;
    },
  };
}

export { hashToken };
