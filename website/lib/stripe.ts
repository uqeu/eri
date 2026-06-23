import Stripe from "stripe";

let cached: Stripe | null = null;

export function stripe(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY environment variable must be set");
  }
  cached = new Stripe(key, {
    apiVersion: "2024-11-20.acacia",
    typescript: true,
  });
  return cached;
}

// Teams is not offered right now — no per-seat plan. Kept out of PaidPlan so
// nobody can check out into it.
export type PaidPlan = "starter" | "pro" | "pro_plus";
export type BillingCadence = "monthly" | "yearly";
export type Tier = "free" | "starter" | "pro" | "pro_plus" | "enterprise";

// (env var name, customer-facing label) per (plan, cadence).
const PRICE_ENV: Record<PaidPlan, Record<BillingCadence, string>> = {
  starter: {
    monthly: "ERI_PRICE_STARTER",
    yearly: "ERI_PRICE_STARTER_YEARLY",
  },
  pro: {
    monthly: "ERI_PRICE_PRO",
    yearly: "ERI_PRICE_PRO_YEARLY",
  },
  pro_plus: {
    monthly: "ERI_PRICE_PRO_PLUS",
    yearly: "ERI_PRICE_PRO_PLUS_YEARLY",
  },
};

// Test-mode (sandbox) price IDs in the eri labs Stripe account
// (acct_1TYCWf4evv030ZvB). Locked tier prices: $15 Starter / $30 Pro /
// $60 Pro+. (Teams retired — no per-seat plan right now.) Pro + Pro+
// migrated 2026-05-25 from $25/$45 →
// $30/$60; the old prices live on but are `active: false` so existing
// subscriptions keep resolving via `tierForPriceId`. All new prices carry
// `metadata.tier` so the webhook resolves via `mapStripePriceToTier`
// without depending on this fallback table.
const TEST_PRICE_IDS: Record<PaidPlan, Record<BillingCadence, string>> = {
  starter: {
    monthly: "price_1TZEdZ4evv030ZvBoREq7XUd",
    yearly: "price_1TZEde4evv030ZvBIwXkK6W4",
  },
  pro: {
    monthly: "price_1TatSf4evv030ZvBebjzOA1D", // $30/mo, metadata.tier=pro
    yearly: "price_1TatSi4evv030ZvBKCHTlvZg",  // $288/yr ($24/mo), metadata.tier=pro
  },
  pro_plus: {
    monthly: "price_1TatSk4evv030ZvB7Oavc2Kx", // $60/mo, metadata.tier=pro_plus
    yearly: "price_1TatSm4evv030ZvB3YG2YVZO",  // $576/yr ($48/mo), metadata.tier=pro_plus
  },
};

export function priceIdForPlan(
  plan: PaidPlan,
  cadence: BillingCadence = "monthly",
): string {
  const envName = PRICE_ENV[plan][cadence];
  const fromEnv = process.env[envName];
  if (fromEnv) return fromEnv;
  return TEST_PRICE_IDS[plan][cadence];
}

/**
 * Map a Stripe Price ID back to the eri tier slug. Checked across both
 * monthly and yearly price IDs so renewal webhooks land on the right tier
 * regardless of cadence.
 */
export function tierForPriceId(priceId: string): Tier {
  if (!priceId) return "free";
  for (const plan of Object.keys(PRICE_ENV) as PaidPlan[]) {
    for (const cadence of ["monthly", "yearly"] as const) {
      const envName = PRICE_ENV[plan][cadence];
      if (priceId === process.env[envName]) return plan;
      if (priceId === TEST_PRICE_IDS[plan][cadence]) return plan;
    }
  }
  return "free";
}

/**
 * Resolve a Stripe price's metadata `tier` field to the canonical eri tier
 * slug. Webhook handlers fall back to `tierForPriceId` when a price doesn't
 * carry tier metadata (older Stripe products predate this convention).
 */
export function mapStripePriceToTier(priceMetadataTier: string | null | undefined): Tier {
  if (!priceMetadataTier) return "free";
  const normalized = priceMetadataTier.trim().toLowerCase();
  switch (normalized) {
    case "free":
    case "starter":
    case "pro":
    case "pro_plus":
    case "enterprise":
      return normalized;
    // Tolerate a few common alternate spellings to match the voice layer.
    case "pro+":
    case "pro plus":
    case "proplus":
      return "pro_plus";
    // Legacy `teams`/`team` subscriptions (plan retired) resolve to free.
    default:
      return "free";
  }
}

