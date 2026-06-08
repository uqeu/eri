import { NextResponse } from "next/server";
import { userFromBearer } from "@/lib/auth";
import { recordTurn } from "@/lib/usage";
import { parse, turnRecordSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const user = await userFromBearer(request.headers.get("authorization"));
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = parse(turnRecordSchema, raw);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  // SECURITY: client-supplied token/cost numbers are validated above but
  // DISCARDED — a user could report anything. This endpoint only counts
  // free-tier turns (one row per POST = the authoritative rate-limit signal);
  // real token billing flows through the metered inference proxy.
  await recordTurn({ userId: user.id, kind: parsed.data.kind });

  return new NextResponse(null, { status: 204 });
}
