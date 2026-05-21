import { NextResponse } from "next/server";
import { listUsagePingsSince, sumUsageSince } from "@/lib/db";
import { userFromBearer } from "@/lib/auth";
import { monthlyLimitForTier } from "@/lib/stripe";
import { rateLimit } from "@/lib/rate_limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DailyBucket {
  date: string;
  tokens_used: number;
  cost_usd: number;
}

function startOfMonthEpoch(now: Date): number {
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
  );
  return Math.floor(start.getTime() / 1000);
}

function isoDate(epoch: number): string {
  const d = new Date(epoch * 1000);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function GET(request: Request): Promise<NextResponse> {
  const limited = rateLimit(request, "usage.summary");
  if (limited) return limited;

  const user = await userFromBearer(request.headers.get("authorization"));
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized." },
      { status: 401 },
    );
  }

  const now = new Date();
  const monthStart = startOfMonthEpoch(now);
  const nowEpoch = Math.floor(now.getTime() / 1000);
  const thirtyDaysAgo = nowEpoch - 30 * 24 * 60 * 60;

  const monthRow = await sumUsageSince(user.id, monthStart);
  const dailyRows = await listUsagePingsSince(user.id, thirtyDaysAgo);

  const buckets = new Map<string, DailyBucket>();
  for (let i = 29; i >= 0; i--) {
    const epoch = nowEpoch - i * 24 * 60 * 60;
    const date = isoDate(epoch);
    buckets.set(date, { date, tokens_used: 0, cost_usd: 0 });
  }
  for (const ping of dailyRows) {
    const date = isoDate(ping.created_at);
    const bucket = buckets.get(date);
    if (bucket) {
      bucket.tokens_used += ping.tokens_used;
      bucket.cost_usd += ping.cost_usd;
    }
  }

  return NextResponse.json(
    {
      tier: user.tier,
      this_month_usd: monthRow.cost,
      this_month_tokens: monthRow.tokens,
      limit_usd: monthlyLimitForTier(user.tier),
      daily: Array.from(buckets.values()),
    },
    { status: 200 },
  );
}
