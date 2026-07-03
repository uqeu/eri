// GET /api/v1/spectrum/health — public liveness endpoint for an external uptime
// monitor (the dead-man's-switch the internal cron alarm can't be). Runs the same
// active Spectrum/Photon probe the cron uses: 200 when the line could serve a
// delivery, 503 when it's dark. Reveals only ok/down — no internals.

import { NextResponse } from "next/server";
import { probeSpectrumHealthy } from "@/lib/health/line_health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const healthy = await probeSpectrumHealthy();
  return NextResponse.json({ ok: healthy }, { status: healthy ? 200 : 503 });
}
