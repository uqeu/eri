import { strict as assert } from "node:assert";
import {
  embedText,
  isValidEmbedding,
  normalizeForEmbedding,
  toPgVectorLiteral,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  type EmbeddingDeps,
} from "../agent/embeddings";

const vec = (n: number): number[] => Array.from({ length: EMBEDDING_DIMENSIONS }, () => n);

function okResponse(embedding: unknown): Response {
  return {
    ok: true,
    json: async () => ({ data: [{ embedding }] }),
  } as unknown as Response;
}

async function main(): Promise<void> {
// isValidEmbedding: exactly 1536 finite numbers.
{
  assert.equal(isValidEmbedding(vec(0.1)), true);
  assert.equal(isValidEmbedding(vec(0.1).slice(0, 100)), false, "wrong length");
  assert.equal(isValidEmbedding("nope"), false);
  assert.equal(isValidEmbedding(null), false);
  const withNaN = vec(0.1);
  withNaN[0] = NaN;
  assert.equal(isValidEmbedding(withNaN), false, "NaN rejected");
}

// normalizeForEmbedding: collapse whitespace + trim.
{
  assert.equal(normalizeForEmbedding("  my   dog\n Bella "), "my dog Bella");
  assert.equal(normalizeForEmbedding("   "), "");
}

// toPgVectorLiteral: pgvector text literal.
{
  assert.equal(toPgVectorLiteral([1, 2, 3]), "[1,2,3]");
}

// embedText: returns the vector on a well-formed response, and sends the right
// model + input to the right URL with the bearer key.
{
  let capturedUrl = "";
  let capturedBody: unknown = null;
  let capturedAuth = "";
  const deps: EmbeddingDeps = {
    getKey: () => "sk-test",
    fetch: async (url, init) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(String(init.body));
      capturedAuth = (init.headers as Record<string, string>).authorization;
      return okResponse(vec(0.25));
    },
  };
  const out = await embedText("my dog", deps);
  assert.ok(out, "valid response → vector");
  assert.equal(out!.length, EMBEDDING_DIMENSIONS);
  assert.equal(capturedUrl, "https://api.voyageai.com/v1/embeddings");
  assert.deepEqual(capturedBody, { model: EMBEDDING_MODEL, input: ["my dog"] });
  assert.equal(capturedAuth, "Bearer sk-test");
}

// embedText: empty/whitespace input → null without calling fetch.
{
  let called = false;
  const deps: EmbeddingDeps = {
    getKey: () => "sk-test",
    fetch: async () => {
      called = true;
      return okResponse(vec(0.1));
    },
  };
  assert.equal(await embedText("   ", deps), null);
  assert.equal(called, false, "no fetch for empty input");
}

// embedText: missing key ("" from env) → null (degrade to lexical-only), no fetch.
{
  let called = false;
  const deps: EmbeddingDeps = {
    getKey: () => "",
    fetch: async () => {
      called = true;
      return okResponse(vec(0.1));
    },
  };
  assert.equal(await embedText("anything", deps), null);
  assert.equal(called, false, "no fetch without a key");
}

// embedText: non-OK HTTP → null.
{
  const deps: EmbeddingDeps = {
    getKey: () => "sk-test",
    fetch: async () => ({ ok: false, json: async () => ({}) }) as unknown as Response,
  };
  assert.equal(await embedText("anything", deps), null);
}

// embedText: fetch throws → null (never propagates).
{
  const deps: EmbeddingDeps = {
    getKey: () => "sk-test",
    fetch: async () => {
      throw new Error("network down");
    },
  };
  assert.equal(await embedText("anything", deps), null);
}

// embedText: malformed body / wrong dimensions → null.
{
  const wrongDim: EmbeddingDeps = {
    getKey: () => "sk-test",
    fetch: async () => okResponse([1, 2, 3]),
  };
  assert.equal(await embedText("anything", wrongDim), null);

  const noData: EmbeddingDeps = {
    getKey: () => "sk-test",
    fetch: async () => ({ ok: true, json: async () => ({}) }) as unknown as Response,
  };
  assert.equal(await embedText("anything", noData), null);
}
}

main().then(() => {
  // eslint-disable-next-line no-console
  console.log("embeddings.test.ts: all assertions passed");
});
