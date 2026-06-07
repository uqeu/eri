import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getUserByEmail, insertPasswordResetToken } from "@/lib/db";
import { rateLimit } from "@/lib/rate_limit";
import { sendPasswordResetEmail } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESET_TTL_SECONDS = 60 * 60;

function baseUrl(): string {
  return process.env.NEXT_PUBLIC_BASE_URL ?? "https://www.tryeri.ca";
}

async function mintResetToken(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  await insertPasswordResetToken({
    token,
    user_id: userId,
    expires_at: now + RESET_TTL_SECONDS,
    created_at: now,
  });
  return token;
}

export async function POST(request: Request): Promise<NextResponse> {
  const limited = await rateLimit(request, "auth.password-reset");
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
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof (raw as { email?: unknown }).email !== "string"
  ) {
    return NextResponse.json(
      { error: "email is required." },
      { status: 400 },
    );
  }
  const email = (raw as { email: string }).email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: "Enter a valid email." },
      { status: 400 },
    );
  }

  const user = await getUserByEmail(email);

  // Always 204 — never reveal whether email is registered.
  if (!user) {
    return new NextResponse(null, { status: 204 });
  }

  const token = await mintResetToken(user.id);
  const resetUrl = new URL("/reset", baseUrl());
  resetUrl.searchParams.set("token", token);

  await sendPasswordResetEmail({
    to: user.email,
    resetUrl: resetUrl.toString(),
  });

  return new NextResponse(null, { status: 204 });
}
