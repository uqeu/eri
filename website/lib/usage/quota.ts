import {
  getTokenBucket,
  incrementMercuryTurns,
  incrementTokensUsed,
  insertUsageRecord,
  markBucketWarned,
  sumUsageRecords24h,
  type TokenBucketRow,
  type UsageRecordInput,
  updateBucketAllowance,
  upsertTokenBucket,
} from "@/lib/inference/db";
import {
  MERCURY_TURN_LIMITS,
  normalizeTier,
  TIER_TOKEN_BUDGETS,
  type TierName,
} from "@/lib/tiers";

/**
 * Tier-based ghost-limit enforcement for the inference proxy.
 *
 * Flow per request:
 *   1. `ensureWithinQuota(userId, tier, estimate)` — pre-flight check.
 *      Returns `ok` (or `ghost_warning` if user has crossed `included`)
 *      to let the request through, or `over_quota` to short-circuit with
 *      HTTP 402.
 *   2. Stream upstream response.
 *   3. `recordUsage(userId, record)` — insert a usage_records row AND
 *      atomically increment `token_buckets.tokens_used`. Marks the warned
 *      flag the first time the user crosses `included` so the proxy can
 *      emit `x-eri-quota-warning: ghost`.
 */

export type QuotaStatus = "ok" | "ghost_warning" | "over_quota";

export interface QuotaCheck {
  ok: boolean;
  status: QuotaStatus;
  bucket: TokenBucketRow;
}

