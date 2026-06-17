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
import { runAgentTurn, type ConversationTurn, type TierAProfile } from "@/lib/agent/run_core";
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
import { createHash } from "node:crypto";
import { embedText, normalizeForEmbedding, toPgVectorLiteral } from "@/lib/agent/embeddings";
import { fuseRRF, RECALL_CANDIDATE_LIMIT } from "@/lib/agent/memory_recall";
import { rerank } from "@/lib/agent/rerank";
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
    webSearch: makeWebSearchDeps(),
    weather: makeWeatherDeps(),
    runVisionTurn: ({ imageUrl, prompt, system }) => runVisionTurn({ imageUrl, prompt, system }),
    loadConversation,
    recordConversation,
    confirmPending,
    cancelPending,
    now: () => Date.now(),
  };
}

/**
 * Wire the real web search behind the WebSearchDeps seam. Tries Composio's search
 * tool first (free via existing COMPOSIO_API_KEY usage), then Brave's free-tier
 * API (BRAVE_SEARCH_KEY) as a fallback. Throws if neither is configured/returns —
 * webSearch() catches and tells the user it couldn't search.
 */
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
      // Brave Search API only — direct, fast, free-tier (the user explicitly does
      // not want Composio in the search path). Logs the failure cause so a 401/
      // missing-key shows up in the Vercel log instead of a silent "couldn't search".
      const braveKey = process.env.BRAVE_SEARCH_KEY;
      if (!braveKey) {
        logEvent("imessage.web_search_unconfigured", {});
        throw new Error("BRAVE_SEARCH_KEY not set");
      }
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`;
      const resp = await fetch(url, {
        headers: { "X-Subscription-Token": braveKey, Accept: "application/json" },
      });
      if (!resp.ok) {
        const detail = (await resp.text()).slice(0, 200);
        logEvent("imessage.web_search_http_error", { status: resp.status, detail });
        throw new Error(`brave ${resp.status}`);
      }
      return mapBraveResults(await resp.json()).slice(0, limit);
    },
  };
}

// Conversation context is two layers (how Claude/ChatGPT don't "lose it"):
//   1. a GENEROUS recent window replayed verbatim — texts are tiny, so we can
//      keep hundreds without meaningful cost (≈ a month of normal texting);
//   2. durable facts (learned_facts) that outlive the window entirely, so the
//      important things are remembered FOREVER even after a message scrolls off.
// (Claude-style summarization of truly enormous threads is the next-level add.)
/** Max recent turns replayed verbatim — high; the durable-facts layer covers the rest. */
const HISTORY_LIMIT = 300;
/** Replay window — a month, so eri never forgets a normal-length relationship's thread. */
const HISTORY_WINDOW = "30 days";

/** Load the recent conversation (oldest→newest) so eri remembers the thread. */
async function loadConversation(userId: string): Promise<ConversationTurn[]> {
  try {
    const rows = await sql()<{ role: string; content: string }[]>`
      SELECT role, content FROM conversation_turns
      WHERE user_id = ${userId} AND created_at > now() - ${HISTORY_WINDOW}::interval
      ORDER BY created_at DESC
      LIMIT ${HISTORY_LIMIT}
    `;
    // DB gave newest→oldest; reverse to oldest→newest for the model.
    return rows
      .reverse()
      .map((r) => ({ role: r.role === "assistant" ? "assistant" : "user", content: r.content }));
  } catch (e) {
    logEvent("imessage.history_load_failed", { userId, error: errMsg(e) });
    return [];
  }
}

/** Append this exchange to the running conversation. Best-effort — never throws. */
async function recordConversation(
  userId: string,
  userText: string,
  assistantText: string,
): Promise<void> {
  try {
    await sql()`
      INSERT INTO conversation_turns (user_id, role, content) VALUES
        (${userId}, 'user', ${userText}),
        (${userId}, 'assistant', ${assistantText})
    `;
  } catch (e) {
    logEvent("imessage.history_record_failed", { userId, error: errMsg(e) });
  }
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
/**
 * Embed text to a pgvector literal, cached by a hash of the normalized text so
 * identical strings (repeated facts, repeated queries) never re-hit Voyage — a
 * cache hit is a cheap local SELECT instead of an API round-trip. Returns null
 * when embeddings are unavailable (no key / error) → lexical-only, never breaks.
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
    logEvent("imessage.embed_cache_read_failed", { error: errMsg(e) });
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
    logEvent("imessage.embed_cache_write_failed", { error: errMsg(e) });
  }
  return lit;
}

async function rememberUserFact(
  userId: string,
  fact: string,
  kind: string,
  category: string,
): Promise<boolean> {
  try {
    // Embed the fact for semantic recall (cached; null if VOYAGE_API_KEY unset /
    // error → stored as NULL, lexical recall still works). `${null}::vector` → NULL.
    const vecLiteral = await cachedEmbedLiteral(fact);
    // P6 consolidation (mem0/Zep): a newer fact that's semantically near an older
    // one IN THE SAME CATEGORY is an UPDATE — supersede the old (invalidate, don't
    // delete) so recall never carries a stale value next to its update. Newer wins.
    // Cosine distance (<=>) < 0.18 ≈ similarity > 0.82. Skipped without an embedding.
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
  query: string,
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

  // 2. Conversational memory — HYBRID recall (the SOTA gap fix): lexical (keyword,
  //    fact_tsv) ∪ semantic (vector cosine) candidates, fused with Reciprocal Rank
  //    Fusion, plus always-include the most recent facts. So "my dog" surfaces a
  //    fact about "Bella" (semantic) AND exact keyword hits AND fresh facts —
  //    prefiltered by user_id so it only scans this person's slice (fast). Degrades
  //    to lexical when no embedding/query (vecLiteral null → vector list empty).
  let learnedFacts: string[] = [];
  // P3: standing behavior/style preferences are ALWAYS injected (not relevance-
  // gated) — "no emojis" / "call me X" must apply every turn, not just when the
  // current message happens to match them.
  let preferenceFacts: string[] = [];
  try {
    const prefRows = await sql()<{ fact: string }[]>`
      SELECT fact FROM learned_facts
      WHERE user_id = ${userId} AND superseded_at IS NULL AND kind = 'preference'
      ORDER BY created_at DESC LIMIT 30
    `;
    preferenceFacts = prefRows.map((r) => r.fact).filter((f) => f.trim());
  } catch (e) {
    logEvent("imessage.preferences_load_failed", { userId, error: errMsg(e) });
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

    // Fuse keyword + semantic by rank, then cross-encoder rerank the fused
    // candidates by TRUE relevance to the message (P5 — biggest quality lever;
    // graceful no-op without VOYAGE_API_KEY). Append recent after (the final
    // case-insensitive dedup below collapses any overlap).
    const fused = fuseRRF([lexicalRows.map((r) => r.fact), vectorRows.map((r) => r.fact)]);
    const ranked = q ? await rerank(q, fused, { topK: 12 }) : fused;
    learnedFacts = [...ranked, ...recentRows.map((r) => r.fact)].filter((f) => f.trim());
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

  // Learned communication style: distilled from how the user ACTUALLY writes over
  // time (their stored messages), so eri reflects their average voice with natural
  // variation — not a parrot of the latest message. Falls back to the device-synced
  // style, then null (eri writes naturally until it's learned them).
  let learnedStyle: string | null = null;
  try {
    const styleRows = await sql()<{ content: string }[]>`
      SELECT content FROM conversation_turns
      WHERE user_id = ${userId} AND role = 'user'
      ORDER BY created_at DESC LIMIT 60
    `;
    learnedStyle = analyzeCommunicationStyle(styleRows.map((r) => r.content));
  } catch (e) {
    logEvent("imessage.style_load_failed", { userId, error: errMsg(e) });
  }
  const communicationStyle = learnedStyle ?? syncedProfile?.communication_style ?? null;

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
  // Behavior preferences (always-on) + any synced ones, deduped.
  const prefSeen = new Set<string>();
  const preferences = [...preferenceFacts, ...(syncedProfile?.preferences ?? [])].filter((p) => {
    const k = p.trim().toLowerCase();
    if (!k || prefSeen.has(k)) return false;
    prefSeen.add(k);
    return true;
  });
  if (dedupedFacts.length === 0 && preferences.length === 0 && !syncedProfile && !dynamicContext) {
    return { profile: null, dynamicContext: "" };
  }
  return {
    profile: {
      facts: dedupedFacts,
      preferences,
      communication_style: communicationStyle,
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
