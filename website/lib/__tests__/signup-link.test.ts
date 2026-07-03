import { strict as assert } from "node:assert";
import { claimSignupToken, hashToken, mintSignupToken, type SignupClaimDeps } from "../phone/signup_link";

const t0 = 1_800_000_000_000;
const PHONE = "+15551234567";

/** A deps stub that binds successfully to the caller (the happy default). */
function okDeps(row: { expires_at: number; used_at: number | null }, over: Partial<SignupClaimDeps> = {}): SignupClaimDeps {
  return {
    findToken: async () => ({ phone_e164: PHONE, ...row }),
    bindPhoneSticky: async (userId) => ({ ownerUserId: userId, inserted: true }),
    markTokenUsed: async () => {},
    ...over,
  };
}

async function run() {
  const { raw, hash } = mintSignupToken(t0);
  assert.equal(hashToken(raw), hash, "hash deterministic; only the hash is stored");

  // Happy path → binds the TOKEN's number, consumes the token.
  {
    let used = false;
    const r = await claimSignupToken(raw, "usr_A", okDeps({ expires_at: t0 + 60_000, used_at: null }, {
      bindPhoneSticky: async (uid, phone) => {
        assert.equal(phone, PHONE, "binds the token's number, not a supplied one");
        return { ownerUserId: uid, inserted: true };
      },
      markTokenUsed: async () => { used = true; },
    }), t0);
    assert.deepEqual(r, { ok: true, phone: PHONE, alreadyLinked: false });
    assert.ok(used, "token consumed on success");
  }

  // Unknown token → invalid.
  assert.deepEqual(
    await claimSignupToken("nope", "usr_A", { findToken: async () => null, bindPhoneSticky: async (u) => ({ ownerUserId: u, inserted: true }), markTokenUsed: async () => {} }, t0),
    { ok: false, error: "invalid" },
  );

  // Expired.
  assert.deepEqual(await claimSignupToken(raw, "usr_A", okDeps({ expires_at: t0 - 1, used_at: null }), t0), { ok: false, error: "expired" });

  // Already used.
  assert.deepEqual(await claimSignupToken(raw, "usr_A", okDeps({ expires_at: t0 + 60_000, used_at: t0 - 10 }), t0), { ok: false, error: "used" });

  // HIJACK REFUSED: number already owned by someone else → refuse, don't consume.
  {
    let used = false;
    const r = await claimSignupToken(raw, "usr_ATTACKER", okDeps({ expires_at: t0 + 60_000, used_at: null }, {
      bindPhoneSticky: async () => ({ ownerUserId: "usr_OWNER", inserted: false }),
      markTokenUsed: async () => { used = true; },
    }), t0);
    assert.deepEqual(r, { ok: false, error: "number_already_linked" });
    assert.equal(used, false, "a hijack attempt never consumes the token or rebinds");
  }

  // Idempotent same-user re-claim (already bound to THIS user).
  {
    const r = await claimSignupToken(raw, "usr_A", okDeps({ expires_at: t0 + 60_000, used_at: null }, {
      bindPhoneSticky: async (u) => ({ ownerUserId: u, inserted: false }),
    }), t0);
    assert.deepEqual(r, { ok: true, phone: PHONE, alreadyLinked: true });
  }

  // eslint-disable-next-line no-console
  console.log("signup-link.test.ts: all assertions passed");
}

run();
