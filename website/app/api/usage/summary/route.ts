import { NextResponse } from "next/server";
import { userFromBearer } from "@/lib/auth";
import { buildUsageSummary } from "@/lib/usage/quota";
import { dailyUsage, monthlyUsage } from "@/lib/usage/history";
import { rateLimit } from "@/lib/rate_limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Credits-based usage wire. Reads the REAL tables: token_buckets (the credit
// meter the quota gate enforces) + usage_records (tokens/cost/daily). The old
// `usage_pings` table is dead and intentionally NOT read here.
export async function GET(request: Request): Promise<NextResponse> {
  const limited = await rateLimit(request, "usage.summary");
  if (limited) return limited;

  const user = await userFromBearer(request.headers.get("authorization"));
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const [summary, month, daily] = await Promise.all([
    buildUsageSummary(user.id, user.tier),
    monthlyUsage(user.id),
    dailyUsage(user.id, 30),
  ]);

  return NextResponse.json(
    {
      tier: summary.tier,
      // Plan meter (what the quota gate enforces), in eri credits.
      credits_used: summary.tokens.used,
      credits_included: summary.tokens.included,
      credits_ghost: summary.tokens.ghost,
      remaining_included: summary.tokens.remaining_included,
      period_end: summary.period.end,
      // This calendar month, from usage_records.
      this_month_requests: month.requests,
      this_month_tokens: month.tokensTotal,
      this_month_credits: month.credits,
      this_month_cost_micros: month.costMicros,
      // Per-day activity for the chart (eri credits).
      daily: daily.map((d) => ({
        date: d.date,
        credits: d.credits,
        cost_micros: d.costMicros,
      })),
    },
    { status: 200 },
  );
}
