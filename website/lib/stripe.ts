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

export type PaidPlan = "starter" | "pro" | "pro_plus" | "teams";
export type BillingCadence = "monthly" | "yearly";
export type Tier = "free" | "starter" | "pro" | "pro_plus" | "teams" | "enterprise";

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
  teams: {
    monthly: "ERI_PRICE_TEAMS",
    yearly: "ERI_PRICE_TEAMS_YEARLY",
  },
};

// Test-mode (sandbox) price IDs created in the eri labs Stripe account on
// 2026-05-20 at the locked tier prices ($15 / $25 / $45 / $30). Used as a
// fallback when ERI_PRICE_* env vars aren't set, so the checkout flow works
// out of the box in dev. Production must override with live-mode IDs.
const TEST_PRICE_IDS: Record<PaidPlan, Record<BillingCadence, string>> = {
  starter: {
    monthly: "price_1TZEdZ4evv030ZvBoREq7XUd",
    yearly: "price_1TZEde4evv030ZvBIwXkK6W4",
  },
  pro: {
    monthly: "price_1TZEiR4evv030ZvBALDZ0WI1",
    yearly: "price_1TZEdo4evv030ZvBbgW93xHr",
  },
  pro_plus: {
    monthly: "price_1TZEds4evv030ZvBLyuqklxG",
    yearly: "price_1TZEdx4evv030ZvBqpxdekKS",
  },
  teams: {
    monthly: "price_1TZEe14evv030ZvBTIzgg3bX",
    yearly: "price_1TZEe54evv030ZvB8Si8Po2S",
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
    case "teams":
    case "enterprise":
      return normalized;
    // Tolerate a few common alternate spellings to match the voice layer.
    case "pro+":
    case "pro plus":
    case "proplus":
      return "pro_plus";
    case "team":
      return "teams";
    default:
      return "free";
  }
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
    case "teams":
      // Per-seat allowance, matched to Pro until the seat math lands.
      return 30;
    case "enterprise":
      return 1000;
    default:
      return 5;
  }
}
