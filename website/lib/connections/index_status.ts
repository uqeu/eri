/**
 * Index status — a SAFE, session-readable summary of what eri has indexed about
 * the user from their connected accounts, for the onboarding "watch eri learn
 * your world" view. Pure: shapes the world-model projection into counts + a few
 * entity NAMES (no observation text, no sensitive content — the recall projection
 * is already the distilled model, and we expose names/kinds only).
 */

import type { RecallProjection } from "@/lib/memory/recall_contract";

export interface IndexStatus {
  /** Active toolkits the user has connected (e.g. ["gmail", "googlecalendar"]). */
  connected: string[];
  counts: {
    entities: number;
    relations: number;
    observations: number;
    predictions: number;
  };
  /** Entity count per kind, e.g. { person: 11, project: 6, place: 2 }. */
  byKind: Record<string, number>;
  /** Top entities by salience — names + kinds only, for the "eri now knows…" list. */
  sample: { name: string; kind: string }[];
  /** When the brain last refreshed the projection (ms), or null if never. */
  updatedAt: number | null;
}

/** How many entity names to surface in the onboarding view. */
export const SAMPLE_MAX = 14;

export function summarizeIndex(
  projection: RecallProjection | null,
  connected: string[],
): IndexStatus {
  const entities = projection?.entities ?? [];
  const byKind: Record<string, number> = {};
  for (const e of entities) {
    const kind = e.kind || "other";
    byKind[kind] = (byKind[kind] ?? 0) + 1;
  }
  return {
    connected: [...connected].sort(),
    counts: {
      entities: entities.length,
      relations: projection?.relations.length ?? 0,
      observations: projection?.recentObservations.length ?? 0,
      predictions: projection?.predictions.length ?? 0,
    },
    byKind,
    // entities arrive sorted by salience (coerceRecallProjection) → top-N is the
    // most-salient slice; names + kinds only.
    sample: entities.slice(0, SAMPLE_MAX).map((e) => ({ name: e.name, kind: e.kind || "other" })),
    updatedAt: projection?.asOf ?? null,
  };
}
