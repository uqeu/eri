import { NextResponse } from "next/server";
import { publicUser } from "@/lib/db";
import { userFromBearer } from "@/lib/auth";
import { rateLimit } from "@/lib/rate_limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const limited = rateLimit(request, "auth.me");
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
