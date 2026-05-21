"use client";

import { useState } from "react";
import Link from "next/link";
import { TierNumeral } from "@/components/TierNumeral";

type BillingCadence = "monthly" | "yearly";

type PlanSlug =
  | "free"
  | "starter"
  | "pro"
  | "pro_plus"
  | "teams"
  | "enterprise";

type GlyphValue =
  | { kind: "bool"; on: boolean }
  | { kind: "text"; label: string; tone?: "default" | "accent" | "muted" }
  | { kind: "limited" }
  | { kind: "expanded" }
  | { kind: "unlimited" }
  | { kind: "flexible" };

interface TurnLimits {
  monthly: number | "Pooled";
  weekly: number | "Pooled";
  daily: number | "Pooled";
  hourly: number | "Pooled";
  perSeat?: boolean;
}

interface Plan {
  name: React.ReactNode;
  shortName: string;
  subtitle: string;
  slug: PlanSlug;
  priceMonthly: number | "Custom" | "Free";
  priceYearlyAsMonthly: number | "Custom" | "Free";
  cadenceNote: string;
  tagline: string;
  includesHeader: string;
  turns: TurnLimits;
  features: ReadonlyArray<{ glyph: "full" | "half" | "ring"; label: string }>;
  cta: { href: string; label: string };
  ctaVariant: "primary" | "ghost";
  popular: boolean;
}

