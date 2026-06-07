/**
 * Lightweight token estimation + extraction.
 *
 * We need two things from this module:
 *   1. A cheap pre-flight estimate so `ensureWithinQuota` can decide
 *      whether to short-circuit with 402 before we touch upstream.
 *   2. An after-the-fact extractor that pulls real usage counts out of
 *      each provider's response shape so `recordUsage` is exact.
 *
 * The estimator is intentionally rough — ~4 chars per token is a fine
 * approximation for English-language code/chat payloads and we only use
 * it to gate the hard cap, never for billing.
 */

import type { ProviderId } from "./providers";

const APPROX_CHARS_PER_TOKEN = 4;

export function estimateTokens(jsonBody: unknown): number {
  if (typeof jsonBody !== "object" || jsonBody === null) return 0;
  try {
    const serialized = JSON.stringify(jsonBody);
    return Math.ceil(serialized.length / APPROX_CHARS_PER_TOKEN);
  } catch {
    return 0;
  }
}

export interface UsageCounts {
  /** Uncached input tokens, billed at the full input rate. */
  tokens_in: number;
  tokens_out: number;
  /**
   * Input tokens served from the prompt cache. Anthropic bills these at ~0.1x
   * the input rate, so they MUST be priced separately for COGS to be accurate.
   * Optional + zero-defaulted so older call sites keep working.
   */
  cache_read_input_tokens?: number;
  /**
   * Input tokens written to the prompt cache (the cache breakpoint prefix).
   * Anthropic bills these at ~1.25x the input rate.
   */
  cache_creation_input_tokens?: number;
}

/** Cost multipliers vs the base input rate for cached tokens (Anthropic). */
const CACHE_READ_MULT = 0.1;
const CACHE_CREATION_MULT = 1.25;

function asInt(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  return 0;
}

/**
 * Pull `{ tokens_in, tokens_out }` out of an already-parsed upstream JSON
 * response. Each provider names the fields differently; we accept all
 * known shapes and zero-fill the rest.
 */
export function extractUsage(
  provider: ProviderId,
  body: unknown,
): UsageCounts {
  if (typeof body !== "object" || body === null) {
    return { tokens_in: 0, tokens_out: 0 };
  }
  const obj = body as Record<string, unknown>;
  const usage =
    (obj.usage as Record<string, unknown> | undefined) ??
    (obj.usageMetadata as Record<string, unknown> | undefined);

  if (!usage) return { tokens_in: 0, tokens_out: 0 };

  switch (provider) {
    case "anthropic":
      // Anthropic reports `input_tokens` EXCLUDING cache; cache reads/writes
      // are separate fields. So tokens_in stays the uncached count (no double
      // count) and the cache kinds ride alongside for accurate COGS pricing.
      return {
        tokens_in: asInt(usage.input_tokens),
        tokens_out: asInt(usage.output_tokens),
        cache_read_input_tokens: asInt(usage.cache_read_input_tokens),
        cache_creation_input_tokens: asInt(usage.cache_creation_input_tokens),
      };
    case "openai":
    case "inception":
      return {
        tokens_in: asInt(usage.prompt_tokens),
        tokens_out: asInt(usage.completion_tokens),
      };
    case "google":
      return {
        tokens_in: asInt(usage.promptTokenCount),
        tokens_out: asInt(usage.candidatesTokenCount),
      };
    default:
      return { tokens_in: 0, tokens_out: 0 };
  }
}

/**
 * Rough cost estimate in micro-USD. The marketing site already has a
 * detailed pricing model in `scripts/pricing_model.py` and we don't want
 * to duplicate that — this is just a sane default so the `cost_usd_micros`
 * column always has a value. Per-model overrides live in PRICE_TABLE.
 */
const PRICE_TABLE: Record<string, { in: number; out: number }> = {
  // micro-USD per token
  "claude-sonnet-4-5":        { in: 3,    out: 15 },
  "claude-opus-4-5":          { in: 15,   out: 75 },
  "claude-haiku-4-5":         { in: 1,    out: 5  },
  "gpt-4o":                   { in: 2.5,  out: 10 },
  "gpt-4o-mini":              { in: 0.15, out: 0.6 },
  "o1":                       { in: 15,   out: 60 },
  "gemini-2.5-pro":           { in: 1.25, out: 5  },
  "gemini-2.5-flash":         { in: 0.075,out: 0.3 },
  "mercury-coder":            { in: 0,    out: 0  }, // free-tier per project memory
  // DeepSeek (pre-wired, off by default — see route gating). Speaks the
  // Anthropic Messages format, so its usage flows through the anthropic case
  // above and prices via these rows once the route flag is flipped on.
  "deepseek-v4-flash":        { in: 0.14, out: 0.28 },
  "deepseek-v4-pro":          { in: 0.435,out: 0.87 },
};

/**
 * Resolve a wire model id to its price row. Exact match first, then a family
 * fallback by prefix so future date/point-release suffixes still price (e.g.
 * `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`). Without this, the live
 * models miss the table and cost is recorded as $0.
 */
function priceForModel(model: string): { in: number; out: number } | null {
  const exact = PRICE_TABLE[model];
  if (exact) return exact;
  const m = model.toLowerCase();
  if (m.startsWith("claude-opus")) return { in: 15, out: 75 };
  if (m.startsWith("claude-sonnet")) return { in: 3, out: 15 };
  if (m.startsWith("claude-haiku")) return { in: 1, out: 5 };
  if (m.startsWith("gpt-4o-mini")) return { in: 0.15, out: 0.6 };
  if (m.startsWith("gpt-4o") || m.startsWith("gpt-4-turbo")) return { in: 2.5, out: 10 };
  if (m.startsWith("o1")) return { in: 15, out: 60 };
  if (m.startsWith("gemini-2.5-pro") || m.startsWith("gemini-2.0-pro"))
    return { in: 1.25, out: 5 };
  if (m.startsWith("gemini-2")) return { in: 0.075, out: 0.3 };
  if (m.startsWith("mercury")) return { in: 0, out: 0 };
  if (m.startsWith("deepseek-v4-pro") || m.startsWith("deepseek-reasoner"))
    return { in: 0.435, out: 0.87 };
  if (m.startsWith("deepseek")) return { in: 0.14, out: 0.28 };
  return null;
}

/**
 * Cost in micro-USD. Critically, the three input-token kinds are priced at
 * DIFFERENT rates — pricing them all at the base input rate (the old behavior)
 * badly under-counts COGS once conversation caching kicks in, because most
 * input then arrives as cheap cache reads while a smaller slice is the pricey
 * cache-creation write. Output is unchanged.
 *
 *   uncached_in × in
 *   + cache_read     × in × 0.10
 *   + cache_creation × in × 1.25
 *   + out            × out
 */
export function estimateCostMicros(model: string, usage: UsageCounts): number {
  const row = priceForModel(model);
  if (!row) return 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheCreation = usage.cache_creation_input_tokens ?? 0;
  const cost =
    usage.tokens_in * row.in +
    cacheRead * row.in * CACHE_READ_MULT +
    cacheCreation * row.in * CACHE_CREATION_MULT +
    usage.tokens_out * row.out;
  return Math.round(cost);
}
