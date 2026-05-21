import { NextResponse } from "next/server";
import { getUserByEmail, publicUser } from "@/lib/db";
import { issueTokenPair, verifyPassword } from "@/lib/auth";
import { rateLimit } from "@/lib/rate_limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface LoginBody {
  email: string;
  password: string;
}

function parseBody(value: unknown): LoginBody | null {
  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.email !== "string" || typeof obj.password !== "string") {
    return null;
  }
  return { email: obj.email, password: obj.password };
}

export async function POST(request: Request): Promise<NextResponse> {
  const limited = rateLimit(request, "auth.login");
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

  const email = body.email.trim().toLowerCase();
  const user = await getUserByEmail(email);
  if (!user || user.password_hash === null) {
    // OAuth-only accounts have no password hash; surface the same generic
    // error so we don't leak which sign-in method an email is using.
    return NextResponse.json(
      { error: "Invalid email or password." },
      { status: 401 },
    );
  }
  const ok = await verifyPassword(body.password, user.password_hash);
  if (!ok) {
    return NextResponse.json(
      { error: "Invalid email or password." },
      { status: 401 },
    );
  }

  const tokens = await issueTokenPair(user);
  return NextResponse.json(
    { ...tokens, user: publicUser(user) },
    { status: 200 },
  );
}
