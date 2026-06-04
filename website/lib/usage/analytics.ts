// Cross-user usage analytics for the admin view.
//
// Aggregates `usage_records` (per-user token/cost rows -- no prompt content)
// into totals, per-model, per-status, and top-user rollups over a time window.
// Service-role only: the calling route MUST gate on users.is_admin first.

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

export interface UsageTotals {
  requests: number;
  tokens_in: number;
  tokens_out: number;
  credits: number;
  cost_usd_micros: number;
  active_users: number;
}

export interface ModelRollup {
  model: string;
  requests: number;
  tokens_in: number;
  tokens_out: number;
  cost_usd_micros: number;
}

export interface StatusRollup {
  status: string;
  requests: number;
}

export interface UserRollup {
  user_id: string;
  email: string | null;
  tier: string | null;
  is_admin: boolean;
  requests: number;
  tokens_in: number;
  tokens_out: number;
  credits: number;
  cost_usd_micros: number;
  last_active: string | null;
}

export interface AdminAnalytics {
  since: string;
  days: number;
  totals: UsageTotals;
  by_model: ModelRollup[];
  by_status: StatusRollup[];
  top_users: UserRollup[];
}

const credits = (tokensIn: number, tokensOut: number): number =>
  tokensIn + OUTPUT_WEIGHT * tokensOut;

/**
 * Aggregate usage over the last `days` (1..365) into admin rollups.
 */
export async function adminAnalytics(
  days = 30,
  topN = 50,
): Promise<AdminAnalytics> {
  const safeDays = Math.min(Math.max(1, Math.floor(days)), 365);
  const safeTop = Math.min(Math.max(1, Math.floor(topN)), 500);
  const since = new Date(Date.now() - safeDays * 86_400_000);

  const totalsRows = await sql()<
    {
      requests: string;
      tokens_in: string;
      tokens_out: string;
      cost: string;
      active: string;
    }[]
  >`
    SELECT count(*) AS requests,
           coalesce(sum(tokens_in), 0) AS tokens_in,
           coalesce(sum(tokens_out), 0) AS tokens_out,
           coalesce(sum(cost_usd_micros), 0) AS cost,
           count(distinct user_id) AS active
    FROM usage_records
    WHERE ts >= ${since}
  `;
  const t = totalsRows[0];
  const tokensIn = num(t?.tokens_in);
  const tokensOut = num(t?.tokens_out);
  const totals: UsageTotals = {
    requests: num(t?.requests),
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    credits: credits(tokensIn, tokensOut),
    cost_usd_micros: num(t?.cost),
    active_users: num(t?.active),
  };

  const modelRows = await sql()<
    {
      model: string;
      requests: string;
      tokens_in: string;
      tokens_out: string;
      cost: string;
    }[]
  >`
    SELECT model,
           count(*) AS requests,
           coalesce(sum(tokens_in), 0) AS tokens_in,
           coalesce(sum(tokens_out), 0) AS tokens_out,
           coalesce(sum(cost_usd_micros), 0) AS cost
    FROM usage_records
    WHERE ts >= ${since}
    GROUP BY model
    ORDER BY cost DESC
    LIMIT 50
  `;
  const by_model: ModelRollup[] = modelRows.map((r) => ({
    model: r.model,
    requests: num(r.requests),
    tokens_in: num(r.tokens_in),
    tokens_out: num(r.tokens_out),
    cost_usd_micros: num(r.cost),
  }));

  const statusRows = await sql()<{ status: string; requests: string }[]>`
    SELECT status, count(*) AS requests
    FROM usage_records
    WHERE ts >= ${since}
    GROUP BY status
    ORDER BY requests DESC
  `;
  const by_status: StatusRollup[] = statusRows.map((r) => ({
    status: r.status,
    requests: num(r.requests),
  }));

  const userRows = await sql()<
    {
      user_id: string;
      email: string | null;
      tier: string | null;
      is_admin: boolean | null;
      requests: string;
      tokens_in: string;
      tokens_out: string;
      cost: string;
      last_active: string | Date | null;
    }[]
  >`
    SELECT u.id AS user_id,
           u.email,
           u.tier,
           u.is_admin,
           count(r.*) AS requests,
           coalesce(sum(r.tokens_in), 0) AS tokens_in,
           coalesce(sum(r.tokens_out), 0) AS tokens_out,
           coalesce(sum(r.cost_usd_micros), 0) AS cost,
           max(r.ts) AS last_active
    FROM users u
    JOIN usage_records r ON r.user_id = u.id
    WHERE r.ts >= ${since}
    GROUP BY u.id, u.email, u.tier, u.is_admin
    ORDER BY cost DESC
    LIMIT ${safeTop}
  `;
  const top_users: UserRollup[] = userRows.map((r) => {
    const ti = num(r.tokens_in);
    const to = num(r.tokens_out);
    return {
      user_id: r.user_id,
      email: r.email,
      tier: r.tier,
      is_admin: r.is_admin ?? false,
      requests: num(r.requests),
      tokens_in: ti,
      tokens_out: to,
      credits: credits(ti, to),
      cost_usd_micros: num(r.cost),
      last_active:
        r.last_active instanceof Date
          ? r.last_active.toISOString()
          : (r.last_active ?? null),
    };
  });

  return {
    since: since.toISOString(),
    days: safeDays,
    totals,
    by_model,
    by_status,
    top_users,
  };
}
