/**
 * Text embeddings for eri's semantic memory (hybrid recall over learned_facts).
 *
 * Uses Voyage AI `voyage-3.5-lite` (1024 dims) — Anthropic's recommended
 * embeddings provider (Claude has no embeddings API of its own). Behind an
 * `EmbeddingDeps` seam so it's testable without network. Key: `VOYAGE_API_KEY`.
 *
 * GRACEFUL DEGRADATION IS THE CONTRACT: `embedText` NEVER throws and returns
 * `null` whenever it can't produce a vector — no VOYAGE_API_KEY, a non-OK HTTP
 * response, a malformed body, a wrong-dimension vector. Callers store NULL and
 * retrieval falls back to lexical-only. Memory degrades, it never breaks.
 */

/** The model + dimensions are load-bearing: the DB column is `vector(1024)`. */
export const EMBEDDING_MODEL = "voyage-3.5-lite";
export const EMBEDDING_DIMENSIONS = 1024;
const EMBEDDINGS_URL = "https://api.voyageai.com/v1/embeddings";

/** The embedding IO, injected so callers are testable with stubs. */
export interface EmbeddingDeps {
  /** Resolve the Voyage API key, or "" when unset (→ degrade to lexical-only). */
  getKey(): string;
  /** Raw fetch of the embeddings endpoint. */
  fetch(input: string, init: RequestInit): Promise<Response>;
}

/** Production deps: the Voyage key from env + global fetch. */
function defaultDeps(): EmbeddingDeps {
  return {
    getKey: () => process.env.VOYAGE_API_KEY ?? "",
    fetch: (input, init) => fetch(input, init),
  };
}

/** Shape of the Voyage embeddings response we depend on. */
interface EmbeddingResponse {
  data?: Array<{ embedding?: unknown }>;
}

/**
 * Validate that an unknown value is a 1024-length array of finite numbers.
 * Pure — exported for testing the narrowing in isolation.
 */
export function isValidEmbedding(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === EMBEDDING_DIMENSIONS &&
    value.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

/** Collapse whitespace + trim so identical facts embed identically (cache-friendly). */
export function normalizeForEmbedding(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Embed `text` to a 1024-dim vector, or `null` if it can't (no key / empty input /
 * HTTP or parse error / wrong shape). Never throws.
 */
export async function embedText(
  text: string,
  deps: EmbeddingDeps = defaultDeps(),
): Promise<number[] | null> {
  const input = normalizeForEmbedding(text);
  if (!input) return null;

  const key = deps.getKey();
  if (!key) return null; // no VOYAGE_API_KEY → degrade to lexical-only

  try {
    const resp = await deps.fetch(EMBEDDINGS_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: [input] }),
    });
    if (!resp.ok) return null;
    const body = (await resp.json()) as EmbeddingResponse;
    const embedding = body.data?.[0]?.embedding;
    return isValidEmbedding(embedding) ? embedding : null;
  } catch {
    return null;
  }
}

/**
 * Format a vector as the pgvector text literal `'[a,b,c]'` for binding as a
 * parameter. pgvector accepts a string literal cast to `vector` — bind this with
 * a `::vector` cast in the query (see memory_recall.ts docs). Pure.
 */
export function toPgVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
