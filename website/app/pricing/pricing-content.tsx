"use client";

import { useState } from "react";
import Link from "next/link";
import { TierNumeral } from "@/components/TierNumeral";

type BillingCadence = "monthly" | "yearly";

type PlanSlug = "free" | "starter" | "pro" | "pro_plus";

type GlyphValue =
  | { kind: "bool"; on: boolean }
  | { kind: "text"; label: string; tone?: "default" | "accent" | "muted" }
  | { kind: "limited" }
  | { kind: "expanded" }
  | { kind: "unlimited" };

interface TurnLimits {
  monthly: number;
  weekly: number;
  daily: number;
  hourly: number;
}

interface Plan {
  name: React.ReactNode;
  shortName: string;
  subtitle: string;
  slug: PlanSlug;
  priceMonthly: number | "Free";
  priceYearlyAsMonthly: number | "Free";
  cadenceNote: string;
  tagline: string;
  blurb: string;
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
    tagline: "Stock Eri, voice and all. Free really means free — no keys to bring.",
    blurb:
      "Drop into eri without a credit card. Voice in (we cover the ElevenLabs side), diffusion edits out, capped cloud turns to eri's engine, and every project you can ship. When the monthly cap hits, eri stays useful — you just trade cloud turns for local ones.",
    includesHeader: "Includes",
    turns: { monthly: 50, weekly: 20, daily: 5, hourly: 2 },
    features: [
      { glyph: "full", label: "Stock eri voice — ElevenLabs included, on us" },
      { glyph: "full", label: "Diffusion edits + Cmd-K palette" },
      { glyph: "half", label: "Limited cloud turns to eri's engine" },
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
    blurb:
      "Adaptive Eri remembers what you've shipped, the patterns you reach for, and the way you phrase things. Picks one of the premium ElevenLabs voices so your assistant sounds the way you want it to. No eri branding on what you ship.",
    includesHeader: "Everything in Free, plus",
    turns: { monthly: 1839, weekly: 459, daily: 65, hourly: 8 },
    features: [
      { glyph: "full", label: "Cross-session memory" },
      { glyph: "full", label: "Pick eri's voice (premium ElevenLabs presets)" },
      { glyph: "full", label: "No eri branding on shipped apps" },
      { glyph: "full", label: "eri-cloud credits included" },
      { glyph: "half", label: "Expanded engine quota" },
      { glyph: "ring", label: "Email support" },
    ],
    cta: { href: "/sign-up?plan=starter", label: "Choose Individual I" },
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
    blurb:
      "Frontier Eri routes between eri's engine, Claude Sonnet 4.5, GPT-4o, and Gemini per task — the right model for the right job. Cloud agents grind through your backlog while you sleep. Inline Cmd-K edits and custom MCP servers ship in.",
    includesHeader: "Everything in Individual I, plus",
    turns: { monthly: 3254, weekly: 813, daily: 116, hourly: 14 },
    features: [
      { glyph: "full", label: "Multi-model routing (eri's engine, GPT-4o, Claude, Gemini)" },
      { glyph: "full", label: "Cloud agents that work while you idle" },
      { glyph: "full", label: "Inline Cmd-K edits included" },
      { glyph: "full", label: "Custom MCP servers" },
      { glyph: "half", label: "128K frontier context window" },
      { glyph: "ring", label: "Priority email + Discord" },
    ],
    cta: { href: "/sign-up?plan=pro", label: "Choose Individual II" },
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
    blurb:
      "Personalized Eri studies your codebase locally — your conventions, your naming, your tests — and biases every suggestion toward how you actually write code. Exclusive voices with blending. A private brain that never pools with anyone else's.",
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
    cta: { href: "/sign-up?plan=pro_plus", label: "Choose Individual III" },
    ctaVariant: "ghost",
    popular: false,
  },
];

