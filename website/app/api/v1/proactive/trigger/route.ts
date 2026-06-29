// GET /api/v1/proactive/trigger — Vercel Cron entrypoint for proactive eri.
//
// Transport only — the decision lives in `dispatchProactive` (lib/proactive).
// The flow per sweep:
//   1. verify CRON_SECRET (mirrors the imessage/usage crons) — 401 otherwise
//   2. enumerate users with a verified phone
//   3. fetch their signals (urgent email / upcoming meeting), detect triggers
//   4. dispatchProactive each: gate → compose (eri voice) → send over iMessage
//   5. meter any turn that ran; return structured counts
//
// The signal FETCH (Gmail/Calendar via the connectors) is the one seam still to
// wire — `fetchSignals` returns empty today, so the loop runs end-to-end and
// sends nothing until signals are fed. Everything else (gate, voice, send,
// dedupe, rate-limit) is live + tested. Add to vercel.json:
//   { "path": "/api/v1/proactive/trigger", "schedule": "*/5 * * * *" }

import { NextResponse } from "next/server";
import { Composio } from "@composio/core";
import { runAgentTurn, type TierAProfile } from "@/lib/agent/run_core";
import { decryptAtRest } from "@/lib/crypto/server_encryption";
import { sql } from "@/lib/db";
import { sendReply } from "@/lib/imessage/provider";
import type { CalendarSignal, EmailSignal } from "@/lib/proactive/detect";
import { detectTriggers } from "@/lib/proactive/detect";
import { dispatchProactive, type ProactiveDeps } from "@/lib/proactive/dispatch";
import {
  CALENDAR_TOOLKIT,
  GMAIL_TOOLKIT,
  fetchSignalsForUser,
  type SignalDeps,
  type ToolResult,
} from "@/lib/proactive/signals";
import type { ProactiveTrigger } from "@/lib/proactive/types";
import { recordUsage } from "@/lib/usage/quota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cap work per sweep so one cron tick stays well within the function budget. */
const MAX_USERS_PER_SWEEP = 200;
/** At most one nudge per user per sweep — the highest-confidence trigger wins. */
const MAX_TRIGGERS_PER_USER = 1;

export async function GET(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("proactive.cron.no_secret_configured");
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const nowMs = Date.now();
  const deps = makeDeps();
  const counts = { candidates: 0, triggers: 0, sent: 0, gated: 0, skipped: 0, errored: 0, no_phone: 0 };

  const candidates = await sql()<{ user_id: string }[]>`
    SELECT DISTINCT user_id FROM phone_links
    WHERE verified_at IS NOT NULL
    LIMIT ${MAX_USERS_PER_SWEEP}
  `;
  counts.candidates = candidates.length;

  for (const { user_id } of candidates) {
    let triggers: ProactiveTrigger[];
    try {
      const signals = await fetchSignals(user_id);
      triggers = detectTriggers(signals, nowMs).slice(0, MAX_TRIGGERS_PER_USER);
    } catch (err) {
      logEvent("proactive.signals_failed", { userId: user_id, error: errMsg(err) });
      continue;
    }
    for (const trigger of triggers) {
      counts.triggers++;
      const result = await dispatchProactive(user_id, trigger, deps);
      counts[result.branch]++;
      if (result.meter) {
        await recordUsage({
          user_id: result.meter.userId,
          provider: "anthropic",
          model: result.meter.model,
          intent: "proactive",
          tokens_in: result.meter.tokensIn,
          tokens_out: result.meter.tokensOut,
          cost_usd_micros: 0,
          latency_ms: 0,
          status: result.branch === "errored" ? "error" : "ok",
        }).catch((e) => logEvent("proactive.meter_failed", { userId: user_id, error: errMsg(e) }));
      }
      logEvent("proactive.dispatched", { userId: user_id, kind: trigger.kind, branch: result.branch, reason: result.reason });
    }
  }

  return NextResponse.json({ ok: true, ...counts }, { status: 200 });
}

