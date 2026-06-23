import { NextResponse } from "next/server";
import { userFromBearer } from "@/lib/auth";
import {
  stripe,
  subscriptionPeriodEnd,
  tierForSubscription,
} from "@/lib/stripe";
import { applySubscriptionByUserId } from "@/lib/db";
import { applyTierToBucket } from "@/lib/usage/quota";
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

  // Start from what the DB has; reconcile against the live subscription below.
  let tier = user.tier;
  let status = user.subscription_status;
  let currentPeriodEnd = user.current_period_end;
  let cancelAtPeriodEnd = false;

  if (user.stripe_subscription_id) {
    try {
      const subscription = await stripe().subscriptions.retrieve(
        user.stripe_subscription_id,
      );
      cancelAtPeriodEnd = subscription.cancel_at_period_end;

      // Self-heal: legacy prices (no metadata.tier, not in the price table)
      // could leave a paying subscriber stamped `free` at signup. Recompute
      // from the live subscription and persist when it drifts. The Stripe
      // round-trip already happened above, so this adds no extra latency.
      const liveTier = await tierForSubscription(subscription);
      const liveStatus = subscription.status;
      const livePeriodEnd = subscriptionPeriodEnd(subscription);
      if (
        liveTier !== user.tier ||
        liveStatus !== user.subscription_status ||
        livePeriodEnd !== user.current_period_end
      ) {
        await applySubscriptionByUserId(user.id, {
          tier: liveTier,
          stripe_subscription_id: subscription.id,
          subscription_status: liveStatus,
          current_period_end: livePeriodEnd,
        });
        try {
          await applyTierToBucket(user.id, liveTier);
        } catch (bucketError) {
          // Quota bucket is observability only — never fail the read on it.
          console.error("subscription reconcile bucket sync failed", bucketError);
        }
        tier = liveTier;
        status = liveStatus;
        currentPeriodEnd = livePeriodEnd;
      }
    } catch (error) {
      console.error("subscription fetch failed", error);
    }
  }

  return NextResponse.json(
    {
      tier,
      status,
      current_period_end: currentPeriodEnd,
      cancel_at_period_end: cancelAtPeriodEnd,
    },
    { status: 200 },
  );
}
