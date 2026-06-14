// POST /api/v1/imessage/inbound — the Sendblue webhook for phone eri (ADR-0002).
//
// Transport only — the decision lives in `handleInbound` (lib/imessage/inbound).
// The flow:
//   1. verify Sendblue's shared secret (constant-time) — 401 otherwise
//   2. parse; skip our own outbound echoes
//   3. CLAIM a processing lease on message_handle (review C1): a true duplicate
//      (already completed) is skipped; a stale incomplete one is reclaimed
//   4. handleInbound decides the reply + what to meter
//   5. AWAIT the usage write (review C2 — a dangling promise dies on Vercel)
//   6. send; if Sendblue drops it (review H4) RELEASE the lease + 500 so the
//      retry re-sends; on success COMPLETE the lease
//   7. one structured log line per request (review H3)
//
// On any infra failure the lease is released and we 500 so Sendblue retries;
// a model failure is already turned into a friendly reply inside handleInbound.

import { NextResponse } from "next/server";
import { decryptAtRest } from "@/lib/crypto/server_encryption";
import { sql } from "@/lib/db";
import { runAgentTurn, type TierAProfile } from "@/lib/agent/run_core";
import { handleInbound, type InboundDeps } from "@/lib/imessage/inbound";
import { consumePairing, normalizeE164, resolveUserByPhone } from "@/lib/imessage/identity";
import { sendReply } from "@/lib/imessage/provider";
import { DEFAULT_SIGNING_HEADER, parseInbound, verifySendblueSecret } from "@/lib/imessage/webhook";
import { rateLimitKey } from "@/lib/rate_limit";
import { ensureWithinQuota, recordUsage } from "@/lib/usage/quota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const e164 = normalizeE164(msg.fromNumber);
  if (!e164) return NextResponse.json({ ok: true, skipped: "bad_number" });

  // Per-sender rate limit (the webhook shares Sendblue's IP, so we key on the
  // sender number, not the IP) — review M1.
  const limited = await rateLimitKey("imessage.inbound", e164);
  if (limited) return limited;

  // Claim the lease. New handle, or one whose prior attempt is incomplete AND
  // stale (the function was killed), wins; a completed handle is a true duplicate.
  const claimed = await sql()<{ message_handle: string }[]>`
    INSERT INTO imessage_inbound (message_handle, received_at)
    VALUES (${msg.messageHandle}, now())
    ON CONFLICT (message_handle) DO UPDATE SET received_at = now()
      WHERE imessage_inbound.completed_at IS NULL
        AND imessage_inbound.received_at < now() - interval '2 minutes'
    RETURNING message_handle
  `;
  if (claimed.length === 0) {
    return NextResponse.json({ ok: true, skipped: "duplicate" });
  }

  try {
    const outcome = await handleInbound(msg, e164, makeDeps());

    // Meter BEFORE responding — the tokens were spent whether or not the send
    // lands, and a fire-and-forget write would be killed on Vercel.
    if (outcome.meter) {
      await recordUsage({
        user_id: outcome.meter.userId,
        provider: "anthropic",
        model: outcome.meter.model,
        intent: "imessage",
        tokens_in: outcome.meter.tokensIn,
        tokens_out: outcome.meter.tokensOut,
        cost_usd_micros: 0,
        latency_ms: outcome.meter.latencyMs,
        status: outcome.meter.status,
      }).catch((e) => logEvent("imessage.meter_failed", { handle: msg.messageHandle, error: errMsg(e) }));
    }

    const sent = await sendReply(e164, outcome.replyChunks);
    if (!sent) {
      // Sendblue dropped the reply — release the lease so the retry re-sends.
      await releaseLease(msg.messageHandle);
      logEvent("imessage.send_failed", { handle: msg.messageHandle, branch: outcome.branch });
      return NextResponse.json({ error: "send_failed" }, { status: 502 });
    }

    await completeLease(msg.messageHandle);
    logEvent("imessage.handled", {
      handle: msg.messageHandle,
      branch: outcome.branch,
      userId: outcome.meter?.userId ?? null,
      tokensIn: outcome.meter?.tokensIn ?? 0,
      tokensOut: outcome.meter?.tokensOut ?? 0,
      latencyMs: outcome.meter?.latencyMs ?? null,
    });
    return NextResponse.json({ ok: true, branch: outcome.branch });
  } catch (err) {
    // Infra failure (DB, etc.) — release the lease and 500 so Sendblue retries.
    await releaseLease(msg.messageHandle).catch(() => {});
    logEvent("imessage.error", { handle: msg.messageHandle, error: errMsg(err) });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

/** Wire the real DB + model behind the orchestrator's injected-deps seam. */
function makeDeps(): InboundDeps {
  return {
    consumePairing,
    resolveUserByPhone,
    withinQuota: async (userId, tier) => (await ensureWithinQuota(userId, tier, 1000)).ok,
    loadProfile,
    runTurn: runAgentTurn,
    now: () => Date.now(),
  };
}

async function completeLease(handle: string): Promise<void> {
  await sql()`UPDATE imessage_inbound SET completed_at = now() WHERE message_handle = ${handle}`;
}

async function releaseLease(handle: string): Promise<void> {
  await sql()`DELETE FROM imessage_inbound WHERE message_handle = ${handle} AND completed_at IS NULL`;
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
    logEvent("imessage.profile_decrypt_failed", { userId });
    return { profile: null, dynamicContext: "" };
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** One structured JSON line per event — greppable in the Vercel logs (review H3). */
function logEvent(event: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ event, ...fields }));
}
