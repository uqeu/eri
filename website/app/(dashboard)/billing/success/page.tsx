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

function prettyTier(slug: string): string {
  return slug.replace("_", " ");
}

function SuccessInner() {
  const params = useSearchParams();
  const sessionId = params?.get("session_id") ?? null;
  const action = params?.get("action") ?? null;
  // Target plan from the API redirect — we use this for the success copy and
  // as the goal for polling. Without it we'd show the user's old/cached tier
  // until the webhook catches up.
  const targetPlan = params?.get("plan") ?? null;
  const { user, reload } = useUser();
  const [pollCount, setPollCount] = useState(0);

  const isSwitch = action === "updated";
  const isNoop = action === "unchanged";

  // Webhooks usually finalize within a few seconds, but to be safe we poll
  // /api/auth/me until the user's tier matches the target. useUser's reload
  // pushes the new user object to every subscriber (sidebar, /billing, etc.)
  // so once polling completes the rest of the app stays in sync without a
  // hard refresh.
  useEffect(() => {
    if (!user) return;
    if (isNoop) return;
    if (pollCount > 12) return;
    if (targetPlan && user.tier === targetPlan) return;
    if (!targetPlan && user.tier !== "free") return;
    const id = window.setTimeout(() => {
      void reload();
      setPollCount((n) => n + 1);
    }, 1500);
    return () => window.clearTimeout(id);
  }, [user, pollCount, reload, isNoop, targetPlan]);

  const matched = targetPlan
    ? user?.tier === targetPlan
    : Boolean(user?.tier && user.tier !== "free");

  const displayPlan = targetPlan ?? user?.tier ?? null;
  const displayPlanLabel = displayPlan ? prettyTier(displayPlan) : null;

  const heading = isNoop
    ? "Already on this plan"
    : isSwitch
      ? "Plan updated"
      : "Payment successful";
  const subHeading = isNoop
    ? "No changes were made"
    : matched
      ? "Your plan is active"
      : "Activating your plan…";

  return (
    <div className="max-w-2xl font-geist">
      <p className="font-geist-mono text-[11px] uppercase tracking-[0.18em] text-text-ter">
        Billing
      </p>
      <h1 className="mt-3 font-display text-[clamp(2rem,4vw,2.9rem)] font-600 leading-[1.04] tracking-[-0.03em] text-text">
        {heading}
      </h1>

      <section className="mt-12 border-t border-border pt-10">
        <div className="flex items-start gap-5">
          <div className="text-text shrink-0">
            <CheckIcon />
          </div>
          <div className="min-w-0">
            <h2 className="text-[15px] font-500 text-text">{subHeading}</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-text-sec">
              {isNoop ? (
                <>
                  You&apos;re already subscribed to{" "}
                  <span className="text-text capitalize">
                    {displayPlanLabel ?? "this plan"}
                  </span>
                  . Nothing was charged.
                </>
              ) : isSwitch ? (
                <>
                  Your subscription is now{" "}
                  <span className="text-text capitalize">
                    {displayPlanLabel ?? "updating"}
                  </span>
                  .{" "}
                  {matched ? (
                    <>
                      The prorated difference has been billed to your card
                      now. Your next monthly invoice will be a clean charge.
                    </>
                  ) : (
                    <>
                      We&apos;re finalizing the change — this usually takes a
                      few seconds.
                    </>
                  )}
                </>
              ) : matched ? (
                <>
                  Welcome to{" "}
                  <span className="text-text capitalize">
                    {displayPlanLabel}
                  </span>
                  . A receipt has been sent to{" "}
                  <span className="text-text">{user?.email}</span>.
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

        <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center gap-1.5 rounded-full bg-[#16140f] px-4 py-2 text-[13.5px] font-600 text-white transition-transform duration-200 hover:-translate-y-px"
          >
            Go to dashboard
            <span aria-hidden className="text-[10px]">
              →
            </span>
          </Link>
          <Link
            href="/billing"
            className="inline-flex items-center justify-center gap-1.5 rounded-full border border-border bg-bg-card px-4 py-2 text-[13.5px] text-text-sec transition-colors hover:border-[rgba(40,33,22,0.22)] hover:text-text"
          >
            Manage billing
          </Link>
        </div>

        {sessionId && (
          <p className="mt-8 font-geist-mono text-[11px] text-text-ter">
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
        <div className="max-w-2xl font-geist">
          <p className="font-geist-mono text-[11px] uppercase tracking-[0.18em] text-text-ter">
            Billing
          </p>
          <h1 className="mt-3 font-display text-[clamp(2rem,4vw,2.9rem)] font-600 leading-[1.04] tracking-[-0.03em] text-text">
            Payment successful
          </h1>
        </div>
      }
    >
      <SuccessInner />
    </Suspense>
  );
}
