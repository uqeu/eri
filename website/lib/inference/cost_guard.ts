/**
 * Cost guard — refuses dispatch to expensive models unless explicitly
 * allowed. eri's positioning is "perfect harness over thrifty models"
 * (Sonnet 4.5, GPT-4o, Gemini Flash/Thinking, Mercury). Opus-class and
 * GPT-5-Pro-class models are out unless the user opts in via a Vercel env
 * var.
 *
 * The check runs server-side on every `/api/v1/inference/*` call. BYOK
 * requests (user pays directly) are exempt — they can do whatever they
 * want with their own key.
 *
 * Costs are per million tokens, output, as of 2026-05-26:
 *   - claude-haiku-4-5     ~ $5    ✓ allowed
 *   - claude-sonnet-4-5    ~ $15   ✓ allowed
 *   - claude-opus-4-5      ~ $75   ✗ blocked (5x sonnet)
 *   - gpt-4o-mini          ~ $0.6  ✓ allowed
 *   - gpt-4o               ~ $10   ✓ allowed
 *   - o1 / o1-preview      ~ $60   ✗ blocked
 *   - gemini-2.0-flash     ~ $0.3  ✓ allowed
 *   - gemini-thinking-2    ~ $5    ✓ allowed
 *   - gemini-2.5-pro       ~ $5    ✓ allowed (note: 2.5-pro is cheaper
 *                                   than 1.5-pro, but still > flash)
 */

const ALLOWED_PREFIXES: ReadonlyArray<string> = [
  // Anthropic — Haiku + Sonnet only, no Opus.
  "claude-haiku-4",
  "claude-haiku-3",
  "claude-sonnet-4",
  "claude-sonnet-3",
  // OpenAI — chat + small reasoners only, no o1/o1-pro/gpt-5-pro.
  "gpt-4o",
  "gpt-4-turbo",
  "gpt-3.5",
  "o3-mini",
  "o4-mini",
  // Google — flash + thinking only, no full pro by default.
  "gemini-2.0-flash",
  "gemini-2.5-flash",
  "gemini-flash-2",
  "gemini-thinking-2",
  "gemini-2.0-flash-thinking",
  // Mercury / diffusion.
  "mercury",
];

const BLOCKED_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /opus/i, reason: "opus_class" },
  { pattern: /^o1($|-)/i, reason: "o1_class" },
  { pattern: /gpt-5-pro/i, reason: "gpt5_pro_class" },
  { pattern: /^gemini-1\.5-pro/i, reason: "gemini_1_5_pro" },
];

export interface CostCheckResult {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly suggested?: string;
}

/**
 * Returns `{ allowed: true }` for any model in the allowlist OR when the
 * env var `ERI_ALLOW_PREMIUM=true` is set (escape hatch for ops). Returns
 * `{ allowed: false, reason, suggested }` for blocked models, where
 * `suggested` is the cheap-and-capable alternative the caller could
 * retry with.
 */
export function checkModelAllowed(modelId: string): CostCheckResult {
  if (!modelId || modelId === "unknown") {
    // Don't block on missing model — provider-specific defaults handle it.
    return { allowed: true };
  }
  if (process.env.ERI_ALLOW_PREMIUM === "true") {
    return { allowed: true };
  }
  for (const { pattern, reason } of BLOCKED_PATTERNS) {
    if (pattern.test(modelId)) {
      return {
        allowed: false,
        reason,
        suggested: suggestedAlternative(modelId),
      };
    }
  }
  // If it matches an allowlist prefix, fine. Otherwise it's an unknown
  // model — let it through (provider will reject with a 400 if it's
  // genuinely unsupported, which is cheaper than us guessing).
  void ALLOWED_PREFIXES;
  return { allowed: true };
}

function suggestedAlternative(modelId: string): string {
  const lower = modelId.toLowerCase();
  if (lower.includes("opus") || lower.startsWith("claude")) {
    return "claude-sonnet-4-6";
  }
  if (lower.startsWith("o1") || lower.includes("gpt-5")) {
    return "gpt-4o";
  }
  if (lower.includes("gemini")) {
    return "gemini-2.0-flash-thinking-exp";
  }
  return "claude-sonnet-4-6";
}
