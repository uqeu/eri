/**
 * Kill-switch for the coding-job feature — Phase 3.
 *
 * Coding jobs spin a cloud sandbox, clone a repo with the user's token, and open
 * PRs — a new, higher-blast-radius surface. So unlike the proactive kill-switch
 * (default-on), this is FAIL-CLOSED: OFF unless explicitly enabled, and gateable
 * to an allowlist while we validate on real users. While off, `dispatchCodingJob`
 * stays in SHADOW mode (classify + log, decline → normal chat). Pure + tested.
 */

type Env = Record<string, string | undefined>;

function truthy(v: string | undefined): boolean {
  const s = (v ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "on" || s === "yes";
}

/**
 * Is the coding-job feature live for this user? Requires `ERI_CODEJOB_ENABLED`
 * truthy; if `ERI_CODEJOB_ALLOWLIST` (comma-separated user ids) is set, the user
 * must be on it (and unknown user → off). Default: off.
 */
export function codeJobEnabled(env: Env, userId?: string): boolean {
  if (!truthy(env.ERI_CODEJOB_ENABLED)) return false;
  const allow = (env.ERI_CODEJOB_ALLOWLIST ?? "").trim();
  if (!allow) return true;
  if (!userId) return false;
  const set = new Set(allow.split(",").map((s) => s.trim()).filter(Boolean));
  return set.has(userId);
}
