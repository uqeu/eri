"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useUser } from "@/lib/auth-client";

function CheckIcon() {
  return (
    <svg
      width="48"
      height="48"
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <circle cx="24" cy="24" r="22" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
      <path
        d="M15 24l6 6 12-12"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SuccessInner() {
  const params = useSearchParams();
  const sessionId = params?.get("session_id") ?? null;
  const action = params?.get("action") ?? null;
  const { user, reload } = useUser();
  const [pollCount, setPollCount] = useState(0);

  const isSwitch = action === "updated";
  const isNoop = action === "unchanged";

  // Webhooks usually finalize within a few seconds, but to be safe we poll
  // the user record a few times so the tier badge updates without a manual
  // refresh.
  useEffect(() => {
    if (!user) return;
    if (isNoop) return;
    if (user.tier && user.tier !== "free") return;
    if (pollCount > 6) return;
    const id = window.setTimeout(() => {
      void reload();
      setPollCount((n) => n + 1);
    }, 1500);
    return () => window.clearTimeout(id);
  }, [user, pollCount, reload, isNoop]);

  const upgraded = user?.tier && user.tier !== "free";

  const heading = isNoop
    ? "Already on this plan"
    : isSwitch
      ? "Plan updated"
      : "Payment successful";
  const subHeading = isNoop
    ? "No changes were made"
    : upgraded
      ? "Your plan is active"
      : "Activating your plan…";

  return (
    <div className="max-w-2xl">
      <p className="text-xs uppercase tracking-[0.25em] text-accent">Billing</p>
      <h1 className="mt-3 font-display text-4xl md:text-5xl tracking-tight">
        {heading}
      </h1>

      <section className="mt-12 border-t border-white/[0.06] pt-10">
        <div className="flex items-start gap-5">
          <div className="text-accent shrink-0">
            <CheckIcon />
          </div>
          <div className="min-w-0">
            <h2 className="text-[15px] font-medium text-paper">{subHeading}</h2>
            <p className="mt-1.5 text-[13px] text-muted leading-relaxed">
              {isNoop ? (
                <>
                  You&apos;re already subscribed to{" "}
                  <span className="text-paper capitalize">
                    {user?.tier.replace("_", " ")}
                  </span>
                  . Nothing was charged.
                </>
              ) : isSwitch ? (
                <>
                  Your subscription is now{" "}
                  <span className="text-paper capitalize">
                    {user?.tier.replace("_", " ") ?? "updating"}
                  </span>
                  . We&apos;ve prorated the difference — any credit or charge
                  appears on your next invoice.
                </>
              ) : upgraded ? (
                <>
                  Welcome to{" "}
                  <span className="text-paper capitalize">
                    {user?.tier.replace("_", " ")}
                  </span>
                  . A receipt has been sent to{" "}
                  <span className="text-paper">{user?.email}</span>.
                </>
              ) : (
                <>
                  Stripe confirmed your payment. We&apos;re finalizing your
                  account now — this usually takes a few seconds.
                </>
              )}
            </p>
          </div>
        </div>

        <div className="mt-10 flex flex-col sm:flex-row gap-3 sm:items-center">
          <Link
            href="/dashboard"
            className="btn-primary inline-flex items-center justify-center gap-1.5 px-4 py-2 text-[13px] rounded-md"
          >
            Go to dashboard
            <span aria-hidden className="text-[10px]">
              →
            </span>
          </Link>
          <Link
            href="/billing"
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-[13px] text-paper/80 hover:text-paper rounded-md border border-white/10 hover:border-white/20 transition"
          >
            Manage billing
          </Link>
        </div>

        {sessionId && (
          <p className="mt-8 text-[11px] text-muted/60 font-mono">
            Reference: {sessionId}
          </p>
        )}
      </section>
    </div>
  );
}

export default function BillingSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-2xl">
          <p className="text-xs uppercase tracking-[0.25em] text-accent">
            Billing
          </p>
          <h1 className="mt-3 font-display text-4xl md:text-5xl tracking-tight">
            Payment successful
          </h1>
        </div>
      }
    >
      <SuccessInner />
    </Suspense>
  );
}
