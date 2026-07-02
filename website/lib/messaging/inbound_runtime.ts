/**
 * Shared inbound runtime for eri's conversational surfaces ("eri Everywhere").
 *
 * The decision logic is `handleInbound` (lib/imessage/inbound) — transport-
 * agnostic and unit-tested. This module is the runtime AROUND it: the real
 * dependency wiring (`makeInboundDeps`, `loadProfile`, memory, connectors) and
 * the `processInbound` orchestration (dedup lease → typing → handleInbound →
 * meter → send → complete/release). It was lifted out of the Sendblue route so
 * the SAME brain + the SAME orchestration serve every provider (Sendblue today,
 * Spectrum next), parameterised only by a thin per-provider `InboundTransport`
 * (how to show typing + how to send the reply). One implementation, many lines.
 */

import { Composio } from "@composio/core";
import { createHash } from "node:crypto";
import { decryptAtRest } from "@/lib/crypto/server_encryption";
import { sql } from "@/lib/db";
import { loadConversation, recordExchange } from "@/lib/agent/conversation";
import { runAgentTurn, type TierAProfile } from "@/lib/agent/run_core";
import {
  CALENDAR_TOOLKIT,
  GMAIL_TOOLKIT,
  type ConnectorDeps,
  type ToolResult,
} from "@/lib/agent/connectors";
import { runVisionTurn } from "@/lib/agent/vision";
import { analyzeCommunicationStyle } from "@/lib/agent/style";
import { mapBraveResults, type WebSearchDeps } from "@/lib/agent/web_search";
import type { WeatherDeps } from "@/lib/agent/weather";
import { embedText, normalizeForEmbedding, toPgVectorLiteral } from "@/lib/agent/embeddings";
import { fuseRRF, RECALL_CANDIDATE_LIMIT } from "@/lib/agent/memory_recall";
import { rerank } from "@/lib/agent/rerank";
import { cancelPending, confirmPending, enqueueCommand } from "@/lib/commands/queue";
import { handleInbound, type InboundDeps } from "@/lib/imessage/inbound";
import { consumePairing, normalizeE164, resolveUserByPhone } from "@/lib/imessage/identity";
import type { InboundMessage } from "@/lib/imessage/webhook";
import { formatWorldModel, readRecallProjection } from "@/lib/messaging/recall";
import { getUserSettings } from "@/lib/messaging/settings";
import { shouldSpeak } from "@/lib/messaging/voice";
import { ensureWithinQuota, recordUsage } from "@/lib/usage/quota";

/** Per-reply context a transport may honor (e.g. speak instead of typing text). */
export interface ReplyContext {
  /** Reply with a voice note instead of text (resolved from the user's setting). */
  speak: boolean;
}

/** How a given provider shows "typing…" and sends the reply for one message. */
export interface InboundTransport {
  /** Show the typing/"composing" indicator. Best-effort; must never throw. */
  sendTyping(): Promise<void>;
  /** Send the ordered reply chunks. Returns true only if every chunk landed.
   *  Providers without voice support ignore `ctx.speak` and send text. */
  sendReply(chunks: string[], ctx: ReplyContext): Promise<boolean>;
}

export type ProcessStatus =
  | "handled"
  | "duplicate"
  | "skipped_outbound"
  | "bad_number"
  | "send_failed"
  | "error";

export interface ProcessOutcome {
  status: ProcessStatus;
  branch?: string;
  userId?: string | null;
}

/**
 * Orchestrate one inbound message: claim a dedup lease, show typing, let
 * `handleInbound` decide the reply, meter, send, then complete (or release on a
 * dropped send so the provider's retry re-sends). Transport-only concerns (auth,
 * rate-limit, HTTP shape) stay in the route; this is everything in between, and
 * it's identical for every provider.
 */
