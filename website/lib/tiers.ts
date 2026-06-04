import {
  countTurnsThisDay,
  countTurnsThisHour,
  countTurnsThisMonth,
  countTurnsThisWeek,
} from "./usage";

/**
 * Display-cased tier names matching `scripts/pricing_model.py`. The DB
 * stores lowercase slugs (`free`, `starter`, `pro`, `pro_plus`, `teams`)
 * so the public boundary is `normalizeTier()` below.
 */
export type TierName = "Free" | "Starter" | "Pro" | "Pro+" | "Teams";

export interface TierLimits {
  perMonth: number;
  perWeek: number;
  perDay: number;
  perHour: number;
}

/**
 * Token budgets per tier for the eri-managed inference proxy.
 *
 * `included` — monthly allowance counted against `token_buckets.tokens_used`.
 * `ghost`    — soft pool above `included`; the user can keep going but the
 *              proxy emits `x-eri-quota-warning: ghost` and the IDE tightens
 *              its slow-mode. Hard cap is `included + ghost`; beyond that
 *              the proxy returns HTTP 402.
 *
 * Numbers picked to match Cursor-class allowances at our tier prices.
 * Teams numbers are PER SEAT — the billing layer multiplies by seat count.
 */
export interface TokenBudget {
  included: number;
  ghost: number;
}

/**
 * Output-token weight for "eri credits" (the no-loss meter).
 *
 * Every Claude family prices output at 5x input (Sonnet $3/$15, Haiku $1/$5,
 * Opus $5/$25). We deduct `tokens_in + OUTPUT_WEIGHT * tokens_out` credits per
 * call so a credit's real cost is bounded by `$3/M` (Sonnet) REGARDLESS of the
 * in/out mix — output-heavy traffic can no longer blow past the plan's COGS.
 * The `included`/`ghost` numbers above are therefore denominated in CREDITS,
 * not raw tokens. Worst-case Sonnet COGS per tier = included x $3/M:
 * Pro+ $12, Teams $9, Pro $2.25, Starter $0.60 — all margin-positive.
 */
export const OUTPUT_WEIGHT = 5;

/**
 * Credits deducted from `token_buckets.tokens_used` for one inference call.
 * The no-loss meter: `in + OUTPUT_WEIGHT * out`. Negative/NaN inputs floor to 0
 * so a malformed usage report can never refund credits or crash the deduction.
 */
export function creditCost(tokensIn: number, tokensOut: number): number {
  const safeIn = Number.isFinite(tokensIn) ? Math.max(0, tokensIn) : 0;
  const safeOut = Number.isFinite(tokensOut) ? Math.max(0, tokensOut) : 0;
  return safeIn + OUTPUT_WEIGHT * safeOut;
}

export const TIER_TOKEN_BUDGETS: Record<TierName, TokenBudget> = {
  Free:    { included:         0, ghost:         0 },
  Starter: { included:   200_000, ghost:    40_000 },
  Pro:     { included:   750_000, ghost:   150_000 },
  "Pro+":  { included: 4_000_000, ghost:   800_000 },
  Teams:   { included: 3_000_000, ghost:   600_000 },
};

/**
 * Mercury (diffusion engine) is FREE at the provider level — Inception's
 * per-turn cost is negligible — but we still rate-limit it per tier to
 * stop abuse. The Free allowance is intentionally generous enough that a
 * first-session demo feels unlimited, then converts: "wow, but I want to
 * ship it" → paid tier with frontier tokens.
 */
export const MERCURY_TURN_LIMITS: Record<TierName, number> = {
  Free:    150,
  Starter: 2_000,
  Pro:     10_000,
  "Pro+":  50_000,
  Teams:   30_000,
};

/**
 * Numbers come directly from `scripts/pricing_model.py` (cache_hit_rate=0.5,
 * target_margin=0.35). Keep these in sync if pricing assumptions change —
 * the marketing site, the billing layer, and this gate must all agree.
 */
export const TIER_LIMITS: Record<TierName, TierLimits> = {
  Free:      { perMonth: 50,    perWeek: 20,   perDay: 5,   perHour: 2 },
  Starter:   { perMonth: 1839,  perWeek: 459,  perDay: 65,  perHour: 8 },
  Pro:       { perMonth: 3254,  perWeek: 813,  perDay: 116, perHour: 14 },
  "Pro+":    { perMonth: 6084,  perWeek: 1521, perDay: 217, perHour: 27 },
  Teams:     { perMonth: 3961,  perWeek: 990,  perDay: 141, perHour: 17 },
};

export interface Remaining {
  month: number;
  week: number;
  day: number;
  hour: number;
}

export interface AllowanceDecision {
  allowed: boolean;
  reason?: string;
  remaining: Remaining;
}

/**
 * Accepts either the DB slug (`free`, `pro_plus`, …) or the display name
 * (`Free`, `Pro+`, …). Anything unrecognized — including `enterprise`,
 * which has no published limits — falls back to Free.
 */
export function normalizeTier(value: string | null | undefined): TierName {
  if (!value) return "Free";
  const lower = value.toLowerCase();
  switch (lower) {
    case "free":
      return "Free";
    case "starter":
      return "Starter";
    case "pro":
      return "Pro";
    case "pro+":
    case "pro_plus":
    case "proplus":
      return "Pro+";
    case "teams":
      return "Teams";
    default:
      return "Free";
  }
}

export async function decideAllowance(
  userId: string,
  tierName: TierName,
): Promise<AllowanceDecision> {
  const limits = TIER_LIMITS[tierName];
  const [monthUsed, weekUsed, dayUsed, hourUsed] = await Promise.all([
    countTurnsThisMonth(userId),
    countTurnsThisWeek(userId),
    countTurnsThisDay(userId),
    countTurnsThisHour(userId),
  ]);

  const remaining: Remaining = {
    month: Math.max(0, limits.perMonth - monthUsed),
    week: Math.max(0, limits.perWeek - weekUsed),
    day: Math.max(0, limits.perDay - dayUsed),
    hour: Math.max(0, limits.perHour - hourUsed),
  };

  // Monthly quota is the hard "QUOTA_EXCEEDED" billing signal — paywall,
  // not retry. Week/day/hour are rolling "RATE_LIMIT" — wait then retry.
  if (monthUsed >= limits.perMonth) {
    return { allowed: false, reason: "QUOTA_EXCEEDED", remaining };
  }
  if (hourUsed >= limits.perHour) {
    return { allowed: false, reason: "RATE_LIMIT", remaining };
  }
  if (dayUsed >= limits.perDay) {
    return { allowed: false, reason: "RATE_LIMIT", remaining };
  }
  if (weekUsed >= limits.perWeek) {
    return { allowed: false, reason: "RATE_LIMIT", remaining };
  }

  return { allowed: true, remaining };
}