interface ComparisonRow {
  label: string;
  values: readonly [GlyphValue, GlyphValue, GlyphValue, GlyphValue];
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
        label: "Diffusion turns on eri's engine",
        values: [limited, expanded, unlimited, unlimited],
      },
      { label: "Inline Cmd-K edit turns", values: [no, yes, yes, yes] },
      { label: "GPT-4o / Claude / Gemini routing", values: [no, no, yes, yes] },
      { label: "Claude polish queue priority", values: [no, no, no, yes] },
      {
        label: "Frontier model context window",
        values: [text("27K"), text("54K"), text("128K"), text("256K")],
      },
    ],
  },
  {
    title: "Adaptive features",
    rows: [
      { label: "Cross-session memory", values: [no, yes, yes, yes] },
      { label: "Multi-model routing", values: [no, no, yes, yes] },
      { label: "Codebase-trained brain", values: [no, no, no, yes] },
      { label: "Private brain (never shared)", values: [no, no, no, yes] },
    ],
  },
  {
    title: "Voice + interaction",
    rows: [
      { label: "Voice commands (always-listening)", values: [yes, yes, yes, yes] },
      {
        label: "ElevenLabs voice — on us",
        values: [
          text("Stock", "accent"),
          text("Premium presets", "accent"),
          text("Premium presets", "accent"),
          text("Exclusive + blending", "accent"),
        ],
      },
      { label: "Eye tracking", values: [yes, yes, yes, yes] },
      { label: "Cmd-K palette", values: [yes, yes, yes, yes] },
    ],
  },
  {
    title: "Privacy + data",
    rows: [
      { label: "Code stays on your machine", values: [yes, yes, yes, yes] },
      {
        label: "Used to train our models",
        values: [
          text("No", "accent"),
          text("No", "accent"),
          text("No", "accent"),
          text("No", "accent"),
        ],
      },
      {
        label: "Data residency",
        values: [text("US"), text("US"), text("US"), text("US")],
      },
    ],
  },
  {
    title: "Customer service",
    rows: [
      { label: "Community Discord", values: [yes, yes, yes, yes] },
      {
        label: "Email support",
        values: [no, yes, text("Priority", "accent"), text("Priority", "accent")],
      },
    ],
  },
];

interface FaqItem {
  q: string;
  a: string;
}

const FAQ: ReadonlyArray<FaqItem> = [
  {
    q: "Is Free actually free?",
    a: "Yes. No credit card, no trial clock, no ElevenLabs key to bring. We cover the stock voice on us. When you hit the monthly cap, cloud turns to eri's engine pause and eri keeps working locally — no surprise bill at any point.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes. Cancel from your dashboard in one click. You keep access through the end of the billing period and can come back whenever — we don't lock you in.",
  },
  {
    q: "What happens to my apps if I downgrade?",
    a: "Your projects, iteration history, and deployed apps all stay. The only things that change are the cloud-only features (premium eri voice presets, removed branding, expanded engine quotas). Your code is yours either way.",
  },
  {
    q: "What is BYOK?",
    a: "Bring Your Own Keys. On paid tiers, you can plug in your own provider keys (Anthropic, OpenAI, Gemini, ElevenLabs) and eri reads them from macOS Keychain — we never proxy, mirror, or sync them. Paid tiers also include eri-cloud credits so you can use eri without bringing keys; either path works.",
  },
  {
    q: "What happens when I hit my monthly cap?",
    a: "Cloud turns pause. eri keeps working — Cmd-K, agent, composer, voice — using your own provider key for the rest of the month. There is no metered overage and we never bill above the headline price. Your cap resets at the start of the next billing cycle.",
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
    a: "Frontier (Individual II) gives you multi-model routing — Eri picks between eri's engine, Claude, GPT-4o, and Gemini per task. Personalized (Individual III) adds exclusive eri voices with voice-blending, locally-trained pattern recognition on your codebase, and a private brain that doesn't pool with other users. Frontier makes Eri smarter; Personalized makes Eri yours.",
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
        className="w-full flex items-start justify-between gap-6 py-6 text-left transition-colors hover:text-paper cursor-pointer"
      >
        <span className={`font-display text-lg sm:text-xl tracking-tight transition-colors ${open ? "text-paper" : "text-paper/90"}`}>
          {item.q}
        </span>
        <span
          className={`mt-2 text-paper/60 transition-transform duration-200 ${open ? "rotate-180 text-paper" : ""}`}
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
          <p className="pb-6 pr-10 text-paper/80 leading-relaxed">{item.a}</p>
        </div>
      </div>
    </div>
  );
}

