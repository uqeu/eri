"use client";

import { useEffect, useState } from "react";
import { authedFetch, useUser } from "@/lib/auth-client";
import { Skeleton } from "@/components/Skeleton";

interface DailyPoint {
  date: string;
  credits: number;
  cost_micros: number;
}

interface UsageSummary {
  tier: string;
  credits_used: number;
  credits_included: number;
  credits_ghost: number;
  remaining_included: number;
  period_end: string;
  this_month_requests: number;
  this_month_tokens: number;
  this_month_credits: number;
  this_month_cost_micros: number;
  daily: DailyPoint[];
}

function isUsage(value: unknown): value is UsageSummary {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.credits_used === "number" &&
    typeof obj.credits_included === "number" &&
    Array.isArray(obj.daily)
  );
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return `${n}`;
}

function shortDate(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${month}/${day}`;
}

interface BarChartProps {
  data: ReadonlyArray<DailyPoint>;
}

function BarChart({ data }: BarChartProps) {
  const maxCredits = data.reduce((max, p) => Math.max(max, p.credits), 0);
  const safeMax = maxCredits > 0 ? maxCredits : 1;
  const width = 720;
  const height = 220;
  const padding = { top: 16, right: 16, bottom: 32, left: 48 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const barGap = 4;
  const barWidth = data.length > 0 ? innerWidth / data.length - barGap : 0;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Daily eri-credit usage for the last 30 days"
      className="w-full h-auto"
    >
      <line
        x1={padding.left}
        y1={padding.top + innerHeight}
        x2={padding.left + innerWidth}
        y2={padding.top + innerHeight}
        stroke="rgba(40,33,22,0.12)"
      />
      <text x={padding.left - 8} y={padding.top + 4} textAnchor="end" fontSize={10} fill="#a39b8c">
        {compact(safeMax)}
      </text>
      <text
        x={padding.left - 8}
        y={padding.top + innerHeight + 4}
        textAnchor="end"
        fontSize={10}
        fill="#a39b8c"
      >
        0
      </text>
      {data.map((point, index) => {
        const barHeight = (point.credits / safeMax) * innerHeight;
        const x = padding.left + index * (barWidth + barGap);
        const y = padding.top + (innerHeight - barHeight);
        const showLabel = index % 5 === 0 || index === data.length - 1;
        return (
          <g key={point.date}>
            <rect
              x={x}
              y={y}
              width={Math.max(barWidth, 1)}
              height={Math.max(barHeight, 0)}
              fill="#3a3833"
              opacity={point.credits > 0 ? 0.85 : 0.12}
            >
              <title>
                {point.date}: {point.credits.toLocaleString()} credits
              </title>
            </rect>
            {showLabel && (
              <text
                x={x + barWidth / 2}
                y={padding.top + innerHeight + 16}
                textAnchor="middle"
                fontSize={10}
                fill="#a39b8c"
              >
                {shortDate(point.date)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export default function UsagePage() {
  const { user } = useUser();
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    async function load(): Promise<void> {
      setLoading(true);
      try {
        const response = await authedFetch("/api/usage/summary");
        if (!response.ok) {
          if (!cancelled) setError("Failed to load usage.");
          return;
        }
        const body: unknown = await response.json();
        if (!cancelled && isUsage(body)) {
          setUsage(body);
          setError(null);
        }
      } catch {
        if (!cancelled) setError("Network error.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!user) return null;

  const percent =
    usage && usage.credits_included > 0
      ? Math.min(100, Math.round((usage.credits_used / usage.credits_included) * 100))
      : 0;

  return (
    <div className="max-w-5xl font-geist">
      <p className="font-geist-mono text-[11px] uppercase tracking-[0.18em] text-text-ter">Usage</p>
      <h1 className="mt-3 font-display text-[clamp(2rem,4vw,2.9rem)] font-600 leading-[1.04] tracking-[-0.03em] text-text">Usage history</h1>

      <div className="mt-10 grid gap-6 md:grid-cols-3">
        <div className="rounded-2xl border border-border bg-bg-card p-6">
          <div className="font-geist-mono text-[11px] uppercase tracking-[0.18em] text-text-ter">eri credits</div>
          <div className="mt-3 font-display text-3xl font-600 tracking-[-0.02em] text-text tabular-nums">
            {usage ? compact(usage.credits_used) : "—"}
          </div>
          <div className="mt-2 text-sm text-text-sec">
            of {usage ? compact(usage.credits_included) : "—"} included
          </div>
          <div className="mt-4 h-2 w-full rounded-full bg-bg-card-2 overflow-hidden">
            <div
              className="h-full bg-text transition-all"
              style={{ width: `${percent}%` }}
            />
          </div>
          <div className="mt-2 text-xs text-text-sec">{percent}% of plan used</div>
        </div>
        <div className="rounded-2xl border border-border bg-bg-card p-6">
          <div className="font-geist-mono text-[11px] uppercase tracking-[0.18em] text-text-ter">Tokens</div>
          <div className="mt-3 font-display text-3xl font-600 tracking-[-0.02em] text-text tabular-nums">
            {usage ? usage.this_month_tokens.toLocaleString() : "—"}
          </div>
          <div className="mt-2 text-sm text-text-sec">
            this month · {usage ? usage.this_month_requests.toLocaleString() : "—"} requests
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-bg-card p-6">
          <div className="font-geist-mono text-[11px] uppercase tracking-[0.18em] text-text-ter">Plan</div>
          <div className="mt-3 font-display text-3xl font-600 tracking-[-0.02em] text-text capitalize">
            {(usage?.tier ?? user.tier).replace("_", " ")}
          </div>
          <div className="mt-2 text-sm text-text-sec">
            {usage ? `${compact(usage.remaining_included)} credits left` : ""}
          </div>
        </div>
      </div>

      <section className="mt-10 rounded-2xl border border-border bg-bg-card p-6">
        <h2 className="font-display text-[1.25rem] font-600 tracking-[-0.02em] text-text">Daily credits · last 30 days</h2>
        <div className="mt-6">
          {loading && !usage ? (
            <Skeleton className="h-[200px] w-full" />
          ) : error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : usage && usage.daily.some((d) => d.credits > 0) ? (
            <BarChart data={usage.daily} />
          ) : (
            <p className="text-sm text-text-sec">No usage yet this period.</p>
          )}
        </div>
      </section>
    </div>
  );
}
