// Core types for the eri account module. The session "token" is a raw bearer
// that lives ONLY in OS Keychain (vscode.SecretStorage); the other fields are
// non-secret metadata cached in globalState for fast cold-start rendering.
//
// Tier slugs match the backend's `users.tier` column exactly — keep this list
// in sync with the website's `lib/stripe.ts::Tier` and `lib/tiers.ts::TierName`
// (the website uses the lowercase slug form for `users.tier`, the display
// names live in TIER_LABELS below).

export type EriTier =
  | "free"
  | "starter"
  | "pro"
  | "pro_plus"
  | "teams"
  | "enterprise";

export interface EriSession {
  /** Raw bearer token — only kept in Keychain, never persisted elsewhere, never logged. */
  readonly token: string;
  readonly userId: string;
  readonly email: string;
  readonly tier: EriTier;
  /** ISO 8601 timestamp captured locally when sign-in completed. */
  readonly signedInAt: string;
}

export interface UsageSummary {
  readonly tier: EriTier;
  readonly tokensUsed: number;
  readonly tokensIncluded: number;
  readonly tokensGhost: number;
  readonly remainingIncluded: number;
  readonly remainingGhost: number;
  readonly softCapWarning: boolean;
  /** ISO 8601 timestamp of period end. */
  readonly periodEnd: string;
}

export const TIER_LABELS: Readonly<Record<EriTier, string>> = {
  free: "Free",
  starter: "Individual I",
  pro: "Individual II",
  pro_plus: "Individual III",
  teams: "Teams",
  enterprise: "Enterprise",
};

export function isEriTier(value: unknown): value is EriTier {
  return (
    value === "free" ||
    value === "starter" ||
    value === "pro" ||
    value === "pro_plus" ||
    value === "teams" ||
    value === "enterprise"
  );
}