const PLANS: ReadonlyArray<Plan> = [
  {
    name: "Free",
    shortName: "Free",
    subtitle: "Stock Eri",
    slug: "free",
    priceMonthly: "Free",
    priceYearlyAsMonthly: "Free",
    cadenceNote: "forever",
    tagline: "For tinkerers who already have keys and want stock Eri.",
    includesHeader: "Includes",
    turns: { monthly: 50, weekly: 20, daily: 5, hourly: 2 },
    features: [
      { glyph: "full", label: "Stock Eri voice + diffusion edits" },
      { glyph: "full", label: "BYOK — eri Engine + ElevenLabs keys" },
      { glyph: "half", label: "Limited eri Engine calls" },
      { glyph: "full", label: "Templates + iteration history" },
      { glyph: "full", label: "Deploy to Vercel" },
      { glyph: "ring", label: "Community Discord support" },
    ],
    cta: { href: "/sign-up?plan=free", label: "Start free" },
    ctaVariant: "primary",
    popular: false,
  },
  {
    name: (
      <>
        Individual <TierNumeral n="I" />
      </>
    ),
    shortName: "Individual I",
    subtitle: "Adaptive Eri",
    slug: "starter",
    priceMonthly: 15,
    priceYearlyAsMonthly: 12,
    cadenceNote: "",
    tagline: "Eri that learns the way you build, session over session.",
    includesHeader: "Everything in Free, plus",
    turns: { monthly: 1839, weekly: 459, daily: 65, hourly: 8 },
    features: [
      { glyph: "full", label: "Cross-session memory" },
      { glyph: "full", label: "Pick eri's voice (premium ElevenLabs presets)" },
      { glyph: "full", label: "No Eri branding on shipped apps" },
      { glyph: "full", label: "Eri-cloud credits included" },
      { glyph: "half", label: "Expanded eri Engine quota" },
      { glyph: "ring", label: "Email support" },
    ],
    cta: { href: "/sign-up?plan=starter", label: "Get Individual I" },
    ctaVariant: "ghost",
    popular: false,
  },
  {
    name: (
      <>
        Individual <TierNumeral n="II" />
      </>
    ),
    shortName: "Individual II",
    subtitle: "Frontier Eri",
    slug: "pro",
    priceMonthly: 25,
    priceYearlyAsMonthly: 20,
    cadenceNote: "",
    tagline: "Adaptive plus frontier models and cloud agents.",
    includesHeader: "Everything in Individual I, plus",
    turns: { monthly: 3254, weekly: 813, daily: 116, hourly: 14 },
    features: [
      { glyph: "full", label: "Multi-model routing (eri Engine, GPT-4o, Claude, Gemini)" },
      { glyph: "full", label: "Cloud agents that work while you idle" },
      { glyph: "full", label: "Inline Cmd-K edits included" },
      { glyph: "full", label: "Custom MCP servers" },
      { glyph: "half", label: "128K frontier context window" },
      { glyph: "ring", label: "Priority email + Discord" },
    ],
    cta: { href: "/sign-up?plan=pro", label: "Get Individual II" },
    ctaVariant: "primary",
    popular: true,
  },
  {
    name: (
      <>
        Individual <TierNumeral n="III" />
      </>
    ),
    shortName: "Individual III",
    subtitle: "Personalized Eri",
    slug: "pro_plus",
    priceMonthly: 45,
    priceYearlyAsMonthly: 36,
    cadenceNote: "",
    tagline: "Eri trained on your patterns. Exclusive voices. Your private brain.",
    includesHeader: "Everything in Individual II, plus",
    turns: { monthly: 6084, weekly: 1521, daily: 217, hourly: 27 },
    features: [
      { glyph: "full", label: "Exclusive eri voices + voice-blending" },
      { glyph: "full", label: "Trained on your codebase patterns (locally)" },
      { glyph: "full", label: "Private brain — never pooled" },
      { glyph: "full", label: "256K frontier context window" },
      { glyph: "full", label: "Priority Claude polish queue" },
      { glyph: "ring", label: "Priority support" },
    ],
    cta: { href: "/sign-up?plan=pro_plus", label: "Get Individual III" },
    ctaVariant: "ghost",
    popular: false,
  },
  {
    name: "Teams",
    shortName: "Teams",
    subtitle: "Shared Brain",
    slug: "teams",
    priceMonthly: 30,
    priceYearlyAsMonthly: 24,
    cadenceNote: "per seat",
    tagline: "Everyone's Eri shares the same context.",
    includesHeader: "Everything in Individual III, plus",
    turns: { monthly: 3961, weekly: 990, daily: 141, hourly: 17, perSeat: true },
    features: [
      { glyph: "full", label: "Shared team brain across the org" },
      { glyph: "full", label: "Team-wide rules and skills" },
      { glyph: "full", label: "SAML / OIDC SSO" },
      { glyph: "full", label: "Audit logs" },
      { glyph: "full", label: "Per-seat usage analytics" },
      { glyph: "ring", label: "Centralized billing, one invoice" },
    ],
    cta: { href: "/sign-up?plan=teams", label: "Start with Teams" },
    ctaVariant: "ghost",
    popular: false,
  },
  {
    name: "Enterprise",
    shortName: "Enterprise",
    subtitle: "Custom",
    slug: "enterprise",
    priceMonthly: "Custom",
    priceYearlyAsMonthly: "Custom",
    cadenceNote: "",
    tagline: "Pooled usage, SCIM, dedicated AM, custom legal.",
    includesHeader: "Everything in Teams, plus",
    turns: { monthly: "Pooled", weekly: "Pooled", daily: "Pooled", hourly: "Pooled" },
    features: [
      { glyph: "full", label: "Pooled usage across the org" },
      { glyph: "full", label: "SCIM provisioning" },
      { glyph: "full", label: "Custom data retention" },
      { glyph: "full", label: "Data residency (US, EU, UK, JP)" },
      { glyph: "full", label: "Dedicated account manager" },
      { glyph: "ring", label: "Custom MSA + DPA" },
    ],
    cta: { href: "mailto:sales@eri.dev", label: "Contact sales" },
    ctaVariant: "ghost",
    popular: false,
  },
];

interface ComparisonRow {
  label: string;
  values: readonly [GlyphValue, GlyphValue, GlyphValue, GlyphValue, GlyphValue, GlyphValue];
  note?: string;
}

interface ComparisonCategory {
  title: string;
  rows: ReadonlyArray<ComparisonRow>;
}

const yes: GlyphValue = { kind: "bool", on: true };
const no: GlyphValue = { kind: "bool", on: false };
const limited: GlyphValue = { kind: "limited" };
const expanded: GlyphValue = { kind: "expanded" };
const unlimited: GlyphValue = { kind: "unlimited" };
const flexible: GlyphValue = { kind: "flexible" };
const text = (label: string, tone: "default" | "accent" | "muted" = "default"): GlyphValue => ({
  kind: "text",
  label,
  tone,
});

