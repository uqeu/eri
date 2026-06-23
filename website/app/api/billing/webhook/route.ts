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
import {
  mapStripePriceToTier,
  stripe,
  subscriptionPeriodEnd,
  tierForPriceId,
  tierForSubscription,
  type Tier,
} from "@/lib/stripe";
import {
  sendPaymentFailedEmail,
  sendPaymentReceiptEmail,
  sendSubscriptionConfirmationEmail,
} from "@/lib/email";
import { applyTierToBucket } from "@/lib/usage/quota";

async function applyTierBucketSafely(userId: string, tier: string): Promise<void> {
  try {
    await applyTierToBucket(userId, tier);
  } catch (error) {
    // Bucket sync is observability/quota only — never block Stripe on it.
    console.error("stripe.webhook.bucket_sync_failed", {
      user_id: userId,
      tier,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// Vercel serverless functions have a 10s timeout on Hobby / 60s on Pro.
// Email rendering + Resend round-trips can eat most of that budget on cold
// starts, so we kick emails off without awaiting and log failures. The
// critical Postgres updates still run synchronously before we respond — so
// a failed/delayed email never blocks Stripe from getting a 200.
function fireAndForget(name: string, promise: Promise<unknown>): void {
  promise.catch((error) => {
    console.error(`stripe.webhook.${name}.email_failed`, error);
  });
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function baseUrl(): string {
  return process.env.NEXT_PUBLIC_BASE_URL ?? "https://www.tryeri.ca";
}

function billingPortalUrl(): string {
  return new URL("/billing/portal", baseUrl()).toString();
}

function logEvent(event: Stripe.Event, extra?: Record<string, unknown>): void {
  console.info("stripe.webhook", {
    id: event.id,
    type: event.type,
    livemode: event.livemode,
    ...extra,
  });
}

async function userForCustomer(customerId: string): Promise<UserRow | null> {
  return getUserByStripeCustomerId(customerId);
}

async function userById(userId: string): Promise<UserRow | null> {
  return getUserById(userId);
}

function customerIdFrom(
  ref: string | Stripe.Customer | Stripe.DeletedCustomer | null,
): string | null {
  if (!ref) return null;
  return typeof ref === "string" ? ref : ref.id;
}

async function applySubscription(
  subscription: Stripe.Subscription,
): Promise<UserRow | null> {
  const customerId = customerIdFrom(subscription.customer);
  if (!customerId) return null;
  // Robust resolution: price metadata → known price IDs → product (the latter
  // survives price migrations, so legacy subscribers no longer fall to free).
  const tier: Tier = await tierForSubscription(subscription);

  const userId = subscription.metadata?.user_id;
  const update = {
    tier,
    stripe_subscription_id: subscription.id,
    subscription_status: subscription.status,
    current_period_end: subscriptionPeriodEnd(subscription),
  };
  if (userId) {
    await applySubscriptionByUserId(userId, update);
    const refreshed = await userById(userId);
    if (refreshed) await applyTierBucketSafely(refreshed.id, refreshed.tier);
    return refreshed;
  }
  await applySubscriptionByCustomerId(customerId, update);
  const refreshed = await userForCustomer(customerId);
  if (refreshed) await applyTierBucketSafely(refreshed.id, refreshed.tier);
  return refreshed;
}

async function clearSubscription(subscription: Stripe.Subscription): Promise<void> {
  const customerId = customerIdFrom(subscription.customer);
  if (!customerId) return;
  await clearSubscriptionByCustomerId(
    customerId,
    subscription.status,
    subscriptionPeriodEnd(subscription),
  );
  const user = await userForCustomer(customerId);
  if (user) await applyTierBucketSafely(user.id, "free");
}

function customerIdFromInvoice(invoice: Stripe.Invoice): string | null {
  return customerIdFrom(invoice.customer);
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
  const PAID_TIERS = ["starter", "pro", "pro_plus", "teams"] as const;
  type PaidTier = (typeof PAID_TIERS)[number];
  const isPaid = (value: string): value is PaidTier =>
    (PAID_TIERS as ReadonlyArray<string>).includes(value);
  if (!isPaid(user.tier)) return;
  fireAndForget(
    "subscription_confirmation",
    sendSubscriptionConfirmationEmail({
      to: user.email,
      tier: user.tier,
      manageUrl: billingPortalUrl(),
    }),
  );
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
  fireAndForget(
    "payment_receipt",
    sendPaymentReceiptEmail({
      to: user.email,
      amountUsd,
      tier: tierFromInvoice(invoice),
      periodStart,
      periodEnd,
      manageUrl: billingPortalUrl(),
    }),
  );
}

async function handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const customerId = customerIdFromInvoice(invoice);
  if (!customerId) return;
  const user = await userForCustomer(customerId);
  if (!user) return;
  fireAndForget(
    "payment_failed",
    sendPaymentFailedEmail({
      to: user.email,
      retryUrl: billingPortalUrl(),
    }),
  );
}

// SCA/3DS authentication required on a recurring charge. Stripe keeps the
// invoice open; treat as a soft payment failure so the user gets nudged into
// the portal to complete the auth challenge.
async function handlePaymentActionRequired(invoice: Stripe.Invoice): Promise<void> {
  await handlePaymentFailed(invoice);
}

// After Stripe's dunning sequence exhausts retries, the invoice is marked
// uncollectible. Drop the user to free; their access ends now.
async function handleInvoiceUncollectible(invoice: Stripe.Invoice): Promise<void> {
  const customerId = customerIdFromInvoice(invoice);
  if (!customerId) return;
  await clearSubscriptionByCustomerId(customerId, "unpaid", invoice.period_end);
}

// Full refunds revoke access; partial refunds we leave alone (might be
// goodwill credit, prorated downgrade, etc.).
async function handleChargeRefunded(charge: Stripe.Charge): Promise<void> {
  const customerId = customerIdFrom(charge.customer);
  if (!customerId) return;
  const fullyRefunded = charge.amount_refunded >= charge.amount;
  if (!fullyRefunded) return;
  await clearSubscriptionByCustomerId(
    customerId,
    "refunded",
    Math.floor(Date.now() / 1000),
  );
}

// A chargeback was opened. Don't auto-downgrade — that hurts good-faith
// users who got their card stolen. Log loudly so we can investigate.
async function handleDisputeCreated(dispute: Stripe.Dispute): Promise<void> {
  const charge = dispute.charge;
  const chargeId = typeof charge === "string" ? charge : charge.id;
  console.warn("stripe.dispute.created", {
    dispute_id: dispute.id,
    charge_id: chargeId,
    amount: dispute.amount,
    reason: dispute.reason,
    status: dispute.status,
  });
}

async function handleDisputeClosed(dispute: Stripe.Dispute): Promise<void> {
  console.warn("stripe.dispute.closed", {
    dispute_id: dispute.id,
    status: dispute.status,
    outcome: dispute.status === "lost" ? "lost" : "won_or_other",
  });
  // If we lost, Stripe already pulled the funds back. Revoke access too.
  if (dispute.status !== "lost") return;
  const charge = dispute.charge;
  if (typeof charge === "string") return;
  const customerId = customerIdFrom(charge.customer);
  if (!customerId) return;
  await clearSubscriptionByCustomerId(
    customerId,
    "disputed",
    Math.floor(Date.now() / 1000),
  );
}

// Radar gives us a heads-up that a charge is *probably* about to be disputed.
// Don't act automatically — but log for review.
async function handleEarlyFraudWarning(
  warning: Stripe.Radar.EarlyFraudWarning,
): Promise<void> {
  const charge = warning.charge;
  const chargeId = typeof charge === "string" ? charge : charge.id;
  console.warn("stripe.radar.early_fraud_warning", {
    warning_id: warning.id,
    charge_id: chargeId,
    fraud_type: warning.fraud_type,
    actionable: warning.actionable,
  });
}

async function handleSubscriptionPaused(
  subscription: Stripe.Subscription,
): Promise<void> {
  const customerId = customerIdFrom(subscription.customer);
  if (!customerId) return;
  await clearSubscriptionByCustomerId(
    customerId,
    "paused",
    subscriptionPeriodEnd(subscription),
  );
}

async function handleSubscriptionResumed(
  subscription: Stripe.Subscription,
): Promise<void> {
  await applySubscription(subscription);
}

// Stripe sends this ~3 days before a trial ends. Useful for nudge emails;
// for now we just log so we have visibility when we wire that template up.
async function handleTrialWillEnd(subscription: Stripe.Subscription): Promise<void> {
  const customerId = customerIdFrom(subscription.customer);
  console.info("stripe.subscription.trial_will_end", {
    subscription_id: subscription.id,
    customer_id: customerId,
    trial_end: subscription.trial_end,
  });
}

// Sent ~24h before a renewal invoice finalizes. Useful for "your card will
// be charged $X tomorrow" reminders — log only for now.
async function handleInvoiceUpcoming(invoice: Stripe.Invoice): Promise<void> {
  console.info("stripe.invoice.upcoming", {
    customer_id: customerIdFromInvoice(invoice),
    amount_due: invoice.amount_due,
    next_payment_attempt: invoice.next_payment_attempt,
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
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  try {
    switch (event.type) {
      // ── subscription lifecycle ─────────────────────────────────────────
      case "customer.subscription.created":
        await handleSubscriptionCreated(event.data.object);
        break;
      case "customer.subscription.updated":
        await applySubscription(event.data.object);
        break;
      case "customer.subscription.deleted":
        await clearSubscription(event.data.object);
        break;
      case "customer.subscription.paused":
        await handleSubscriptionPaused(event.data.object);
        break;
      case "customer.subscription.resumed":
        await handleSubscriptionResumed(event.data.object);
        break;
      case "customer.subscription.trial_will_end":
        await handleTrialWillEnd(event.data.object);
        break;

      // ── checkout ───────────────────────────────────────────────────────
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
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
      case "checkout.session.async_payment_failed":
      case "checkout.session.expired":
        logEvent(event);
        break;

      // ── invoice / payment ──────────────────────────────────────────────
      case "invoice.payment_succeeded":
        await handlePaymentSucceeded(event.data.object);
        break;
      case "invoice.payment_failed":
        await handlePaymentFailed(event.data.object);
        break;
      case "invoice.payment_action_required":
        await handlePaymentActionRequired(event.data.object);
        break;
      case "invoice.marked_uncollectible":
        await handleInvoiceUncollectible(event.data.object);
        break;
      case "invoice.upcoming":
        await handleInvoiceUpcoming(event.data.object);
        break;
      case "invoice.finalized":
      case "invoice.created":
      case "invoice.paid":
        logEvent(event);
        break;

      // ── customer ───────────────────────────────────────────────────────
      case "customer.created":
      case "customer.updated":
      case "customer.deleted":
        logEvent(event);
        break;

      // ── payment methods ────────────────────────────────────────────────
      case "payment_method.attached":
      case "payment_method.detached":
      case "payment_method.updated":
        logEvent(event);
        break;

      // ── refunds, disputes, fraud ───────────────────────────────────────
      case "charge.refunded":
        await handleChargeRefunded(event.data.object);
        break;
      case "charge.refund.updated":
        logEvent(event);
        break;
      case "charge.dispute.created":
        await handleDisputeCreated(event.data.object);
        break;
      case "charge.dispute.closed":
        await handleDisputeClosed(event.data.object);
        break;
      case "charge.dispute.updated":
      case "charge.dispute.funds_withdrawn":
      case "charge.dispute.funds_reinstated":
        logEvent(event);
        break;
      case "radar.early_fraud_warning.created":
      case "radar.early_fraud_warning.updated":
        await handleEarlyFraudWarning(event.data.object);
        break;

      default:
        logEvent(event, { unhandled: true });
        break;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    console.error("stripe webhook handler failed", {
      type: event.type,
      id: event.id,
      message,
      stack,
    });
    return NextResponse.json(
      { error: "Webhook handler failed." },
      { status: 500 },
    );
  }
  return NextResponse.json({ received: true }, { status: 200 });
}
