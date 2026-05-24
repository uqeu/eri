import { NextResponse } from "next/server";
import { resetMonthlyBuckets } from "@/lib/usage/quota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Vercel Cron entrypoint. Configure in `vercel.json`:
 *
 *   {
 *     "crons": [
 *       { "path": "/api/v1/usage/cron", "schedule": "5 0 * * *" }
 *     ]
 *   }
 *
 * Auth: requires the `CRON_SECRET` env var to match the
 * `Authorization: Bearer <secret>` header Vercel attaches when invoking
 * cron jobs. We deliberately do NOT use the API bearer flow — this is
 * an internal job, not a user-scoped call.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("usage.cron.no_secret_configured");
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  const header = request.headers.get("authorization");
  if (header !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await resetMonthlyBuckets();
  return NextResponse.json({ ok: true, ...result }, { status: 200 });
}
