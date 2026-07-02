/**
 * Magic sign-up link — hijack-proof number↔account binding.
 *
 * A stranger texts eri from number X; eri mints a single-use token that ENCODES X
 * and texts back a link (so only the holder of X ever sees it). On the web the
 * user signs up / logs in and CLAIMS the token, which binds X to their account.
 *
 * Single-principal integrity is the whole moat, so the binding is hijack-proof by
 * construction:
 *  - the number is fixed by the token (server-stored), NEVER user-supplied;
 *  - the bind is atomic on `phone_links.phone_e164`'s UNIQUE index — first writer
 *    wins, races can't double-bind;
 *  - a number already bound to ANYONE else is refused (no rebind, ever);
 *  - the token is single-use + short-TTL, so a leaked/old link can't be replayed.
 *
 * Pure of IO (crypto only) + injected DB ops, so the decision is unit-tested.
 */

import { createHash, randomBytes } from "node:crypto";

/** Long enough to tap + sign up, short enough a leaked link can't be replayed. */
export const SIGNUP_TOKEN_TTL_MS = 30 * 60_000; // 30 min

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Mint a fresh token: the raw secret (goes in the texted link) + its hash (all
 *  that's persisted) + expiry. `nowMs` injected so it's deterministic. */
export function mintSignupToken(nowMs: number): { raw: string; hash: string; expiresAt: number } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: hashToken(raw), expiresAt: nowMs + SIGNUP_TOKEN_TTL_MS };
}

export interface SignupTokenRow {
  phone_e164: string;
  /** epoch ms */
  expires_at: number;
  /** epoch ms, or null if unused */
  used_at: number | null;
}

export interface SignupClaimDeps {
  /** The stored token by its hash, or null. */
  findToken(tokenHash: string): Promise<SignupTokenRow | null>;
  /** ATOMICALLY bind `phone` to `userId` (INSERT … ON CONFLICT (phone_e164) DO
   *  NOTHING — the unique index makes it race-proof). Returns who OWNS the number
   *  afterward and whether THIS call inserted it. */
  bindPhoneSticky(userId: string, phone: string): Promise<{ ownerUserId: string; inserted: boolean }>;
  /** Single-use: mark the token consumed (idempotent). */
  markTokenUsed(tokenHash: string): Promise<void>;
}

export type ClaimResult =
  | { ok: true; phone: string; alreadyLinked: boolean }
  | { ok: false; error: "invalid" | "expired" | "used" | "number_already_linked" };

/**
 * Claim a signup token for `userId`, binding the token's number to the account.
 * Hijack-proof (see module doc). Never binds a number the caller supplied — only
 * the one the token encodes.
 */
export async function claimSignupToken(
  rawToken: string,
  userId: string,
  deps: SignupClaimDeps,
  nowMs: number,
): Promise<ClaimResult> {
  const hash = hashToken(rawToken);
  const token = await deps.findToken(hash);
  if (!token) return { ok: false, error: "invalid" };
  if (token.used_at != null) return { ok: false, error: "used" };
  if (token.expires_at <= nowMs) return { ok: false, error: "expired" };

  const { ownerUserId, inserted } = await deps.bindPhoneSticky(userId, token.phone_e164);
  if (ownerUserId !== userId) {
    // The number already belongs to someone else — REFUSE. No rebind, ever. The
    // token is NOT consumed (nothing happened), but it also can't help an attacker.
    return { ok: false, error: "number_already_linked" };
  }
  await deps.markTokenUsed(hash);
  return { ok: true, phone: token.phone_e164, alreadyLinked: !inserted };
}
