import { NextResponse } from "next/server";
import { createUser, getUserByEmail, publicUser } from "@/lib/db";
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
  const limited = rateLimit(request, "auth.signup");
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
