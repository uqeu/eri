// POST /api/v1/phone/pair — mint a pairing code for phone eri (ADR-0002).
//
// `eri phone link` (CLI) calls this with the user's `eri_sk_*` bearer; it mints
// a short, unambiguous code, stores it (short TTL), and returns it plus the eri
// number. The user texts the code to that number; the inbound webhook matches
// it, binds + verifies their phone, and consumes the code.

import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { authenticateApiBearer } from "@/lib/auth/api_tokens";
import { sql } from "@/lib/db";
import { featureLocked } from "@/lib/feature_gate";
import { rateLimit } from "@/lib/rate_limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CODE_TTL_MINUTES = 15;
// Crockford-ish alphabet: no 0/O/1/I so a texted code is unambiguous.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LEN = 6;

function mintCode(): string {
  const bytes = randomBytes(CODE_LEN);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

export async function POST(request: Request): Promise<Response> {
  const limited = await rateLimit(request, "phone.pair");
  if (limited) return limited;
  const auth = await authenticateApiBearer(request.headers.get("authorization"));
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (featureLocked(auth.user.tier, "phoneEri")) {
    return NextResponse.json({ error: "tier_locked", required: "pro_plus" }, { status: 402 });
  }

  const code = mintCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60_000).toISOString();
  await sql()`
    INSERT INTO phone_pairings (code, user_id, expires_at)
    VALUES (${code}, ${auth.user.id}, ${expiresAt})
  `;
  return NextResponse.json({
    code,
    number: process.env.SENDBLUE_FROM_NUMBER ?? null,
    expires_in_minutes: CODE_TTL_MINUTES,
  });
}
