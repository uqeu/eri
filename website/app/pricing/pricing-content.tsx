"use client";

import { useState } from "react";
import Link from "next/link";

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
    subtitle: "Free forever",
    slug: "free",
    priceMonthly: "Free",
    priceYearlyAsMonthly: "Free",
    cadenceNote: "forever",
    tagline: "A local agentic workbench you can trust before you ship.",
    blurb:
      "Start with the local workbench, CLI, previews, and checkpoints. Eri can plan, edit, and verify on your machine; upgrade when you want larger cloud handoffs or team runners. No card to start, no surprise bills.",
    includesHeader: "Includes",
    turns: { monthly: 150, weekly: 50, daily: 10, hourly: 3 },
    features: [
      { glyph: "full", label: "Local agent workbench + CLI" },
      { glyph: "full", label: "Previews, checkpoints, and Cmd-K edits" },
      { glyph: "half", label: "150 cloud handoff turns per month" },
      { glyph: "full", label: "Templates + iteration history" },
      { glyph: "ring", label: "Cloud runners require upgrade" },
      { glyph: "ring", label: "Community Discord support" },
    ],
    cta: { href: "/sign-up?plan=free", label: "Start free" },
    ctaVariant: "primary",
    popular: false,
  },
  {
    name: "Starter",
    shortName: "Starter",
    subtitle: "Adaptive",
    slug: "starter",
    priceMonthly: 15,
    priceYearlyAsMonthly: 12,
    cadenceNote: "",
    tagline: "A steadier local agent with memory across real projects.",
    blurb:
      "Eri remembers project context, prior checkpoints, and the workflows you repeat. Use the desktop workbench or CLI to plan, edit, preview, and verify servers with less re-explaining.",
    includesHeader: "Everything in Free, plus",
    turns: { monthly: 1839, weekly: 459, daily: 65, hourly: 8 },
    features: [
      { glyph: "full", label: "Cross-session project memory" },
      { glyph: "full", label: "Optional voice and gaze targeting inputs" },
      { glyph: "full", label: "No eri branding on shipped apps" },
      { glyph: "full", label: "Eri cloud handoff credits included" },
      { glyph: "half", label: "Expanded agent turn quota" },
      { glyph: "ring", label: "Email support" },
    ],
    cta: { href: "/sign-up?plan=starter", label: "Choose Starter" },
    ctaVariant: "ghost",
    popular: false,
  },
  {
    name: "Pro",
    shortName: "Pro",
    subtitle: "Frontier",
    slug: "pro",
    priceMonthly: 30,
    priceYearlyAsMonthly: 24,
    cadenceNote: "",
    tagline: "Local workbench first, cloud runners when the task should leave your laptop.",
    blurb:
      "Hand off reviews, deploy prep, server checks, and longer backlog work to cloud runners. Eri keeps the checkpoint trail visible so you can inspect what changed before it ships.",
    includesHeader: "Everything in Starter, plus",
    turns: { monthly: 3961, weekly: 990, daily: 141, hourly: 17 },
    features: [
      { glyph: "full", label: "Cloud runners for review and deploy prep" },
      { glyph: "full", label: "Background agents that work while you idle" },
      { glyph: "full", label: "Server verification and preview handoff" },
      { glyph: "full", label: "Custom MCP integrations" },
      { glyph: "half", label: "Larger project context" },
      { glyph: "ring", label: "Priority email + Discord" },
    ],
    cta: { href: "/sign-up?plan=pro", label: "Choose Pro" },
    ctaVariant: "primary",
    popular: true,
  },
  {
    name: "Pro+",
    shortName: "Pro+",
    subtitle: "Personalized",
    slug: "pro_plus",
    priceMonthly: 60,
    priceYearlyAsMonthly: 48,
    cadenceNote: "",
    tagline: "A private workbench tuned to your repo, team, and release path.",
    blurb:
      "Eri studies your codebase locally: conventions, naming, tests, review habits, and deployment rituals. Keep the private project brain beside your repo while you hand longer work to managed cloud runners.",
    includesHeader: "Everything in Pro, plus",
    turns: { monthly: 8206, weekly: 2051, daily: 293, hourly: 36 },
    features: [
      { glyph: "full", label: "More cloud runner capacity" },
      { glyph: "full", label: "Learns your codebase patterns locally" },
      { glyph: "full", label: "Private project brain — never pooled" },
      { glyph: "full", label: "Largest project context" },
      { glyph: "full", label: "Priority review and deploy queue" },
      { glyph: "ring", label: "Priority support" },
    ],
    cta: { href: "/sign-up?plan=pro_plus", label: "Choose Pro+" },
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
    title: "Workbench + agent",
    rows: [
      {
        label: "Local agent workbench",
        values: [yes, yes, yes, yes],
      },
      {
        label: "Cloud handoff turns",
        values: [limited, expanded, unlimited, unlimited],
      },
      { label: "Inline Cmd-K edits", values: [yes, yes, yes, yes] },
      { label: "Background cloud runners", values: [no, no, yes, yes] },
      { label: "Review and deploy queue priority", values: [no, no, no, yes] },
      {
        label: "eri context window",
        values: [text("25K"), text("54K"), text("128K"), text("256K")],
      },
    ],
  },
  {
    title: "Checkpoints + shipping",
    rows: [
      { label: "Preview generation", values: [yes, yes, yes, yes] },
      { label: "Checkpoint history", values: [yes, yes, yes, yes] },
      { label: "Server verification", values: [limited, expanded, yes, yes] },
      { label: "Automated review pass", values: [no, no, yes, yes] },
      { label: "Deploy handoff", values: [no, yes, yes, yes] },
    ],
  },
  {
    title: "Adaptive features",
    rows: [
      { label: "Cross-session memory", values: [no, yes, yes, yes] },
      { label: "Custom MCP integrations", values: [no, yes, yes, yes] },
      { label: "Codebase pattern learning", values: [no, no, no, yes] },
      { label: "Private project brain (never shared)", values: [no, no, no, yes] },
    ],
  },
  {
    title: "Targeting inputs",
    rows: [
      { label: "Text commands and CLI prompts", values: [yes, yes, yes, yes] },
      {
        label: "Optional voice targeting",
        values: [
          text("Included", "accent"),
          text("Included", "accent"),
          text("Included", "accent"),
          text("Included", "accent"),
        ],
      },
      { label: "Optional gaze targeting", values: [yes, yes, yes, yes] },
      { label: "Cmd-K palette", values: [yes, yes, yes, yes] },
    ],
  },
  {
    title: "Privacy + data",
    rows: [
      { label: "Code stays on your machine", values: [yes, yes, yes, yes] },
      {
        label: "Used for shared training",
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
    title: "CLI + MCP",
    rows: [
      {
        label: "Terminal CLI (`eri ask`, `eri ship`, `eri plan`…)",
        values: [no, yes, yes, yes],
        note: "Sign in once via `eri auth login`; the bearer roams across machines.",
      },
      {
        label: "Drop-in MCP server",
        values: [no, yes, yes, yes],
        note: "`brew install eri-mcp-server` and connect Eri to MCP-capable tools.",
      },
      {
        label: "Automatic app updates",
        values: [no, yes, yes, yes],
        note: "Keep the workbench, CLI, and MCP server current without manual reinstall loops.",
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
    a: "Yes. No credit card, no trial clock. When you hit the monthly cloud handoff cap, Eri keeps working locally — no surprise bill, ever.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes. Cancel from your dashboard in one click. You keep access through the end of the billing period and can come back whenever — we don't lock you in.",
  },
  {
    q: "What happens to my apps if I downgrade?",
    a: "Your projects, checkpoints, previews, and deployed apps all stay. The only things that change are cloud-only features such as removed branding, expanded handoff quota, and managed runner capacity. Your code is yours either way.",
  },
  {
    q: "What is local-first cloud handoff?",
    a: "The workbench and CLI run locally by default. When a job needs longer runtime, managed infrastructure, review, deploy prep, or server verification away from your machine, you hand it to Eri cloud with a visible checkpoint trail.",
  },
  {
    q: "Do I need an API key to use eri?",
    a: "You never bring your own model key — eri runs on your eri credits through the eri proxy. Inside the desktop app you sign in once and we issue a bearer (`eri_sk_...`) you never see; the workbench uses it transparently. Outside the desktop — the terminal CLI and MCP server — that same bearer authenticates Eri calls.",
  },
  {
    q: "Why do paid plans exist at all? eri seems local-first.",
    a: "Local work is cheap because it runs on your machine. Paid plans cover the pieces that need managed infrastructure: cloud handoff turns, longer-running agents, automated review, deploy prep, server verification, updates, support, and team-ready runner capacity.",
  },
  {
    q: "What's the cost breakdown, transparently?",
    a: "Roughly: account infrastructure, preview hosting, update delivery, support, and the managed runner time behind cloud handoffs. Higher tiers buy more runner capacity and priority for review, verification, and deploy work. Once you exceed the cap you can keep using Eri locally; no metered overage, no surprise bill.",
  },
  {
    q: "What happens when I hit my monthly cap?",
    a: "Cloud handoffs pause. Eri keeps working locally — Cmd-K, agent, composer, previews, checkpoints, voice, and gaze inputs — for the rest of the month. There is no metered overage and we never bill above the headline price. Your cap resets at the start of the next billing cycle.",
  },
  {
    q: "Do you offer student, non-profit, or open-source discounts?",
    a: "Yes. Email phlotu@gmail.com with a .edu address, a non-profit registration, or a link to your OSS project and the operator will set you up. Case-by-case, real conversation, no coupon code.",
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
    q: "Frontier vs Personalized?",
    a: "Pro adds managed cloud runners for longer review, verification, deploy, and backlog work. Pro+ adds local pattern learning on your codebase plus a private project brain that doesn't pool with other users. Pro gives you more handoff capacity; Pro+ makes Eri fit your repo and release habits.",
  },
  {
    q: "Does Personalized train on my code?",
    a: "No. Your code never leaves your machine for shared training. Personalization is local pattern recognition plus cached project context via eri_cache. The private brain is a per-user project store living next to your repo, not training data shipped away.",
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
          ? "border-white/25 bg-white/[0.04]"
          : "border-white/10 bg-white/[0.02] hover:border-white/20"
      }`}
    >
      {plan.popular && (
        <span className="absolute right-5 top-5 inline-flex items-center rounded-full border border-white/15 bg-black/40 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-paper/70">
          Recommended
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

      {/* Price block — fixed min-height so all 4 tiers align */}
      <div className="mt-5 flex flex-wrap items-baseline gap-x-2 gap-y-1 tabular-nums min-h-[3.25rem]">
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
            <>
              <span>{plan.cadenceNote || "forever"}</span>
              <span className="opacity-0">·</span>
            </>
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
        Agent turns
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
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-paper/70">
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
                    <span className="italic text-paper">{t.label}</span>
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
                className="px-5 py-3 font-mono text-[10px] uppercase tracking-[0.25em] text-paper/70"
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
            <div className="px-5 py-3 bg-white/[0.04] font-mono text-[10px] uppercase tracking-[0.25em] text-paper/70">
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
      <section className="border-b border-border">
        <div className="container pt-20 lg:pt-28 pb-10 text-center">
          <h1
            className="text-[clamp(2rem,4vw,3.25rem)] tracking-tight text-balance leading-[1.05] mx-auto max-w-3xl"
            style={{
              fontFamily: "Funnel Display, system-ui, sans-serif",
              fontWeight: 500,
              letterSpacing: "-0.025em",
            }}
          >
            Plans that grow with you
          </h1>
          <p className="mt-5 mx-auto max-w-xl text-[15px] text-text-sec leading-relaxed">
            Start free, scale when you&apos;re ready. Hard-capped, cancel any time, no surprise bills.
          </p>

          <div className="mt-8 flex items-center justify-center">
            <div
              role="tablist"
              aria-label="Billing cadence"
              className="inline-flex items-center gap-0.5 rounded-full border border-white/10 bg-white/[0.03] p-1"
            >
              <button
                type="button"
                role="tab"
                aria-selected={cadence === "monthly"}
                onClick={() => setCadence("monthly")}
                className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
                  cadence === "monthly"
                    ? "bg-white/[0.08] text-paper border border-white/10"
                    : "border border-transparent text-muted hover:text-paper"
                }`}
              >
                Monthly
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={cadence === "yearly"}
                onClick={() => setCadence("yearly")}
                className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
                  cadence === "yearly"
                    ? "bg-white/[0.08] text-paper border border-white/10"
                    : "border border-transparent text-muted hover:text-paper"
                }`}
              >
                Yearly
                <span className="ml-1.5 font-mono text-[10px] text-paper/60">
                  · save 2mo
                </span>
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-6xl px-6 pt-10 sm:pt-12 pb-16 sm:pb-20">
          <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 items-stretch">
            {PLANS.map((plan) => (
              <PlanTile key={plan.slug} plan={plan} cadence={cadence} />
            ))}
          </div>

          <div className="mt-12 rounded-xl border border-white/10 bg-white/[0.02] p-6 sm:p-7">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-8">
              <div className="sm:w-44 flex-shrink-0">
                <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-paper/60">
                  What's a turn?
                </p>
              </div>
              <div className="flex-1">
                <p className="text-paper/85 leading-relaxed">
                  An <span className="text-paper">agent turn</span> is one
                  useful round-trip with Eri: a workbench instruction, CLI
                  prompt, Cmd-K inline edit, server verification, or Composer
                  multi-file plan.
                </p>
                <p className="mt-2 text-muted leading-relaxed text-sm">
                  Daily caps are soft (occasional overruns are fine); hourly
                  caps stop a runaway cloud handoff from draining your month in
                  five minutes. Local work continues after cloud turns pause.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-14 rounded-xl border border-white/10 bg-white/[0.02] p-6 sm:p-8">
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-paper/70">
              What's not on this page
            </p>
            <h3 className="mt-3 font-display text-2xl sm:text-3xl tracking-tight">
              Four line items you won't ever see on a bill from us.
            </h3>
            <div className="mt-7 grid gap-5 sm:grid-cols-2">
              <div className="flex gap-3">
                <span aria-hidden className="mt-2 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-paper/40" />
                <div>
                  <p className="text-paper/90 text-sm">Metered overage.</p>
                  <p className="mt-1 text-xs text-muted leading-relaxed">
                    Hit the monthly cap and cloud handoffs pause. Local work keeps going.
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <span aria-hidden className="mt-2 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-paper/40" />
                <div>
                  <p className="text-paper/90 text-sm">Opaque cloud work.</p>
                  <p className="mt-1 text-xs text-muted leading-relaxed">
                    Cloud handoffs keep visible checkpoints, logs, and reviewable changes.
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <span aria-hidden className="mt-2 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-paper/40" />
                <div>
                  <p className="text-paper/90 text-sm">Workbench lock-in.</p>
                  <p className="mt-1 text-xs text-muted leading-relaxed">
                    Use the desktop, terminal CLI, SDKs, or MCP server against one account.
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <span aria-hidden className="mt-2 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-paper/40" />
                <div>
                  <p className="text-paper/90 text-sm">Add-ons for the basics.</p>
                  <p className="mt-1 text-xs text-muted leading-relaxed">
                    Cmd-K, previews, checkpoints, voice input, and gaze targeting ship on every tier.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-white/10 bg-white/[0.01]">
        <div className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-muted">
            Compare
          </p>
          <h2 className="mt-4 font-display text-3xl sm:text-5xl tracking-tight max-w-3xl text-balance">
            Compare features{" "}
            <span className="italic text-paper">across plans.</span>
          </h2>
          <p className="mt-4 max-w-2xl text-muted leading-relaxed">
            Every feature, side by side. Categories group what Eri can do, how
            you target work, and when jobs stay local versus move to managed
            runners.
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
            Transparent economics
          </p>
          <h2 className="mt-4 font-display text-3xl sm:text-5xl tracking-tight text-balance">
            Why these prices exist,{" "}
            <span className="italic text-paper">in one paragraph.</span>
          </h2>
          <div className="mt-8 space-y-4 text-base text-paper/80 leading-relaxed">
            <p>
              Local work stays inexpensive because the agentic workbench, CLI,
              previews, and checkpoints run on your machine. The real cost of
              running Eri at scale is managed infrastructure: cloud runners,
              server verification, preview handoff, update delivery, review
              queues, and support. Each paid tier maps to the amount of
              off-machine work we run on your behalf.
            </p>
            <p>
              Pro is built for regular review, verification, deploy,
              and backlog handoffs. Pro+ adds more runner capacity
              plus local project personalization for heavier release
              paths. When you exceed the budget, Eri keeps working locally; we
              never bill above the headline price.
            </p>
            <p>
              Pricing is identical whether you reach Eri through the
              desktop, the terminal CLI, the MCP server, or managed cloud
              runners. One bearer, one bucket, one bill.
            </p>
          </div>
        </div>
      </section>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-24 sm:py-32">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-muted">
            Questions
          </p>
          <h2 className="mt-4 font-display text-3xl sm:text-5xl tracking-tight text-balance">
            The stuff people{" "}
            <span className="italic text-paper">always ask.</span>
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
