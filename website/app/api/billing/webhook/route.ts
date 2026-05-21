import { NextResponse } from "next/server";
import type Stripe from "stripe";
import {
  applySubscriptionByCustomerId,
  applySubscriptionByUserId,
  clearSubscriptionByCustomerId,
  getUserById,
  getUserByStripeCustomerId,
  type UserRow,
} from "@/lib/db";
import { mapStripePriceToTier, stripe, tierForPriceId, type Tier } from "@/lib/stripe";
import {
  sendPaymentFailedEmail,
  sendPaymentReceiptEmail,
  sendSubscriptionConfirmationEmail,
} from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function baseUrl(): string {
  return process.env.NEXT_PUBLIC_BASE_URL ?? "https://eri.dev";
}

function billingPortalUrl(): string {
  return new URL("/billing/portal", baseUrl()).toString();
}

async function userForCustomer(customerId: string): Promise<UserRow | null> {
  return getUserByStripeCustomerId(customerId);
}

async function userById(userId: string): Promise<UserRow | null> {
  return getUserById(userId);
}

function tierFromSubscriptionItem(item: Stripe.SubscriptionItem | undefined): Tier {
  if (!item) return "free";
  // Prefer the price-level metadata convention (`price.metadata.tier`) so a
  // single price ID can re-target tiers without redeploys; fall back to the
  // env-var price ID table for older products that predate the convention.
  const metadataTier = item.price.metadata?.tier;
  if (metadataTier) {
    return mapStripePriceToTier(metadataTier);
  }
  return tierForPriceId(item.price.id);
}

async function applySubscription(
  subscription: Stripe.Subscription,
): Promise<UserRow | null> {
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;
  const firstItem = subscription.items.data[0];
  const tier: Tier =
    subscription.status === "active" || subscription.status === "trialing"
      ? tierFromSubscriptionItem(firstItem)
      : "free";

  const userId = subscription.metadata?.user_id;
  const update = {
    tier,
    stripe_subscription_id: subscription.id,
    subscription_status: subscription.status,
    current_period_end: subscription.current_period_end,
  };
  if (userId) {
    await applySubscriptionByUserId(userId, update);
    return userById(userId);
  }
  await applySubscriptionByCustomerId(customerId, update);
  return userForCustomer(customerId);
}

async function clearSubscription(subscription: Stripe.Subscription): Promise<void> {
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;
  await clearSubscriptionByCustomerId(
    customerId,
    subscription.status,
    subscription.current_period_end,
  );
}

function customerIdFromInvoice(invoice: Stripe.Invoice): string | null {
  if (!invoice.customer) return null;
  return typeof invoice.customer === "string"
    ? invoice.customer
    : invoice.customer.id;
}

function tierFromInvoice(invoice: Stripe.Invoice): Tier {
  const line = invoice.lines.data[0];
  const metadataTier = line?.price?.metadata?.tier;
  if (metadataTier) return mapStripePriceToTier(metadataTier);
  const priceId = line?.price?.id ?? "";
  return tierForPriceId(priceId);
}

async function handleSubscriptionCreated(
  subscription: Stripe.Subscription,
): Promise<void> {
  const user = await applySubscription(subscription);
  if (!user) return;
  // Confirmation email is gated on a known paid tier; free / enterprise are
  // either handled by sales or need no email.
  const PAID_TIERS = ["starter", "pro", "pro_plus", "teams"] as const;
  type PaidTier = (typeof PAID_TIERS)[number];
  const isPaid = (value: string): value is PaidTier =>
    (PAID_TIERS as ReadonlyArray<string>).includes(value);
  if (!isPaid(user.tier)) return;
  await sendSubscriptionConfirmationEmail({
    to: user.email,
    tier: user.tier,
    manageUrl: billingPortalUrl(),
  });
}

async function handlePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
  const customerId = customerIdFromInvoice(invoice);
  if (!customerId) return;
  const user = await userForCustomer(customerId);
  if (!user) return;
  const amountUsd = (invoice.amount_paid ?? 0) / 100;
  const line = invoice.lines.data[0];
  const periodStart = line?.period?.start ?? invoice.period_start;
  const periodEnd = line?.period?.end ?? invoice.period_end;
  await sendPaymentReceiptEmail({
    to: user.email,
    amountUsd,
    tier: tierFromInvoice(invoice),
    periodStart,
    periodEnd,
    manageUrl: billingPortalUrl(),
  });
}

async function handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const customerId = customerIdFromInvoice(invoice);
  if (!customerId) return;
  const user = await userForCustomer(customerId);
  if (!user) return;
  await sendPaymentFailedEmail({
    to: user.email,
    retryUrl: billingPortalUrl(),
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  const signature = request.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret) {
    return NextResponse.json(
      { error: "Missing Stripe signature." },
      { status: 400 },
    );
  }

  const payload = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(payload, signature, secret);
  } catch (error) {
    console.error("stripe webhook signature failed", error);
    return NextResponse.json(
      { error: "Invalid signature." },
      { status: 400 },
    );
  }

  try {
    switch (event.type) {
      case "customer.subscription.created": {
        await handleSubscriptionCreated(event.data.object);
        break;
      }
      case "customer.subscription.updated": {
        await applySubscription(event.data.object);
        break;
      }
      case "customer.subscription.deleted": {
        await clearSubscription(event.data.object);
        break;
      }
      case "checkout.session.completed": {
        const session = event.data.object;
        if (session.subscription && session.customer) {
          const subscriptionId =
            typeof session.subscription === "string"
              ? session.subscription
              : session.subscription.id;
          const subscription =
            await stripe().subscriptions.retrieve(subscriptionId);
          await applySubscription(subscription);
        }
        break;
      }
      case "invoice.payment_succeeded": {
        await handlePaymentSucceeded(event.data.object);
        break;
      }
      case "invoice.payment_failed": {
        await handlePaymentFailed(event.data.object);
        break;
      }
      default:
        break;
    }
  } catch (error) {
    console.error("stripe webhook handler failed", error);
    return NextResponse.json(
      { error: "Webhook handler failed." },
      { status: 500 },
    );
  }
  return NextResponse.json({ received: true }, { status: 200 });
}
