import { NextResponse } from "next/server";
import { userFromBearer } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { revokeAllOtherTokens } from "@/lib/inference/db";
import { rateLimit } from "@/lib/rate_limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/auth/devices/revoke-all` — sign out every device. Authenticated
 * by the web session (JWT), which is not itself a device token, so it revokes
 * ALL of the user's active api_tokens. Each revoked device 401s on its next call.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const limited = await rateLimit(request, "auth.devices.revoke_all");
  if (limited) return limited;

  const user = await userFromBearer(request.headers.get("authorization"));
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const revoked = await revokeAllOtherTokens(user.id, null);
  void recordAudit(user.id, "device.token_revoked", { all: true, revoked });
  return NextResponse.json({ ok: true, revoked }, { status: 200 });
}
