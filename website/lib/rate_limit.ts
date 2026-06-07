import { NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * Rate limiting for auth + sensitive routes.
 *
 * Uses Upstash Redis (a SHARED store) when `UPSTASH_REDIS_REST_URL` +
 * `UPSTASH_REDIS_REST_TOKEN` are set, so the limit is GLOBAL across all
 * serverless instances — the previous in-process `Map` reset per instance,
 * which under Vercel fan-out meant the effective limit was ~unbounded. When
 * Upstash isn't configured (local dev) we fall back to the in-process limiter
 * so nothing breaks.
 *
 * The key is the *trusted* client IP (platform-set `x-real-ip` first; the
 * left-most `x-forwarded-for` is client-spoofable so it's only a fallback).
 */

interface RouteLimit {
  max: number;
  windowSec: number;
}

// Per-route limits. Auth/credential endpoints are strict; reads are looser.
const ROUTE_LIMITS: Record<string, RouteLimit> = {
  "auth.login": { max: 10, windowSec: 60 },
  "auth.signup": { max: 5, windowSec: 60 },
  "auth.password-reset": { max: 5, windowSec: 60 },
  "auth.refresh": { max: 30, windowSec: 60 },
  "auth.oauth_start": { max: 20, windowSec: 60 },
  "auth.oauth_callback": { max: 20, windowSec: 60 },
};
const DEFAULT_LIMIT: RouteLimit = { max: 30, windowSec: 60 };

function limitFor(route: string): RouteLimit {
  return ROUTE_LIMITS[route] ?? DEFAULT_LIMIT;
}

function clientIp(request: Request): string {
  const real = request.headers.get("x-real-ip");
  if (real && real.trim()) return real.trim();
  const fwd = request.headers.get("x-forwarded-for");
  const first = fwd?.split(",")[0]?.trim();
  return first || "unknown";
}

// --- Upstash (shared) path -------------------------------------------------

let redisClient: Redis | null | undefined;
function redis(): Redis | null {
  if (redisClient !== undefined) return redisClient;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  redisClient = url && token ? new Redis({ url, token }) : null;
  return redisClient;
}

const limiters = new Map<string, Ratelimit>();
function limiter(route: string): Ratelimit | null {
  const r = redis();
  if (!r) return null;
  const cached = limiters.get(route);
  if (cached) return cached;
  const { max, windowSec } = limitFor(route);
  const rl = new Ratelimit({
    redis: r,
    limiter: Ratelimit.slidingWindow(max, `${windowSec} s`),
    prefix: `eri:rl:${route}`,
    analytics: false,
  });
  limiters.set(route, rl);
  return rl;
}

// --- In-process fallback (dev / Upstash unconfigured) ----------------------

interface Bucket {
  count: number;
  resetAt: number;
}
const BUCKETS = new Map<string, Bucket>();

function fallbackAllow(route: string, ip: string): { ok: boolean; retryAfter: number } {
  const { max, windowSec } = limitFor(route);
  const now = Date.now();
  const key = `${route}:${ip}`;
  const bucket = BUCKETS.get(key);
  if (!bucket || bucket.resetAt <= now) {
    BUCKETS.set(key, { count: 1, resetAt: now + windowSec * 1000 });
    return { ok: true, retryAfter: 0 };
  }
  if (bucket.count >= max) {
    return { ok: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  bucket.count += 1;
  return { ok: true, retryAfter: 0 };
}

function tooMany(retryAfter: number): NextResponse {
  return NextResponse.json(
    { error: "Too many requests." },
    { status: 429, headers: { "Retry-After": String(Math.max(1, retryAfter)) } },
  );
}

/**
 * Enforce the rate limit for `route`. Returns a 429 `NextResponse` to return
 * immediately, or `null` to proceed. Async because the shared store is networked.
 */
export async function rateLimit(
  request: Request,
  route: string,
): Promise<NextResponse | null> {
  const ip = clientIp(request);
  const rl = limiter(route);
  if (rl) {
    try {
      const { success, reset } = await rl.limit(`${route}:${ip}`);
      if (success) return null;
      const retryAfter = Math.ceil((reset - Date.now()) / 1000);
      return tooMany(retryAfter);
    } catch (e) {
      // Never hard-fail auth on a limiter outage — fall through to in-process.
      console.error("rate_limit.upstash_failed", e);
    }
  }
  const res = fallbackAllow(route, ip);
  return res.ok ? null : tooMany(res.retryAfter);
}