function periodWindowForNow(now: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

function budgetForTier(tier: TierName): { included: number; ghost: number } {
  return TIER_TOKEN_BUDGETS[tier];
}

/**
 * Fetch the user's bucket, lazily creating one matching the tier when
 * absent. Also rolls the window forward if the stored period has expired.
 */
export async function getOrCreateBucket(
  userId: string,
  tier: TierName,
  now: Date = new Date(),
): Promise<TokenBucketRow> {
  const existing = await getTokenBucket(userId);
  if (existing && existing.period_end > now) {
    return existing;
  }
  const { included, ghost } = budgetForTier(tier);
  const { start, end } = periodWindowForNow(now);
  return upsertTokenBucket({
    user_id: userId,
    period_start: start,
    period_end: end,
    tokens_included: included,
    tokens_overage: ghost,
  });
}

/**
 * Decide whether `estimatedTokens` is allowed under the user's current
 * bucket. Conservatively counts the estimate against the hard cap so we
 * never start streaming a request the user can't pay for.
 */
export async function ensureWithinQuota(
  userId: string,
  tierSlug: string,
  estimatedTokens: number,
): Promise<QuotaCheck> {
  const tier = normalizeTier(tierSlug);
  const bucket = await getOrCreateBucket(userId, tier);
  const hardCap = bucket.tokens_included + bucket.tokens_overage;
  const projected = bucket.tokens_used + Math.max(0, estimatedTokens);

  if (projected > hardCap) {
    return { ok: false, status: "over_quota", bucket };
  }
  if (projected > bucket.tokens_included) {
    return { ok: true, status: "ghost_warning", bucket };
  }
  return { ok: true, status: "ok", bucket };
}

export interface RecordUsageOutcome {
  bucket: TokenBucketRow | null;
  crossedIntoGhost: boolean;
}

/**
 * Insert a usage_records row and atomically bump `tokens_used`. Returns
 * the new bucket state so the caller can decide whether to emit the
 * `x-eri-quota-warning: ghost` header.
 */
export async function recordUsage(
  record: UsageRecordInput,
): Promise<RecordUsageOutcome> {
  const totalTokens = record.tokens_in + record.tokens_out;
  await insertUsageRecord(record);
  if (totalTokens <= 0) {
    const bucket = await getTokenBucket(record.user_id);
    return { bucket, crossedIntoGhost: false };
  }
  const before = await getTokenBucket(record.user_id);
  const bucket = await incrementTokensUsed(record.user_id, totalTokens);
  if (!bucket || !before) {
    return { bucket, crossedIntoGhost: false };
  }
  const crossed =
    before.tokens_used <= before.tokens_included &&
    bucket.tokens_used > bucket.tokens_included &&
    before.warned_at === null;
  if (crossed) {
    await markBucketWarned(record.user_id);
  }
  return { bucket, crossedIntoGhost: crossed };
}

export interface MercuryTurnCheck {
  ok: boolean;
  used: number;
  limit: number;
  resetAt: Date;
}

/**
 * Mercury turn gate (separate from frontier-token quota). Mercury is free
 * per-call, so this exists only to keep Free-tier abuse bounded. Caller
 * should refuse the request when `ok === false` and surface the limit/reset.
 */
export async function ensureMercuryTurnAvailable(
  userId: string,
  tierSlug: string,
): Promise<MercuryTurnCheck> {
  const tier = normalizeTier(tierSlug);
  const bucket = await getOrCreateBucket(userId, tier);
  const limit = MERCURY_TURN_LIMITS[tier];
  const used = bucket.mercury_turns_used;
  return {
    ok: used < limit,
    used,
    limit,
    resetAt: bucket.period_end,
  };
}

/**
 * Atomically bump the Mercury turn counter. Called after a successful
 * `/api/v1/inference/iterate` proxy round-trip.
 */
export async function recordMercuryTurn(userId: string): Promise<void> {
  await incrementMercuryTurns(userId);
}

/**
 * Reset every user's bucket whose `period_end` has elapsed. Intended for
 * a Vercel Cron job hitting an internal route on the billing anniversary;
 * exported here as a pure helper so it can be unit-tested in isolation.
 */
export async function resetMonthlyBuckets(now: Date = new Date()): Promise<{
  reset: number;
}> {
  // The bucket layer is a per-user upsert; the cron-style route in
  // app/api/v1/usage/cron iterates over users and calls
  // `getOrCreateBucket` which handles the rollover atomically. We keep
  // this function as a thin wrapper so the route stays declarative.
  const { sql } = await import("@/lib/db");
  const rows = await sql()<{ user_id: string; tier: string }[]>`
    SELECT tb.user_id, u.tier
    FROM token_buckets tb
    JOIN users u ON u.id = tb.user_id
    WHERE tb.period_end <= ${now}
  `;
  let count = 0;
  for (const row of rows) {
    await getOrCreateBucket(row.user_id, normalizeTier(row.tier), now);
    count += 1;
  }
  return { reset: count };
}

export interface UsageSummary {
  tier: TierName;
  period: { start: string; end: string };
  tokens: {
    used: number;
    included: number;
    ghost: number;
    remaining_included: number;
    remaining_ghost: number;
  };
  soft_cap_warning: boolean;
  recent_24h: { requests: number; tokens: number };
}

/**
 * Flat camelCase shape with **tier slugs** (not display names) — what
 * the IDE's `UsageClient.parseUsage` actually consumes. We keep
 * `UsageSummary` as the internal nested shape for SSR / dashboard pages
 * and derive this wire form for the API boundary.
 */
export interface IdeUsageWire {
  tier: string;
  tokensUsed: number;
  tokensIncluded: number;
  tokensGhost: number;
  remainingIncluded: number;
  remainingGhost: number;
  softCapWarning: boolean;
  periodEnd: string;
}

export async function buildUsageWireForIde(
  userId: string,
  tierSlug: string,
): Promise<IdeUsageWire> {
  const summary = await buildUsageSummary(userId, tierSlug);
  return {
    tier: tierSlug,
    tokensUsed: summary.tokens.used,
    tokensIncluded: summary.tokens.included,
    tokensGhost: summary.tokens.ghost,
    remainingIncluded: summary.tokens.remaining_included,
    remainingGhost: summary.tokens.remaining_ghost,
    softCapWarning: summary.soft_cap_warning,
    periodEnd: summary.period.end,
  };
}

export async function buildUsageSummary(
  userId: string,
  tierSlug: string,
): Promise<UsageSummary> {
  const tier = normalizeTier(tierSlug);
  const bucket = await getOrCreateBucket(userId, tier);
  const recent = await sumUsageRecords24h(userId);
  const remainingIncluded = Math.max(
    0,
    bucket.tokens_included - bucket.tokens_used,
  );
  const usedAboveIncluded = Math.max(
    0,
    bucket.tokens_used - bucket.tokens_included,
  );
  const remainingGhost = Math.max(0, bucket.tokens_overage - usedAboveIncluded);
  return {
    tier,
    period: {
      start: bucket.period_start.toISOString(),
      end: bucket.period_end.toISOString(),
    },
    tokens: {
      used: bucket.tokens_used,
      included: bucket.tokens_included,
      ghost: bucket.tokens_overage,
      remaining_included: remainingIncluded,
      remaining_ghost: remainingGhost,
    },
    soft_cap_warning: bucket.tokens_used > bucket.tokens_included,
    recent_24h: recent,
  };
}

/**
 * Re-align an existing bucket to a new tier (called from the Stripe
 * webhook when a subscription is created / updated / cancelled). We keep
 * `tokens_used` so a mid-cycle upgrade doesn't hand the user a fresh
 * allowance for free, but bump the cap.
 */
export async function applyTierToBucket(
  userId: string,
  tierSlug: string,
): Promise<void> {
  const tier = normalizeTier(tierSlug);
  const { included, ghost } = budgetForTier(tier);
  const existing = await getTokenBucket(userId);
  if (!existing) {
    await getOrCreateBucket(userId, tier);
    return;
  }
  await updateBucketAllowance({
    user_id: userId,
    tokens_included: included,
    tokens_overage: ghost,
  });
}
