import { NextResponse } from "next/server";
import { authenticateApiBearer } from "@/lib/auth/api_tokens";
import { decryptAtRest, encryptAtRest } from "@/lib/crypto/server_encryption";
import { sql } from "@/lib/db";
import { featureLocked } from "@/lib/feature_gate";
import { coerceRecallProjection, parseRecallUpload } from "@/lib/memory/recall_contract";
import { rateLimit } from "@/lib/rate_limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUT /api/v1/memory/recall — the Rust brain pushes the user's world-model
 * projection (ADR-0010). Body = the §1 projection JSON. The server encrypts it at
 * rest with K_server (AAD = the caller's user_id) — same posture as the Tier-A
 * profile, distinct path (the profile PUT is lossy and would drop these fields).
 *
 * Strictly single-principal: only the authenticated bearer's own row is written.
 */
export async function PUT(request: Request): Promise<Response> {
  const limited = await rateLimit(request, "memory.recall.write");
  if (limited) return limited;
  const auth = await authenticateApiBearer(request.headers.get("authorization"));
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Same paid gate as the Tier-A profile push — cloud storage is paid-only.
  if (featureLocked(auth.user.tier, "cloudSync")) {
    return NextResponse.json({ error: "tier_locked", required: "starter" }, { status: 402 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = parseRecallUpload(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const enc = encryptAtRest(parsed.json, auth.user.id);
  await sql()`
    INSERT INTO recall_projections (user_id, projection_enc, updated_at)
    VALUES (${auth.user.id}, ${enc}, now())
    ON CONFLICT (user_id) DO UPDATE SET
      projection_enc = EXCLUDED.projection_enc,
      updated_at = now()
  `;
  return NextResponse.json({ ok: true });
}

/**
 * GET /api/v1/memory/recall — the caller's own world-model projection, decrypted.
 * Ungated on read (mirrors profile/sync) so a user can always see what eri knows.
 * The iMessage reply path reads in-process (lib/messaging/recall) rather than over
 * HTTP; this endpoint is for external/debug reads + symmetry.
 */
export async function GET(request: Request): Promise<Response> {
  const limited = await rateLimit(request, "memory.recall.read");
  if (limited) return limited;
  const auth = await authenticateApiBearer(request.headers.get("authorization"));
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const rows = await sql()<{ projection_enc: Buffer; updated_at: Date | string }[]>`
    SELECT projection_enc, updated_at FROM recall_projections WHERE user_id = ${auth.user.id}
  `;
  const row = rows[0];
  if (!row) {
    return NextResponse.json({ projection: null, updated_at: null });
  }
  let projection: unknown;
  try {
    projection = coerceRecallProjection(JSON.parse(decryptAtRest(Buffer.from(row.projection_enc), auth.user.id)));
  } catch {
    console.error("recall.decrypt_failed", { userId: auth.user.id });
    return NextResponse.json({ error: "recall_unavailable" }, { status: 503 });
  }
  return NextResponse.json({
    projection,
    updated_at:
      row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  });
}
