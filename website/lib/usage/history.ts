// User-facing usage history, aggregated from the REAL `usage_records` table.
//
// NOTE: the legacy `usage_pings` table is dead -- the inference proxy never
// writes to it, so anything reading it shows $0/0. Everything here reads
// `usage_records` (written by the proxy's recordUsage) instead. Credits use the
// same weighting as the quota meter (in + OUTPUT_WEIGHT*out).

import { sql } from "@/lib/db";
import { OUTPUT_WEIGHT } from "@/lib/tiers";

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export interface MonthlyUsage {
  requests: number;
  tokensIn: number;
  tokensOut: number;
  tokensTotal: number;
  credits: number;
  costMicros: number;
}

export interface DailyUsage {
  date: string; // YYYY-MM-DD (UTC)
  credits: number;
  costMicros: number;
  tokens: number;
}

/** Calendar-month totals for a user from usage_records. */
export async function monthlyUsage(userId: string): Promise<MonthlyUsage> {
  const rows = await sql()<
    {
      requests: string;
      tin: string;
      tout: string;
      cost: string;
    }[]
  >`
    SELECT count(*) AS requests,
           coalesce(sum(tokens_in), 0) AS tin,
           coalesce(sum(tokens_out), 0) AS tout,
           coalesce(sum(cost_usd_micros), 0) AS cost
    FROM usage_records
    WHERE user_id = ${userId}
      AND ts >= date_trunc('month', now())
  `;
  const r = rows[0];
  const tokensIn = num(r?.tin);
  const tokensOut = num(r?.tout);
  return {
    requests: num(r?.requests),
    tokensIn,
    tokensOut,
    tokensTotal: tokensIn + tokensOut,
    credits: tokensIn + OUTPUT_WEIGHT * tokensOut,
    costMicros: num(r?.cost),
  };
}

/** Per-day usage for the last `days`, zero-filled, oldest-first. */
export async function dailyUsage(
  userId: string,
  days = 30,
): Promise<DailyUsage[]> {
  const safeDays = Math.min(Math.max(1, Math.floor(days)), 90);
  const since = new Date(Date.now() - safeDays * 86_400_000);
  const rows = await sql()<
    {
      date: string;
      credits: string;
      cost: string;
      tokens: string;
    }[]
  >`
    SELECT to_char(date_trunc('day', ts AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS date,
           coalesce(sum(tokens_in + ${OUTPUT_WEIGHT} * tokens_out), 0) AS credits,
           coalesce(sum(cost_usd_micros), 0) AS cost,
           coalesce(sum(tokens_in + tokens_out), 0) AS tokens
    FROM usage_records
    WHERE user_id = ${userId}
      AND ts >= ${since}
    GROUP BY 1
    ORDER BY 1
  `;

  const byDate = new Map<string, DailyUsage>();
  for (const r of rows) {
    byDate.set(r.date, {
      date: r.date,
      credits: num(r.credits),
      costMicros: num(r.cost),
      tokens: num(r.tokens),
    });
  }

  // Zero-fill every day in the window so the chart has a stable x-axis.
  const out: DailyUsage[] = [];
  for (let i = safeDays - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    const date = d.toISOString().slice(0, 10);
    out.push(byDate.get(date) ?? { date, credits: 0, costMicros: 0, tokens: 0 });
  }
  return out;
}
