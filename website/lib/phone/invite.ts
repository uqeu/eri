/**
 * Invite-by-number onboarding — the owner adds a friend's number on the web, the
 * friend's FIRST text auto-creates + binds their account. No link, no sign-up form.
 *
 * Hijack-proof by construction, same invariant as the magic link
 * ([[project_eri_newuser_frontdoor]]): the bind is atomic on `phone_links.phone_e164`'s
 * UNIQUE index — a number already bound to ANYONE else is refused (no rebind). The
 * whole accept runs in ONE transaction, so a bind that loses a race rolls back the
 * account creation (no orphan). The number is fixed by who TEXTS, never user-supplied.
 *
 * Friends-testing phase: auto-bind on first text. PUBLIC launch needs the one-tap
 * "K invited you → join theirs vs start your own" confirm (impersonation guard) before
 * this binds a number the texter didn't consent to — tracked, not built here.
 */

import { randomBytes } from "node:crypto";
import { sql } from "@/lib/db";

/** Tier invited friends get so they can actually text eri (phoneEri is Pro+-gated).
 *  COMPED for the friends-testing phase; revisit for launch billing. */
const INVITE_TIER = "pro_plus";

/** Thrown to roll back the accept transaction when the number is already bound to
 *  someone else — so we never orphan a half-created account or rebind a number. */
class NoRebindError extends Error {}

function newUserId(): string {
  return `usr_${randomBytes(16).toString("hex")}`;
}

/**
 * If `e164` has a PENDING invite, atomically create + bind the friend's account and
 * consume the invite; return the new account (+ the inviter's name for the welcome).
 * Returns null when there's no pending invite OR the number is already bound
 * (hijack-proof refuse) — the caller then falls through to the magic-link flow.
 */
export async function acceptPendingInvite(
  e164: string,
): Promise<{ userId: string; inviterName: string | null } | null> {
  try {
    return await sql().begin(async (tx) => {
      const inv = await tx<{ invited_by_name: string | null }[]>`
        SELECT invited_by_name FROM phone_invites
        WHERE phone_e164 = ${e164} AND consumed_at IS NULL
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `;
      if (!inv[0]) return null;

      const userId = newUserId();
      const email = `phone_${e164.replace(/\D/g, "")}@invite.eri`;
      // Unusable password ('' is not a valid hash → never matches): the friend auths
      // by TEXTING, not the web. Comped tier so phoneEri is unlocked.
      // `created_at` is deliberately omitted — it's a bigint EPOCH with a default
      // (0001_init.sql), so passing now() (timestamptz) fails the insert outright.
      await tx`
        INSERT INTO users (id, email, password_hash, display_name, tier)
        VALUES (${userId}, ${email}, '', ${null}, ${INVITE_TIER})
      `;
      // Atomic hijack-proof bind — a number already bound to anyone else conflicts.
      const bound = await tx`
        INSERT INTO phone_links (id, user_id, phone_e164, verified_at, last_service)
        VALUES (${`pl_${randomBytes(16).toString("base64url")}`}, ${userId}, ${e164}, now(), 'iMessage')
        ON CONFLICT (phone_e164) DO NOTHING
        RETURNING id
      `;
      if (bound.length === 0) throw new NoRebindError();
      await tx`
        UPDATE phone_invites SET consumed_at = now(), consumed_user_id = ${userId}
        WHERE phone_e164 = ${e164}
      `;
      return { userId, inviterName: inv[0].invited_by_name };
    });
  } catch (e) {
    if (e instanceof NoRebindError) return null;
    // This runs on the FIRST text from every unknown number — ahead of the magic-link
    // flow, which is the live front door. A throw here (missing table because 0033
    // hasn't been applied yet, a transient DB blip) would take new-user onboarding
    // down with it. Degrade to "no invite" and fall through, but say so loudly: an
    // optional feature must never be able to break the path it sits in front of.
    console.log(
      JSON.stringify({
        event: "invite.accept_failed",
        error: e instanceof Error ? e.message : String(e),
      }),
    );
    return null;
  }
}

/**
 * Owner creates (or refreshes) a PENDING invite for a friend's number. Idempotent
 * per number; won't touch an already-consumed (bound) number. `phone` must be a
 * normalized E.164.
 */
export async function createPhoneInvite(input: {
  ownerId: string;
  ownerName: string | null;
  phone: string;
}): Promise<void> {
  await sql()`
    INSERT INTO phone_invites (phone_e164, invited_by, invited_by_name)
    VALUES (${input.phone}, ${input.ownerId}, ${input.ownerName})
    ON CONFLICT (phone_e164) DO UPDATE SET
      invited_by = EXCLUDED.invited_by,
      invited_by_name = EXCLUDED.invited_by_name,
      created_at = now()
    WHERE phone_invites.consumed_at IS NULL
  `;
}