export async function processInbound(
  msg: InboundMessage,
  transport: InboundTransport,
  opts: { inboundWasVoice?: boolean } = {},
): Promise<ProcessOutcome> {
  if (msg.isOutbound) return { status: "skipped_outbound" };

  const e164 = normalizeE164(msg.fromNumber);
  if (!e164) return { status: "bad_number" };

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
  if (claimed.length === 0) return { status: "duplicate" };

  // Show "eri is typing…" immediately so the wait feels intentional. Fire-and-
  // forget — must never delay or fail the actual reply.
  void transport.sendTyping().catch(() => {});

  try {
    const outcome = await handleInbound(msg, e164, makeInboundDeps());

    // Meter BEFORE responding — the tokens were spent whether or not the send
    // lands, and a fire-and-forget write would be killed on serverless.
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
      }).catch((e) => logEvent("inbound.meter_failed", { handle: msg.messageHandle, error: errMsg(e) }));
    }

    // Decide voice-vs-text from the user's setting (only for resolved users;
    // unknown/unlinked senders always get text). A settings hiccup → text.
    const speak = await resolveSpeak(outcome.meter?.userId ?? null, opts.inboundWasVoice ?? false);

    const sent = await transport.sendReply(outcome.replyChunks, { speak });
    if (!sent) {
      await releaseLease(msg.messageHandle);
      logEvent("inbound.send_failed", { handle: msg.messageHandle, branch: outcome.branch });
      return { status: "send_failed", branch: outcome.branch, userId: outcome.meter?.userId ?? null };
    }

    await completeLease(msg.messageHandle);
    logEvent("inbound.handled", {
      handle: msg.messageHandle,
      branch: outcome.branch,
      userId: outcome.meter?.userId ?? null,
      tokensIn: outcome.meter?.tokensIn ?? 0,
      tokensOut: outcome.meter?.tokensOut ?? 0,
      latencyMs: outcome.meter?.latencyMs ?? null,
    });
    return { status: "handled", branch: outcome.branch, userId: outcome.meter?.userId ?? null };
  } catch (err) {
    await releaseLease(msg.messageHandle).catch(() => {});
    logEvent("inbound.error", { handle: msg.messageHandle, error: errMsg(err) });
    return { status: "error" };
  }
}

/** Resolve whether eri should reply with a voice note for this user/turn. */
async function resolveSpeak(userId: string | null, inboundWasVoice: boolean): Promise<boolean> {
  if (!userId) return false;
  try {
    const settings = await getUserSettings(userId);
    return shouldSpeak(settings.voiceMode, inboundWasVoice);
  } catch {
    return false;
  }
}

/** Wire the real DB + model behind the orchestrator's injected-deps seam. */
export function makeInboundDeps(): InboundDeps {
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
    webSearch: makeWebSearchDeps(),
    weather: makeWeatherDeps(),
    runVisionTurn: ({ imageUrl, prompt, system }) => runVisionTurn({ imageUrl, prompt, system }),
    dispatchCodingJob: async (userId, intent) => {
      // SHADOW MODE (Phase 3, P1): the classifier runs on real inbound traffic and
      // we LOG every coding intent it flags — so we can validate precision before
      // P2 wires the real job kickoff (mirrors the Q23 shadow-then-enforce posture).
      // Return null → decline → the message falls through to normal chat, so this is
      // additive with zero behavior change. Once the brain's CodeTurn contract lands,
      // P2 replaces this body with the real kickoff + streamed status
      // ("on it — cloning — tests green — PR #123 [link]").
      logEvent("inbound.coding_intent_shadow", {
        userId,
        verb: intent.verb,
        repo: intent.repo,
        confidence: intent.confidence,
      });
      return null;
    },
    loadConversation,
    recordConversation: recordExchange,
    recordSignal,
    rejectRecentSignal,
    confirmPending,
    cancelPending,
    now: () => Date.now(),
  };
}

/** Log an eri reply as a behavioral signal ('kept') — the KTO dataset. Never throws. */
async function recordSignal(
  userId: string,
  prompt: string,
  response: string,
  model: string,
): Promise<void> {
  try {
    await sql()`
      INSERT INTO behavioral_signals (user_id, prompt, response, signal, model)
      VALUES (${userId}, ${prompt}, ${response}, 'kept', ${model})
    `;
  } catch (e) {
    logEvent("inbound.signal_record_failed", { userId, error: errMsg(e) });
  }
}

/** Flip the user's most recent signal to 'rejected' (they corrected eri). Never throws. */
async function rejectRecentSignal(userId: string): Promise<void> {
  try {
    await sql()`
      UPDATE behavioral_signals SET signal = 'rejected'
      WHERE id = (
        SELECT id FROM behavioral_signals
        WHERE user_id = ${userId} AND signal = 'kept'
        ORDER BY created_at DESC LIMIT 1
      )
    `;
  } catch (e) {
    logEvent("inbound.signal_reject_failed", { userId, error: errMsg(e) });
  }
}

/** Real-time weather via Open-Meteo — free, no API key. Throws on a non-OK
 *  response so getWeather() converts it to a friendly reason. */
function makeWeatherDeps(): WeatherDeps {
  return {
    fetchJson: async (url) => {
      const resp = await fetch(url, { headers: { Accept: "application/json" } });
      if (!resp.ok) throw new Error(`open-meteo ${resp.status}`);
      return resp.json();
    },
  };
}

