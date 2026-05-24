import { NextResponse } from "next/server";
import {
  consumeDeviceCodeSecret,
  getDeviceCodeGrant,
} from "@/lib/inference/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PollBody {
  code: string;
}

function parseBody(value: unknown): PollBody | null {
  if (typeof value !== "object" || value === null) return null;
  const code = (value as Record<string, unknown>).code;
  if (typeof code !== "string" || code.length === 0 || code.length > 256) {
    return null;
  }
  return { code };
}

export async function POST(request: Request): Promise<NextResponse> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const body = parseBody(raw);
  if (!body) {
    return NextResponse.json({ error: "invalid_code" }, { status: 400 });
  }

  const grant = await getDeviceCodeGrant(body.code);
  if (!grant) {
    return NextResponse.json({ status: "expired" }, { status: 200 });
  }
  if (grant.expires_at <= new Date()) {
    return NextResponse.json({ status: "expired" }, { status: 200 });
  }

  // Not yet acted on by the user.
  if (grant.redeemed_at === null) {
    return NextResponse.json({ status: "pending" }, { status: 200 });
  }

  // Approved but no token issued → user denied.
  if (grant.api_token_id === null) {
    return NextResponse.json({ status: "denied" }, { status: 200 });
  }

  // Approved + token issued. Deliver the plaintext exactly once.
  const plaintext = await consumeDeviceCodeSecret(body.code);
  if (!plaintext) {
    // Already delivered; the IDE missed its chance. The user must restart
    // the flow — we don't replay raw bearers from the DB.
    return NextResponse.json(
      { status: "expired", reason: "already_delivered" },
      { status: 200 },
    );
  }
  return NextResponse.json(
    { status: "approved", token: plaintext },
    { status: 200 },
  );
}
