// POST /api/v1/phone/invite — invite a friend by number.
//
// An owner (Pro+) adds a friend's phone number; we create a PENDING invite keyed by
// the number. When that number FIRST texts eri's line, handleInbound auto-creates +
// binds their account (hijack-proof) and eri replies already onboarded — no link, no
// sign-up form. See lib/phone/invite.ts.

import { NextResponse } from "next/server";
import { authenticateApiBearer } from "@/lib/auth/api_tokens";
import { featureLocked } from "@/lib/feature_gate";
import { normalizeE164 } from "@/lib/imessage/identity";
import { createPhoneInvite } from "@/lib/phone/invite";
import { rateLimit } from "@/lib/rate_limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const limited = await rateLimit(request, "phone.invite");
  if (limited) return limited;
  const auth = await authenticateApiBearer(request.headers.get("authorization"));
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Only a Pro+ owner (who can text eri themselves) can invite — same gate as pairing.
  if (featureLocked(auth.user.tier, "phoneEri")) {
    return NextResponse.json({ error: "tier_locked", required: "pro_plus" }, { status: 402 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const raw = (body as { phone?: unknown })?.phone;
  const phone = typeof raw === "string" ? normalizeE164(raw) : null;
  if (!phone) {
    return NextResponse.json({ error: "bad_number" }, { status: 400 });
  }

  await createPhoneInvite({
    ownerId: auth.user.id,
    ownerName: auth.user.display_name ?? null,
    phone,
  });
  return NextResponse.json({ ok: true, phone });
}
