import { NextResponse } from "next/server";
import { userFromBearer } from "@/lib/auth";
import { normalizeTier, TIER_LIMITS } from "@/lib/tiers";
import { featuresForTier } from "@/lib/features";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const user = await userFromBearer(request.headers.get("authorization"));
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const tier = normalizeTier(user.tier);
  const features = Array.from(featuresForTier(tier));
  const rateLimits = TIER_LIMITS[tier];

  return NextResponse.json(
    {
      userId: user.id,
      tier,
      features,
      rateLimits,
    },
    { status: 200 },
  );
}
