import { strict as assert } from "node:assert";
import { fuseRRF, DEFAULT_RRF_K, RECALL_CANDIDATE_LIMIT } from "../agent/memory_recall";

// Single list → returns items in the same order, deduped.
{
  const out = fuseRRF([["a", "b", "c"]]);
  assert.deepEqual(out, ["a", "b", "c"]);
}

// Dedup within and across lists (an item appearing twice isn't doubled in output).
{
  const out = fuseRRF([
    ["a", "a", "b"],
    ["b", "c"],
  ]);
  assert.equal(new Set(out).size, out.length, "no duplicates in output");
  assert.deepEqual([...out].sort(), ["a", "b", "c"]);
}

// An item ranked highly in BOTH lists beats items in only one.
{
  // "shared" is rank 0 in list2 and rank 2 in list1 → appears in both, high score.
  const lexical = ["x", "y", "shared"];
  const vector = ["shared", "z"];
  const out = fuseRRF([lexical, vector]);
  assert.equal(out[0], "shared", "item in both lists fuses to the top");
}

// RRF math: with k=60, an item at rank 0 in two lists scores 2/60; an item at
// rank 0 in one list scores 1/60. So the cross-list item ranks first.
{
  const out = fuseRRF([
    ["both", "onlyA"],
    ["both", "onlyB"],
  ]);
  assert.equal(out[0], "both");
  // onlyA (rank 1 list1 = 1/61) vs onlyB (rank 1 list2 = 1/61) tie → first-seen wins.
  assert.deepEqual(out, ["both", "onlyA", "onlyB"]);
}

// Tie-break is stable: equal scores preserve first-seen (lexical-first) order.
{
  const out = fuseRRF([
    ["first", "second"],
    [],
  ]);
  assert.deepEqual(out, ["first", "second"]);
}

// Empty input → empty output (no throw).
{
  assert.deepEqual(fuseRRF([]), []);
  assert.deepEqual(fuseRRF([[], []]), []);
}

// Empty strings are ignored (defensive — DB shouldn't emit them, but be safe).
{
  const out = fuseRRF([["", "real", ""]]);
  assert.deepEqual(out, ["real"]);
}

// Larger k flattens rank weighting: the gap between rank0 and rank1 shrinks, but
// ordering within a single list is unchanged.
{
  const list = ["a", "b", "c", "d"];
  assert.deepEqual(fuseRRF([list], 1), ["a", "b", "c", "d"]);
  assert.deepEqual(fuseRRF([list], 1000), ["a", "b", "c", "d"]);
}

// Three lists fuse (lexical ∪ vector ∪ recent-style); the item present in the
// most lists with best ranks rises to the top.
{
  const out = fuseRRF([
    ["bella", "work"],
    ["bella", "games"],
    ["bella", "chores"],
  ]);
  assert.equal(out[0], "bella");
}

// Sanity on exported constants.
{
  assert.equal(DEFAULT_RRF_K, 60);
  assert.equal(RECALL_CANDIDATE_LIMIT, 24);
}

// eslint-disable-next-line no-console
console.log("memory-recall.test.ts: all assertions passed");
