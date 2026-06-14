import { NextResponse } from "next/server";
import { authenticateApiBearer } from "@/lib/auth/api_tokens";
import { decryptAtRest, encryptAtRest } from "@/lib/crypto/server_encryption";
import { sql } from "@/lib/db";
import { featureLocked } from "@/lib/feature_gate";
import { parseProfileUpload } from "@/lib/memory/profile_contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/memory/profile — the caller's Tier-A personalization profile.
 *
 * Returns `{ profile, dynamic_context, updated_at }` decrypted from K_server, or
 * nulls when the user hasn't synced a profile yet. Scoped strictly to the
 * authenticated bearer's `user_id` — user A can never read user B's profile.
 * Ungated on read (mirrors memory/sync) so a user can always see what eri knows.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = await authenticateApiBearer(request.headers.get("authorization"));
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const rows = await sql()<
    { profile_enc: Buffer; dynamic_context_enc: Buffer; updated_at: Date | string }[]
  >`
    SELECT profile_enc, dynamic_context_enc, updated_at
    FROM personalization_profiles
    WHERE user_id = ${auth.user.id}
  `;
  const row = rows[0];
  if (!row) {
    return NextResponse.json({ profile: null, dynamic_context: null, updated_at: null });
  }
  return NextResponse.json({
    profile: JSON.parse(decryptAtRest(Buffer.from(row.profile_enc))),
    dynamic_context: decryptAtRest(Buffer.from(row.dynamic_context_enc)),
    updated_at:
      row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  });
}

/**
 * PUT /api/v1/memory/profile — replace the caller's Tier-A profile.
 * Body: `{ profile: object, dynamic_context?: string }` (plaintext — the server
 * encrypts at rest with K_server, since this tier is server-readable).
 */
export async function PUT(request: Request): Promise<Response> {
  const auth = await authenticateApiBearer(request.headers.get("authorization"));
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Same paid-only gate as Tier-B sync — Free is strictly local (no cloud
  // storage), so the entitlement lives in one place (lib/features.ts: cloudSync).
  if (featureLocked(auth.user.tier, "cloudSync")) {
    return NextResponse.json({ error: "tier_locked", required: "starter" }, { status: 402 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = parseProfileUpload(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const profileEnc = encryptAtRest(parsed.profileJson);
  const dynamicEnc = encryptAtRest(parsed.dynamicContext);

  await sql()`
    INSERT INTO personalization_profiles (user_id, profile_enc, dynamic_context_enc)
    VALUES (${auth.user.id}, ${profileEnc}, ${dynamicEnc})
    ON CONFLICT (user_id) DO UPDATE SET
      profile_enc = EXCLUDED.profile_enc,
      dynamic_context_enc = EXCLUDED.dynamic_context_enc,
      updated_at = now()
  `;
  return NextResponse.json({ ok: true });
}
