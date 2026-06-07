import { NextResponse } from "next/server";
import { userFromBearer } from "@/lib/auth";
import { stripe } from "@/lib/stripe";
import { rateLimit } from "@/lib/rate_limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const limited = await rateLimit(request, "billing.subscription");
  if (limited) return limited;

  const user = await userFromBearer(request.headers.get("authorization"));
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized." },
      { status: 401 },
    );
  }

  let cancelAtPeriodEnd = false;
  if (user.stripe_subscription_id) {
    try {
      const subscription = await stripe().subscriptions.retrieve(
        user.stripe_subscription_id,
      );
      cancelAtPeriodEnd = subscription.cancel_at_period_end;
    } catch (error) {
      console.error("subscription fetch failed", error);
    }
  }

  return NextResponse.json(
    {
      tier: user.tier,
      status: user.subscription_status,
      current_period_end: user.current_period_end,
      cancel_at_period_end: cancelAtPeriodEnd,
    },
    { status: 200 },
  );
}
