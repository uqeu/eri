// POST /api/v1/commands/poll — the computer-resident eri claims its next command.
//
// The computer drives the work (Vercel has no worker): it polls this on an
// interval with its eri_sk_ bearer; we atomically claim the oldest pending,
// non-expired command for THAT user and hand it back. Returns { command: null }
// when there's nothing to do. Strictly user-scoped — a bearer can only ever
// claim its own rows.

import { NextResponse } from "next/server";
import { authenticateApiBearer } from "@/lib/auth/api_tokens";
import { claimNextCommand } from "@/lib/commands/queue";
import { featureLocked } from "@/lib/feature_gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticateApiBearer(request.headers.get("authorization"));
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (featureLocked(auth.user.tier, "phoneEri")) {
    return NextResponse.json({ error: "tier_locked", required: "pro_plus" }, { status: 402 });
  }
  const command = await claimNextCommand(auth.user.id);
  return NextResponse.json({ command });
}
