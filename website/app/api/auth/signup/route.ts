import { NextResponse } from "next/server";
import { createHmac } from "node:crypto";
import {
  countSignupOriginsByIpHash,
  createUser,
  getUserByEmail,
  publicUser,
  recordSignupOrigin,
} from "@/lib/db";
import {
  hashPassword,
  issueTokenPair,
  newUserId,
} from "@/lib/auth";
import { rateLimit } from "@/lib/rate_limit";
import { sendWelcomeEmail } from "@/lib/email";
import { canonicalizeEmail } from "@/lib/email-normalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// At most this many accounts per origin IP (free-tier abuse control).
const MAX_ACCOUNTS_PER_IP = 1;

/** Best-effort trusted client IP. Prefer the platform-set x-real-ip; fall back
 * to the left-most x-forwarded-for. */
function clientIp(request: Request): string | null {
  const real = request.headers.get("x-real-ip");
  if (real && real.trim()) return real.trim();
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return null;
}

/** HMAC of the client IP so we never store raw addresses. Returns null when the
 * server secret isn't configured (enforcement is then skipped — fail-open so
 * dev/preview aren't broken; set ERI_IP_HASH_SECRET in prod to enable). */
function hashClientIp(request: Request): string | null {
  const secret = process.env.ERI_IP_HASH_SECRET;
  if (!secret) return null;
  const ip = clientIp(request);
  if (!ip) return null;
  return createHmac("sha256", secret).update(ip).digest("hex");
}

interface SignupBody {
  email: string;
  password: string;
  display_name?: string;
}

function parseBody(value: unknown): SignupBody | null {
  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.email !== "string" || typeof obj.password !== "string") {
    return null;
  }
  const displayName =
    typeof obj.display_name === "string" ? obj.display_name : undefined;
  return {
    email: obj.email,
    password: obj.password,
    display_name: displayName,
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  const limited = await rateLimit(request, "auth.signup");
  if (limited) return limited;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400 },
    );
  }
  const body = parseBody(raw);
  if (!body) {
    return NextResponse.json(
      { error: "email and password are required." },
      { status: 400 },
    );
  }

  const rawEmail = body.email.trim().toLowerCase();
  if (!EMAIL_RE.test(rawEmail) || rawEmail.length > 254) {
    return NextResponse.json(
      { error: "Enter a valid email." },
      { status: 400 },
    );
  }
  // Store + dedupe on the canonical form so +tag aliases can't farm accounts.
  const email = canonicalizeEmail(rawEmail);
  if (body.password.length < 8 || body.password.length > 256) {
    return NextResponse.json(
      { error: "Password must be 8-256 characters." },
      { status: 400 },
    );
  }

  const existing = await getUserByEmail(email);
  if (existing) {
    return NextResponse.json(
      { error: "Email already registered." },
      { status: 409 },
    );
  }

  // Free-account abuse control: cap accounts per origin IP. Fail-open if the
  // secret isn't set or the lookup errors — never block a legit signup on a
  // best-effort abuse check.
  const ipHash = hashClientIp(request);
  if (ipHash) {
    try {
      if ((await countSignupOriginsByIpHash(ipHash)) >= MAX_ACCOUNTS_PER_IP) {
        return NextResponse.json(
          {
            error:
              "An account already exists for this network. If you need another, contact support.",
          },
          { status: 429 },
        );
      }
    } catch (e) {
      console.error("signup.ip_check_failed", e);
    }
  }

  const passwordHash = await hashPassword(body.password);
  const id = newUserId();
  const createdAt = Math.floor(Date.now() / 1000);
  const user = await createUser({
    id,
    email,
    password_hash: passwordHash,
    display_name: body.display_name ?? null,
    created_at: createdAt,
  });
  if (ipHash) {
    try {
      await recordSignupOrigin(ipHash, user.id);
    } catch (e) {
      console.error("signup.ip_record_failed", e);
    }
  }

  const tokens = await issueTokenPair(user);

  await sendWelcomeEmail({
    to: user.email,
    displayName: user.display_name ?? undefined,
  });

  return NextResponse.json(
    { ...tokens, user: publicUser(user) },
    { status: 201 },
  );
}
