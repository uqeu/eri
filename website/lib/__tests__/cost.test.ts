import { strict as assert } from "node:assert";
import {
  estimateCostMicros,
  extractUsage,
  type UsageCounts,
} from "../inference/tokens";

// COGS pricing must charge the three input-token kinds at DIFFERENT rates.
// Sonnet input is $3/M (3 micro-USD/token), output $15/M (15/token).
// cache reads ~0.1x input, cache creation ~1.25x input.

// Plain input + output, no cache: in*3 + out*15.
assert.equal(
  estimateCostMicros("claude-sonnet-4-5", { tokens_in: 1000, tokens_out: 100 }),
  1000 * 3 + 100 * 15,
);

// Cache read priced at 0.1x: 1000 cached reads cost like 100 fresh input.
assert.equal(
  estimateCostMicros("claude-sonnet-4-5", {
    tokens_in: 0,
    tokens_out: 0,
    cache_read_input_tokens: 1000,
  }),
  Math.round(1000 * 3 * 0.1), // 300
);

// Cache creation priced at 1.25x.
assert.equal(
  estimateCostMicros("claude-sonnet-4-5", {
    tokens_in: 0,
    tokens_out: 0,
    cache_creation_input_tokens: 1000,
  }),
  Math.round(1000 * 3 * 1.25), // 3750
);

// The realistic conversation-cached turn: a little fresh input, a big cache
// read, a moderate cache-creation write, plus output.
const turn: UsageCounts = {
  tokens_in: 500, // fresh
  tokens_out: 800,
  cache_read_input_tokens: 40_000, // re-read context (cheap)
  cache_creation_input_tokens: 2_000, // newly cached (pricey)
};
const expected =
  500 * 3 + 40_000 * 3 * 0.1 + 2_000 * 3 * 1.25 + 800 * 15;
assert.equal(estimateCostMicros("claude-sonnet-4-5", turn), Math.round(expected));

// REGRESSION: the old code priced every input token at 1x and ignored cache.
// That blended number badly under-counts a cache-heavy turn. Prove the new
// number is strictly larger than the naive (tokens_in-only) estimate would be,
// because cache reads + creation now contribute real cost.
const naive = 500 * 3 + 800 * 15;
assert.ok(
  estimateCostMicros("claude-sonnet-4-5", turn) > naive,
  "cache tokens must add to COGS, not be free",
);

// Family fallback still prices (e.g. dated point-release suffix).
assert.equal(
  estimateCostMicros("claude-sonnet-4-6-20260601", { tokens_in: 1000, tokens_out: 0 }),
  3000,
);

// DeepSeek pre-wire rows price (off by default at the route layer, but the
// table must be ready). V4-Flash input $0.14/M.
assert.equal(
  estimateCostMicros("deepseek-v4-flash", { tokens_in: 1_000_000, tokens_out: 0 }),
  140_000,
);

// extractUsage pulls the cache fields out of an Anthropic message_start shape.
const parsed = extractUsage("anthropic", {
  usage: {
    input_tokens: 500,
    output_tokens: 1,
    cache_read_input_tokens: 40_000,
    cache_creation_input_tokens: 2_000,
  },
});
assert.equal(parsed.tokens_in, 500);
assert.equal(parsed.cache_read_input_tokens, 40_000);
assert.equal(parsed.cache_creation_input_tokens, 2_000);

// SECURITY: an unknown model must NOT be free — it falls back to the most
// expensive (Opus-class) rate so a novel model id can't be used for free
// inference. Was previously 0; that was a usage-theft hole.
assert.ok(
  estimateCostMicros("totally-unknown", { tokens_in: 1000, tokens_out: 0 }) === 15_000,
  "unknown model must price at the high fallback, not zero",
);

// eslint-disable-next-line no-console
console.log("cost.test.ts: all assertions passed");
