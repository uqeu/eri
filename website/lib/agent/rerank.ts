/**
 * Cross-encoder rerank for eri's memory recall (P5 — the single biggest retrieval-
 * quality lever in the corpus, Recall@5 ↔ answer-accuracy r≈0.98).
 *
 * Hybrid recall (lexical ∪ vector, RRF-fused) gives good CANDIDATES, but bi-encoder
 * similarity is coarse — it can't tell that "the deal closed at 40k" answers "how
 * much did Henderson pay" better than "the Henderson deal was stressful". A
 * cross-encoder reads (query, document) TOGETHER and scores true relevance. We use
 * Voyage's reranker (rerank-2.5-lite — the same provider as our embeddings; Claude
 * has no reranker either), so it needs no on-device model.
 *
 * Behind a `RerankDeps` seam (testable without network). GRACEFUL: never throws —
 * no VOYAGE_API_KEY, <2 docs, HTTP/parse error all return the documents in their
 * ORIGINAL order, so recall degrades to the RRF order, never breaks.
 */

export const RERANK_MODEL = "rerank-2.5-lite";
const RERANK_URL = "https://api.voyageai.com/v1/rerank";

/** The rerank IO, injected so callers are testable with stubs. */
export interface RerankDeps {
  /** Voyage API key, or "" when unset (→ keep original order). */
  getKey(): string;
  fetch(input: string, init: RequestInit): Promise<Response>;
}

function defaultDeps(): RerankDeps {
  return {
    getKey: () => process.env.VOYAGE_API_KEY ?? "",
    fetch: (input, init) => fetch(input, init),
  };
}

interface RerankResponse {
  data?: Array<{ index?: unknown; relevance_score?: unknown }>;
}

/**
 * Parse a Voyage rerank response into the document indices in reranked (best-
 * first) order, validated against `n`. Returns null on a malformed body or any
 * out-of-range / duplicate index (so the caller keeps the original order). Pure.
 */
export function parseRerankOrder(raw: unknown, n: number): number[] | null {
  if (typeof raw !== "object" || raw === null) return null;
  const data = (raw as RerankResponse).data;
  if (!Array.isArray(data) || data.length === 0) return null;
  const order: number[] = [];
  const seen = new Set<number>();
  for (const row of data) {
    if (typeof row !== "object" || row === null) return null;
    const idx = (row as { index?: unknown }).index;
    if (typeof idx !== "number" || !Number.isInteger(idx) || idx < 0 || idx >= n || seen.has(idx)) {
      return null;
    }
    seen.add(idx);
    order.push(idx);
  }
  return order;
}

/**
 * Rerank `documents` by true relevance to `query`, returning the top `topK`
 * (default: all) in best-first order. Never throws: no key / <2 docs / any error
 * returns the documents unchanged (capped to topK). Cost-bounded — one call over
 * the small candidate set.
 */
export async function rerank(
  query: string,
  documents: string[],
  opts: { topK?: number } = {},
  deps: RerankDeps = defaultDeps(),
): Promise<string[]> {
  const topK = opts.topK ?? documents.length;
  const q = query.trim();
  if (!q || documents.length < 2) return documents.slice(0, topK);
  const key = deps.getKey();
  if (!key) return documents.slice(0, topK);

  try {
    const resp = await deps.fetch(RERANK_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ query: q, documents, model: RERANK_MODEL, top_k: topK }),
    });
    if (!resp.ok) return documents.slice(0, topK);
    const order = parseRerankOrder(await resp.json(), documents.length);
    if (!order) return documents.slice(0, topK);
    return order.slice(0, topK).map((i) => documents[i]);
  } catch {
    return documents.slice(0, topK);
  }
}