function makeWebSearchDeps(): WebSearchDeps {
  return {
    runSearch: async (query, limit) => {
      // Brave Search API only — direct, fast, free-tier. Logs the failure cause so
      // a 401/missing-key shows up in the log instead of a silent "couldn't search".
      const braveKey = process.env.BRAVE_SEARCH_KEY;
      if (!braveKey) {
        logEvent("inbound.web_search_unconfigured", {});
        throw new Error("BRAVE_SEARCH_KEY not set");
      }
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`;
      const resp = await fetch(url, {
        headers: { "X-Subscription-Token": braveKey, Accept: "application/json" },
      });
      if (!resp.ok) {
        const detail = (await resp.text()).slice(0, 200);
        logEvent("inbound.web_search_http_error", { status: resp.status, detail });
        throw new Error(`brave ${resp.status}`);
      }
      return mapBraveResults(await resp.json()).slice(0, limit);
    },
  };
}

/**
 * Wire SQL (active connections) + Composio tool execution behind the ConnectorDeps
 * seam, so eri can read Gmail/Calendar in-cloud. The SDK is built per call so a
 * missing key fails at request time (caught by the connector readers → empty).
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
 * Embed text to a pgvector literal, cached by a hash of the normalized text so
 * identical strings never re-hit the embedder. Returns null when embeddings are
 * unavailable (no key / error) → lexical-only, never breaks.
 */
async function cachedEmbedLiteral(text: string): Promise<string | null> {
  const norm = normalizeForEmbedding(text);
  if (!norm) return null;
  const hash = createHash("sha256").update(norm).digest("hex");
  try {
    const hit = await sql()<{ lit: string }[]>`
      SELECT embedding::text AS lit FROM embedding_cache WHERE text_hash = ${hash}
    `;
    if (hit[0]?.lit) return hit[0].lit;
  } catch (e) {
    logEvent("inbound.embed_cache_read_failed", { error: errMsg(e) });
  }
  const vector = await embedText(norm);
  if (!vector) return null;
  const lit = toPgVectorLiteral(vector);
  try {
    await sql()`
      INSERT INTO embedding_cache (text_hash, embedding) VALUES (${hash}, ${lit}::vector)
      ON CONFLICT (text_hash) DO NOTHING
    `;
  } catch (e) {
    logEvent("inbound.embed_cache_write_failed", { error: errMsg(e) });
  }
  return lit;
}

/**
 * Save a durable fact to cloud-primary memory (learned_facts). Append-only +
 * upsert on (user_id, fact). Consolidation: a newer fact semantically near an
 * older one IN THE SAME CATEGORY supersedes it (invalidate, don't delete).
 * Never throws — a failed save becomes a soft "couldn't save".
 */
async function rememberUserFact(
  userId: string,
  fact: string,
  kind: string,
  category: string,
): Promise<boolean> {
  try {
    const vecLiteral = await cachedEmbedLiteral(fact);
    if (vecLiteral) {
      await sql()`
        UPDATE learned_facts SET superseded_at = now()
        WHERE user_id = ${userId} AND category = ${category}
          AND superseded_at IS NULL AND embedding IS NOT NULL
          AND fact <> ${fact}
          AND (embedding <=> ${vecLiteral}::vector) < 0.18
      `;
    }
    await sql()`
      INSERT INTO learned_facts (user_id, fact, kind, category, source, embedding)
      VALUES (${userId}, ${fact}, ${kind}, ${category}, 'imessage', ${vecLiteral}::vector)
      ON CONFLICT (user_id, fact)
        DO UPDATE SET created_at = now(), kind = EXCLUDED.kind,
          category = EXCLUDED.category, embedding = EXCLUDED.embedding,
          superseded_at = NULL
    `;
    return true;
  } catch (e) {
    logEvent("inbound.remember_failed", { userId, error: errMsg(e) });
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
 * Build the context eri sees for this user — account identity (always known) +
 * conversational memory (hybrid recall over learned_facts) + the synced Tier-A
 * profile + learned communication style. So eri KNOWS you on every text.
 */
export async function loadProfile(
  userId: string,
  query: string,
): Promise<{ profile: TierAProfile | null; dynamicContext: string }> {
  // 0. The brain's world-model projection (ADR-0010) — the canonical recall, read
  //    from the server-readable store. It LEADS the blend; the phone's own stores
  //    below are coverage/fallback (Phase A strangler-fig). Best-effort: a null
  //    projection just means the reply falls back to the existing TS recall.
  const wm = formatWorldModel(await readRecallProjection(userId));

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
    logEvent("inbound.identity_load_failed", { userId, error: errMsg(e) });
  }

  // 2. Conversational memory — HYBRID recall: lexical (keyword) ∪ semantic
  //    (vector) candidates fused with RRF, reranked, plus always-recent facts.
  let learnedFacts: string[] = [];
  let preferenceFacts: string[] = [];
  try {
    const prefRows = await sql()<{ fact: string }[]>`
      SELECT fact FROM learned_facts
      WHERE user_id = ${userId} AND superseded_at IS NULL AND kind = 'preference'
      ORDER BY created_at DESC LIMIT 30
    `;
    preferenceFacts = prefRows.map((r) => r.fact).filter((f) => f.trim());
  } catch (e) {
    logEvent("inbound.preferences_load_failed", { userId, error: errMsg(e) });
  }
  try {
    const q = query.trim();
    const vecLiteral = q ? await cachedEmbedLiteral(q) : null;

    const lexicalRows = q
      ? await sql()<{ fact: string }[]>`
          SELECT fact FROM learned_facts
          WHERE user_id = ${userId} AND superseded_at IS NULL
            AND fact_tsv @@ websearch_to_tsquery('english', ${q})
          ORDER BY ts_rank(fact_tsv, websearch_to_tsquery('english', ${q})) DESC
          LIMIT ${RECALL_CANDIDATE_LIMIT}
        `
      : [];

    const vectorRows = vecLiteral
      ? await sql()<{ fact: string }[]>`
          SELECT fact FROM learned_facts
          WHERE user_id = ${userId} AND superseded_at IS NULL AND embedding IS NOT NULL
          ORDER BY embedding <=> ${vecLiteral}::vector
          LIMIT ${RECALL_CANDIDATE_LIMIT}
        `
      : [];

    const recentRows = await sql()<{ fact: string }[]>`
      SELECT fact FROM learned_facts WHERE user_id = ${userId} AND superseded_at IS NULL
      ORDER BY created_at DESC LIMIT ${RECALL_CANDIDATE_LIMIT}
    `;

    const fused = fuseRRF([lexicalRows.map((r) => r.fact), vectorRows.map((r) => r.fact)]);
    const ranked = q ? await rerank(q, fused, { topK: 12 }) : fused;
    learnedFacts = [...ranked, ...recentRows.map((r) => r.fact)].filter((f) => f.trim());
  } catch (e) {
    logEvent("inbound.learned_facts_load_failed", { userId, error: errMsg(e) });
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
      logEvent("inbound.profile_decrypt_failed", { userId });
    }
  }

  // Learned communication style: distilled from how the user actually writes.
  let learnedStyle: string | null = null;
  try {
    const styleRows = await sql()<{ content: string }[]>`
      SELECT content FROM conversation_turns
      WHERE user_id = ${userId} AND role = 'user'
      ORDER BY created_at DESC LIMIT 60
    `;
    learnedStyle = analyzeCommunicationStyle(styleRows.map((r) => r.content));
  } catch (e) {
    logEvent("inbound.style_load_failed", { userId, error: errMsg(e) });
  }
  // Style: the brain's projection wins where present (§8), else the learned/synced.
  const communicationStyle = wm.style ?? learnedStyle ?? syncedProfile?.communication_style ?? null;

  // Merge facts — the brain world-model LEADS (entities/relations + its profile
  // facts), then identity, then the phone's own stores as coverage/fallback (§8).
  const facts = [
    ...wm.facts,
    ...wm.profileFacts,
    ...identityFacts,
    ...learnedFacts,
    ...(syncedProfile?.facts ?? []),
  ];
  const seen = new Set<string>();
  const dedupedFacts = facts.filter((f) => {
    const k = f.trim().toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const prefSeen = new Set<string>();
  const preferences = [...wm.preferences, ...preferenceFacts, ...(syncedProfile?.preferences ?? [])].filter((p) => {
    const k = p.trim().toLowerCase();
    if (!k || prefSeen.has(k)) return false;
    prefSeen.add(k);
    return true;
  });
  // The "right now" slice (recent observations + predictions) leads the dynamic
  // context; the brain's own dynamicContext + the synced one follow.
  const blendedDynamic = [...wm.dynamic, wm.profileDynamicContext, dynamicContext]
    .map((s) => s.trim())
    .filter(Boolean)
    .join("\n");
  if (dedupedFacts.length === 0 && preferences.length === 0 && !syncedProfile && !blendedDynamic) {
    return { profile: null, dynamicContext: "" };
  }
  return {
    profile: { facts: dedupedFacts, preferences, communication_style: communicationStyle },
    dynamicContext: blendedDynamic,
  };
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** One structured JSON line per event — greppable in the platform logs. */
export function logEvent(event: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ event, ...fields }));
}
