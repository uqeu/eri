"use client";

import { useEffect, useState, type ReactNode } from "react";
import { authedFetch, useUser } from "@/lib/auth-client";

type BillingCadence = "monthly" | "yearly";
type PaidPlan = "starter" | "pro" | "pro_plus" | "teams";
type PlanSlug = "free" | PaidPlan;

interface SubscriptionSummary {
  tier: string;
  status: string | null;
  current_period_end: number | null;
  cancel_at_period_end: boolean;
}

interface UsageSummary {
  spend_usd: number;
  budget_usd: number;
  tokens: number;
}

interface RawUsageSummary {
  this_month_usd?: unknown;
  this_month_tokens?: unknown;
  limit_usd?: unknown;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function isSubscription(value: unknown): value is SubscriptionSummary {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.tier === "string";
}

function readUsageSummary(value: unknown): UsageSummary | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as RawUsageSummary;
  const spend = asNumber(raw.this_month_usd);
  const budget = asNumber(raw.limit_usd);
  const tokens = asNumber(raw.this_month_tokens);
  if (spend === null || budget === null || tokens === null) return null;
  return { spend_usd: spend, budget_usd: budget, tokens };
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

interface PlanDef {
  slug: PlanSlug;
  name: string;
  priceMonthly: number;
  priceYearly: number;
  cadenceSuffix: string;
  blurb: string;
}

// Self-serve plans only. Teams is sales-led — users can land on the Teams
// tier in DB if we provision it manually, but they can't pick it themselves
// from the in-app picker.
const PLAN_DEFS: ReadonlyArray<PlanDef> = [
  {
    slug: "free",
    name: "Free",
    priceMonthly: 0,
    priceYearly: 0,
    cadenceSuffix: "",
    blurb: "For exploring eri",
  },
  {
    slug: "starter",
    name: "Starter",
    priceMonthly: 15,
    priceYearly: 144,
    cadenceSuffix: "",
    blurb: "For solo developers",
  },
  {
    slug: "pro",
    name: "Pro",
    priceMonthly: 25,
    priceYearly: 240,
    cadenceSuffix: "",
    blurb: "For daily eri use",
  },
  {
    slug: "pro_plus",
    name: "Pro+",
    priceMonthly: 45,
    priceYearly: 432,
    cadenceSuffix: "",
    blurb: "Power user tier",
  },
];

// Used only for resolving the hero display when a user has a sales-provisioned
// tier (Teams, Enterprise) that isn't shown in the self-serve picker.
const NON_SELF_SERVE_PLANS: Record<string, PlanDef> = {
  teams: {
    slug: "teams" as PlanSlug,
    name: "Teams",
    priceMonthly: 0,
    priceYearly: 0,
    cadenceSuffix: "",
    blurb: "Provisioned by our team",
  },
  enterprise: {
    slug: "free" as PlanSlug,
    name: "Enterprise",
    priceMonthly: 0,
    priceYearly: 0,
    cadenceSuffix: "",
    blurb: "Custom contract",
  },
};

function planDefFor(slug: string): PlanDef {
  return (
    PLAN_DEFS.find((p) => p.slug === slug) ??
    NON_SELF_SERVE_PLANS[slug] ??
    PLAN_DEFS[0]
  );
}

function formatPrice(n: number): string {
  return `$${n}`;
}

function formatDate(unix: number | null): string {
  if (!unix) return "—";
  return new Date(unix * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function PlanIcon() {
  return (
    <svg
      width="56"
      height="56"
      viewBox="0 0 56 56"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <linearGradient id="planGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity="0.4" />
          <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity="0.05" />
        </linearGradient>
      </defs>
      <circle cx="28" cy="28" r="3" fill="hsl(var(--accent))" />
      <circle
        cx="28"
        cy="28"
        r="9"
        stroke="hsl(var(--accent))"
        strokeOpacity="0.5"
        strokeWidth="1.2"
        fill="url(#planGrad)"
      />
      <circle
        cx="28"
        cy="28"
        r="17"
        stroke="hsl(var(--accent))"
        strokeOpacity="0.25"
        strokeWidth="1"
      />
      <circle
        cx="28"
        cy="28"
        r="25"
        stroke="hsl(var(--accent))"
        strokeOpacity="0.1"
        strokeWidth="1"
      />
      <circle cx="28" cy="11" r="1.8" fill="hsl(var(--accent))" opacity="0.7" />
      <circle cx="45" cy="28" r="1.8" fill="hsl(var(--accent))" opacity="0.5" />
      <circle cx="28" cy="45" r="1.8" fill="hsl(var(--accent))" opacity="0.5" />
      <circle cx="11" cy="28" r="1.8" fill="hsl(var(--accent))" opacity="0.5" />
    </svg>
  );
}

function CardGlyph() {
  return (
    <svg
      width="28"
      height="20"
      viewBox="0 0 28 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect width="28" height="20" rx="3" fill="#1A1F36" />
      <circle cx="11" cy="10" r="6" fill="#EB001B" />
      <circle cx="17" cy="10" r="6" fill="#F79E1B" />
      <path
        d="M14 5.5a6 6 0 0 0 0 9 6 6 0 0 0 0-9z"
        fill="#FF5A00"
      />
    </svg>
  );
}

interface RowProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}

function Row({ title, description, action }: RowProps) {
  return (
    <div className="flex items-center justify-between gap-6 py-4">
      <div className="min-w-0 flex-1">
        <div className="text-[14px] text-paper">{title}</div>
        {description && (
          <div className="mt-1 text-[13px] text-muted leading-relaxed">
            {description}
          </div>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

interface SectionProps {
  title: string;
  description?: string;
  children?: ReactNode;
}

function Section({ title, description, children }: SectionProps) {
  return (
    <section className="mt-10 first:mt-0">
      <div className="mb-2">
        <h2 className="text-[15px] font-medium text-paper">{title}</h2>
        {description && (
          <p className="mt-1 text-[12px] text-muted leading-relaxed">
            {description}
          </p>
        )}
      </div>
      <div className="divide-y divide-white/[0.06] border-t border-white/[0.06]">
        {children}
      </div>
    </section>
  );
}

export default function BillingPage() {
  const { user } = useUser();
  const [subscription, setSubscription] = useState<SubscriptionSummary | null>(
    null,
  );
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [cadence, setCadence] = useState<BillingCadence>("monthly");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<boolean>(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const [subRes, usageRes] = await Promise.all([
          authedFetch("/api/billing/subscription"),
          authedFetch("/api/usage/summary"),
        ]);
        if (!cancelled) {
          if (subRes.ok) {
            const body: unknown = await subRes.json();
            if (isSubscription(body)) setSubscription(body);
          }
          if (usageRes.ok) {
            const body: unknown = await usageRes.json();
            const parsed = readUsageSummary(body);
            if (parsed) setUsage(parsed);
          }
        }
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
  const currentPlan = planDefFor(tier);
  const isPaid = tier !== "free";
  const PAID_TIERS: ReadonlyArray<PaidPlan> = [
    "starter",
    "pro",
    "pro_plus",
    "teams",
  ];
  const isPaidTier = (value: string): value is PaidPlan =>
    (PAID_TIERS as ReadonlyArray<string>).includes(value);

  function actionFor(planSlug: PlanSlug): {
    label: string;
    onClick: () => void;
    disabled: boolean;
    style: "primary" | "ghost";
  } | null {
    if (planSlug === tier) return null;
    // Downgrade to Free still goes through the Stripe portal — cancellation
    // surveys and retention prompts live there.
    if (planSlug === "free") {
      return {
        label: pending === "portal" ? "Opening…" : "Downgrade via portal",
        onClick: () => {
          void openPortal();
        },
        disabled: pending !== null,
        style: "ghost",
      };
    }
    // Every other transition (Free→paid, paid→different paid) hits our
    // checkout route, which decides between in-app subscription update vs.
    // launching a fresh Checkout session.
    const niceName = planDefFor(planSlug).name;
    const isUpgradeFromPaid = isPaidTier(tier) && planSlug !== tier;
    return {
      label:
        pending === `upgrade-${planSlug}`
          ? isUpgradeFromPaid
            ? "Updating…"
            : "Redirecting…"
          : isUpgradeFromPaid
            ? `Switch to ${niceName}`
            : `Upgrade to ${niceName}`,
      onClick: () => {
        void upgrade(planSlug);
      },
      disabled: pending !== null,
      style: "primary",
    };
  }

  const renewLabel = (() => {
    if (!subscription?.current_period_end) return null;
    const date = formatDate(subscription.current_period_end);
    if (subscription.cancel_at_period_end) return `Cancels on ${date}`;
    return `Your subscription will auto renew on ${date}.`;
  })();

  const remaining = usage
    ? Math.max(0, usage.budget_usd - usage.spend_usd)
    : null;

  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-3xl md:text-4xl tracking-tight text-paper">
        Settings
      </h1>

      {error && (
        <div
          role="alert"
          className="mt-6 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-[13px] text-red-300"
        >
          {error}
        </div>
      )}

      <div className="mt-8">
        {/* Plan hero */}
        <div className="flex items-center justify-between gap-6 py-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="shrink-0">
              <PlanIcon />
            </div>
            <div className="min-w-0">
              <h2 className="text-[18px] font-medium text-paper">
                eri {currentPlan.name} plan
              </h2>
              {isPaid && (
                <p className="mt-0.5 text-[13px] text-paper/80">
                  {currentPlan.blurb}
                </p>
              )}
              <p className="mt-0.5 text-[12px] text-muted">
                {renewLabel ?? (isPaid ? "Active" : "No subscription yet")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setPicking((v) => !v)}
            className="shrink-0 border border-white/15 hover:border-paper text-paper px-3.5 py-1.5 rounded-md text-[13px] transition"
          >
            {picking ? "Close" : "Adjust plan"}
          </button>
        </div>

        {/* Inline plan picker */}
        {picking && (
          <div className="mt-2 rounded-lg border border-white/[0.08] bg-white/[0.015] p-5">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-[14px] font-medium text-paper">
                Choose a plan
              </h3>
              <div
                role="tablist"
                aria-label="Billing cadence"
                className="inline-flex rounded-full border border-white/10 bg-white/[0.02] p-0.5"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={cadence === "monthly"}
                  onClick={() => setCadence("monthly")}
                  className={`px-3 py-1 text-[12px] rounded-full transition ${
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
                  className={`px-3 py-1 text-[12px] rounded-full transition ${
                    cadence === "yearly"
                      ? "bg-accent text-ink"
                      : "text-muted hover:text-paper"
                  }`}
                >
                  Yearly
                </button>
              </div>
            </div>

            <ul className="mt-4 divide-y divide-white/[0.06]">
              {PLAN_DEFS.map((plan) => {
                const isCurrent = plan.slug === tier;
                const price =
                  cadence === "yearly" ? plan.priceYearly : plan.priceMonthly;
                const suffix =
                  plan.slug === "free"
                    ? ""
                    : plan.cadenceSuffix
                      ? `${plan.cadenceSuffix} / ${cadence === "yearly" ? "yr" : "mo"}`
                      : `/ ${cadence === "yearly" ? "yr" : "mo"}`;
                const action = actionFor(plan.slug);
                return (
                  <li
                    key={plan.slug}
                    className="py-3 grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-3 md:items-center"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[14px] text-paper">
                          {plan.name}
                        </span>
                        {isCurrent && (
                          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm bg-accent/20 text-accent border border-accent/30">
                            Current
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-[12px] text-muted">
                        {plan.blurb}
                      </p>
                    </div>
                    <div className="text-[13px] text-muted whitespace-nowrap">
                      <span className="text-paper">{formatPrice(price)}</span>
                      {suffix && <span className="ml-1">{suffix}</span>}
                    </div>
                    <div className="md:text-right">
                      {action ? (
                        <button
                          type="button"
                          onClick={action.onClick}
                          disabled={action.disabled}
                          className={`px-3 py-1.5 rounded-md text-[12px] transition disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap ${
                            action.style === "primary"
                              ? "btn-primary"
                              : "border border-white/15 hover:border-paper text-paper"
                          }`}
                        >
                          {action.label}
                        </button>
                      ) : (
                        <span className="text-[12px] text-muted">—</span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="mt-4 text-[12px] text-muted leading-relaxed">
              Need Teams or Enterprise?{" "}
              <a
                href="mailto:sales@tryeri.ca?subject=Teams%20plan"
                className="text-accent hover:underline"
              >
                Contact sales
              </a>
              .
            </p>
          </div>
        )}

        {/* Payment */}
        <Section title="Payment">
          <Row
            title={
              isPaid ? (
                <div className="flex items-center gap-3">
                  <CardGlyph />
                  <span>Card on file — managed via Stripe</span>
                </div>
              ) : (
                <span className="text-muted">No payment method on file</span>
              )
            }
            action={
              isPaid && (
                <button
                  type="button"
                  onClick={() => void openPortal()}
                  disabled={pending !== null}
                  className="border border-white/15 hover:border-paper text-paper px-3.5 py-1.5 rounded-md text-[13px] transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {pending === "portal" ? "Opening…" : "Update"}
                </button>
              )
            }
          />
        </Section>

        {/* Usage credits */}
        <Section
          title="Usage credits"
          description="Buy usage credits so you can keep using eri if you hit your monthly limit."
        >
          <Row
            title={
              usage ? `$${(remaining ?? 0).toFixed(2)}` : "—"
            }
            description={
              usage
                ? `Current balance — $${usage.spend_usd.toFixed(2)} of $${usage.budget_usd.toFixed(2)} used this period`
                : "Loading usage…"
            }
            action={
              <button
                type="button"
                disabled
                className="inline-flex items-center gap-2 border border-white/15 text-paper/60 px-3.5 py-1.5 rounded-md text-[13px] cursor-not-allowed"
                title="Coming soon"
              >
                <span>Buy more</span>
                <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm bg-accent/20 text-accent border border-accent/30">
                  Soon
                </span>
              </button>
            }
          />
          <Row
            title="Auto-reload"
            description="Automatically buy more usage credits when you're running low"
            action={
              <button
                type="button"
                disabled
                className="border border-white/15 text-paper/60 px-3.5 py-1.5 rounded-md text-[13px] cursor-not-allowed"
                title="Coming soon"
              >
                Turn on
              </button>
            }
          />
        </Section>

        {/* Invoices */}
        <Section title="Invoices">
          <Row
            title={
              isPaid
                ? "View and download invoices in the Stripe portal"
                : "No invoices yet"
            }
            action={
              isPaid && (
                <button
                  type="button"
                  onClick={() => void openPortal()}
                  disabled={pending !== null}
                  className="border border-white/15 hover:border-paper text-paper px-3.5 py-1.5 rounded-md text-[13px] transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  View invoices
                </button>
              )
            }
          />
        </Section>

        {/* Cancellation */}
        {isPaid && !subscription?.cancel_at_period_end && (
          <Section title="Cancellation">
            <Row
              title="Cancel plan"
              description="You'll keep access until the end of your current billing period."
              action={
                <button
                  type="button"
                  onClick={() => void openPortal()}
                  disabled={pending !== null}
                  className="bg-red-500/80 hover:bg-red-500 text-paper px-3.5 py-1.5 rounded-md text-[13px] transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
              }
            />
          </Section>
        )}
      </div>
    </div>
  );
}
