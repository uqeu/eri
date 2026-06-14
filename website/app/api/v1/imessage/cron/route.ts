import { NextResponse } from "next/server";
import { relayExpiredCommands, sweepPhoneTables } from "@/lib/imessage/cleanup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Vercel Cron entrypoint — prunes expired phone_pairings + old imessage_inbound
 * rows (review M3), and closes out + notifies expired command-queue goals whose
 * computer was offline (review M5). Run FREQUENTLY (e.g. every 10 min) so the
 * "your computer was offline" notice is timely. Add to `vercel.json`:
 *
 *   { "crons": [{ "path": "/api/v1/imessage/cron", "schedule": "* /10 * * * *" }] }
 *
 * Auth mirrors the usage cron: requires `CRON_SECRET` to match the
 * `Authorization: Bearer <secret>` header Vercel attaches.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("imessage.cron.no_secret_configured");
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const swept = await sweepPhoneTables();
  const expiredCommands = await relayExpiredCommands();
  return NextResponse.json({ ok: true, ...swept, expiredCommands }, { status: 200 });
}
