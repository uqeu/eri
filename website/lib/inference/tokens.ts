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
  tokens_in: number;
  tokens_out: number;
}

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
      return {
        tokens_in: asInt(usage.input_tokens),
        tokens_out: asInt(usage.output_tokens),
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
};

export function estimateCostMicros(
  model: string,
  usage: UsageCounts,
): number {
  const row = PRICE_TABLE[model];
  if (!row) return 0;
  const cost = usage.tokens_in * row.in + usage.tokens_out * row.out;
  return Math.round(cost);
}
