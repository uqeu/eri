import { strict as assert } from "node:assert";
import type Stripe from "stripe";
import {
  priceIdForPlan,
  tierForSubscription,
  tierFromProductName,
} from "../stripe";

// Plain tsx script (matches the other lib/__tests__ files): top-level asserts,
// throws on failure, logs + exits 0 on success. Guards the tier resolver that
// a legacy Stripe price ($45 Pro+, no metadata.tier, price ID absent from the
// table) used to mis-resolve to `free`, dropping paying subscribers.

// Minimal Stripe.Subscription with a single item. `product` may be a bare ID
// string or an expanded Product object — tierForSubscription only reads status
// and the first item's price.{metadata,id,product}.
function subscriptionWith(opts: {
  status?: Stripe.Subscription.Status;
  priceId?: string;
  priceMetadataTier?: string;
  product?: string | { name?: string; metadata?: Record<string, string> };
}): Stripe.Subscription {
  const product = opts.product ?? "prod_unknown";
  return {
    status: opts.status ?? "active",
    items: {
      data: [
        {
          price: {
            id: opts.priceId ?? "price_legacy_unmapped",
            metadata: opts.priceMetadataTier
              ? { tier: opts.priceMetadataTier }
              : {},
            product,
          },
        },
      ],
    },
  } as unknown as Stripe.Subscription;
}

// tierFromProductName: Pro+ must win over Pro (substring trap).
assert.equal(tierFromProductName("eri Pro+"), "pro_plus");
assert.equal(tierFromProductName("eri Pro Plus"), "pro_plus");
assert.equal(tierFromProductName("eri Pro"), "pro");
assert.equal(tierFromProductName("eri Starter"), "starter");
assert.equal(tierFromProductName(""), "free");
assert.equal(tierFromProductName(null), "free");
assert.equal(tierFromProductName("Some Other Thing"), "free");

// Async cases wrapped in a main() — this runner transpiles to CJS, where
// top-level await isn't allowed. A rejection exits non-zero so failures fail.
async function main(): Promise<void> {
  // Live price metadata.tier resolves first.
  assert.equal(
    await tierForSubscription(
      subscriptionWith({ priceMetadataTier: "pro_plus" }),
    ),
    "pro_plus",
  );

  // A known current price ID resolves.
  assert.equal(
    await tierForSubscription(
      subscriptionWith({ priceId: priceIdForPlan("pro", "monthly") }),
    ),
    "pro",
  );

  // The exact production bug: legacy archived price, no metadata.tier, price ID
  // absent from the table — must still resolve to pro_plus via the product.
  assert.equal(
    await tierForSubscription(
      subscriptionWith({
        priceId: "price_1TZEdsLEGACY",
        product: { name: "eri Pro+", metadata: {} },
      }),
    ),
    "pro_plus",
  );

  // Product metadata.tier beats the product name.
  assert.equal(
    await tierForSubscription(
      subscriptionWith({
        product: { name: "Mislabeled Legacy", metadata: { tier: "pro" } },
      }),
    ),
    "pro",
  );

  // A non-active subscription never grants a paid tier.
  assert.equal(
    await tierForSubscription(
      subscriptionWith({ status: "canceled", priceMetadataTier: "pro_plus" }),
    ),
    "free",
  );

  console.log(
    "stripe-tier.test.ts: tier resolution (incl. legacy price recovery) OK",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
