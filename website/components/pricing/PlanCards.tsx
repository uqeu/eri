"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { PLANS, type Plan } from "./plans";

// Four plan cards: Free, Starter, Pro, Pro+. A monthly / yearly toggle sits
// above them (yearly is about 20% off). The recommended one (Pro) inverts to an
// ink-dark surface so it reads as the chosen path without a gradient or a
// colored stripe; lime appears only on the real CTA and the toggle thumb.

const ACCENT = "#e0ff4f";
const EASE = "cubic-bezier(0.16,1,0.3,1)";

function PriceLine({ plan, yearly }: { plan: Plan; yearly: boolean }): React.ReactElement {
  const dark = plan.recommended;
  const ink = dark ? "#f7f7f4" : "#1d1d1f";
  const sub = dark ? "rgba(247,247,244,0.62)" : "#86868b";
  const amount = yearly ? plan.priceYear : plan.price;

  return (
    <div className="flex flex-col">
      <span className="flex items-baseline gap-1">
        <span className="font-display text-[2.1rem] font-600 leading-none tracking-[-0.04em]" style={{ color: ink }}>
          {plan.price === 0 ? "Free" : `$${amount}`}
        </span>
        {plan.price !== 0 && (
          <span className="font-geist text-[14px] font-medium" style={{ color: sub }}>/mo</span>
        )}
      </span>
      <span className="mt-2 font-geist text-[12.5px]" style={{ color: sub }}>
        {plan.price === 0
          ? "forever"
          : yearly
            ? "billed yearly, save 20%"
            : "per month, plus usage"}
      </span>
    </div>
  );
}

function Card({ plan, yearly }: { plan: Plan; yearly: boolean }): React.ReactElement {
  const dark = plan.recommended;

  const surface = dark
    ? {
        background: "#16140f",
        border: "1px solid rgba(224,255,79,0.28)",
        boxShadow:
          "0 30px 80px -34px rgba(20,16,8,0.6), 0 4px 16px -8px rgba(20,16,8,0.3), inset 0 1px 0 rgba(255,255,255,0.06)",
      }
    : {
        background: "#ffffff",
        border: "1px solid var(--border)",
        boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 18px 50px -34px rgba(40,26,70,0.18)",
      };

  const ink = dark ? "#f7f7f4" : "#1d1d1f";
  const sec = dark ? "rgba(247,247,244,0.72)" : "#515154";
  const ter = dark ? "rgba(247,247,244,0.5)" : "#86868b";

  return (
    <div
      className="relative flex flex-col rounded-[20px] p-6 transition-transform duration-300 hover:-translate-y-1"
      style={{ ...surface, transitionTimingFunction: EASE }}
    >
      {dark && (
        <span
          className="absolute right-5 top-6 font-geist text-[11px] font-medium"
          style={{ color: "rgba(247,247,244,0.6)" }}
        >
          Recommended
        </span>
      )}

      <div>
        <h3 className="font-display text-[1.25rem] font-600 tracking-[-0.02em]" style={{ color: ink }}>
          {plan.name}
        </h3>
        <p className="mt-1.5 min-h-[34px] max-w-[20ch] font-geist text-[13px] leading-snug" style={{ color: sec }}>
          {plan.forWhom}
        </p>
      </div>

      <div className="mt-6">
        <PriceLine plan={plan} yearly={yearly} />
      </div>

      <Link
        href={plan.cta.href}
        className="group/cta mt-6 inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 font-geist text-[14px] font-600 outline-none transition-transform duration-200 hover:-translate-y-[1px] focus-visible:ring-2 focus-visible:ring-offset-2"
        style={
          dark
            ? { background: ACCENT, color: "#1a1d00" }
            : { background: "#16140f", color: "#ffffff" }
        }
      >
        {plan.cta.label}
        <ArrowRight
          size={14}
          strokeWidth={2.4}
          className="transition-transform duration-200 group-hover/cta:translate-x-0.5"
        />
      </Link>

      <div className="mt-6 border-t pt-5" style={{ borderColor: dark ? "rgba(247,247,244,0.12)" : "var(--border)" }}>
        {plan.carriesOver && (
          <p className="mb-3 font-geist text-[12px] font-medium" style={{ color: ter }}>
            {plan.carriesOver}
          </p>
        )}
        <ul className="flex flex-col gap-2.5">
          {plan.features.map((f) => (
            <li key={f} className="flex items-start gap-2">
              <Check
                size={14}
                strokeWidth={2.6}
                className="mt-[3px] shrink-0"
                style={{ color: dark ? ACCENT : "#1d1d1f" }}
              />
              <span className="font-geist text-[13px] leading-snug" style={{ color: sec }}>
                {f}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function BillingToggle({
  yearly,
  onChange,
}: {
  yearly: boolean;
  onChange: (v: boolean) => void;
}): React.ReactElement {
  const base =
    "rounded-full px-5 py-1.5 font-geist text-[13.5px] font-medium outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-[#16140f]/25";
  const active = { background: "#ffffff", color: "#1d1d1f", boxShadow: "0 1px 3px rgba(20,16,8,0.16)" };
  const idle = { background: "transparent", color: "#86868b" };

  return (
    <div className="mb-7 flex justify-center">
      <div
        className="inline-flex items-center gap-1 rounded-full p-1"
        style={{ background: "#f0f0f2", border: "1px solid var(--border)" }}
        role="tablist"
        aria-label="Billing period"
      >
        <button
          type="button"
          role="tab"
          aria-selected={!yearly}
          onClick={() => onChange(false)}
          className={base}
          style={yearly ? idle : active}
        >
          Monthly
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={yearly}
          onClick={() => onChange(true)}
          className={`${base} inline-flex items-center gap-1.5`}
          style={yearly ? active : idle}
        >
          Yearly
          <span className="text-[11px] font-600" style={{ color: "#6f8500" }}>save 20%</span>
        </button>
      </div>
    </div>
  );
}

export function PlanCards(): React.ReactElement {
  const [yearly, setYearly] = useState(false);

  return (
    <section className="mx-auto max-w-6xl px-6">
      <BillingToggle yearly={yearly} onChange={setYearly} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-start">
        {PLANS.map((plan) => (
          <Card key={plan.id} plan={plan} yearly={yearly} />
        ))}
      </div>
    </section>
  );
}
