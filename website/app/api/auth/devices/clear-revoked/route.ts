import { NextResponse } from "next/server";
import { userFromBearer } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { deleteRevokedTokensForUser } from "@/lib/inference/db";
import { rateLimit } from "@/lib/rate_limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/auth/devices/clear-revoked` — permanently remove the signed-in
 * user's revoked device tokens from history. Only ever deletes already-revoked
 * rows, so it can never sign out an active device. Returns the count cleared.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const limited = await rateLimit(request, "auth.devices.clear_revoked");
  if (limited) return limited;

  const user = await userFromBearer(request.headers.get("authorization"));
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const cleared = await deleteRevokedTokensForUser(user.id);
  void recordAudit(user.id, "device.history_cleared", { cleared });
  return NextResponse.json({ ok: true, cleared }, { status: 200 });
}
