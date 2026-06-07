import { NextResponse } from "next/server";
import {
  getUserById,
  publicUser,
  updateUserDisplayName,
} from "@/lib/db";
import { userFromBearer } from "@/lib/auth";
import { rateLimit } from "@/lib/rate_limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DISPLAY_NAME_MAX = 80;

export async function GET(request: Request): Promise<NextResponse> {
  const limited = await rateLimit(request, "auth.me");
  if (limited) return limited;

  const user = await userFromBearer(request.headers.get("authorization"));
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized." },
      { status: 401 },
    );
  }
  return NextResponse.json({ user: publicUser(user) }, { status: 200 });
}

/**
 * Update the currently signed-in user's profile. Today only `display_name`
 * is mutable here — email is anchored to the OAuth provider and tier flows
 * through the Stripe webhook. Empty string clears the name (the GET handler
 * then falls back to the OAuth-derived label in `publicUser`).
 *
 * Body: `{ display_name?: string | null }`
 * Response: `{ user: PublicUser }`
 */
export async function PATCH(request: Request): Promise<NextResponse> {
  const limited = await rateLimit(request, "auth.me");
  if (limited) return limited;

  const auth = await userFromBearer(request.headers.get("authorization"));
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400 },
    );
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }
  const raw = (body as Record<string, unknown>).display_name;

  // `undefined` means "field not present" → no-op + just echo current user.
  // `null` or empty string → clear the stored name (fall back to OAuth).
  // Otherwise trim + length-validate + persist.
  if (raw !== undefined) {
    let next: string | null;
    if (raw === null) {
      next = null;
    } else if (typeof raw !== "string") {
      return NextResponse.json(
        { error: "display_name must be a string or null." },
        { status: 400 },
      );
    } else {
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        next = null;
      } else if (trimmed.length > DISPLAY_NAME_MAX) {
        return NextResponse.json(
          { error: `display_name max length is ${DISPLAY_NAME_MAX}.` },
          { status: 400 },
        );
      } else {
        next = trimmed;
      }
    }
    await updateUserDisplayName(auth.id, next);
  }

  // Re-read so the response carries any other fields that may have changed
  // server-side (tier, subscription status, etc.) since the bearer landed.
  const fresh = await getUserById(auth.id);
  if (!fresh) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }
  return NextResponse.json({ user: publicUser(fresh) }, { status: 200 });
}
