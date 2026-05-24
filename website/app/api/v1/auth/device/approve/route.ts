import { NextResponse } from "next/server";
import { userFromBearer } from "@/lib/auth";
import {
  approveDeviceCodeGrant,
  denyDeviceCodeGrant,
  getDeviceCodeGrant,
} from "@/lib/inference/db";
import { issueApiToken } from "@/lib/auth/api_tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ApproveBody {
  code: string;
  action: "approve" | "deny";
  label?: string;
}

function parseBody(value: unknown): ApproveBody | null {
  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.code !== "string" || obj.code.length === 0 || obj.code.length > 256) {
    return null;
  }
  if (obj.action !== "approve" && obj.action !== "deny") return null;
  const label = typeof obj.label === "string" ? obj.label.slice(0, 64) : undefined;
  return { code: obj.code, action: obj.action, label };
}

export async function POST(request: Request): Promise<NextResponse> {
  // The acting user must be signed in to the web session. Reuse the
  // existing JWT bearer flow so the dashboard / device-approval page can
  // call this endpoint without any extra plumbing.
  const user = await userFromBearer(request.headers.get("authorization"));
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const body = parseBody(raw);
  if (!body) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const grant = await getDeviceCodeGrant(body.code);
  if (!grant || grant.redeemed_at !== null) {
    return NextResponse.json({ error: "code_not_pending" }, { status: 404 });
  }
  if (grant.expires_at <= new Date()) {
    return NextResponse.json({ error: "expired" }, { status: 410 });
  }

  if (body.action === "deny") {
    await denyDeviceCodeGrant(body.code);
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const issued = await issueApiToken({
    userId: user.id,
    label: body.label ?? "IDE",
  });
  await approveDeviceCodeGrant({
    code: body.code,
    user_id: user.id,
    api_token_id: issued.row.id,
    plaintext: issued.raw,
  });
  // Do NOT return the plaintext here — the IDE will pull it via /poll.
  return NextResponse.json({ ok: true, token_id: issued.row.id }, { status: 200 });
}
