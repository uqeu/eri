import { NextResponse } from "next/server";

/**
 * Per-API-token sliding-window rate limit at the gateway. This is the
 * cheap first line of defense — the monthly quota in `lib/usage/quota.ts`
 * is the actual billing gate.
 *
 * Limit: 60 requests / minute per token. Bucket map lives in-process per
 * serverless instance; that's intentional — Vercel's edge fans out
 * enough that 60/min/instance is plenty for an IDE while keeping abusive
 * loops bounded.
 *
 * Response envelope mirrors `over_quota` so the IDE can drive a clock
 * toast without parsing free-form English:
 *   { error: "rate_limited", tier, window: "minute", resetAt: ISO-8601 }
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const BUCKETS = new Map<string, Bucket>();
const WINDOW_MS = 60_000;
const MAX_HITS = 60;

export interface RateLimitContext {
  /** Tier slug for the user owning the token. Surfaced in the response body. */
  readonly tier?: string;
}

export function rateLimitToken(
  apiTokenId: string,
  ctx: RateLimitContext = {},
): NextResponse | null {
  const now = Date.now();
  const bucket = BUCKETS.get(apiTokenId);
  if (!bucket || bucket.resetAt <= now) {
    BUCKETS.set(apiTokenId, { count: 1, resetAt: now + WINDOW_MS });
    return null;
  }
  if (bucket.count >= MAX_HITS) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    return NextResponse.json(
      {
        error: "rate_limited",
        tier: ctx.tier ?? "free",
        window: "minute",
        resetAt: new Date(bucket.resetAt).toISOString(),
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfter),
          "X-Eri-RateLimit-Window": "minute",
          "X-Eri-RateLimit-Reset": String(Math.floor(bucket.resetAt / 1000)),
        },
      },
    );
  }
  bucket.count += 1;
  return null;
}
