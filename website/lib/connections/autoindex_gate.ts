/**
 * Auto-index rollout gate.
 *
 * Reading a real inbox into the world model stays OFF at scale until the brain's
 * Claude precision pass is validated broadly — a real financial email once slipped
 * the keyword floor. Until `ERI_AUTOINDEX_ENABLED=true`, ONLY allowlisted users
 * (`ERI_AUTOINDEX_ALLOWLIST`, comma-separated user ids or emails) get indexed;
 * every other caller's observations endpoint returns empty + `gated:true`. Flip
 * the flag once residual cleanup + broader validation land. Fail-closed: an empty
 * allowlist with the flag off blocks everyone.
 */

export interface GateConfig {
  enabled: boolean;
  allowlist: string[];
}

/**
 * Test users always allowed during the gated rollout, so shipping the gate never
 * breaks the active backfill even before the env allowlist is set. `bellkaizen`.
 * `ERI_AUTOINDEX_ALLOWLIST` ADDS more; `ERI_AUTOINDEX_ENABLED=true` opens to all.
 */
export const DEFAULT_ALLOWLIST: readonly string[] = ["usr_118616bec5b74da2a54c48161987357a"];

/** Pure gate decision — testable without process.env. */
export function autoIndexAllowedWith(
  userId: string,
  email: string | null | undefined,
  cfg: GateConfig,
): boolean {
  if (cfg.enabled) return true;
  const allow = cfg.allowlist.map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allow.length === 0) return false;
  if (allow.includes(userId.toLowerCase())) return true;
  return email != null && email.length > 0 && allow.includes(email.toLowerCase());
}

/** Env-backed gate: `ERI_AUTOINDEX_ENABLED` + `ERI_AUTOINDEX_ALLOWLIST`, merged
 *  with the built-in test-user default so the gate is safe to ship immediately. */
export function autoIndexAllowed(userId: string, email: string | null | undefined): boolean {
  return autoIndexAllowedWith(userId, email, {
    enabled: process.env.ERI_AUTOINDEX_ENABLED === "true",
    allowlist: [...DEFAULT_ALLOWLIST, ...(process.env.ERI_AUTOINDEX_ALLOWLIST ?? "").split(",")],
  });
}
