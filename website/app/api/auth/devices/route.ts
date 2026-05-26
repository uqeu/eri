import { NextResponse } from "next/server";
import { userFromBearer } from "@/lib/auth";
import { listApiTokensByUser } from "@/lib/inference/db";
import { rateLimit } from "@/lib/rate_limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DeviceWire {
  id: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
  revoked: boolean;
}

/**
 * `GET /api/auth/devices` — list every api_token the signed-in user has
 * ever had, active first. Plaintext bearers are NEVER returned; only the
 * id (which the revoke endpoint uses) and human-readable metadata.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const limited = rateLimit(request, "auth.devices.list");
  if (limited) return limited;

  const user = await userFromBearer(request.headers.get("authorization"));
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const tokens = await listApiTokensByUser(user.id);
  const devices: DeviceWire[] = tokens.map((t) => ({
    id: t.id,
    label: t.label,
    created_at: t.created_at.toISOString(),
    last_used_at: t.last_used_at ? t.last_used_at.toISOString() : null,
    revoked: t.revoked_at !== null,
  }));
  return NextResponse.json({ devices }, { status: 200 });
}