function formatPrice(value: number | "Free"): string {
  if (value === "Free") return "$0";
  return `$${value}`;
}

function priceFor(plan: Plan, cadence: BillingCadence): number | "Free" {
  return cadence === "yearly" ? plan.priceYearlyAsMonthly : plan.priceMonthly;
}

function PlanArt({ slug }: { slug: PlanSlug }): React.ReactElement {
  // Orbital illustration that scales in density per tier. Each card gets a
  // distinct rendering so the eye picks up that they're different products
  // without us having to lean on a heavy logo per plan.
  const rings = {
    free: 1,
    starter: 2,
    pro: 3,
    pro_plus: 4,
  }[slug];
  const dots = {
    free: 2,
    starter: 4,
    pro: 6,
    pro_plus: 8,
  }[slug];
  return (
    <svg
      width="56"
      height="56"
      viewBox="0 0 56 56"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      className={slug === "pro" ? "text-accent" : "text-paper/60"}
    >
      <circle cx="28" cy="28" r="3" fill="currentColor" />
      {Array.from({ length: rings }).map((_, i) => (
        <circle
          key={i}
          cx="28"
          cy="28"
          r={6 + i * 7}
          stroke="currentColor"
          strokeOpacity={0.4 - i * 0.08}
          strokeWidth="1"
          fill="none"
        />
      ))}
      {Array.from({ length: dots }).map((_, i) => {
        const angle = (i / dots) * Math.PI * 2;
        const r = 6 + (rings - 1) * 7;
        const cx = 28 + Math.cos(angle) * r;
        const cy = 28 + Math.sin(angle) * r;
        return (
          <circle
            key={`d-${i}`}
            cx={cx}
            cy={cy}
            r="1.6"
            fill="currentColor"
            opacity={0.7}
          />
        );
      })}
    </svg>
  );
}

