import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { googleAuthUrl } from "@/lib/google_oauth";
import { rateLimit } from "@/lib/rate_limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "__eri_oauth_state";
const NEXT_COOKIE = "__eri_oauth_next";
const STATE_TTL_SECONDS = 60 * 5;

/**
 * Compute the OAuth redirect URI from the incoming request. We trust the
 * `Host` header set by Vercel / Next so a single deployment can serve both
 * preview and production domains without baking the URL into the build.
 */
function callbackUrl(request: Request): string {
  const url = new URL(request.url);
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const protocol = forwardedProto ?? url.protocol.replace(":", "");
  const host = request.headers.get("host") ?? url.host;
  return `${protocol}://${host}/api/auth/google/callback`;
}

function sanitizeNext(value: string | null): string | null {
  if (!value) return null;
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//")) return null;
  if (value.length > 512) return null;
  return value;
}

export async function GET(request: Request): Promise<NextResponse> {
  const limited = await rateLimit(request, "auth.oauth_start");
  if (limited) return limited;

  let authUrl: string;
  const state = randomBytes(32).toString("base64url");
  const redirectUri = callbackUrl(request);
  try {
    authUrl = googleAuthUrl(state, redirectUri);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Google OAuth misconfigured.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const url = new URL(request.url);
  const next = sanitizeNext(url.searchParams.get("next"));
  const isSecure =
    (request.headers.get("x-forwarded-proto") ?? url.protocol).startsWith(
      "https",
    );

  const response = NextResponse.redirect(authUrl, { status: 302 });
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    path: "/api/auth/google",
    maxAge: STATE_TTL_SECONDS,
  });
  if (next) {
    response.cookies.set(NEXT_COOKIE, next, {
      httpOnly: true,
      secure: isSecure,
      sameSite: "lax",
      path: "/api/auth/google",
      maxAge: STATE_TTL_SECONDS,
    });
  }
  return response;
}