const COMPARISON: ReadonlyArray<ComparisonCategory> = [
  {
    title: "Models",
    rows: [
      {
        label: "eri Engine diffusion turns",
        values: [limited, expanded, unlimited, unlimited, flexible, flexible],
      },
      {
        label: "Inline Cmd-K edit turns",
        values: [no, yes, yes, yes, yes, yes],
      },
      {
        label: "GPT-4o / Claude / Gemini routing",
        values: [no, no, yes, yes, yes, yes],
      },
      {
        label: "Claude polish queue priority",
        values: [no, no, no, yes, yes, yes],
      },
      {
        label: "Frontier model context window",
        values: [
          text("27K"),
          text("54K"),
          text("128K"),
          text("256K"),
          text("256K"),
          text("256K"),
        ],
      },
    ],
  },
  {
    title: "Adaptive features",
    rows: [
      { label: "Cross-session memory", values: [no, yes, yes, yes, yes, yes] },
      { label: "Multi-model routing", values: [no, no, yes, yes, yes, yes] },
      { label: "Codebase-trained brain", values: [no, no, no, yes, yes, yes] },
      { label: "Private brain (never shared)", values: [no, no, no, yes, yes, yes] },
      { label: "Shared team brain", values: [no, no, no, no, yes, yes] },
    ],
  },
  {
    title: "Voice + interaction",
    rows: [
      { label: "Voice commands (always-listening)", values: [yes, yes, yes, yes, yes, yes] },
      { label: "Pick eri's voice (premium ElevenLabs presets)", values: [no, yes, yes, yes, yes, yes] },
      {
        label: "Exclusive eri voices + voice-blending",
        values: [no, no, no, yes, yes, yes],
      },
      {
        label: "Premium ElevenLabs preset library",
        values: [limited, yes, yes, yes, yes, yes],
      },
      { label: "Eye tracking", values: [yes, yes, yes, yes, yes, yes] },
      { label: "Cmd-K palette", values: [yes, yes, yes, yes, yes, yes] },
    ],
  },
  {
    title: "Privacy + data",
    rows: [
      { label: "Code stays on your machine", values: [yes, yes, yes, yes, yes, yes] },
      {
        label: "Used to train our models",
        values: [
          text("No", "accent"),
          text("No", "accent"),
          text("No", "accent"),
          text("No", "accent"),
          text("No", "accent"),
          text("No", "accent"),
        ],
      },
      {
        label: "Data residency",
        values: [
          text("US"),
          text("US"),
          text("US"),
          text("US"),
          text("US"),
          text("US · EU · UK · JP"),
        ],
      },
    ],
  },
  {
    title: "Security + admin",
    rows: [
      { label: "SSO (SAML / OIDC)", values: [no, no, no, no, yes, yes] },
      { label: "SCIM provisioning", values: [no, no, no, no, no, yes] },
      { label: "Audit logs", values: [no, no, no, no, yes, yes] },
      { label: "Custom data retention", values: [no, no, no, no, no, yes] },
      {
        label: "SOC 2 Type 2",
        note: "Coming Q3 2026",
        values: [
          text("Q3 2026", "muted"),
          text("Q3 2026", "muted"),
          text("Q3 2026", "muted"),
          text("Q3 2026", "muted"),
          text("Q3 2026", "muted"),
          text("Q3 2026", "muted"),
        ],
      },
    ],
  },
  {
    title: "Customer service",
    rows: [
      { label: "Community Discord", values: [yes, yes, yes, yes, yes, yes] },
      {
        label: "Email support",
        values: [
          no,
          no,
          yes,
          text("Priority", "accent"),
          text("Priority", "accent"),
          text("24/7 priority", "accent"),
        ],
      },
      { label: "Dedicated account manager", values: [no, no, no, no, no, yes] },
      { label: "Custom legal terms", values: [no, no, no, no, no, yes] },
    ],
  },
];

interface FaqItem {
  q: string;
  a: string;
}

