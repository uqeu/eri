import { NextResponse } from "next/server";
import { authenticateApiBearer } from "@/lib/auth/api_tokens";
import { sql } from "@/lib/db";
import { featureLocked } from "@/lib/feature_gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BLOB_BYTES = 4 * 1024 * 1024; // 4 MB hard cap — memory grows but not unboundedly

/**
 * GET /api/v1/memory/sync — returns the user's encrypted memory blob.
 *
 * Response: `{ blob_base64, updated_at }` or `{ blob_base64: null }` when
 * the user hasn't synced anything yet. The bytes are opaque — only the
 * IDE has the per-user salt + bearer-derived key needed to decrypt.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = await authenticateApiBearer(request.headers.get("authorization"));
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const rows = await sql()<{ blob: Buffer; updated_at: Date | string }[]>`
    SELECT blob, updated_at FROM memory_blobs
    WHERE user_id = ${auth.user.id}
  `;
  const row = rows[0];
  if (!row) {
    return NextResponse.json({ blob_base64: null, updated_at: null });
  }
  return NextResponse.json({
    blob_base64: Buffer.from(row.blob).toString("base64"),
    updated_at: row.updated_at instanceof Date
      ? row.updated_at.toISOString()
      : String(row.updated_at),
  });
}

/**
 * PUT /api/v1/memory/sync — replace the user's memory blob.
 * Body: `{ blob_base64 }`. Caller encrypts client-side; we don't inspect.
 */
export async function PUT(request: Request): Promise<Response> {
  const auth = await authenticateApiBearer(request.headers.get("authorization"));
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Cloud sync is paid-only — Free is strictly local (no cloud storage, so
  // 1000s of free users cost ~nothing). Gated via the shared feature system so
  // the entitlement lives in one place (lib/features.ts: cloudSync).
  if (featureLocked(auth.user.tier, "cloudSync")) {
    return NextResponse.json(
      { error: "tier_locked", required: "starter" },
      { status: 402 },
    );
  }

  let body: { blob_base64?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (typeof body.blob_base64 !== "string") {
    return NextResponse.json(
      { error: "missing_blob_base64" },
      { status: 400 },
    );
  }
  const blob = Buffer.from(body.blob_base64, "base64");
  if (blob.length === 0) {
    return NextResponse.json({ error: "empty_blob" }, { status: 400 });
  }
  if (blob.length > MAX_BLOB_BYTES) {
    return NextResponse.json(
      { error: "blob_too_large", limit: MAX_BLOB_BYTES },
      { status: 413 },
    );
  }

  await sql()`
    INSERT INTO memory_blobs (user_id, blob)
    VALUES (${auth.user.id}, ${blob})
    ON CONFLICT (user_id) DO UPDATE SET
      blob = EXCLUDED.blob,
      updated_at = now()
  `;
  return NextResponse.json({ ok: true, bytes: blob.length });
}
