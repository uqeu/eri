"use client";

import { useEffect, useState } from "react";
import { authedFetch, useUser } from "@/lib/auth-client";

type BillingCadence = "monthly" | "yearly";
type PaidPlan = "starter" | "pro" | "pro_plus" | "teams";

interface SubscriptionSummary {
  tier: string;
  status: string | null;
  current_period_end: number | null;
  cancel_at_period_end: boolean;
}

function isSubscription(value: unknown): value is SubscriptionSummary {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.tier === "string";
}

function extractUrl(value: unknown): string | null {
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { url?: unknown }).url === "string"
  ) {
    return (value as { url: string }).url;
  }
  return null;
}

function extractError(value: unknown): string | null {
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { error?: unknown }).error === "string"
  ) {
    return (value as { error: string }).error;
  }
  return null;
}

interface PlanCardProps {
  name: string;
  price: string;
  priceSuffix: string;
  features: ReadonlyArray<string>;
  highlighted: boolean;
  current: boolean;
  action: { label: string; onClick: () => void; disabled?: boolean } | null;
}

function PlanCard({
  name,
  price,
  priceSuffix,
  features,
  highlighted,
  current,
  action,
}: PlanCardProps) {
  return (
    <div
      className={`rounded-lg p-6 flex flex-col ${
        highlighted
          ? "border-2 border-accent bg-accent/5"
          : "border border-white/10 bg-white/[0.02]"
      }`}
    >
      <div className="flex items-center justify-between">
        <h3 className="font-display text-2xl tracking-tight">{name}</h3>
        {current && (
          <span className="text-xs uppercase tracking-[0.2em] text-accent">
            Current
          </span>
        )}
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="font-display text-3xl text-paper">{price}</span>
        {priceSuffix && (
          <span className="text-muted text-sm">{priceSuffix}</span>
        )}
      </div>
      <ul className="mt-6 space-y-2 text-sm text-muted flex-1">
        {features.map((feature) => (
          <li key={feature} className="flex gap-2">
            <span className="text-accent" aria-hidden>
              ✓
            </span>
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          disabled={action.disabled}
          className={`mt-6 px-4 py-3 rounded-md text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed ${
            highlighted
              ? "ship-gradient ship-gradient-hover text-ink"
              : "border border-white/20 hover:border-accent text-paper"
          }`}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

interface PlanDef {
  slug: "free" | PaidPlan;
  name: string;
  priceMonthly: string;
  priceYearly: string;
  cadenceLabel: string;
  features: ReadonlyArray<string>;
}

const PLAN_DEFS: ReadonlyArray<PlanDef> = [
  {
    slug: "free",
    name: "Free",
    priceMonthly: "$0",
    priceYearly: "$0",
    cadenceLabel: "",
    features: [
      "$5 of monthly credits",
      "Local voice + gaze sidecars",
      "Community support",
    ],
  },
  {
    slug: "starter",
    name: "Starter",
    priceMonthly: "$20",
    priceYearly: "$200",
    cadenceLabel: "",
    features: [
      "$20 of monthly credits",
      "eri Engine diffusion code-gen",
      "Email support",
    ],
  },
  {
    slug: "pro",
    name: "Pro",
    priceMonthly: "$30",
    priceYearly: "$300",
    cadenceLabel: "",
    features: [
      "$30 of monthly credits",
      "Priority diffusion lane",
      "Voice library access",
      "Priority support",
    ],
  },
  {
    slug: "pro_plus",
    name: "Pro+",
    priceMonthly: "$60",
    priceYearly: "$600",
    cadenceLabel: "",
    features: [
      "Everything in Pro",
      "5x credit allowance",
      "Frontier model lane",
      "Cloud agents",
    ],
  },
  {
    slug: "teams",
    name: "Teams",
    priceMonthly: "$40",
    priceYearly: "$400",
    cadenceLabel: "per seat",
    features: [
      "Everything in Pro",
      "Shared team context",
      "SSO via SAML / OIDC",
      "Centralized billing",
    ],
  },
];

export default function BillingPage() {
  const { user } = useUser();
  const [subscription, setSubscription] = useState<SubscriptionSummary | null>(
    null,
  );
  const [cadence, setCadence] = useState<BillingCadence>("monthly");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const response = await authedFetch("/api/billing/subscription");
        if (!response.ok) return;
        const body: unknown = await response.json();
        if (!cancelled && isSubscription(body)) setSubscription(body);
      } catch {
        // ignore
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [user]);

  async function upgrade(plan: PaidPlan): Promise<void> {
    setPending(`upgrade-${plan}`);
    setError(null);
    try {
      const response = await authedFetch("/api/billing/checkout", {
        method: "POST",
        body: { plan, billing: cadence },
      });
      const body: unknown = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(extractError(body) ?? "Could not start checkout.");
        return;
      }
      const url = extractUrl(body);
      if (url) window.location.href = url;
    } catch {
      setError("Network error. Try again.");
    } finally {
      setPending(null);
    }
  }

  async function openPortal(): Promise<void> {
    setPending("portal");
    setError(null);
    try {
      const response = await authedFetch("/api/billing/portal", {
        method: "POST",
        body: {},
      });
      const body: unknown = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(extractError(body) ?? "Could not open billing portal.");
        return;
      }
      const url = extractUrl(body);
      if (url) window.location.href = url;
    } catch {
      setError("Network error. Try again.");
    } finally {
      setPending(null);
    }
  }

  if (!user) return null;

  const tier = subscription?.tier ?? user.tier;
  const PAID_TIERS: ReadonlyArray<PaidPlan> = [
    "starter",
    "pro",
    "pro_plus",
    "teams",
  ];
  const isPaidTier = (value: string): value is PaidPlan =>
    (PAID_TIERS as ReadonlyArray<string>).includes(value);

  function actionFor(planSlug: "free" | PaidPlan): PlanCardProps["action"] {
    if (planSlug === tier) {
      // Current plan: Free has no action; paid lets the user open the portal.
      if (planSlug === "free") return null;
      return {
        label: pending === "portal" ? "Opening…" : "Manage billing",
        onClick: () => {
          void openPortal();
        },
        disabled: pending !== null,
      };
    }
    if (planSlug === "free") {
      // Downgrading to free always goes through the portal.
      return {
        label: "Downgrade via portal",
        onClick: () => {
          void openPortal();
        },
        disabled: pending !== null,
      };
    }
    // Cross-plan moves between paid tiers also flow through the portal so
    // proration stays in Stripe's hands; only Free→paid hits checkout.
    if (isPaidTier(tier) && planSlug !== tier) {
      return {
        label: pending === "portal" ? "Opening…" : "Switch via portal",
        onClick: () => {
          void openPortal();
        },
        disabled: pending !== null,
      };
    }
    const labelBusy = pending === `upgrade-${planSlug}` ? "Redirecting…" : null;
    const niceName = PLAN_DEFS.find((p) => p.slug === planSlug)?.name ?? planSlug;
    return {
      label: labelBusy ?? `Upgrade to ${niceName}`,
      onClick: () => {
        void upgrade(planSlug);
      },
      disabled: pending !== null,
    };
  }

  return (
    <div className="max-w-7xl">
      <p className="text-xs uppercase tracking-[0.25em] text-accent">Billing</p>
      <h1 className="mt-3 font-display text-4xl md:text-5xl tracking-tight">
        Plans &amp; billing
      </h1>
      <p className="mt-4 text-muted max-w-2xl">
        You're currently on the <span className="text-paper">{tier}</span> plan.
        Upgrade or downgrade any time — changes prorate automatically.
      </p>

      <div className="mt-6 flex items-center gap-3">
        <div
          role="tablist"
          aria-label="Billing cadence"
          className="inline-flex rounded-full border border-white/10 bg-white/[0.02] p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={cadence === "monthly"}
            onClick={() => setCadence("monthly")}
            className={`px-4 py-2 text-sm rounded-full transition ${
              cadence === "monthly"
                ? "bg-accent text-ink"
                : "text-muted hover:text-paper"
            }`}
          >
            Monthly
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={cadence === "yearly"}
            onClick={() => setCadence("yearly")}
            className={`px-4 py-2 text-sm rounded-full transition ${
              cadence === "yearly"
                ? "bg-accent text-ink"
                : "text-muted hover:text-paper"
            }`}
          >
            Yearly
          </button>
        </div>
        {cadence === "yearly" && (
          <span className="text-xs uppercase tracking-[0.18em] text-accent">
            Save 2 months
          </span>
        )}
      </div>

      {error && (
        <p className="mt-6 text-sm text-red-400" role="alert">
          {error}
        </p>
      )}

      <div className="mt-10 grid gap-6 lg:grid-cols-5 md:grid-cols-2">
        {PLAN_DEFS.map((plan) => {
          const price =
            plan.slug === "free"
              ? plan.priceMonthly
              : cadence === "yearly"
                ? plan.priceYearly
                : plan.priceMonthly;
          const priceSuffix =
            plan.slug === "free"
              ? ""
              : cadence === "yearly"
                ? plan.cadenceLabel
                  ? `${plan.cadenceLabel} / year`
                  : "/ year"
                : plan.cadenceLabel
                  ? `${plan.cadenceLabel} / month`
                  : "/ month";
          return (
            <PlanCard
              key={plan.slug}
              name={plan.name}
              price={price}
              priceSuffix={priceSuffix}
              features={plan.features}
              highlighted={tier === plan.slug}
              current={tier === plan.slug}
              action={actionFor(plan.slug)}
            />
          );
        })}
      </div>
    </div>
  );
}