const FAQ: ReadonlyArray<FaqItem> = [
  {
    q: "Can I cancel anytime?",
    a: "Yes. Cancel from your dashboard in one click. You keep access through the end of the billing period and can come back whenever — we don't lock you in.",
  },
  {
    q: "What happens to my apps if I downgrade?",
    a: "Your projects, iteration history, and deployed apps all stay. The only things that change are the cloud-only features (premium eri voice presets, removed branding, expanded eri Engine quotas). Your code is yours either way.",
  },
  {
    q: "What is BYOK?",
    a: "Bring Your Own Keys. On the Free plan, Eri uses your eri Engine and ElevenLabs API keys directly from your machine — we never see them or proxy them. Paid tiers use Eri-cloud credits so you don't need to manage keys.",
  },
  {
    q: "Do you offer student, non-profit, or open-source discounts?",
    a: "Yes. Email hello@eri.dev with a .edu address, a non-profit registration, or a link to your OSS project and we'll set you up. Case-by-case, real conversation, no coupon code.",
  },
  {
    q: "Refund policy?",
    a: "If you're unhappy within 30 days, email us and we'll refund the most recent month. No forms, no \"why are you leaving\" survey.",
  },
  {
    q: "Does the price include VAT / GST?",
    a: "Prices are listed in USD and exclude VAT, GST, and other local taxes. We add applicable taxes at checkout based on your billing address.",
  },
  {
    q: "Annual billing discount?",
    a: "Yearly billing saves you two months — the same monthly headline price, billed once a year. Switch cadence from your dashboard at any time.",
  },
  {
    q: "Frontier vs Personalized Eri?",
    a: "Frontier (Individual II) gives you multi-model routing — Eri picks between the eri Engine, Claude, GPT-4o, and Gemini per task. Personalized (Individual III) adds exclusive eri voices with voice-blending, locally-trained pattern recognition on your codebase, and a private brain that doesn't pool with other users. Frontier makes Eri smarter; Personalized makes Eri yours.",
  },
  {
    q: "Does Personalized Eri train on my code?",
    a: "No. Your code never leaves your machine. Personalization is local pattern recognition + cached embeddings via eri_cache — not training data shipped to a third party. The private brain is a per-user vector store living next to your project, not a fine-tune.",
  },
];

function Glyph({ glyph }: { glyph: "full" | "half" | "ring" }): React.ReactElement {
  const common = "inline-block w-3 h-3 rounded-full flex-shrink-0";
  if (glyph === "full") {
    return <span className={`${common} bg-accent`} aria-hidden />;
  }
  if (glyph === "half") {
    return (
      <span
        className={`${common} border border-accent`}
        style={{
          background:
            "linear-gradient(90deg, #E0FF4F 0%, #E0FF4F 50%, transparent 50%, transparent 100%)",
        }}
        aria-hidden
      />
    );
  }
  return <span className={`${common} border border-accent`} aria-hidden />;
}

function ValueCell({ value }: { value: GlyphValue }): React.ReactElement {
  if (value.kind === "bool") {
    return value.on ? (
      <span className="inline-flex w-4 h-4 items-center justify-center text-accent" aria-label="Yes">
        <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 8.5l3.5 3.5L13 4.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    ) : (
      <span className="text-muted/40 text-base leading-none" aria-label="Not included">—</span>
    );
  }
  if (value.kind === "limited") {
    return (
      <span className="inline-flex items-center gap-1.5 text-paper/85 text-xs">
        <span
          className="w-2.5 h-2.5 rounded-full border border-accent/70"
          style={{
            background:
              "linear-gradient(90deg, rgba(224,255,79,0.7) 0%, rgba(224,255,79,0.7) 50%, transparent 50%, transparent 100%)",
          }}
          aria-hidden
        />
        Limited
      </span>
    );
  }
  if (value.kind === "expanded") {
    return (
      <span className="inline-flex items-center gap-1.5 text-paper/85 text-xs">
        <span
          className="w-2.5 h-2.5 rounded-full border border-accent/70"
          style={{
            background:
              "conic-gradient(#E0FF4F 0deg 270deg, transparent 270deg 360deg)",
          }}
          aria-hidden
        />
        Expanded
      </span>
    );
  }
  if (value.kind === "unlimited") {
    return (
      <span className="inline-flex items-center gap-1.5 text-paper/95 text-xs">
        <span className="w-2.5 h-2.5 rounded-full bg-accent" aria-hidden />
        Unlimited<sup className="text-accent">*</sup>
      </span>
    );
  }
  if (value.kind === "flexible") {
    return (
      <span className="inline-flex items-center gap-1.5 text-paper/95 text-xs">
        <span className="w-2.5 h-2.5 rounded-full bg-accent/80" aria-hidden />
        Flexible<sup className="text-accent">**</sup>
      </span>
    );
  }
  const toneClass =
    value.tone === "accent" ? "text-accent" : value.tone === "muted" ? "text-muted" : "text-paper/85";
  return <span className={`text-xs tabular-nums ${toneClass}`}>{value.label}</span>;
}

