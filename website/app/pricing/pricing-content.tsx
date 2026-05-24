"use client";

import { useState } from "react";
import Link from "next/link";

type Cadence = "monthly" | "yearly";

interface Plan {
  readonly name: string;
  readonly subtitle: string;
  readonly priceMonthly: number | "Free";
  readonly priceYearly: number | "Free";
  readonly cta: { href: string; label: string };
  readonly ctaPrimary: boolean;
  readonly includesHeader: string;
  readonly features: ReadonlyArray<string>;
}

const PLANS: ReadonlyArray<Plan> = [
  {
    name: "Free",
    subtitle: "Alpha access. Voice, gaze, diffusion — nothing held back.",
    priceMonthly: "Free",
    priceYearly: "Free",
    cta: { href: "/sign-up", label: "Get alpha access" },
    ctaPrimary: false,
    includesHeader: "Includes:",
    features: [
      "Voice transcription on us",
      "Gaze targeting + diffusion preview",
      "Capped cloud turns to eri's engine",
      "Templates + iteration history",
      "Deploy to your hosting",
      "Community Discord support",
    ],
  },
  {
    name: "Pro",
    subtitle: "When we open up paid: an eri that learns how you build.",
    priceMonthly: 25,
    priceYearly: 20,
    cta: { href: "/sign-up?plan=pro", label: "Join the waitlist" },
    ctaPrimary: true,
    includesHeader: "Everything in Free, plus:",
    features: [
      "Cross-session memory of your codebase",
      "Premium voice presets",
      "Multi-model routing — the right brain per task",
      "Background agents that work while you idle",
      "Extended context window",
      "Priority support",
    ],
  },
];

export function PricingContent(): React.ReactElement {
  const [cadence, setCadence] = useState<Cadence>("yearly");

  return (
    <main className="bg-bg text-text">
      <section className="container pt-24 pb-12 lg:pt-32 lg:pb-16">
        <div className="mx-auto max-w-2xl text-center">
          <h1
            className="text-balance text-[clamp(2.5rem,5vw,4rem)] leading-[1.05] mb-5"
            style={{
              fontFamily: "Funnel Display, system-ui, sans-serif",
              fontWeight: 500,
              letterSpacing: "-0.03em",
            }}
          >
            Plans that grow with you
          </h1>
          <p className="text-text-sec text-[16px] leading-[1.55] mb-9">
            Free during invite-only alpha. Below is what paid tiers will look
            like when we open up — hard-capped, cancel any time, no surprise
            bills.
          </p>

          <CadenceToggle cadence={cadence} onChange={setCadence} />
        </div>
      </section>

      <section className="container pb-24 lg:pb-32">
        <div className="mx-auto max-w-4xl grid grid-cols-1 md:grid-cols-2 gap-4">
          {PLANS.map((plan) => (
            <PlanCard key={plan.name} plan={plan} cadence={cadence} />
          ))}
        </div>

        <p className="mt-10 text-center text-text-ter text-[12px] leading-relaxed">
          Prices shown don&apos;t include applicable tax. Plans and pricing
          subject to change while we&apos;re in alpha.
        </p>
      </section>
    </main>
  );
}

function CadenceToggle({
  cadence,
  onChange,
}: {
  cadence: Cadence;
  onChange: (c: Cadence) => void;
}): React.ReactElement {
  return (
    <div
      role="radiogroup"
      aria-label="Billing cadence"
      className="inline-flex items-center gap-0.5 rounded-full border border-border bg-bg-card p-1"
    >
      <button
        type="button"
        role="radio"
        aria-checked={cadence === "monthly"}
        onClick={() => onChange("monthly")}
        className={
          "rounded-full px-4 py-1.5 text-[13px] transition-colors " +
          (cadence === "monthly"
            ? "bg-bg-card-2 text-text"
            : "text-text-sec hover:text-text")
        }
      >
        Monthly
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={cadence === "yearly"}
        onClick={() => onChange("yearly")}
        className={
          "rounded-full px-4 py-1.5 text-[13px] transition-colors " +
          (cadence === "yearly"
            ? "bg-bg-card-2 text-text"
            : "text-text-sec hover:text-text")
        }
      >
        Yearly
        <span className="ml-1.5 text-text-ter">· save 2mo</span>
      </button>
    </div>
  );
}

function PlanCard({
  plan,
  cadence,
}: {
  plan: Plan;
  cadence: Cadence;
}): React.ReactElement {
  const price = cadence === "monthly" ? plan.priceMonthly : plan.priceYearly;
  const isFree = price === "Free";

  return (
    <div className="flex h-full flex-col rounded-2xl border border-border bg-bg-card p-7 lg:p-8">
      <div className="mb-6">
        <h2 className="text-[24px] font-medium leading-tight text-text mb-1.5">
          {plan.name}
        </h2>
        <p className="text-text-sec text-[14px] leading-[1.45]">
          {plan.subtitle}
        </p>
      </div>

      <div className="mb-6 flex items-baseline gap-2">
        {isFree ? (
          <span className="text-[36px] font-medium leading-none text-text">
            $0
          </span>
        ) : (
          <>
            <span className="text-[36px] font-medium leading-none text-text">
              ${price}
            </span>
            <span className="text-text-sec text-[12px] leading-[1.4]">
              USD / month
              <br />
              billed {cadence === "yearly" ? "annually" : "monthly"}
            </span>
          </>
        )}
      </div>

      <Link
        href={plan.cta.href}
        className={
          "inline-flex items-center justify-center rounded-md px-4 py-2.5 text-[14px] font-medium transition-opacity " +
          (plan.ctaPrimary
            ? "bg-text text-bg hover:opacity-90"
            : "border border-border text-text hover:bg-bg-card-2")
        }
      >
        {plan.cta.label}
      </Link>

      <div className="my-6 border-t border-border" />

      <div className="flex flex-1 flex-col">
        <p className="text-text text-[14px] font-medium mb-4">
          {plan.includesHeader}
        </p>
        <ul className="space-y-3">
          {plan.features.map((f) => (
            <li
              key={f}
              className="flex items-start gap-3 text-[14px] text-text-sec leading-[1.4]"
            >
              <span
                aria-hidden
                className="mt-1 inline-block h-[14px] w-[14px] flex-shrink-0 text-text"
              >
                <svg viewBox="0 0 14 14" fill="none">
                  <path
                    d="M3 7.5l2.5 2.5L11 4.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              {f}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