function PlanTile({
  plan,
  cadence,
}: {
  plan: Plan;
  cadence: BillingCadence;
}): React.ReactElement {
  const isFree = plan.priceMonthly === "Free";
  const current = formatPrice(priceFor(plan, cadence));
  const monthlyStr = formatPrice(plan.priceMonthly);
  const yearlyStr = formatPrice(plan.priceYearlyAsMonthly);
  const showStrike =
    cadence === "yearly" && !isFree && monthlyStr !== yearlyStr;
  const ctaClass =
    plan.ctaVariant === "primary"
      ? "ship-gradient ship-gradient-hover text-ink"
      : "border border-white/15 hover:border-paper text-paper";

  return (
    <div
      className={`group relative flex h-full flex-col rounded-2xl border p-6 transition-all duration-200 ${
        plan.popular
          ? "border-accent/50 bg-white/[0.03] shadow-lg shadow-black/30"
          : "border-white/10 bg-white/[0.02] hover:border-white/20"
      }`}
    >
      {plan.popular && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em] bg-accent text-ink rounded-full shadow-md shadow-accent/30 whitespace-nowrap">
          ★ Most popular
        </span>
      )}

      <div className="flex items-start justify-between gap-3">
        <PlanArt slug={plan.slug} />
      </div>

      <div className="mt-5 flex flex-col gap-1">
        <h3 className="font-display text-2xl tracking-tight leading-tight text-paper">
          {plan.name}
        </h3>
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
          {plan.subtitle}
        </p>
        <p className="mt-2 text-[13px] text-paper/80 leading-relaxed">
          {plan.tagline}
        </p>
      </div>

      <div className="mt-5 flex flex-wrap items-baseline gap-x-2 gap-y-1 tabular-nums">
        {showStrike && (
          <span className="font-mono text-sm text-muted line-through decoration-muted/60">
            {monthlyStr}
          </span>
        )}
        <span className="font-display text-4xl tracking-tight leading-none text-paper">
          {current}
        </span>
        <span className="inline-flex flex-col text-[11px] font-normal leading-tight text-muted">
          {isFree ? (
            <span>{plan.cadenceNote || "forever"}</span>
          ) : (
            <>
              <span>USD / month</span>
              <span>
                {cadence === "yearly" ? "billed annually" : "billed monthly"}
              </span>
            </>
          )}
        </span>
      </div>

      <div className="mt-5">
        <Link
          href={plan.cta.href}
          className={`inline-flex h-11 w-full items-center justify-center rounded-md px-5 text-sm font-medium transition ${ctaClass}`}
        >
          {plan.cta.label}
        </Link>
      </div>

      <div className="mt-6 -mx-6 px-6 pt-6 border-t border-white/[0.08]">
        <p className="text-[13px] font-medium text-paper/80">
          {plan.includesHeader}
        </p>
        <ul className="mt-3 flex flex-col gap-2 text-[13px] text-paper/75">
          {plan.features.map((f) => (
            <li key={f.label} className="flex items-start gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                fill="currentColor"
                viewBox="0 0 256 256"
                aria-hidden
                className={`mt-0.5 shrink-0 ${plan.popular ? "text-accent" : "text-paper/50"}`}
              >
                <path d="M229.66 77.66l-128 128a8 8 0 0 1-11.32 0l-56-56a8 8 0 0 1 11.32-11.32L96 188.69 218.34 66.34a8 8 0 0 1 11.32 11.32Z" />
              </svg>
              <span className="leading-snug">{f.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function TurnLimitsBlock({ turns }: { turns: TurnLimits }): React.ReactElement {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.02] px-4 py-3">
      <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-muted">
        Voice turns
      </p>
      <div className="mt-2 grid grid-cols-4 gap-3">
        {[
          { v: turns.monthly, sub: "/mo" },
          { v: turns.weekly, sub: "/wk soft" },
          { v: turns.daily, sub: "/day soft" },
          { v: turns.hourly, sub: "/hr burst" },
        ].map((row) => (
          <div key={row.sub}>
            <div className="font-mono text-[15px] tabular-nums text-paper leading-none">
              {row.v.toLocaleString("en-US")}
            </div>
            <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-muted">
              {row.sub}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlanDetail({
  plan,
  cadence,
}: {
  plan: Plan;
  cadence: BillingCadence;
}): React.ReactElement {
  const isFree = plan.priceMonthly === "Free";
  const current = formatPrice(priceFor(plan, cadence));
  const monthlyStr = formatPrice(plan.priceMonthly);
  const yearlyStr = formatPrice(plan.priceYearlyAsMonthly);
  const showStrike = cadence === "yearly" && !isFree && monthlyStr !== yearlyStr;
  const href = isFree ? plan.cta.href : `${plan.cta.href}&billing=${cadence}`;

  const ctaClass =
    plan.ctaVariant === "primary"
      ? "ship-gradient ship-gradient-hover text-ink"
      : "border border-white/15 text-paper hover:border-accent/60 hover:text-accent";

  return (
    <article
      className={`relative overflow-hidden rounded-2xl border p-6 sm:p-8 ${
        plan.popular
          ? "border-accent/60 bg-accent/[0.04]"
          : "border-white/10 bg-white/[0.02]"
      }`}
    >
      <div className="grid gap-8 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-accent">
            {plan.subtitle}
          </p>
          <h3 className="mt-2 font-display text-3xl sm:text-4xl tracking-tight leading-tight">
            {plan.name}
          </h3>

          <div className="mt-5 flex items-baseline gap-3 tabular-nums">
            {showStrike && (
              <span className="font-mono text-sm text-muted line-through decoration-muted/60">
                {monthlyStr}
              </span>
            )}
            <span className="font-display text-5xl sm:text-6xl tracking-tight leading-none">
              {current}
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
              {isFree ? plan.cadenceNote : "/mo"}
            </span>
          </div>
          {cadence === "yearly" && !isFree && (
            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
              Billed yearly · save 2 mo
            </p>
          )}

          <p className="mt-5 text-paper/85 leading-relaxed">{plan.blurb}</p>

          <Link
            href={href}
            className={`mt-7 inline-flex w-full sm:w-auto justify-center font-medium px-5 py-3 rounded-md text-sm transition ${ctaClass}`}
          >
            {plan.cta.label}
          </Link>

          <div className="mt-7">
            <TurnLimitsBlock turns={plan.turns} />
          </div>
        </div>

        <div className="lg:border-l lg:border-white/10 lg:pl-8">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
            {plan.includesHeader}
          </p>
          <ul className="mt-5 flex flex-col gap-4 text-sm">
            {plan.features.map((feature) => (
              <li key={feature.label} className="flex gap-3 items-start">
                <span className="mt-1">
                  <Glyph glyph={feature.glyph} />
                </span>
                <span className="text-paper/90 leading-relaxed">
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
];

function ComparisonTable(): React.ReactElement {
  return (
    <div className="hidden md:block mt-12 rounded-xl border border-white/10 overflow-hidden">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="sticky top-[3.5rem] z-10 bg-ink/95 backdrop-blur supports-[backdrop-filter]:bg-ink/80 border-b border-white/10">
            <th className="text-left px-5 py-4 font-mono text-[10px] uppercase tracking-[0.22em] text-muted w-[36%]">
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
                colSpan={5}
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
            Four tiers. Three depths of personalization — Adaptive, Frontier,
            Personalized. Monthly or yearly. Cancel any time.
          </p>
          <p className="mt-3 max-w-2xl text-sm text-paper/70 leading-relaxed">
            Every paid tier is{" "}
            <span className="text-accent">hard-capped at the headline price.</span>{" "}
            When you reach the monthly turn limit, eri pauses cloud turns and
            keeps working on your own keys. No metered overage, no surprise
            invoice.
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
                  A <span className="text-accent">voice turn</span> is one round-trip with eri's engine: one push-to-talk submission, one Cmd-K inline edit, or one Composer multi-file plan. Each turn averages 15K input and 3K output tokens.
                </p>
                <p className="mt-2 text-muted leading-relaxed text-sm">
                  Tab completions don't count — they're metered separately. Daily caps are soft (occasional overruns are fine); hourly caps stop a runaway agent from draining your month in five minutes.
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 items-stretch">
            {PLANS.map((plan) => (
              <PlanTile key={plan.slug} plan={plan} cadence={cadence} />
            ))}
          </div>

          <div className="mt-14 rounded-xl border border-white/10 bg-white/[0.02] p-6 sm:p-8">
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-accent">
              What's not on this page
            </p>
            <h3 className="mt-3 font-display text-2xl sm:text-3xl tracking-tight">
              Four line items you won't ever see on a bill from us.
            </h3>
            <div className="mt-7 grid gap-5 sm:grid-cols-2">
              <div className="flex gap-3">
                <span aria-hidden className="mt-2 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                <div>
                  <p className="text-paper/90 text-sm">Metered overage.</p>
                  <p className="mt-1 text-xs text-muted leading-relaxed">
                    Hit the monthly cap and cloud turns pause. Your own key still works.
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <span aria-hidden className="mt-2 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                <div>
                  <p className="text-paper/90 text-sm">Opaque auto-routing.</p>
                  <p className="mt-1 text-xs text-muted leading-relaxed">
                    Every turn shows which model answered and how much it cost in tokens and time.
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <span aria-hidden className="mt-2 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                <div>
                  <p className="text-paper/90 text-sm">An ElevenLabs key on Free.</p>
                  <p className="mt-1 text-xs text-muted leading-relaxed">
                    Stock eri voice ships in on Free — we cover it. You only bring keys if you want to.
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <span aria-hidden className="mt-2 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                <div>
                  <p className="text-paper/90 text-sm">Add-ons for the basics.</p>
                  <p className="mt-1 text-xs text-muted leading-relaxed">
                    Voice, gaze, Cmd-K, diffusion preview, and iteration history ship on every tier.
                  </p>
                </div>
              </div>
            </div>
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
            you talk to it, and what's on us versus what you bring.
          </p>

          <ComparisonTable />
          <MobileCompare />

          <p className="mt-6 text-[11px] text-muted leading-relaxed max-w-2xl">
            <span className="text-accent">*</span> Usage must be reasonable.
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
