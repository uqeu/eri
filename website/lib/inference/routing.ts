/**
 * Server-side model routing. Today this is an (almost) no-op: every request
 * forwards to the provider the route declared. The one exception is the
 * DeepSeek "fast tier" pre-wire — DISABLED by default.
 *
 * Why it exists now but stays off: the Claude credits funding eri are free and
 * expire ~November, so until then everything routes to Claude (use-it-or-lose
 * -it). After they expire, Claude input/output is real money and DeepSeek
 * (~10-30x cheaper, and Anthropic-format so a drop-in) becomes the cheap path
 * for the agentic "fast" tier. Flipping ERI_DEEPSEEK_FAST=true is the whole
 * activation — no code change. It is NOT a local model: DeepSeek is cloud +
 * metered, so the user still pays eri and revenue is preserved.
 */

import type { ProviderId } from "./providers";

export interface ResolvedRoute {
  provider: ProviderId;
  /** The model id to send upstream (may differ from what the IDE requested). */
  model: string;
  /** True when the route was remapped away from what the caller asked for. */
  rerouted: boolean;
}

/** DeepSeek's cheap, fast model exposed on its Anthropic-format endpoint. */
const DEEPSEEK_FAST_MODEL = "deepseek-v4-flash";

function deepseekFastEnabled(): boolean {
  return process.env.ERI_DEEPSEEK_FAST === "true";
}

/**
 * Does the requested model name denote the cheap "fast" tier? eri's fast tier
 * maps to Haiku today; we also accept an explicit "fast" alias so callers can
 * opt in without knowing the underlying model.
 */
function isFastTierModel(model: string): boolean {
  const m = model.toLowerCase();
  return m.includes("haiku") || m === "fast" || m.endsWith("-fast");
}

/**
 * Resolve the effective `{ provider, model }` for a request. Pure + dependent
 * only on env, so it is trivially testable. Defaults to a passthrough.
 */
export function resolveModelRoute(
  provider: ProviderId,
  model: string,
): ResolvedRoute {
  if (
    provider === "anthropic" &&
    deepseekFastEnabled() &&
    isFastTierModel(model)
  ) {
    return { provider: "deepseek", model: DEEPSEEK_FAST_MODEL, rerouted: true };
  }
  return { provider, model, rerouted: false };
}
