import { NextResponse } from "next/server";
import { revokeRefreshToken } from "@/lib/auth";
import { rateLimit } from "@/lib/rate_limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const limited = await rateLimit(request, "auth.logout");
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
    typeof (raw as { refresh_token?: unknown }).refresh_token !== "string"
  ) {
    return NextResponse.json(
      { error: "refresh_token is required." },
      { status: 400 },
    );
  }

  await revokeRefreshToken((raw as { refresh_token: string }).refresh_token);
  return NextResponse.json({ ok: true }, { status: 200 });
}