function FaqRow({ item }: { item: FaqItem }): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-white/10 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-start justify-between gap-6 py-6 text-left transition hover:text-accent"
      >
        <span className="font-display text-lg sm:text-xl tracking-tight">{item.q}</span>
        <span
          className={`mt-2 text-accent transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      <div
        className="grid transition-all duration-300 ease-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <p className="pb-6 pr-10 text-muted leading-relaxed">{item.a}</p>
        </div>
      </div>
    </div>
  );
}

function formatPrice(value: number | "Custom" | "Free"): string {
  if (value === "Custom") return "Custom";
  if (value === "Free") return "$0";
  return `$${value}`;
}

interface PriceBlockProps {
  plan: Plan;
  cadence: BillingCadence;
}

function PriceBlock({ plan, cadence }: PriceBlockProps): React.ReactElement {
  const isCustom = plan.priceMonthly === "Custom";
  const isFree = plan.priceMonthly === "Free";
  const monthly = formatPrice(plan.priceMonthly);
  const yearlyAsMonthly = formatPrice(plan.priceYearlyAsMonthly);
  const current = cadence === "yearly" ? yearlyAsMonthly : monthly;
  const showStrikethrough =
    cadence === "yearly" && !isCustom && !isFree && monthly !== yearlyAsMonthly;

  return (
    <div className="mt-5">
      <div className="flex items-baseline gap-2 tabular-nums">
        {showStrikethrough && (
          <span className="font-mono text-sm text-muted line-through decoration-muted/60">
            {monthly}
          </span>
        )}
        <span className="font-display text-5xl tracking-tight leading-none transition-all">
          {current}
        </span>
        {!isCustom && (
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
            /mo
          </span>
        )}
      </div>
      <div className="mt-2 h-4">
        {plan.cadenceNote && (
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
            {plan.cadenceNote}
          </span>
        )}
        {cadence === "yearly" && !isCustom && !isFree && !plan.cadenceNote && (
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
            Billed yearly · save 2 mo
          </span>
        )}
      </div>
    </div>
  );
}

function formatTurnValue(value: number | "Pooled"): string {
  if (value === "Pooled") return "Pooled";
  return value.toLocaleString("en-US");
}

function TurnLimitsBlock({ turns }: { turns: TurnLimits }): React.ReactElement {
  const suffix = turns.perSeat ? " / seat" : "";
  return (
    <div className="mt-5 rounded-md border border-white/10 bg-white/[0.02] px-3 py-3">
      <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-muted">
        Voice turns
      </p>
      <div className="mt-2 grid grid-cols-4 gap-2">
        <div>
          <div className="font-mono text-[15px] tabular-nums text-paper leading-none">
            {formatTurnValue(turns.monthly)}
          </div>
          <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-muted">
            /mo{suffix}
          </div>
        </div>
        <div>
          <div className="font-mono text-[15px] tabular-nums text-paper leading-none">
            {formatTurnValue(turns.weekly)}
          </div>
          <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-muted">
            /wk soft
          </div>
        </div>
        <div>
          <div className="font-mono text-[15px] tabular-nums text-paper leading-none">
            {formatTurnValue(turns.daily)}
          </div>
          <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-muted">
            /day soft
          </div>
        </div>
        <div>
          <div className="font-mono text-[15px] tabular-nums text-paper leading-none">
            {formatTurnValue(turns.hourly)}
          </div>
          <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-muted">
            /hr burst
          </div>
        </div>
      </div>
    </div>
  );
}

function PlanCard({
  plan,
  cadence,
}: {
  plan: Plan;
  cadence: BillingCadence;
}): React.ReactElement {
  const isFree = plan.slug === "free";
  const isEnt = plan.slug === "enterprise";
  const href = isFree || isEnt ? plan.cta.href : `${plan.cta.href}&billing=${cadence}`;

  const ctaClass =
    plan.ctaVariant === "primary"
      ? "ship-gradient ship-gradient-hover text-ink"
      : "border border-white/15 text-paper hover:border-accent/60 hover:text-accent";

  const overlayGradient = plan.popular
    ? "linear-gradient(160deg, #181818 0%, #1c2a5c 55%, #2f9bff 110%)"
    : "linear-gradient(160deg, #181818 0%, #1f2747 60%, #228df2 110%)";

  return (
    <article
      tabIndex={0}
      className={`group relative overflow-hidden rounded-xl border p-6 flex flex-col transition-[transform,box-shadow,border-color] duration-300 ease-out hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/40 focus-within:-translate-y-0.5 focus-within:shadow-lg focus-within:shadow-black/40 focus:outline-none ${
        plan.popular
          ? "border-accent/60 bg-accent/[0.04] hover:border-accent focus-within:border-accent"
          : "border-white/10 bg-white/[0.02] hover:border-white/30 focus-within:border-white/30"
      }`}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 transition-[clip-path] duration-[400ms] [transition-timing-function:cubic-bezier(0.4,0,0.2,1)] [clip-path:polygon(0_100%,100%_100%,100%_100%,0_100%)] group-hover:[clip-path:polygon(0_0,100%_0,100%_100%,0_100%)] group-focus-within:[clip-path:polygon(0_0,100%_0,100%_100%,0_100%)]"
        style={{ background: overlayGradient }}
      />

      {plan.popular && (
        <span className="absolute -top-2.5 left-6 z-20 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.22em] bg-accent text-ink rounded-full">
          Most popular
        </span>
      )}

      <span
        aria-hidden
        className="absolute top-4 right-4 z-20 font-mono text-base text-muted transition-all duration-300 ease-out group-hover:text-paper group-hover:translate-x-0.5 group-focus-within:text-paper group-focus-within:translate-x-0.5"
      >
        →
      </span>

      <div className="relative z-10 flex flex-col flex-1 transition-colors duration-300 ease-out group-hover:text-white group-focus-within:text-white">
        <div>
          <h3 className="font-display text-2xl tracking-tight leading-tight">
            {plan.name}
          </h3>
          <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-muted transition-colors duration-300 ease-out group-hover:text-white/75 group-focus-within:text-white/75">
            {plan.subtitle}
          </p>
        </div>

        <PriceBlock plan={plan} cadence={cadence} />

        <p className="mt-4 text-xs text-muted leading-relaxed min-h-[2.5rem] transition-colors duration-300 ease-out group-hover:text-white/80 group-focus-within:text-white/80">
          {plan.tagline}
        </p>

        <Link
          href={href}
          className={`relative z-10 mt-5 w-full text-center font-medium px-3 py-2.5 rounded-md text-sm transition ${ctaClass}`}
        >
          {plan.cta.label}
        </Link>

        <TurnLimitsBlock turns={plan.turns} />

        <div className="mt-7 pt-5 border-t border-white/10 transition-colors duration-300 ease-out group-hover:border-white/20 group-focus-within:border-white/20">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted transition-colors duration-300 ease-out group-hover:text-white/70 group-focus-within:text-white/70">
            {plan.includesHeader}
          </p>
          <ul className="mt-4 flex flex-col gap-3 text-xs">
            {plan.features.map((feature) => (
              <li key={feature.label} className="flex gap-2.5 items-start">
                <span className="mt-0.5">
                  <Glyph glyph={feature.glyph} />
                </span>
                <span className="text-paper/85 leading-relaxed transition-colors duration-300 ease-out group-hover:text-white/90 group-focus-within:text-white/90">
                  {feature.label}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </article>
  );
}

const TIER_HEADERS: ReadonlyArray<{ label: string; sub: string; popular?: boolean }> = [
  { label: "Free", sub: "Stock" },
  { label: "I", sub: "Adaptive" },
  { label: "II", sub: "Frontier", popular: true },
  { label: "III", sub: "Personalized" },
  { label: "Teams", sub: "Shared" },
  { label: "Enterprise", sub: "Custom" },
];

function ComparisonTable(): React.ReactElement {
  return (
    <div className="hidden md:block mt-12 rounded-xl border border-white/10 overflow-hidden">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="sticky top-[3.5rem] z-10 bg-ink/95 backdrop-blur supports-[backdrop-filter]:bg-ink/80 border-b border-white/10">
            <th className="text-left px-5 py-4 font-mono text-[10px] uppercase tracking-[0.22em] text-muted w-[28%]">
              Compare features
            </th>
            {TIER_HEADERS.map((t) => (
              <th
                key={t.label}
                className={`px-3 py-4 text-center align-middle ${
                  t.popular ? "bg-accent/[0.06]" : ""
                }`}
              >
                <div className="font-display text-base tracking-tight leading-none">
                  {t.label === "I" || t.label === "II" || t.label === "III" ? (
                    <span className="italic text-accent">{t.label}</span>
                  ) : (
                    t.label
                  )}
                </div>
                <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.22em] text-muted">
                  {t.sub}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {COMPARISON.flatMap((category) => [
            <tr key={`cat-${category.title}`} className="bg-white/[0.04]">
              <td
                colSpan={7}
                className="px-5 py-3 font-mono text-[10px] uppercase tracking-[0.25em] text-accent"
              >
                {category.title}
              </td>
            </tr>,
            ...category.rows.map((row, rIdx) => (
              <tr
                key={`${category.title}-${row.label}`}
                className={`border-t border-white/5 ${
                  rIdx % 2 === 0 ? "bg-transparent" : "bg-white/[0.015]"
                }`}
              >
                <td className="px-5 py-3.5 text-paper/90">
                  {row.label}
                  {row.note && (
                    <span className="ml-2 font-mono text-[9px] uppercase tracking-[0.2em] text-muted">
                      {row.note}
                    </span>
                  )}
                </td>
                {row.values.map((value, i) => (
                  <td
                    key={i}
                    className={`px-3 py-3.5 text-center ${
                      TIER_HEADERS[i]?.popular ? "bg-accent/[0.03]" : ""
                    }`}
                  >
                    <ValueCell value={value} />
                  </td>
                ))}
              </tr>
            )),
          ])}
        </tbody>
      </table>
    </div>
  );
}

function MobileCompare(): React.ReactElement {
  const [activeTier, setActiveTier] = useState<number>(2);
  const tier = TIER_HEADERS[activeTier];

  return (
    <div className="md:hidden mt-10">
      <div className="overflow-x-auto -mx-6 px-6 pb-2">
        <div className="inline-flex gap-2">
          {TIER_HEADERS.map((t, idx) => {
            const active = idx === activeTier;
            return (
              <button
                key={t.label}
                type="button"
                onClick={() => setActiveTier(idx)}
                className={`px-3 py-2 rounded-full font-mono text-[10px] uppercase tracking-[0.22em] whitespace-nowrap transition ${
                  active
                    ? "bg-accent text-ink"
                    : "border border-white/10 text-muted"
                }`}
              >
                <span className="font-display not-italic mr-1">
                  {t.label === "I" || t.label === "II" || t.label === "III" ? (
                    <span className="italic">{t.label}</span>
                  ) : (
                    t.label
                  )}
                </span>
                <span>· {t.sub}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-white/10 overflow-hidden">
        {COMPARISON.map((category) => (
          <div key={`m-${category.title}`}>
            <div className="px-5 py-3 bg-white/[0.04] font-mono text-[10px] uppercase tracking-[0.25em] text-accent">
              {category.title}
            </div>
            {category.rows.map((row, rIdx) => (
              <div
                key={`m-${category.title}-${row.label}`}
                className={`flex items-center justify-between gap-4 px-5 py-3.5 border-t border-white/5 ${
                  rIdx % 2 === 0 ? "bg-transparent" : "bg-white/[0.015]"
                }`}
              >
                <span className="text-paper/90 text-sm">
                  {row.label}
                  {row.note && (
                    <span className="ml-2 font-mono text-[9px] uppercase tracking-[0.2em] text-muted">
                      {row.note}
                    </span>
                  )}
                </span>
                <span className="flex-shrink-0">
                  <ValueCell value={row.values[activeTier]} />
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>

      <p className="mt-3 text-[11px] text-muted">
        Showing <span className="text-paper">{tier.label} · {tier.sub}</span>. Tap a tier to switch.
      </p>
    </div>
  );
}

export function PricingContent(): React.ReactElement {
  const [cadence, setCadence] = useState<BillingCadence>("monthly");

  return (
    <>
      <section className="relative overflow-hidden border-b border-white/10">
        <div
          className="absolute inset-0 pointer-events-none mesh-bg opacity-60"
          aria-hidden
        />
        <div className="relative mx-auto max-w-7xl px-6 py-20 sm:py-24">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-accent">
            Pricing
          </p>
          <h1 className="mt-5 font-display text-4xl sm:text-6xl lg:text-7xl tracking-tight max-w-4xl text-balance leading-[1.02]">
            Start free. Grow into{" "}
            <span className="italic accent-text">your own Eri.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-muted leading-relaxed">
            Six tiers. Three depths of personalization — Adaptive, Frontier,
            Personalized. Monthly or yearly. Cancel any time, no seat math.
          </p>

          <div className="mt-10 flex items-center gap-4">
            <div
              role="tablist"
              aria-label="Billing cadence"
              className="relative inline-flex rounded-full border border-white/10 bg-white/[0.03] p-1"
            >
              <button
                type="button"
                role="tab"
                aria-selected={cadence === "monthly"}
                onClick={() => setCadence("monthly")}
                className={`relative z-10 px-4 py-2 text-sm rounded-full transition-colors ${
                  cadence === "monthly"
                    ? "text-paper"
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
                className={`relative z-10 px-4 py-2 text-sm rounded-full transition-colors ${
                  cadence === "yearly"
                    ? "text-paper"
                    : "text-muted hover:text-paper"
                }`}
              >
                Yearly
              </button>
              <span
                className="absolute top-1 bottom-1 rounded-full bg-white/[0.08] border border-white/10 transition-transform duration-300 ease-out"
                style={{
                  width: "calc(50% - 4px)",
                  left: 4,
                  transform:
                    cadence === "yearly" ? "translateX(100%)" : "translateX(0%)",
                }}
                aria-hidden
              />
            </div>
            <span
              className={`font-mono text-[10px] uppercase tracking-[0.22em] transition-opacity ${
                cadence === "yearly" ? "text-accent opacity-100" : "opacity-0"
              }`}
            >
              Save 2 months
            </span>
          </div>
        </div>
      </section>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-7xl px-6 py-16 sm:py-20">
          <div className="mb-10 rounded-xl border border-white/10 bg-white/[0.02] p-6 sm:p-7">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-8">
              <div className="sm:w-44 flex-shrink-0">
                <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-accent">
                  What's a turn?
                </p>
              </div>
              <div className="flex-1">
                <p className="text-paper/90 leading-relaxed">
                  A <span className="text-accent">voice turn</span> is one round-trip with the eri Engine: one push-to-talk submission, one Cmd-K inline edit, or one Composer multi-file plan. Each turn averages 15K input and 3K output tokens.
                </p>
                <p className="mt-2 text-muted leading-relaxed text-sm">
                  Tab completions don't count — they're metered separately. Daily caps are soft (occasional overruns are fine); hourly caps stop a runaway agent from draining your month in five minutes.
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-6 grid-cols-1 md:grid-cols-3 lg:grid-cols-6">
            {PLANS.map((plan) => (
              <PlanCard key={plan.slug} plan={plan} cadence={cadence} />
            ))}
          </div>

          <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
            <span className="inline-flex items-center gap-2">
              <Glyph glyph="full" /> Unlimited
            </span>
            <span className="inline-flex items-center gap-2">
              <Glyph glyph="half" /> Expanded
            </span>
            <span className="inline-flex items-center gap-2">
              <Glyph glyph="ring" /> Limited
            </span>
          </div>
        </div>
      </section>

      <section className="border-b border-white/10 bg-white/[0.01]">
        <div className="mx-auto max-w-7xl px-6 py-20 sm:py-24">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-muted">
            Compare
          </p>
          <h2 className="mt-4 font-display text-3xl sm:text-5xl tracking-tight max-w-3xl text-balance">
            Compare features{" "}
            <span className="italic text-accent">across plans.</span>
          </h2>
          <p className="mt-4 max-w-2xl text-muted leading-relaxed">
            Every feature, side by side. Categories group what Eri can do, how
            you talk to it, and what your security team needs to know.
          </p>

          <ComparisonTable />
          <MobileCompare />

          <p className="mt-6 text-[11px] text-muted leading-relaxed max-w-2xl">
            <span className="text-accent">*</span> Usage must be reasonable.{" "}
            <span className="text-accent">**</span> Enterprise and Teams
            purchase credits.
          </p>
        </div>
      </section>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-24 sm:py-32">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-muted">
            Questions
          </p>
          <h2 className="mt-4 font-display text-3xl sm:text-5xl tracking-tight text-balance">
            The stuff people{" "}
            <span className="italic text-accent">always ask.</span>
          </h2>

          <div className="mt-12 border-y border-white/10">
            {FAQ.map((item) => (
              <FaqRow key={item.q} item={item} />
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