/** Wire the real DB + model + Sendblue behind the dispatcher's deps seam. */
function makeDeps(): ProactiveDeps {
  return {
    gateState: async (userId, trigger) => {
      const rows = await sql()<{ last_ms: string | null; today: string; dup: string }[]>`
        SELECT
          extract(epoch from max(sent_at)) * 1000 AS last_ms,
          count(*) FILTER (WHERE sent_at > now() - interval '1 day') AS today,
          count(*) FILTER (WHERE dedupe_key = ${trigger.dedupeKey}) AS dup
        FROM proactive_log WHERE user_id = ${userId}
      `;
      const row = rows[0];
      const nowMs = Date.now();
      return {
        nowMs,
        lastSentMs: row?.last_ms != null ? Number(row.last_ms) : null,
        sentTodayCount: row ? Number(row.today) : 0,
        alreadySent: row ? Number(row.dup) > 0 : false,
        // No per-user timezone stored yet → use UTC hour (tz refinement is a
        // follow-up; the confidence/cap/gap gates are timezone-independent).
        localHour: new Date(nowMs).getUTCHours(),
      };
    },
    loadProfile,
    resolvePhone: async (userId) => {
      const rows = await sql()<{ phone_e164: string }[]>`
        SELECT phone_e164 FROM phone_links
        WHERE user_id = ${userId} AND verified_at IS NOT NULL
        ORDER BY verified_at DESC LIMIT 1
      `;
      return rows[0]?.phone_e164 ?? null;
    },
    runTurn: runAgentTurn,
    send: sendReply,
    recordSent: async (userId, trigger) => {
      await sql()`
        INSERT INTO proactive_log (user_id, dedupe_key, kind)
        VALUES (${userId}, ${trigger.dedupeKey}, ${trigger.kind})
        ON CONFLICT (user_id, dedupe_key) DO NOTHING
      `;
    },
  };
}

/**
 * Fetch this user's recent signals. Gmail + Calendar via the user's connected
 * Composio accounts: the decision/mapping lives in `fetchSignalsForUser`
 * (lib/proactive/signals); here we just wire the real SQL + Composio access behind
 * its `SignalDeps` seam. Crash-free by contract — `fetchSignalsForUser` swallows any
 * connector/DB failure and returns empty, so one user's broken connection never
 * stops the sweep.
 */
async function fetchSignals(
  userId: string,
): Promise<{ emails: EmailSignal[]; events: CalendarSignal[] }> {
  return fetchSignalsForUser(userId, makeSignalDeps());
}

/** Wire SQL (active connections) + Composio tool execution behind the seam. */
function makeSignalDeps(): SignalDeps {
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
      // The SDK is constructed per call so a missing key fails at request time
      // (and is caught by fetchSignalsForUser → empty), never at module load.
      const composio = new Composio({ apiKey: requireComposioKey() });
      // @composio/core 0.10+ requires a toolkit version for manual execution (else
      // it throws "Toolkit version not specified"). Latest action + skip the strict
      // check; the signal mappers are defensive against shape drift.
      const result = await composio.tools.execute(slug, {
        userId,
        arguments: args,
        version: "latest",
        dangerouslySkipVersionCheck: true,
      });
      return {
        data: (result?.data ?? {}) as Record<string, unknown>,
        error: result?.error ?? null,
        successful: result?.successful === true,
      } satisfies ToolResult;
    },
  };
}

function requireComposioKey(): string {
  const key = process.env.COMPOSIO_API_KEY;
  if (!key) throw new Error("COMPOSIO_API_KEY is not configured");
  return key;
}

/** Load + decrypt the user's Tier-A profile; missing/undecryptable → no context. */
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
    logEvent("proactive.profile_decrypt_failed", { userId });
    return { profile: null, dynamicContext: "" };
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function logEvent(event: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ event, ...fields }));
}
