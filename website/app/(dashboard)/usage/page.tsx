"use client";

import { useEffect, useState } from "react";
import { authedFetch, useUser } from "@/lib/auth-client";

interface DailyBucket {
  date: string;
  tokens_used: number;
  cost_usd: number;
}

interface UsageSummary {
  tier: string;
  this_month_usd: number;
  this_month_tokens: number;
  limit_usd: number;
  daily: DailyBucket[];
}

function isUsage(value: unknown): value is UsageSummary {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.this_month_usd === "number" &&
    typeof obj.this_month_tokens === "number" &&
    typeof obj.limit_usd === "number" &&
    Array.isArray(obj.daily)
  );
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function shortDate(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${month}/${day}`;
}

interface BarChartProps {
  data: ReadonlyArray<DailyBucket>;
}

function BarChart({ data }: BarChartProps) {
  const maxCost = data.reduce((max, point) => Math.max(max, point.cost_usd), 0);
  const safeMax = maxCost > 0 ? maxCost : 1;
  const width = 720;
  const height = 220;
  const padding = { top: 16, right: 16, bottom: 32, left: 40 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const barGap = 4;
  const barWidth = data.length > 0 ? innerWidth / data.length - barGap : 0;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Daily usage for the last 30 days"
      className="w-full h-auto"
    >
      <line
        x1={padding.left}
        y1={padding.top + innerHeight}
        x2={padding.left + innerWidth}
        y2={padding.top + innerHeight}
        stroke="rgba(255,255,255,0.1)"
      />
      <text
        x={padding.left - 8}
        y={padding.top + 4}
        textAnchor="end"
        fontSize={10}
        fill="#8A8A8A"
      >
        {formatUsd(safeMax)}
      </text>
      <text
        x={padding.left - 8}
        y={padding.top + innerHeight + 4}
        textAnchor="end"
        fontSize={10}
        fill="#8A8A8A"
      >
        $0
      </text>
      {data.map((point, index) => {
        const barHeight = (point.cost_usd / safeMax) * innerHeight;
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
              fill="#E0FF4F"
              opacity={point.cost_usd > 0 ? 0.9 : 0.15}
            >
              <title>
                {point.date}: {formatUsd(point.cost_usd)} ·{" "}
                {point.tokens_used.toLocaleString()} tokens
              </title>
            </rect>
            {showLabel && (
              <text
                x={x + barWidth / 2}
                y={padding.top + innerHeight + 16}
                textAnchor="middle"
                fontSize={10}
                fill="#8A8A8A"
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
    usage && usage.limit_usd > 0
      ? Math.min(100, Math.round((usage.this_month_usd / usage.limit_usd) * 100))
      : 0;

  return (
    <div className="max-w-5xl">
      <p className="text-xs uppercase tracking-[0.25em] text-accent">Usage</p>
      <h1 className="mt-3 font-display text-4xl md:text-5xl tracking-tight">
        Usage history
      </h1>

      <div className="mt-10 grid gap-6 md:grid-cols-3">
        <div className="border border-white/10 rounded-lg p-6 bg-white/[0.02]">
          <div className="text-xs uppercase tracking-[0.2em] text-muted">
            This month
          </div>
          <div className="mt-3 font-display text-3xl text-paper">
            {usage ? formatUsd(usage.this_month_usd) : "—"}
          </div>
          <div className="mt-2 text-sm text-muted">
            of {usage ? formatUsd(usage.limit_usd) : "—"} included
          </div>
          <div className="mt-4 h-2 w-full rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
        <div className="border border-white/10 rounded-lg p-6 bg-white/[0.02]">
          <div className="text-xs uppercase tracking-[0.2em] text-muted">
            Tokens
          </div>
          <div className="mt-3 font-display text-3xl text-paper">
            {usage ? usage.this_month_tokens.toLocaleString() : "—"}
          </div>
          <div className="mt-2 text-sm text-muted">this month</div>
        </div>
        <div className="border border-white/10 rounded-lg p-6 bg-white/[0.02]">
          <div className="text-xs uppercase tracking-[0.2em] text-muted">
            Plan
          </div>
          <div className="mt-3 font-display text-3xl text-paper capitalize">
            {usage?.tier ?? user.tier}
          </div>
        </div>
      </div>

      <section className="mt-10 border border-white/10 rounded-lg p-6 bg-white/[0.02]">
        <h2 className="font-display text-xl tracking-tight">
          Daily spend · last 30 days
        </h2>
        <div className="mt-6">
          {loading && !usage ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : error ? (
            <p className="text-sm text-red-400">{error}</p>
          ) : usage && usage.daily.length > 0 ? (
            <BarChart data={usage.daily} />
          ) : (
            <p className="text-sm text-muted">No usage yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}
