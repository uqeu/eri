import { strict as assert } from "node:assert";
import { parseRerankOrder, rerank, RERANK_MODEL } from "../agent/rerank";

// parseRerankOrder: valid order; rejects malformed / out-of-range / dup.
{
  assert.deepEqual(parseRerankOrder({ data: [{ index: 2 }, { index: 0 }, { index: 1 }] }, 3), [2, 0, 1]);
  assert.equal(parseRerankOrder({ data: [] }, 3), null);
  assert.equal(parseRerankOrder({ data: [{ index: 5 }] }, 3), null, "out of range");
  assert.equal(parseRerankOrder({ data: [{ index: 0 }, { index: 0 }] }, 3), null, "duplicate");
  assert.equal(parseRerankOrder({ nope: 1 }, 3), null);
  assert.equal(parseRerankOrder("garbage", 3), null);
}

async function run() {
  const docs = ["the deal was stressful", "the deal closed at 40k", "lunch was good"];

  // Reorders by the reranker's returned indices, capped to topK.
  const reordered = await rerank("how much did the deal close for", docs, { topK: 2 }, {
    getKey: () => "k",
    fetch: async () => ({ ok: true, json: async () => ({ data: [{ index: 1 }, { index: 0 }, { index: 2 }] }) }) as unknown as Response,
  });
  assert.deepEqual(reordered, ["the deal closed at 40k", "the deal was stressful"]);

  // No key → original order (graceful), capped to topK.
  const nokey = await rerank("q", docs, { topK: 2 }, { getKey: () => "", fetch: async () => { throw new Error("no"); } });
  assert.deepEqual(nokey, docs.slice(0, 2));

  // HTTP error → original order.
  const errd = await rerank("q", docs, {}, { getKey: () => "k", fetch: async () => ({ ok: false, json: async () => ({}) }) as unknown as Response });
  assert.deepEqual(errd, docs);

  // <2 docs → returned as-is, no call.
  let called = false;
  const one = await rerank("q", ["only"], {}, { getKey: () => "k", fetch: async () => { called = true; return {} as Response; } });
  assert.deepEqual(one, ["only"]);
  assert.equal(called, false);

  assert.equal(RERANK_MODEL, "rerank-2.5-lite");

  // eslint-disable-next-line no-console
  console.log("rerank.test.ts: all assertions passed");
}

run();
