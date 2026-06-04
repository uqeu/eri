import { NextResponse } from "next/server";
import {
  createOAuthUser,
  getUserByEmail,
  linkOAuthToUser,
} from "@/lib/db";
import { issueTokenPair, newUserId } from "@/lib/auth";
import {
  exchangeCode,
  getUserInfo,
  type GoogleUserInfo,
} from "@/lib/google_oauth";
import { rateLimit } from "@/lib/rate_limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "__eri_oauth_state";
const NEXT_COOKIE = "__eri_oauth_next";
const REFRESH_COOKIE = "eri_refresh";
const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30;
const OAUTH_PROVIDER = "google";

function callbackUrl(request: Request): string {
  const url = new URL(request.url);
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const protocol = forwardedProto ?? url.protocol.replace(":", "");
  const host = request.headers.get("host") ?? url.host;
  return `${protocol}://${host}/api/auth/google/callback`;
}

function sanitizeNext(value: string | undefined): string {
  if (!value) return "/";
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//")) return "/";
  if (value.length > 512) return "/";
  return value;
}

function errorRedirect(request: Request, code: string): NextResponse {
  const url = new URL(request.url);
  const target = new URL("/sign-in", `${url.protocol}//${url.host}`);
  target.searchParams.set("oauth_error", code);
  const response = NextResponse.redirect(target, { status: 302 });
  response.cookies.delete({ name: STATE_COOKIE, path: "/api/auth/google" });
  response.cookies.delete({ name: NEXT_COOKIE, path: "/api/auth/google" });
  return response;
}

interface UpsertResult {
  userId: string;
  email: string;
  displayName: string | null;
  isNew: boolean;
}

async function upsertGoogleUser(
  info: GoogleUserInfo,
  email: string,
): Promise<UpsertResult> {
  const existing = await getUserByEmail(email);
  if (existing) {
    if (existing.oauth_subject !== info.id) {
      await linkOAuthToUser(existing.id, OAUTH_PROVIDER, info.id);
    }
    return {
      userId: existing.id,
      email: existing.email,
      displayName: existing.display_name,
      isNew: false,
    };
  }
  const id = newUserId();
  const createdAt = Math.floor(Date.now() / 1000);
  const displayName = info.name ?? info.given_name ?? null;
  const created = await createOAuthUser({
    id,
    email,
    display_name: displayName,
    oauth_provider: OAUTH_PROVIDER,
    oauth_subject: info.id,
    created_at: createdAt,
  });
  return {
    userId: created.id,
    email: created.email,
    displayName: created.display_name,
    isNew: true,
  };
}

export async function GET(request: Request): Promise<NextResponse> {
  const limited = rateLimit(request, "auth.oauth_callback");
  if (limited) return limited;

  const url = new URL(request.url);
  if (url.searchParams.get("error")) {
    return errorRedirect(request, "access_denied");
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const stateCookie = request.headers
    .get("cookie")
    ?.split("; ")
    .map((entry) => entry.split("="))
    .find(([name]) => name === STATE_COOKIE)?.[1];
  const nextCookie = request.headers
    .get("cookie")
    ?.split("; ")
    .map((entry) => entry.split("="))
    .find(([name]) => name === NEXT_COOKIE)?.[1];

  if (!code || !state || !stateCookie || state !== stateCookie) {
    return errorRedirect(request, "invalid_state");
  }

  const redirectUri = callbackUrl(request);

  let tokenResponse;
  try {
    tokenResponse = await exchangeCode(code, redirectUri);
  } catch {
    return errorRedirect(request, "token_exchange_failed");
  }

  let userInfo: GoogleUserInfo;
  try {
    userInfo = await getUserInfo(tokenResponse.access_token);
  } catch {
    return errorRedirect(request, "userinfo_failed");
  }

  if (!userInfo.verified_email) {
    return errorRedirect(request, "email_unverified");
  }

  const email = userInfo.email.trim().toLowerCase();
  if (email.length === 0 || email.length > 254) {
    return errorRedirect(request, "invalid_email");
  }

  let upserted: UpsertResult;
  try {
    upserted = await upsertGoogleUser(userInfo, email);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    console.error("google oauth db_error", {
      email,
      sub: userInfo.id,
      error: error instanceof Error ? { message, stack: error.stack } : error,
    });
    const target = new URL("/sign-in", request.url);
    target.searchParams.set("oauth_error", "db_error");
    target.searchParams.set("oauth_debug", message.slice(0, 200));
    return NextResponse.redirect(target, { status: 302 });
  }

  const tokens = await issueTokenPair({
    id: upserted.userId,
    email: upserted.email,
    password_hash: null,
    display_name: upserted.displayName,
    tier: "free",
    stripe_customer_id: null,
    stripe_subscription_id: null,
    subscription_status: null,
    current_period_end: null,
    created_at: Math.floor(Date.now() / 1000),
    last_threshold_email_at: null,
    oauth_provider: OAUTH_PROVIDER,
    oauth_subject: userInfo.id,
    is_admin: false,
  });

  const next = sanitizeNext(
    nextCookie ? decodeURIComponent(nextCookie) : undefined,
  );
  const target = new URL(next, `${url.protocol}//${url.host}`);
  const isSecure =
    (request.headers.get("x-forwarded-proto") ?? url.protocol).startsWith(
      "https",
    );

  const response = NextResponse.redirect(target, { status: 302 });
  // The client-side session helper reads `eri_refresh` from document.cookie
  // to bootstrap a session via /api/auth/refresh, so we must NOT mark this
  // HTTP-only. The refresh token itself is single-use and rotates on each
  // exchange, which limits XSS exposure.
  response.cookies.set(REFRESH_COOKIE, tokens.refresh_token, {
    httpOnly: false,
    secure: isSecure,
    sameSite: "lax",
    path: "/",
    maxAge: REFRESH_TTL_SECONDS,
  });
  // Also surface a short-lived access token so server components can verify
  // requests immediately after the redirect without waiting for the client
  // to hit /api/auth/refresh.
  response.cookies.set("eri_access", tokens.access_token, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60,
  });
  response.cookies.delete({ name: STATE_COOKIE, path: "/api/auth/google" });
  response.cookies.delete({ name: NEXT_COOKIE, path: "/api/auth/google" });

  // Marker the UI can read to greet new users differently if needed.
  if (upserted.isNew) {
    target.searchParams.set("welcome", "1");
  }

  return response;
}
