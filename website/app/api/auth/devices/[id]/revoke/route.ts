import { NextResponse } from "next/server";
import { userFromBearer } from "@/lib/auth";
import { revokeApiTokenForUser } from "@/lib/inference/db";
import { rateLimit } from "@/lib/rate_limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/auth/devices/:id/revoke` — invalidate a specific api_token.
 * The next bearer call from the revoked device will 401 instantly.
 * Always returns 200 on success, 404 on miss — we never leak whether
 * the token id exists for someone else.
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const limited = rateLimit(request, "auth.devices.revoke");
  if (limited) return limited;

  const user = await userFromBearer(request.headers.get("authorization"));
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const ok = await revokeApiTokenForUser(params.id, user.id);
  if (!ok) {
    return NextResponse.json(
      { error: "Token not found or already revoked." },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true }, { status: 200 });
}
