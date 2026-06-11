import type { TierName } from "./tiers";

/**
 * Source of truth: `app/pricing/pricing-content.tsx` per-tier feature lists
 * + the side-by-side comparison table. When a row in the comparison table
 * has a checkmark in a column, that tier unlocks the feature.
 *
 * Tiers are listed in ascending order; higher tiers always include lower
 * tier features unless explicitly noted (e.g. `privateContext` is gated to
 * Pro+ and above, but Teams + Enterprise inherit it).
 *
 * Enterprise is treated as Teams plus extras for now since `normalizeTier`
 * does not yet emit an "Enterprise" variant — we keep the type narrow.
 */
export type Feature =
  | "voice"
  | "diffusionPreview"
  | "iterationHistory"
  | "gaze"
  | "inlineEdit"
  | "composer"
  | "agentMode"
  | "mentions"
  | "codebaseIndex"
  | "mcp"
  | "multiModel"
  | "cloudAgents"
  | "exclusiveVoices"
  | "codebaseTrainedBrain"
  | "privateContext"
  | "polishQueue"
  | "sso"
  | "auditLogs"
  | "scim";

const ALL_TIERS: ReadonlyArray<TierName> = ["Free", "Starter", "Pro", "Pro+"];

/**
 * Map of feature → tiers that unlock it. Derived from the pricing page:
 *
 * - `voice`, `diffusionPreview`, `iterationHistory`, `gaze`, `mentions` are
 *   table-stakes — every tier including Free gets them ("Code stays on your
 *   machine", "Voice commands (always-listening)", "Eye tracking", "Cmd-K
 *   palette" rows show ✓ across every column).
 * - `inlineEdit` (Cmd-K inline edits) is gated to Starter+ per
 *   "Inline Cmd-K edit turns" comparison row.
 * - `composer` (multi-file Composer) — Free can author composer plans with
 *   BYOK but the multi-file apply-all action is a paid feature; we gate at
 *   Starter+ to keep parity with inline edits.
 * - `agentMode` and `cloudAgents` — "Cloud agents that work while you idle"
 *   is Pro+ per the Individual II bullet.
 * - `mcp` — "Custom MCP servers" is Pro+ per the Individual II bullet.
 * - `codebaseIndex` — basic indexing is available on every tier (mentions
 *   include pick-codebase), but at Pro+ it becomes a private brain.
 * - `multiModel` — "Multi-model routing" comparison row shows Pro+.
 * - `exclusiveVoices`, `codebaseTrainedBrain`, `privateContext`,
 *   `polishQueue` — all Pro+ ("Individual III") and above.
 * - `sso`, `auditLogs` — Teams+ per the comparison table.
 * - `scim` — Enterprise only; we leave it gated out of every tier here
 *   because the DB never sets tier="enterprise" (normalizeTier falls back
 *   to Free) — SCIM gating is enforced server-side in admin routes.
 */
export const FEATURE_GATES: Record<Feature, ReadonlyArray<TierName>> = {
  voice: ALL_TIERS,
  diffusionPreview: ALL_TIERS,
  iterationHistory: ALL_TIERS,
  gaze: ALL_TIERS,
  mentions: ALL_TIERS,
  codebaseIndex: ALL_TIERS,
  inlineEdit: ["Starter", "Pro", "Pro+"],
  composer: ["Starter", "Pro", "Pro+"],
  multiModel: ["Pro", "Pro+"],
  cloudAgents: ["Pro", "Pro+"],
  agentMode: ["Pro", "Pro+"],
  mcp: ["Pro", "Pro+"],
  exclusiveVoices: ["Pro+"],
  codebaseTrainedBrain: ["Pro+"],
  privateContext: ["Pro+"],
  polishQueue: ["Pro+"],
  // Teams retired — these unlock on no current tier (kept for when seats return).
  sso: [],
  auditLogs: [],
  scim: [],
};

const ALL_FEATURES: ReadonlyArray<Feature> = Object.keys(FEATURE_GATES) as Feature[];

export function isFeatureAllowed(tier: TierName, feature: Feature): boolean {
  const allowed = FEATURE_GATES[feature];
  return allowed.includes(tier);
}

export function featuresForTier(tier: TierName): ReadonlySet<Feature> {
  const set = new Set<Feature>();
  for (const feature of ALL_FEATURES) {
    if (isFeatureAllowed(tier, feature)) {
      set.add(feature);
    }
  }
  return set;
}
