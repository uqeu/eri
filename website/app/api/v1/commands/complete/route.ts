// POST /api/v1/commands/complete — the computer posts a command's outcome.
//
// Body: { id, status: 'done'|'error'|'awaiting_confirm', result?, confirmPrompt? }
// We record the outcome (scoped to the caller's user_id) and relay a friendly
// line back to the user's verified phone — the result, the failure reason, or
// (for a risky action) the confirmation prompt to which they reply YES.

import { NextResponse } from "next/server";
import { authenticateApiBearer } from "@/lib/auth/api_tokens";
import {
  completeCommand,
  meteredRemoteUsage,
  relayMessage,
  type CommandStatus,
} from "@/lib/commands/queue";
import { sql } from "@/lib/db";
import { formatReply } from "@/lib/imessage/format";
import { sendReply } from "@/lib/imessage/provider";
import { recordUsage } from "@/lib/usage/quota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED: ReadonlySet<string> = new Set(["done", "error", "awaiting_confirm"]);

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticateApiBearer(request.headers.get("authorization"));
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: {
    id?: unknown;
    status?: unknown;
    result?: unknown;
    confirmPrompt?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (typeof body.id !== "string" || typeof body.status !== "string" || !ALLOWED.has(body.status)) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const status = body.status as Extract<CommandStatus, "done" | "error" | "awaiting_confirm">;
  const result = typeof body.result === "string" ? body.result : undefined;
  const confirmPrompt = typeof body.confirmPrompt === "string" ? body.confirmPrompt : undefined;

  const ok = await completeCommand({ id: body.id, userId: auth.user.id, status, result, confirmPrompt });
  if (!ok) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Meter the remote compute this turn cost (review M4) — remote control runs on
  // eri's cloud tokens like any other turn. Only terminal turns are billed (a
  // resumed awaiting_confirm meters on its own completion), and a $0 local recall
  // meters nothing. Awaited — a dangling promise dies on Vercel (review C2).
  const usage = meteredRemoteUsage({
    status,
    tokensIn: (body as { tokensIn?: unknown }).tokensIn,
    tokensOut: (body as { tokensOut?: unknown }).tokensOut,
  });
  if (usage) {
    await recordUsage({
      user_id: auth.user.id,
      provider: "anthropic",
      model: "remote-control",
      intent: "remote_control",
      tokens_in: usage.tokensIn,
      tokens_out: usage.tokensOut,
      cost_usd_micros: 0,
      latency_ms: 0,
      status: status === "done" ? "ok" : "error",
    }).catch((e) =>
      console.log(JSON.stringify({ event: "commands.meter_failed", error: String(e) })),
    );
  }

  // Relay to the user's most-recently-verified phone (best-effort).
  const links = await sql()<{ phone_e164: string }[]>`
    SELECT phone_e164 FROM phone_links
    WHERE user_id = ${auth.user.id} AND verified_at IS NOT NULL
    ORDER BY verified_at DESC
    LIMIT 1
  `;
  if (links[0]) {
    const text = relayMessage({ status, result, confirmPrompt });
    await sendReply(links[0].phone_e164, formatReply(text)).catch((e) =>
      console.log(JSON.stringify({ event: "commands.relay_failed", error: String(e) })),
    );
  }

  return NextResponse.json({ ok: true });
}
