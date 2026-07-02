import { NextResponse } from "next/server";
import { userFromBearer } from "@/lib/auth";
import { claimSignupToken } from "@/lib/phone/signup_link";
import { makeSignupClaimDeps } from "@/lib/phone/signup_link_db";
import { rateLimit } from "@/lib/rate_limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/phone/claim  { token }  — bind the signup token's number to the
 * SESSION user's account (the magic sign-up link's final step).
 *
 * Hijack-proof: the number is fixed by the token (never from the request), the
 * bind is atomic on the phone_e164 UNIQUE index, and a number already linked to
 * anyone else is refused (409, no rebind). Session-authed (the user just signed
 * up / logged in on /join).
 */
export async function POST(request: Request): Promise<Response> {
  const limited = await rateLimit(request, "phone.claim");
  if (limited) return limited;

  const user = await userFromBearer(request.headers.get("authorization"));
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const token = (body as { token?: unknown })?.token;
  if (typeof token !== "string" || token.length === 0) {
    return NextResponse.json({ error: "missing_token" }, { status: 400 });
  }

  const result = await claimSignupToken(token, user.id, makeSignupClaimDeps(), Date.now());
  if (!result.ok) {
    const status = result.error === "number_already_linked" ? 409 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true, phone: result.phone, alreadyLinked: result.alreadyLinked });
}
