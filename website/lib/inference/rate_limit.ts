import { NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * Per-API-token rate limit at the inference gateway (the cheap first line of
 * defense; the monthly quota in `lib/usage/quota.ts` is the billing gate).
 *
 * 60 requests / minute / token, GLOBAL via Upstash Redis when configured
 * (`UPSTASH_REDIS_REST_URL` + `_TOKEN`) — the old in-process map reset per
 * serverless instance, so under fan-out a single token could far exceed 60/min.
 * Falls back to in-process when Upstash isn't set (dev) and fails open on a
 * limiter outage so inference never hard-breaks.
 *
 * Response envelope (both paths) mirrors `over_quota` so the IDE can drive a
 * clock toast without parsing English.
 */

const WINDOW_MS = 60_000;
const MAX_HITS = 60;

export interface RateLimitContext {
  readonly tier?: string;
}

function tooMany(ctx: RateLimitContext, resetMs: number): NextResponse {
  const retryAfter = Math.max(1, Math.ceil((resetMs - Date.now()) / 1000));
  return NextResponse.json(
    {
      error: "rate_limited",
      tier: ctx.tier ?? "free",
      window: "minute",
      resetAt: new Date(resetMs).toISOString(),
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfter),
        "X-Eri-RateLimit-Window": "minute",
        "X-Eri-RateLimit-Reset": String(Math.floor(resetMs / 1000)),
      },
    },
  );
}

// --- Upstash (shared) path -------------------------------------------------

let limiterCache: Ratelimit | null | undefined;
function limiter(): Ratelimit | null {
  if (limiterCache !== undefined) return limiterCache;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  limiterCache =
    url && token
      ? new Ratelimit({
          redis: new Redis({ url, token }),
          limiter: Ratelimit.slidingWindow(MAX_HITS, "60 s"),
          prefix: "eri:rl:infer",
          analytics: false,
        })
      : null;
  return limiterCache;
}

// --- In-process fallback ---------------------------------------------------

interface Bucket {
  count: number;
  resetAt: number;
}
const BUCKETS = new Map<string, Bucket>();

export async function rateLimitToken(
  apiTokenId: string,
  ctx: RateLimitContext = {},
): Promise<NextResponse | null> {
  const rl = limiter();
  if (rl) {
    try {
      const { success, reset } = await rl.limit(apiTokenId);
      return success ? null : tooMany(ctx, reset);
    } catch (e) {
      console.error("inference.rate_limit.upstash_failed", e);
    }
  }
  const now = Date.now();
  const bucket = BUCKETS.get(apiTokenId);
  if (!bucket || bucket.resetAt <= now) {
    BUCKETS.set(apiTokenId, { count: 1, resetAt: now + WINDOW_MS });
    return null;
  }
  if (bucket.count >= MAX_HITS) {
    return tooMany(ctx, bucket.resetAt);
  }
  bucket.count += 1;
  return null;
}
