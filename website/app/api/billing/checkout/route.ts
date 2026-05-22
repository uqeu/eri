import { NextResponse } from "next/server";
import { setUserStripeCustomerId } from "@/lib/db";
import { userFromBearer } from "@/lib/auth";
import {
  priceIdForPlan,
  stripe,
  type BillingCadence,
  type PaidPlan,
} from "@/lib/stripe";
import { rateLimit } from "@/lib/rate_limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CheckoutBody {
  plan: PaidPlan;
  billing: BillingCadence;
}

const PAID_PLANS: ReadonlyArray<PaidPlan> = ["starter", "pro", "pro_plus", "teams"];
const CADENCES: ReadonlyArray<BillingCadence> = ["monthly", "yearly"];

function isPaidPlan(value: unknown): value is PaidPlan {
  return typeof value === "string" && (PAID_PLANS as ReadonlyArray<string>).includes(value);
}

function isBillingCadence(value: unknown): value is BillingCadence {
  return typeof value === "string" && (CADENCES as ReadonlyArray<string>).includes(value);
}

function parseBody(value: unknown): CheckoutBody | null {
  if (typeof value !== "object" || value === null) return null;
  const plan = (value as { plan?: unknown }).plan;
  if (!isPaidPlan(plan)) return null;
  const billingRaw = (value as { billing?: unknown }).billing;
  // `billing` is optional — default to monthly so existing clients that only
  // sent `{ plan }` keep working.
  const billing: BillingCadence =
    billingRaw === undefined ? "monthly" : isBillingCadence(billingRaw) ? billingRaw : "monthly";
  if (billingRaw !== undefined && !isBillingCadence(billingRaw)) return null;
  return { plan, billing };
}

export async function POST(request: Request): Promise<NextResponse> {
  const limited = rateLimit(request, "billing.checkout");
  if (limited) return limited;

  const user = await userFromBearer(request.headers.get("authorization"));
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized." },
      { status: 401 },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400 },
    );
  }
  const body = parseBody(raw);
  if (!body) {
    return NextResponse.json(
      {
        error:
          "plan must be 'starter' | 'pro' | 'pro_plus' | 'teams' and billing 'monthly' | 'yearly'.",
      },
      { status: 400 },
    );
  }

  const client = stripe();
  let customerId = user.stripe_customer_id;
  if (!customerId) {
    const customer = await client.customers.create({
      email: user.email,
      metadata: { user_id: user.id },
    });
    customerId = customer.id;
    await setUserStripeCustomerId(user.id, customerId);
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  const newPriceId = priceIdForPlan(body.plan, body.billing);

  // If the user already has a subscription, swap the price item in-place
  // with proration instead of opening a new Checkout session. This is the
  // "switch plan without leaving the app" path used by Cursor / Linear /
  // Anthropic. Falls back to Checkout if the existing subscription is in
  // a state we can't update (canceled, incomplete_expired, etc.).
  if (user.stripe_subscription_id) {
    try {
      const sub = await client.subscriptions.retrieve(
        user.stripe_subscription_id,
      );
      const switchable =
        sub.status === "active" ||
        sub.status === "trialing" ||
        sub.status === "past_due";
      const existingItem = sub.items.data[0];
      if (switchable && existingItem) {
        if (existingItem.price.id === newPriceId) {
          return NextResponse.json(
            {
              url: `${baseUrl}/billing/success?action=unchanged&plan=${body.plan}`,
            },
            { status: 200 },
          );
        }
        await client.subscriptions.update(sub.id, {
          items: [{ id: existingItem.id, price: newPriceId }],
          proration_behavior: "create_prorations",
          // Cancel any prior "schedule to cancel at period end" — if the user
          // is upgrading after clicking cancel, they almost certainly want
          // their subscription to keep running.
          cancel_at_period_end: false,
          metadata: {
            ...(sub.metadata ?? {}),
            user_id: user.id,
            plan: body.plan,
            billing: body.billing,
          },
        });
        return NextResponse.json(
          {
            url: `${baseUrl}/billing/success?action=updated&plan=${body.plan}`,
          },
          { status: 200 },
        );
      }
    } catch (error) {
      console.warn(
        "billing.checkout: cannot update existing subscription, falling back to checkout",
        error,
      );
    }
  }

  const session = await client.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: newPriceId, quantity: 1 }],
    success_url: `${baseUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/billing/cancel`,
    metadata: {
      user_id: user.id,
      plan: body.plan,
      billing: body.billing,
    },
  });

  if (!session.url) {
    return NextResponse.json(
      { error: "Stripe did not return a checkout URL." },
      { status: 502 },
    );
  }
  return NextResponse.json({ url: session.url }, { status: 200 });
}
