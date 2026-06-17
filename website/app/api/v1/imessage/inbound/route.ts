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
import { Composio } from "@composio/core";
import { decryptAtRest } from "@/lib/crypto/server_encryption";
import { sql } from "@/lib/db";
import { runAgentTurn, type TierAProfile } from "@/lib/agent/run_core";
import {
  CALENDAR_TOOLKIT,
  GMAIL_TOOLKIT,
  type ConnectorDeps,
  type ToolResult,
} from "@/lib/agent/connectors";
import { runVisionTurn } from "@/lib/agent/vision";
import { cancelPending, confirmPending, enqueueCommand } from "@/lib/commands/queue";
import { handleInbound, type InboundDeps } from "@/lib/imessage/inbound";
import { consumePairing, normalizeE164, resolveUserByPhone } from "@/lib/imessage/identity";
import { sendReply, sendTypingIndicator } from "@/lib/imessage/provider";
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

  // Show "eri is typing…" immediately so the wait feels intentional. Best-effort,
  // fire-and-forget — must never delay or fail the actual reply.
  void sendTypingIndicator(e164).catch(() => {});

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
    enqueueComputerGoal: async (userId, goal, kind) => {
      const enqueued = await enqueueCommand({ userId, source: "imessage", goal, kind });
      return enqueued !== null;
    },
    rememberUserFact,
    connectors: makeConnectorDeps(),
    runVisionTurn: ({ imageUrl, prompt, system }) => runVisionTurn({ imageUrl, prompt, system }),
    confirmPending,
    cancelPending,
    now: () => Date.now(),
  };
}

/**
 * Wire SQL (active connections) + Composio tool execution behind the ConnectorDeps
 * seam, so eri can read Gmail/Calendar in-cloud. Same shape as the proactive
 * cron's signal wiring; the SDK is built per call so a missing key fails at
 * request time (caught by the connector readers → empty) not at module load.
 */
function makeConnectorDeps(): ConnectorDeps {
  return {
    activeToolkits: async (userId) => {
      const rows = await sql()<{ toolkit: string }[]>`
        SELECT toolkit FROM composio_accounts
        WHERE user_id = ${userId}
          AND status = 'active'
          AND toolkit IN (${GMAIL_TOOLKIT}, ${CALENDAR_TOOLKIT})
      `;
      return new Set(rows.map((r) => r.toolkit));
    },
    executeTool: async (userId, slug, args) => {
      const key = process.env.COMPOSIO_API_KEY;
      if (!key) throw new Error("COMPOSIO_API_KEY is not configured");
      const composio = new Composio({ apiKey: key });
      const result = await composio.tools.execute(slug, { userId, arguments: args });
      return {
        data: (result?.data ?? {}) as Record<string, unknown>,
        error: result?.error ?? null,
        successful: result?.successful === true,
      } satisfies ToolResult;
    },
  };
}

/**
 * Save a durable fact to cloud-primary memory (learned_facts). Append-only +
 * upsert on (user_id, fact): re-stating a fact refreshes its recency, never
 * duplicates. Never throws — a failed save becomes a soft "couldn't save".
 */
async function rememberUserFact(userId: string, fact: string, kind: string): Promise<boolean> {
  try {
    await sql()`
      INSERT INTO learned_facts (user_id, fact, kind, source)
      VALUES (${userId}, ${fact}, ${kind}, 'imessage')
      ON CONFLICT (user_id, fact) DO UPDATE SET created_at = now(), kind = EXCLUDED.kind
    `;
    return true;
  } catch (e) {
    logEvent("imessage.remember_failed", { userId, error: errMsg(e) });
    return false;
  }
}

async function completeLease(handle: string): Promise<void> {
  await sql()`UPDATE imessage_inbound SET completed_at = now() WHERE message_handle = ${handle}`;
}

async function releaseLease(handle: string): Promise<void> {
  await sql()`DELETE FROM imessage_inbound WHERE message_handle = ${handle} AND completed_at IS NULL`;
}

/**
 * Build the context eri sees for this user, from three sources merged into one
 * profile (cloud pivot — eri must KNOW you on every text):
 *   1. Account identity (email, name, plan) from `users` — always known, so eri
 *      can answer "what's my email" without dispatching anything.
 *   2. Conversational memory (`learned_facts`) — what eri has been told over text.
 *   3. The synced Tier-A profile (`personalization_profiles`) — distilled on the
 *      laptop and pushed up.
 * Identity + learned facts work even when no profile has ever synced.
 */
async function loadProfile(
  userId: string,
): Promise<{ profile: TierAProfile | null; dynamicContext: string }> {
  // 1. Account identity — always available, cheap, the floor of "knows me".
  const identityFacts: string[] = [];
  try {
    const idRows = await sql()<{ email: string; display_name: string | null; tier: string }[]>`
      SELECT email, display_name, tier FROM users WHERE id = ${userId}
    `;
    const id = idRows[0];
    if (id) {
      if (id.display_name?.trim()) identityFacts.push(`Your name is ${id.display_name.trim()}.`);
      identityFacts.push(`Your eri account email is ${id.email}.`);
      identityFacts.push(`You're on the ${id.tier} plan.`);
    }
  } catch (e) {
    logEvent("imessage.identity_load_failed", { userId, error: errMsg(e) });
  }

  // 2. Conversational memory — newest first, capped so the prompt stays tight.
  let learnedFacts: string[] = [];
  try {
    const factRows = await sql()<{ fact: string }[]>`
      SELECT fact FROM learned_facts WHERE user_id = ${userId}
      ORDER BY created_at DESC LIMIT 40
    `;
    learnedFacts = factRows.map((r) => r.fact).filter((f) => f.trim());
  } catch (e) {
    logEvent("imessage.learned_facts_load_failed", { userId, error: errMsg(e) });
  }

  // 3. Synced Tier-A profile (optional).
  let syncedProfile: TierAProfile | null = null;
  let dynamicContext = "";
  const rows = await sql()<{ profile_enc: Buffer; dynamic_context_enc: Buffer }[]>`
    SELECT profile_enc, dynamic_context_enc
    FROM personalization_profiles
    WHERE user_id = ${userId}
  `;
  const row = rows[0];
  if (row) {
    try {
      syncedProfile = JSON.parse(decryptAtRest(Buffer.from(row.profile_enc), userId)) as TierAProfile;
      dynamicContext = decryptAtRest(Buffer.from(row.dynamic_context_enc), userId);
    } catch {
      logEvent("imessage.profile_decrypt_failed", { userId });
    }
  }

  // Merge: identity → learned → synced facts (dedup, identity/learned first so the
  // basics always lead). If nothing at all, return null so the persona stands alone.
  const facts = [...identityFacts, ...learnedFacts, ...(syncedProfile?.facts ?? [])];
  const seen = new Set<string>();
  const dedupedFacts = facts.filter((f) => {
    const k = f.trim().toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (dedupedFacts.length === 0 && !syncedProfile && !dynamicContext) {
    return { profile: null, dynamicContext: "" };
  }
  return {
    profile: {
      facts: dedupedFacts,
      preferences: syncedProfile?.preferences ?? [],
      communication_style: syncedProfile?.communication_style ?? null,
    },
    dynamicContext,
  };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** One structured JSON line per event — greppable in the Vercel logs (review H3). */
function logEvent(event: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ event, ...fields }));
}
