import { NextResponse } from "next/server";

interface Bucket {
  count: number;
  resetAt: number;
}

const BUCKETS = new Map<string, Bucket>();
const WINDOW_MS = 60_000;
const MAX_HITS = 10;

function clientKey(request: Request, route: string): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip =
    (forwarded?.split(",")[0] ?? "").trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  return `${route}:${ip}`;
}

export function rateLimit(
  request: Request,
  route: string,
): NextResponse | null {
  const key = clientKey(request, route);
  const now = Date.now();
  const bucket = BUCKETS.get(key);
  if (!bucket || bucket.resetAt <= now) {
    BUCKETS.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return null;
  }
  if (bucket.count >= MAX_HITS) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    return NextResponse.json(
      { error: "Too many requests." },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfter) },
      },
    );
  }
  bucket.count += 1;
  return null;
}
