/**
 * Recall — the phone's read half of the recall seam (ADR-0010).
 *
 * `readRecallProjection` pulls the brain's world-model projection from the
 * server-readable store (in-process, decrypt under K_server); `formatWorldModel`
 * turns it into prompt-ready context lines. The blend itself (beside the phone's
 * existing `learned_facts`) lives in `inbound_runtime.loadProfile` — Phase A
 * strangler-fig: the projection LEADS (canonical), `learned_facts` stays as
 * coverage/fallback, nothing is dropped.
 *
 * Read is best-effort: any failure returns null and the reply falls back to the
 * existing TS recall, so a brain hiccup never breaks the phone.
 */

import { decryptAtRest } from "@/lib/crypto/server_encryption";
import { sql } from "@/lib/db";
import { coerceRecallProjection, type RecallProjection } from "@/lib/memory/recall_contract";

/** How much of the projection to actually inject into a reply prompt (bounded so
 *  the context stays a glance, not a dump — the store caps are higher). */
const INJECT_FACTS = 18;
const INJECT_OBSERVATIONS = 8;
const INJECT_PREDICTIONS = 6;

/** The caller's world-model projection, or null when none / unavailable. Never throws. */
export async function readRecallProjection(userId: string): Promise<RecallProjection | null> {
  try {
    const rows = await sql()<{ projection_enc: Buffer }[]>`
      SELECT projection_enc FROM recall_projections WHERE user_id = ${userId}
    `;
    const row = rows[0];
    if (!row) return null;
    return coerceRecallProjection(JSON.parse(decryptAtRest(Buffer.from(row.projection_enc), userId)));
  } catch (e) {
    console.error("recall.read_failed", { userId, error: String(e) });
    return null;
  }
}

/** Render one relation as a natural sentence eri can read in context. */
function relationLine(kind: string, src: string, dst: string): string {
  switch (kind) {
    case "works_with":
      return `${src} works with ${dst}`;
    case "collaborates_on":
      return `${src} collaborates on ${dst}`;
    case "owns":
      return `${src} owns ${dst}`;
    case "uses":
      return `${src} uses ${dst}`;
    case "part_of":
      return `${src} is part of ${dst}`;
    default:
      return `${src} → ${dst} (${kind})`;
  }
}

/** The projection as prompt-ready context: a knowledge block (entities/relations),
 *  a "right now" block (recent observations + predictions), and the brain's own
 *  style/profile fields. Pure + tested. */
export interface WorldModelContext {
  /** Entity + relation knowledge — these LEAD the profile facts (brain-first). */
  facts: string[];
  /** The live slice: recent observations + learned next-step predictions. */
  dynamic: string[];
  /** The brain's communication style, when present (empty until the sync slice). */
  style: string | null;
  /** The brain profile's own facts/preferences/dynamicContext (empty until sync). */
  profileFacts: string[];
  preferences: string[];
  profileDynamicContext: string;
}

export function formatWorldModel(p: RecallProjection | null): WorldModelContext {
  if (!p) {
    return { facts: [], dynamic: [], style: null, profileFacts: [], preferences: [], profileDynamicContext: "" };
  }

  // Relations are the most informative ("who works with whom on what"); lead with
  // them, then fill with standalone high-salience entities not already named.
  const facts: string[] = [];
  const seen = new Set<string>();
  for (const r of p.relations) {
    const line = relationLine(r.kind, r.src, r.dst);
    if (!seen.has(line)) {
      facts.push(line);
      seen.add(line);
    }
    if (facts.length >= INJECT_FACTS) break;
  }
  if (facts.length < INJECT_FACTS) {
    const named = new Set(p.relations.flatMap((r) => [r.src, r.dst]));
    for (const e of p.entities) {
      if (named.has(e.name)) continue;
      facts.push(e.kind ? `${e.name} (${e.kind})` : e.name);
      if (facts.length >= INJECT_FACTS) break;
    }
  }

  const dynamic: string[] = [];
  for (const o of p.recentObservations.slice(0, INJECT_OBSERVATIONS)) dynamic.push(o.text);
  for (const pr of p.predictions.slice(0, INJECT_PREDICTIONS)) {
    dynamic.push(`After ${pr.after}, you usually ${pr.next}.`);
  }

  return {
    facts,
    dynamic,
    style: p.profile.communicationStyle || null,
    profileFacts: p.profile.facts,
    preferences: p.profile.preferences,
    profileDynamicContext: p.profile.dynamicContext,
  };
}
