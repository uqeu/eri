// POST /api/v1/imessage/inbound — the Sendblue webhook for phone eri (ADR-0002).
//
// The full flow when you text the eri number:
//   1. verify Sendblue's shared secret (constant-time) — reject otherwise
//   2. dedup on message_handle (retries never double-reply / double-meter)
//   3. if the text is a pairing code → bind + verify the number, confirm
//   4. resolve the verified user; unknown number → "run `eri phone link`"
//   5. gate phoneEri (Pro+) + quota
//   6. load the Tier-A profile, run ONE bounded turn, text the reply back
//
// Always returns 200 (with a friendly text) on app-level problems so Sendblue
// doesn't retry into a loop; only auth/parse failures return 4xx.

import { NextResponse } from "next/server";
import { decryptAtRest } from "@/lib/crypto/server_encryption";
import { sql } from "@/lib/db";
import { featureLocked } from "@/lib/feature_gate";
import { runAgentTurn, type TierAProfile } from "@/lib/agent/run_core";
import { formatReply } from "@/lib/imessage/format";
import {
  consumePairing,
  extractPairingCode,
  normalizeE164,
  resolveUserByPhone,
} from "@/lib/imessage/identity";
import { sendReply } from "@/lib/imessage/provider";
import { DEFAULT_SIGNING_HEADER, parseInbound, verifySendblueSecret } from "@/lib/imessage/webhook";
import { ensureWithinQuota, recordUsage } from "@/lib/usage/quota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_LINKED =
  "Hey! I don't recognize this number yet 🌿 Run `eri phone link` on your computer and text me the code it gives you to connect.";
const LINKED =
  'You\'re linked! 🌿 Text me anything — I know your day. Try "what was I working on?"';
const LOCKED = "Texting with eri is a Pro+ feature — upgrade at tryeri.ca to chat with me here.";
const OVER_QUOTA =
  "You're out of eri credits for this cycle — they reset next period, or upgrade at tryeri.ca.";
const ERRORED = "Sorry — I hit a snag answering that. Try me again in a sec 🌿";

export async function POST(request: Request): Promise<Response> {
  const raw = await request.text();
  const headers = Object.fromEntries(request.headers.entries());
  const secret = process.env.SENDBLUE_SIGNING_SECRET ?? "";
  const headerName = process.env.SENDBLUE_SIGNING_HEADER ?? DEFAULT_SIGNING_HEADER;
  if (!verifySendblueSecret(headers, secret, headerName)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const msg = parseInbound(body);
  if (!msg) return NextResponse.json({ error: "bad_payload" }, { status: 400 });
  if (msg.isOutbound) return NextResponse.json({ ok: true, skipped: "outbound" });

  // Idempotency — only the first delivery of a handle proceeds.
  const fresh = await sql()<{ message_handle: string }[]>`
    INSERT INTO imessage_inbound (message_handle) VALUES (${msg.messageHandle})
    ON CONFLICT (message_handle) DO NOTHING
    RETURNING message_handle
  `;
  if (fresh.length === 0) return NextResponse.json({ ok: true, skipped: "duplicate" });

  const e164 = normalizeE164(msg.fromNumber);
  if (!e164) return NextResponse.json({ ok: true, skipped: "bad_number" });

  // Pairing: a text that's just a code binds + verifies this number.
  const code = extractPairingCode(msg.content);
  if (code) {
    const paired = await consumePairing(code, e164);
    if (paired) {
      await safeSend(e164, [LINKED]);
      return NextResponse.json({ ok: true, paired: true });
    }
    // Not a real code — fall through (a normal message can look code-shaped).
  }

  const user = await resolveUserByPhone(e164);
  if (!user) {
    await safeSend(e164, [NOT_LINKED]);
    return NextResponse.json({ ok: true, linked: false });
  }
  if (featureLocked(user.tier, "phoneEri")) {
    await safeSend(e164, [LOCKED]);
    return NextResponse.json({ ok: true, locked: true });
  }

  const quota = await ensureWithinQuota(user.userId, user.tier, 1000);
  if (!quota.ok) {
    await safeSend(e164, [OVER_QUOTA]);
    return NextResponse.json({ ok: true, over_quota: true });
  }

  const { profile, dynamicContext } = await loadProfile(user.userId);

  const started = Date.now();
  let replyText: string;
  let tokensIn = 0;
  let tokensOut = 0;
  let status: "ok" | "error" = "ok";
  try {
    const turn = await runAgentTurn({
      prompt: msg.content,
      profile,
      dynamicContext,
      maxTokens: 700,
    });
    replyText = turn.text;
    tokensIn = turn.tokensIn;
    tokensOut = turn.tokensOut;
  } catch (err) {
    console.error("imessage.turn_failed", err instanceof Error ? err.message : String(err));
    replyText = ERRORED;
    status = "error";
  }

  // Meter against the same monthly bucket as everything else (intent=imessage).
  recordUsage({
    user_id: user.userId,
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    intent: "imessage",
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    cost_usd_micros: 0,
    latency_ms: Date.now() - started,
    status,
  }).catch((e) =>
    console.error("imessage.record_usage_failed", e instanceof Error ? e.message : String(e)),
  );

  await safeSend(e164, formatReply(replyText));
  return NextResponse.json({ ok: true });
}

/** Load + decrypt the caller's Tier-A profile; missing/undecryptable → no context. */
async function loadProfile(
  userId: string,
): Promise<{ profile: TierAProfile | null; dynamicContext: string }> {
  const rows = await sql()<{ profile_enc: Buffer; dynamic_context_enc: Buffer }[]>`
    SELECT profile_enc, dynamic_context_enc
    FROM personalization_profiles
    WHERE user_id = ${userId}
  `;
  const row = rows[0];
  if (!row) return { profile: null, dynamicContext: "" };
  try {
    return {
      profile: JSON.parse(decryptAtRest(Buffer.from(row.profile_enc), userId)) as TierAProfile,
      dynamicContext: decryptAtRest(Buffer.from(row.dynamic_context_enc), userId),
    };
  } catch {
    console.error("imessage.profile_decrypt_failed", { userId });
    return { profile: null, dynamicContext: "" };
  }
}

/** Send without letting a Sendblue hiccup turn into a 500 (would trigger retries). */
async function safeSend(to: string, chunks: string[]): Promise<void> {
  try {
    await sendReply(to, chunks);
  } catch (e) {
    console.error("imessage.send_failed", e instanceof Error ? e.message : String(e));
  }
}
