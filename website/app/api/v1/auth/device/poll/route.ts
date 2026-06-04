import { NextResponse } from "next/server";
import {
  consumeDeviceCodeSecret,
  getDeviceCodeGrant,
} from "@/lib/inference/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PollBody {
  device_code: string;
}

function parseBody(value: unknown): PollBody | null {
  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;
  // Prefer RFC `device_code`; accept camelCase and the legacy `code` key.
  const deviceCode = obj.device_code ?? obj.deviceCode ?? obj.code;
  if (
    typeof deviceCode !== "string" ||
    deviceCode.length === 0 ||
    deviceCode.length > 512
  ) {
    return null;
  }
  return { device_code: deviceCode };
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
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  // Looked up ONLY by the secret device_code — the browser never has this.
  const grant = await getDeviceCodeGrant(body.device_code);
  if (!grant || grant.expires_at <= new Date()) {
    return NextResponse.json(
      { status: "expired", error: "expired_token" },
      { status: 200 },
    );
  }

  // Not yet acted on by the user.
  if (grant.redeemed_at === null) {
    return NextResponse.json(
      { status: "pending", error: "authorization_pending" },
      { status: 200 },
    );
  }

  // Approved but no token issued → user denied.
  if (grant.api_token_id === null) {
    return NextResponse.json(
      { status: "denied", error: "access_denied" },
      { status: 200 },
    );
  }

  // Approved + token issued. Deliver the plaintext exactly once.
  const plaintext = await consumeDeviceCodeSecret(body.device_code);
  if (!plaintext) {
    // Already delivered; the client missed its window. Restart the flow —
    // we never replay raw bearers from the DB.
    return NextResponse.json(
      { status: "expired", reason: "already_delivered", error: "expired_token" },
      { status: 200 },
    );
  }
  return NextResponse.json(
    { status: "approved", token: plaintext },
    { status: 200 },
  );
}
