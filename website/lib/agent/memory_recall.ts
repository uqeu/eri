/**
 * Hybrid memory recall for learned_facts — the fusion layer that makes eri recall
 * the RIGHT facts about a person.
 *
 * THE GAP: lexical-only retrieval (Postgres fact_tsv @@ websearch_to_tsquery) can't
 * match paraphrases — "my dog" never surfaces a fact about "Bella". The fix is
 * HYBRID retrieval: run a lexical search AND a semantic vector search in parallel,
 * then fuse the two ranked lists with Reciprocal Rank Fusion (RRF). Lexical wins on
 * exact tokens (names, codes); vector wins on synonyms/intent. Hybrid beats either.
 *
 * This module owns the PURE fusion math (`fuseRRF`). The two ranked lists are
 * produced by SQL in the route (route.ts owns the DB + the OpenAI key); see
 * `HYBRID_QUERY_DOC` below for the exact intended query.
 */

/** RRF's smoothing constant. The canonical default (Cormack et al. 2009) is 60. */
export const DEFAULT_RRF_K = 60;

/**
 * Reciprocal Rank Fusion. Each input list is a ranked list of fact strings
 * (best-first). An item's fused score is the sum over the lists it appears in of
 * `1 / (k + rank)`, where `rank` is its 0-based position in that list. Items are
 * returned de-duplicated and sorted by descending fused score.
 *
 * Scale-free (fuses on RANK not score), so the lexical ts_rank and the vector
 * cosine distance — which live on completely different scales — combine cleanly.
 *
 * Ties (equal fused score) preserve first-seen order, which is stable and means an
 * item that ranked highly in the first-passed list (we pass lexical first) wins a
 * tie deterministically.
 *
 * @param rankedLists ordered lists of fact strings (e.g. [lexicalFacts, vectorFacts])
 * @param k smoothing constant (default 60); larger k flattens the rank weighting
 */
export function fuseRRF(rankedLists: string[][], k: number = DEFAULT_RRF_K): string[] {
  const scores = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  let order = 0;

  for (const list of rankedLists) {
    list.forEach((item, rank) => {
      if (!item) return;
      if (!firstSeen.has(item)) firstSeen.set(item, order++);
      scores.set(item, (scores.get(item) ?? 0) + 1 / (k + rank));
    });
  }

  return [...scores.keys()].sort((a, b) => {
    const diff = (scores.get(b) ?? 0) - (scores.get(a) ?? 0);
    if (diff !== 0) return diff;
    return (firstSeen.get(a) ?? 0) - (firstSeen.get(b) ?? 0);
  });
}

/**
 * The intended hybrid retrieval query for `loadProfile` (documentation, not run
 * here — route.ts owns the `sql` client + OpenAI key). Two CTEs, BOTH prefiltered
 * by user_id (so the scan only ever covers one person's slice → sub-100ms):
 *
 *   1. LEXICAL — the existing 0023 path, unchanged:
 *        SELECT fact, ts_rank(fact_tsv, websearch_to_tsquery('english', $q)) AS rank
 *        FROM learned_facts
 *        WHERE user_id = $userId AND $q <> ''
 *          AND fact_tsv @@ websearch_to_tsquery('english', $q)
 *        ORDER BY rank DESC LIMIT 24
 *
 *   2. VECTOR — semantic, skips un-embedded rows so a partial backfill is safe:
 *        SELECT fact, embedding <=> $queryVec::vector AS distance
 *        FROM learned_facts
 *        WHERE user_id = $userId AND embedding IS NOT NULL
 *        ORDER BY embedding <=> $queryVec::vector LIMIT 24
 *      ($queryVec = embedText(incoming message) → toPgVectorLiteral(...) → '[...]')
 *
 * Fuse the two ordered fact-string lists with `fuseRRF([lexicalFacts, vectorFacts])`.
 * Then the route keeps its existing always-include layers: RECENT facts (newest N)
 * and IDENTITY facts (name/email/plan, assembled in the route, never embedded).
 * Recent ∪ hybrid is deduped by the route's existing case-insensitive pass.
 *
 * Graceful degradation: if `embedText` returns null (no OPENAI_MASTER_KEY / error),
 * skip the vector CTE entirely and fall back to lexical ∪ recent — exactly today's
 * behavior. Nothing breaks when embeddings are absent.
 */
export const HYBRID_QUERY_DOC =
  "lexical (fact_tsv @@ websearch_to_tsquery, ts_rank) ∪ vector (embedding <=> query::vector), " +
  "both prefiltered by user_id, fused with fuseRRF, plus always-include recent + identity (identity in route)";

/** Default per-side candidate cap before fusion — matches the route's existing LIMIT 24. */
export const RECALL_CANDIDATE_LIMIT = 24;
