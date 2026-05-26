"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { authedFetch, useUser } from "@/lib/auth-client";

interface SubscriptionSummary {
  tier: string;
  status: string | null;
  current_period_end: number | null;
  cancel_at_period_end: boolean;
}

interface UsageSummary {
  tier: string;
  this_month_usd: number;
  this_month_tokens: number;
  limit_usd: number;
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
    typeof obj.this_month_usd === "number" &&
    typeof obj.this_month_tokens === "number" &&
    typeof obj.limit_usd === "number"
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

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
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
    usage && usage.limit_usd > 0
      ? Math.min(100, Math.round((usage.this_month_usd / usage.limit_usd) * 100))
      : 0;

  return (
    <div className="max-w-5xl">
      <div>
        <p className="text-xs uppercase tracking-[0.25em] text-accent">
          Dashboard
        </p>
        <h1 className="mt-3 font-display text-4xl md:text-5xl tracking-tight">
          Welcome, {greeting}
        </h1>
      </div>

      <div className="mt-10 grid gap-6 md:grid-cols-2">
        <section className="border border-white/10 rounded-lg p-6 bg-white/[0.02]">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl tracking-tight">
              Subscription
            </h2>
            <span className="text-xs uppercase tracking-[0.2em] text-accent border border-accent/40 rounded px-2 py-1">
              {subscription?.tier ?? user.tier}
            </span>
          </div>
          <dl className="mt-6 space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">Status</dt>
              <dd className="text-paper">
                {subscription?.status ?? "active"}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">
                {subscription?.cancel_at_period_end ? "Ends" : "Renews"}
              </dt>
              <dd className="text-paper">
                {formatRenewal(subscription?.current_period_end ?? null)}
              </dd>
            </div>
          </dl>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={openPortal}
              disabled={portalLoading || user.tier === "free"}
              className="border border-white/20 hover:border-accent text-paper px-4 py-2 rounded-md text-sm transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {portalLoading ? "Opening…" : "Manage billing"}
            </button>
            <Link
              href="/billing"
              className="text-sm text-muted hover:text-paper transition self-center"
            >
              Change plan →
            </Link>
          </div>
          {portalError && (
            <p className="mt-3 text-sm text-red-400">{portalError}</p>
          )}
        </section>

        <section className="border border-white/10 rounded-lg p-6 bg-white/[0.02]">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl tracking-tight">This month</h2>
            <Link
              href="/usage"
              className="text-xs text-muted hover:text-paper transition"
            >
              Details →
            </Link>
          </div>
          <div className="mt-6 flex items-baseline gap-3">
            <span className="font-display text-4xl text-paper">
              {usage ? formatUsd(usage.this_month_usd) : "—"}
            </span>
            <span className="text-sm text-muted">
              of {usage ? formatUsd(usage.limit_usd) : "—"}
            </span>
          </div>
          <div className="mt-4 h-2 w-full rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="mt-3 text-sm text-muted">
            {usage ? formatTokens(usage.this_month_tokens) : "—"} tokens used
          </p>
        </section>
      </div>

      <section className="mt-6 border border-white/10 rounded-lg p-6 bg-white/[0.02]">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl tracking-tight">
            Connected devices
          </h2>
          <Link
            href="/devices"
            className="text-xs text-muted hover:text-paper transition"
          >
            Manage →
          </Link>
        </div>
        {activeDevices === null ? (
          <p className="mt-4 text-sm text-muted">Loading…</p>
        ) : activeDevices === 0 ? (
          <div className="mt-4">
            <p className="text-sm text-paper">
              No eri IDE has connected to your account yet.
            </p>
            <p className="mt-2 text-sm text-muted leading-relaxed">
              When the eri IDE is open on your machine, run{" "}
              <code className="font-mono text-[12px] bg-white/5 border border-white/10 rounded px-1.5 py-0.5">
                eri.account.signIn
              </code>{" "}
              from the command palette. We'll bring you back here to approve
              the device, then drop a bearer token into your macOS Keychain.
            </p>
          </div>
        ) : (
          <p className="mt-4 text-sm text-paper">
            <span className="font-display text-3xl text-paper">
              {activeDevices}
            </span>
            <span className="ml-2 text-muted">
              active {activeDevices === 1 ? "device" : "devices"}
            </span>
          </p>
        )}
      </section>

      <section className="mt-10">
        <h2 className="font-display text-xl tracking-tight">Quick links</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <a
            href="#"
            className="border border-white/10 rounded-lg p-5 hover:border-accent transition group"
          >
            <div className="text-sm text-muted">Download</div>
            <div className="mt-1 text-paper group-hover:text-accent transition">
              Download eri
            </div>
          </a>
          <Link
            href="/library"
            className="border border-white/10 rounded-lg p-5 hover:border-accent transition group"
          >
            <div className="text-sm text-muted">Voices</div>
            <div className="mt-1 text-paper group-hover:text-accent transition">
              Open Voice Library
            </div>
          </Link>
          <a
            href="mailto:phlotu@gmail.com"
            className="border border-white/10 rounded-lg p-5 hover:border-accent transition group"
          >
            <div className="text-sm text-muted">Help</div>
            <div className="mt-1 text-paper group-hover:text-accent transition">
              Get support
            </div>
          </a>
        </div>
      </section>
    </div>
  );
}
