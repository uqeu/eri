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

// Test-mode (sandbox) price IDs in the eri labs Stripe account
// (acct_1TYCWf4evv030ZvB). Locked tier prices: $15 Starter / $30 Pro /
// $60 Pro+ / $30 Teams. Pro + Pro+ migrated 2026-05-25 from $25/$45 →
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