/**
 * Last-resort tier resolution from a Stripe Product name. Products survive
 * price migrations (the $25→$30 Pro and $45→$60 Pro+ reprices in 2026-05
 * archived the old PRICES but kept the same PRODUCT), so a name match catches
 * legacy subscriptions whose price predates the `metadata.tier` convention and
 * isn't in the price-ID table. Pro+ is checked before Pro because "pro" is a
 * substring of "pro+".
 */
export function tierFromProductName(name: string | null | undefined): Tier {
  if (!name) return "free";
  const n = name.trim().toLowerCase();
  if (n.includes("pro+") || n.includes("pro plus") || n.includes("proplus")) {
    return "pro_plus";
  }
  if (n.includes("pro")) return "pro";
  if (n.includes("starter")) return "starter";
  if (n.includes("enterprise")) return "enterprise";
  return "free";
}

/**
 * Resolve a tier from a Stripe Product reference. Reads `product.metadata.tier`
 * first (set once per product, survives price churn), then falls back to the
 * product name. Fetches the product only when given a bare ID. Any failure
 * resolves to "free" and is logged loudly rather than throwing.
 */
async function tierForProduct(
  ref: string | Stripe.Product | Stripe.DeletedProduct | null,
): Promise<Tier> {
  if (!ref) return "free";
  let product: Stripe.Product | Stripe.DeletedProduct;
  if (typeof ref === "string") {
    try {
      product = await stripe().products.retrieve(ref);
    } catch (error) {
      console.error("stripe.tier.product_fetch_failed", {
        product: ref,
        error: error instanceof Error ? error.message : String(error),
      });
      return "free";
    }
  } else {
    product = ref;
  }
  if (product.deleted) return "free";
  const metaTier = product.metadata?.tier;
  if (metaTier) {
    const fromMeta = mapStripePriceToTier(metaTier);
    if (fromMeta !== "free") return fromMeta;
  }
  return tierFromProductName(product.name);
}

/**
 * Stripe moved `current_period_end` from Subscription to SubscriptionItem in
 * API version 2025-03-31. Read from the first item, fall back to the
 * subscription-level field for older webhooks, then to 0 so postgres-js never
 * receives `undefined`.
 */
export function subscriptionPeriodEnd(subscription: Stripe.Subscription): number {
  const firstItem = subscription.items.data[0] as
    | (Stripe.SubscriptionItem & { current_period_end?: number })
    | undefined;
  const fromItem = firstItem?.current_period_end;
  if (typeof fromItem === "number") return fromItem;
  const fromSub = (subscription as { current_period_end?: number })
    .current_period_end;
  if (typeof fromSub === "number") return fromSub;
  return 0;
}

/**
 * Canonical, robust tier resolution for a live Stripe subscription. Resolution
 * order, each step falling through only when it yields "free":
 *   1. `price.metadata.tier`   — new prices carry this
 *   2. `tierForPriceId(price.id)` — known current price IDs
 *   3. product metadata / name — survives the price migrations above
 *
 * Only `active`/`trialing` subscriptions grant a paid tier; every other status
 * (past_due, canceled, unpaid, paused, incomplete…) resolves to "free", which
 * matches the access semantics the webhook has always enforced.
 *
 * This is the fix for legacy subscribers (e.g. anyone on the archived $45 Pro+
 * price `price_1TZEds…`, whose empty metadata + untracked price ID made the
 * old resolver stamp them `free` despite an active paid subscription).
 */
export async function tierForSubscription(
  subscription: Stripe.Subscription,
): Promise<Tier> {
  if (subscription.status !== "active" && subscription.status !== "trialing") {
    return "free";
  }
  const item = subscription.items.data[0];
  if (!item) return "free";

  const metaTier = item.price.metadata?.tier;
  if (metaTier) {
    const fromMeta = mapStripePriceToTier(metaTier);
    if (fromMeta !== "free") return fromMeta;
  }

  const byPrice = tierForPriceId(item.price.id);
  if (byPrice !== "free") return byPrice;

  return tierForProduct(item.price.product);
}

export function monthlyLimitForTier(tier: string): number {
  switch (tier) {
    case "starter":
      return 20;
    case "pro":
      return 30;
    case "pro_plus":
      // 5x credit allowance vs Pro.
      return 150;
    case "enterprise":
      return 1000;
    default:
      return 5;
  }
}
