import { NextResponse } from "next/server";
import { userFromBearer } from "@/lib/auth";
import { decideAllowance, normalizeTier } from "@/lib/tiers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const user = await userFromBearer(request.headers.get("authorization"));
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const tier = normalizeTier(user.tier);
  const decision = await decideAllowance(user.id, tier);

  // 429 for RATE_LIMIT, 200 with allowed=false for QUOTA_EXCEEDED so the
  // IDE can distinguish "retry soon" from "show paywall".
  if (!decision.allowed && decision.reason === "RATE_LIMIT") {
    return NextResponse.json(decision, { status: 429 });
  }
  return NextResponse.json(decision, { status: 200 });
}
