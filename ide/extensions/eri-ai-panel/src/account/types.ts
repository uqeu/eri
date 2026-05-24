// Core types for the eri account module. The session "token" is a raw bearer
// that lives ONLY in OS Keychain (vscode.SecretStorage); the other fields are
// non-secret metadata cached in globalState for fast cold-start rendering.

export type EriTier = "free" | "pro" | "proPlus" | "team" | "enterprise";

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
  pro: "Pro",
  proPlus: "Pro+",
  team: "Team",
  enterprise: "Enterprise",
};

export function isEriTier(value: unknown): value is EriTier {
  return (
    value === "free" ||
    value === "pro" ||
    value === "proPlus" ||
    value === "team" ||
    value === "enterprise"
  );
}
