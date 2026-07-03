/**
 * Recall projection — wire contract for the sibling endpoint (`/api/v1/memory/recall`).
 *
 * The Rust brain pushes a bounded projection of the user's world model (the §1
 * shape in docs/contracts/recall-projection-contract.md); the server stores it
 * encrypted (K_server, AAD=user_id), and the phone reads it to enrich a reply.
 *
 * This is a SIBLING of the Tier-A profile endpoint — chosen because the existing
 * profile PUT is *lossy* (it stores only `JSON.stringify(body.profile)`, silently
 * dropping any top-level world-model fields), so riding it would 200-OK while the
 * projection vanished. Distinct path, SAME encryption.
 *
 * Pure: validate + canonicalize on write, defensively shape on read. Both bounded
 * so a malformed/huge projection can never blow up the prompt or the store.
 */

/** Projection cap — the brain targets <=32KB; 64KB is the hard ceiling (mirrors profile). */
export const MAX_RECALL_BYTES = 64 * 1024;
/** Bounds so a runaway projection can't flood the store or the prompt. */
export const MAX_ENTITIES = 60;
export const MAX_RELATIONS = 80;
export const MAX_OBSERVATIONS = 40;
export const MAX_PREDICTIONS = 30;
export const MAX_PROFILE_LIST = 60;

export interface RecallEntity {
  id: string;
  kind: string;
  name: string;
  salience: number;
}
export interface RecallRelation {
  src: string;
  dst: string;
  kind: string;
}
export interface RecallObservation {
  text: string;
  ts: number;
  kind: string;
}
export interface RecallPrediction {
  after: string;
  next: string;
  count: number;
}
/** Learned texting cadence — how the user paces their messages (bubbles/turn). */
export interface RecallCadence {
  /** Human phrase for the prompt ("short quick bursts, often 2-3 messages"). */
  descriptor: string;
  /** Typical bubbles per turn (1 = terse, 3 = bursty). Clamped 1..4. */
  bubblesPerTurn: number;
}
export interface RecallProfile {
  facts: string[];
  preferences: string[];
  communicationStyle: string;
  dynamicContext: string;
  /** Learned texting cadence — optional (absent on older projections / fresh users). */
  cadence?: RecallCadence;
}
export interface RecallProjection {
  version: number;
  asOf: number;
  entities: RecallEntity[];
  relations: RecallRelation[];
  recentObservations: RecallObservation[];
  predictions: RecallPrediction[];
  profile: RecallProfile;
}

function rec(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
function strList(v: unknown, cap: number): string[] {
  return arr(v)
    .map(str)
    .filter((s) => s.trim())
    .slice(0, cap);
}
function coerceCadence(v: unknown): RecallCadence | undefined {
  const o = rec(v);
  const descriptor = str(o.descriptor).trim();
  const bubblesPerTurn = num(o.bubblesPerTurn);
  if (!descriptor && bubblesPerTurn <= 0) return undefined;
  return { descriptor, bubblesPerTurn: Math.max(1, Math.min(Math.round(bubblesPerTurn) || 1, 4)) };
}

/**
 * Defensively shape any raw value into a well-formed, bounded RecallProjection.
 * Used on READ (decrypted store) and as the canonical form on WRITE. Drops
 * malformed elements, coerces types, caps sizes — never throws. Empty/absent
 * fields are valid (a fresh user projects `[]` / empty profile).
 */
export function coerceRecallProjection(raw: unknown): RecallProjection {
  const r = rec(raw);
  const p = rec(r.profile);
  const cadence = coerceCadence(p.cadence);

  const entities: RecallEntity[] = arr(r.entities)
    .map((e) => {
      const o = rec(e);
      return { id: str(o.id), kind: str(o.kind), name: str(o.name).trim(), salience: num(o.salience) };
    })
    .filter((e) => e.name)
    .sort((a, b) => b.salience - a.salience)
    .slice(0, MAX_ENTITIES);

  const names = new Set(entities.map((e) => e.name));
  const relations: RecallRelation[] = arr(r.relations)
    .map((e) => {
      const o = rec(e);
      return { src: str(o.src).trim(), dst: str(o.dst).trim(), kind: str(o.kind) };
    })
    // §1 guarantee: relations only reference projected entities (no dangling).
    .filter((rel) => rel.src && rel.dst && names.has(rel.src) && names.has(rel.dst))
    .slice(0, MAX_RELATIONS);

  const recentObservations: RecallObservation[] = arr(r.recentObservations)
    .map((e) => {
      const o = rec(e);
      return { text: str(o.text).trim(), ts: num(o.ts), kind: str(o.kind) || "fact" };
    })
    .filter((o) => o.text)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, MAX_OBSERVATIONS);

  const predictions: RecallPrediction[] = arr(r.predictions)
    .map((e) => {
      const o = rec(e);
      return { after: str(o.after).trim(), next: str(o.next).trim(), count: num(o.count) };
    })
    // count >= 2 per the contract (a learned chain, not a one-off).
    .filter((pr) => pr.after && pr.next && pr.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_PREDICTIONS);

  return {
    version: typeof r.version === "number" ? r.version : 1,
    asOf: num(r.asOf),
    entities,
    relations,
    recentObservations,
    predictions,
    profile: {
      facts: strList(p.facts, MAX_PROFILE_LIST),
      preferences: strList(p.preferences, MAX_PROFILE_LIST),
      communicationStyle: str(p.communicationStyle).trim(),
      dynamicContext: str(p.dynamicContext).trim(),
      ...(cadence ? { cadence } : {}),
    },
  };
}

export type RecallUpload = { ok: true; json: string } | { ok: false; error: string };

/**
 * Validate + canonicalize a pushed projection for storage. Coerces to the bounded
 * shape (so we store exactly what we validated), then enforces the byte ceiling.
 */
export function parseRecallUpload(body: unknown): RecallUpload {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "missing_body" };
  }
  const json = JSON.stringify(coerceRecallProjection(body));
  if (Buffer.byteLength(json, "utf8") > MAX_RECALL_BYTES) {
    return { ok: false, error: "recall_too_large" };
  }
  return { ok: true, json };
}
