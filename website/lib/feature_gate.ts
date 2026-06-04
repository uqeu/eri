// Server-side feature enforcement. Until now `featuresForTier` was advisory
// (only surfaced by /api/v1/me); these helpers let routes HARD-block a tier
// from a feature it hasn't paid for. Each route formats its own 4xx response
// (some stream SSE, some return JSON), so this stays response-shape-agnostic.
//
// Feature -> enforcing route map:
//   agentMode   -> /api/v1/agent/run (non-free intents)
//   multiModel  -> /api/v1/inference/ship (tandem builder/checker)
// Base inference (/api/v1/inference/messages, used by the CLI build/chat) is
// intentionally NOT feature-gated -- it is token-gated, so paying Pro users are
// never locked out of the core CLI.

import { FEATURE_GATES, isFeatureAllowed, type Feature } from "./features";
import { normalizeTier, type TierName } from "./tiers";

/** Lowest tier that unlocks a feature (gate arrays are ascending), or null. */
export function requiredTierFor(feature: Feature): TierName | null {
  const tiers = FEATURE_GATES[feature];
  return tiers.length > 0 ? tiers[0] : null;
}

/** True when `tierSlug` is NOT entitled to `feature`. */
export function featureLocked(tierSlug: string, feature: Feature): boolean {
  return !isFeatureAllowed(normalizeTier(tierSlug), feature);
}

/** Standard JSON body for a 403 feature-locked response. */
export function featureLockedBody(feature: Feature): {
  error: "feature_locked";
  feature: Feature;
  requiredTier: TierName | null;
  message: string;
} {
  const required = requiredTierFor(feature);
  return {
    error: "feature_locked",
    feature,
    requiredTier: required,
    message: `Upgrade to ${required ?? "a higher plan"} to use this feature.`,
  };
}
