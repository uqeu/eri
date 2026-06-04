import { NextResponse } from "next/server";
import { userFromBearer } from "@/lib/auth";
import {
  approveDeviceCodeGrant,
  denyDeviceCodeGrant,
  getDeviceCodeGrantByUserCode,
  revokeOtherTokensByLabel,
} from "@/lib/inference/db";
import { issueApiToken } from "@/lib/auth/api_tokens";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ApproveBody {
  user_code: string;
  action: "approve" | "deny";
  label?: string;
}

// The browser may send the code hyphenated, lowercase, or with stray spaces.
// Normalize to the stored form: uppercase, alphanumerics only.
function normalizeUserCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.toUpperCase().replace(/[^0-9A-Z]/g, "");
  return cleaned.length >= 6 && cleaned.length <= 16 ? cleaned : null;
}

function parseBody(value: unknown): ApproveBody | null {
  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;
  // Accept `user_code`; tolerate legacy clients that sent `code`.
  const userCode = normalizeUserCode(obj.user_code ?? obj.code);
  if (!userCode) return null;
  if (obj.action !== "approve" && obj.action !== "deny") return null;
  const label =
    typeof obj.label === "string" ? obj.label.slice(0, 64) : undefined;
  return { user_code: userCode, action: obj.action, label };
}

export async function POST(request: Request): Promise<NextResponse> {
  // The acting user must be signed in to the web session; approval ties the
  // device to *their* account and quota.
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

  const grant = await getDeviceCodeGrantByUserCode(body.user_code);
  if (!grant || grant.redeemed_at !== null) {
    return NextResponse.json({ error: "code_not_pending" }, { status: 404 });
  }
  if (grant.expires_at <= new Date()) {
    return NextResponse.json({ error: "expired" }, { status: 410 });
  }

  if (body.action === "deny") {
    await denyDeviceCodeGrant(body.user_code);
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // Prefer the machine label the CLI sent at /start; fall back to any explicit
  // body label, then a generic name.
  const label = grant.device_label ?? body.label ?? "Eri";
  const issued = await issueApiToken({
    userId: user.id,
    label,
  });
  const approved = await approveDeviceCodeGrant({
    user_code: body.user_code,
    user_id: user.id,
    api_token_id: issued.row.id,
    plaintext: issued.raw,
  });
  if (!approved) {
    // Lost the race to a concurrent approve/deny between read and write. The
    // freshly issued token row is unused and owned by this user; harmless.
    return NextResponse.json({ error: "code_not_pending" }, { status: 404 });
  }

  // One active token per machine: revoke this host's prior tokens.
  const replaced = await revokeOtherTokensByLabel(user.id, label, issued.row.id);

  void recordAudit(user.id, "device.token_created", {
    token_id: issued.row.id,
    label,
    replaced,
  });

  // The device_code never appears in this response or in the browser. The
  // originating client is the only holder of it and pulls the token via /poll.
  return NextResponse.json(
    { ok: true, token_id: issued.row.id },
    { status: 200 },
  );
}
