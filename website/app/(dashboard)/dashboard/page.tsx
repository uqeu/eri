"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { authedFetch, useUser } from "@/lib/auth-client";
import { dashboardOnboardingSteps } from "@/lib/dashboard-onboarding";

interface SubscriptionSummary {
  tier: string;
  status: string | null;
  current_period_end: number | null;
  cancel_at_period_end: boolean;
}

interface UsageSummary {
  tier: string;
  credits_used: number;
  credits_included: number;
  this_month_tokens: number;
  this_month_requests: number;
}

function isSubscription(value: unknown): value is SubscriptionSummary {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.tier === "string";
}

function isUsage(value: unknown): value is UsageSummary {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.credits_used === "number" &&
    typeof obj.credits_included === "number" &&
    typeof obj.this_month_tokens === "number"
  );
}

function formatRenewal(epoch: number | null): string {
  if (!epoch) return "—";
  const date = new Date(epoch * 1000);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toString();
}

interface DeviceLite {
  id: string;
  revoked: boolean;
}

export default function DashboardPage() {
  const { user } = useUser();
  const [subscription, setSubscription] = useState<SubscriptionSummary | null>(
    null,
  );
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [activeDevices, setActiveDevices] = useState<number | null>(null);
  const [portalLoading, setPortalLoading] = useState<boolean>(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const [subRes, usageRes, devicesRes] = await Promise.all([
          authedFetch("/api/billing/subscription"),
          authedFetch("/api/usage/summary"),
          authedFetch("/api/auth/devices"),
        ]);
        if (subRes.ok) {
          const body: unknown = await subRes.json();
          if (!cancelled && isSubscription(body)) setSubscription(body);
        }
        if (usageRes.ok) {
          const body: unknown = await usageRes.json();
          if (!cancelled && isUsage(body)) setUsage(body);
        }
        if (devicesRes.ok) {
          const body: unknown = await devicesRes.json();
          if (
            !cancelled &&
            typeof body === "object" &&
            body !== null &&
            Array.isArray((body as { devices?: unknown }).devices)
          ) {
            const list = (body as { devices: DeviceLite[] }).devices;
            setActiveDevices(list.filter((d) => !d.revoked).length);
          }
        }
      } catch {
        // Swallow — individual cards show their own loading state.
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [user]);

  async function openPortal(): Promise<void> {
    setPortalLoading(true);
    setPortalError(null);
    try {
      const response = await authedFetch("/api/billing/portal", {
        method: "POST",
        body: {},
      });
      const body: unknown = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message =
          typeof body === "object" &&
          body !== null &&
          typeof (body as { error?: unknown }).error === "string"
            ? (body as { error: string }).error
            : "Failed to open billing portal.";
        setPortalError(message);
        return;
      }
      if (
        typeof body === "object" &&
        body !== null &&
        typeof (body as { url?: unknown }).url === "string"
      ) {
        window.location.href = (body as { url: string }).url;
      }
    } finally {
      setPortalLoading(false);
    }
  }

  if (!user) return null;

  const greeting = user.display_name?.trim() || user.email;
  const percent =
    usage && usage.credits_included > 0
      ? Math.min(100, Math.round((usage.credits_used / usage.credits_included) * 100))
      : 0;
  const onboardingSteps = dashboardOnboardingSteps({
    activeDevices,
    tier: subscription?.tier ?? user.tier,
  });

  return (
    <div className="max-w-5xl font-geist">
      <header>
        <h1 className="font-display text-[clamp(2rem,4vw,2.9rem)] font-600 leading-[1.04] tracking-[-0.03em] text-text">
          Welcome, {greeting}
        </h1>
        <p className="mt-2 font-geist text-[15px] text-text-sec">
          Your account, usage, and connected devices, all in one place.
        </p>
      </header>

      <section className="mt-9 rounded-2xl border border-border bg-bg-card p-6 md:p-7">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="font-geist-mono text-[11px] uppercase tracking-[0.18em] text-text-ter">
              First run
            </p>
            <h2 className="mt-2 font-display text-[1.5rem] font-600 tracking-[-0.02em] text-text">
              Get from account to first shipped task.
            </h2>
          </div>
          <Link
            href="/docs/quickstart"
            className="font-geist text-[14px] text-text-sec transition-colors hover:text-text"
          >
            Quickstart →
          </Link>
        </div>
        <div className="mt-6 grid gap-3 lg:grid-cols-5">
          {onboardingSteps.map((step, index) => (
            <Link
              key={step.id}
              href={step.href}
              className="group rounded-xl border border-border bg-bg p-4 transition-colors hover:border-[rgba(40,33,22,0.22)]"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-geist-mono text-[11px] text-text-ter">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 font-geist text-[11px] ${
                    step.status === "done"
                      ? "bg-[rgba(28,26,23,0.10)] text-text"
                      : "bg-bg-card-2 text-text-sec"
                  }`}
                >
                  {step.status === "done" ? "done" : "next"}
                </span>
              </div>
              <div className="mt-3 font-geist text-[14px] font-500 text-text">
                {step.title}
              </div>
              <p className="mt-1.5 font-geist text-[12.5px] leading-relaxed text-text-sec">
                {step.body}
              </p>
              <div className="mt-3 font-geist text-[12.5px] text-text transition-colors group-hover:text-text">
                {step.cta} →
              </div>
            </Link>
          ))}
        </div>
      </section>

      <div className="mt-6 grid gap-5 md:grid-cols-2">
        <section className="rounded-2xl border border-border bg-bg-card p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-[1.25rem] font-600 tracking-[-0.02em] text-text">
              Subscription
            </h2>
            <span className="rounded-full border border-border px-2.5 py-1 font-geist text-[11px] uppercase tracking-[0.16em] text-text">
              {subscription?.tier ?? user.tier}
            </span>
          </div>
          <dl className="mt-6 space-y-3 font-geist text-[14px]">
            <div className="flex justify-between">
              <dt className="text-text-sec">Status</dt>
              <dd className="text-text">
                {subscription?.status ?? "active"}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text-sec">
                {subscription?.cancel_at_period_end ? "Ends" : "Renews"}
              </dt>
              <dd className="text-text">
                {formatRenewal(subscription?.current_period_end ?? null)}
              </dd>
            </div>
          </dl>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={openPortal}
              disabled={portalLoading || user.tier === "free"}
              className="rounded-full bg-[#16140f] px-4 py-2 font-geist text-[13.5px] font-600 text-white transition-transform duration-200 hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
            >
              {portalLoading ? "Opening…" : "Manage billing"}
            </button>
            <Link
              href="/billing"
              className="font-geist text-[14px] text-text-sec transition-colors hover:text-text"
            >
              Change plan →
            </Link>
          </div>
          {portalError && (
            <p className="mt-3 font-geist text-[14px] text-red-600">{portalError}</p>
          )}
        </section>

        <section className="rounded-2xl border border-border bg-bg-card p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-[1.25rem] font-600 tracking-[-0.02em] text-text">
              This month
            </h2>
            <Link
              href="/usage"
              className="font-geist text-[13px] text-text-sec transition-colors hover:text-text"
            >
              Details →
            </Link>
          </div>
          <div className="mt-6 flex items-baseline gap-3">
            <span className="font-display text-[2.4rem] font-600 leading-none tracking-[-0.03em] text-text tabular-nums">
              {usage ? formatTokens(usage.credits_used) : "—"}
            </span>
            <span className="font-geist text-[14px] text-text-sec">
              of {usage ? formatTokens(usage.credits_included) : "—"} credits
            </span>
          </div>
          <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-bg-card-2">
            <div
              className="h-full rounded-full bg-text transition-all"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="mt-3 font-geist text-[13.5px] text-text-sec">
            {usage ? formatTokens(usage.this_month_tokens) : "—"} tokens ·{" "}
            {usage ? usage.this_month_requests.toLocaleString() : "—"} requests this month
          </p>
        </section>
      </div>

      <section className="mt-5 rounded-2xl border border-border bg-bg-card p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-[1.25rem] font-600 tracking-[-0.02em] text-text">
            Connected devices
          </h2>
          <Link
            href="/devices"
            className="font-geist text-[13px] text-text-sec transition-colors hover:text-text"
          >
            Manage →
          </Link>
        </div>
        {activeDevices === null ? (
          <p className="mt-4 font-geist text-[14px] text-text-sec">Loading…</p>
        ) : activeDevices === 0 ? (
          <div className="mt-4">
            <p className="font-geist text-[14px] text-text">
              No Eri device has connected to your account yet.
            </p>
            <p className="mt-2 max-w-prose font-geist text-[14px] leading-relaxed text-text-sec">
              When Eri is open on your machine, run{" "}
              <code className="rounded border border-border bg-bg-card-2 px-1.5 py-0.5 font-geist-mono text-[12px] text-text">
                eri.account.signIn
              </code>{" "}
              from the command palette. We'll bring you back here to approve
              the device, then drop a bearer token into your macOS Keychain.
            </p>
          </div>
        ) : (
          <p className="mt-4 flex items-baseline gap-2">
            <span className="font-display text-[2rem] font-600 leading-none tracking-[-0.03em] text-text">
              {activeDevices}
            </span>
            <span className="font-geist text-[14px] text-text-sec">
              active {activeDevices === 1 ? "device" : "devices"}
            </span>
          </p>
        )}
      </section>

      <section className="mt-9">
        <h2 className="font-display text-[1.25rem] font-600 tracking-[-0.02em] text-text">
          Quick links
        </h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Link
            href="/install"
            className="group rounded-xl border border-border bg-bg-card p-5 transition-colors hover:border-[rgba(40,33,22,0.22)]"
          >
            <div className="font-geist text-[13px] text-text-ter">Download</div>
            <div className="mt-1 font-geist text-[15px] font-500 text-text">
              Download eri
            </div>
          </Link>
          <Link
            href="/docs/ide"
            className="group rounded-xl border border-border bg-bg-card p-5 transition-colors hover:border-[rgba(40,33,22,0.22)]"
          >
            <div className="font-geist text-[13px] text-text-ter">Agent Manager</div>
            <div className="mt-1 font-geist text-[15px] font-500 text-text">
              Open workbench guide
            </div>
          </Link>
          <a
            href="mailto:phlotu@gmail.com"
            className="group rounded-xl border border-border bg-bg-card p-5 transition-colors hover:border-[rgba(40,33,22,0.22)]"
          >
            <div className="font-geist text-[13px] text-text-ter">Help</div>
            <div className="mt-1 font-geist text-[15px] font-500 text-text">
              Get support
            </div>
          </a>
        </div>
      </section>
    </div>
  );
}
