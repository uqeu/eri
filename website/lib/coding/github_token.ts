/**
 * Pull the user's GitHub OAuth access token out of a Composio connected-account
 * response — Phase 3 (the coding-job token source).
 *
 * Composio nests the credential differently across auth schemes and SDK versions
 * (`data.access_token`, `val.access_token`, `state.val.access_token`,
 * `connectionParams.access_token`, …), so rather than hard-code one path we search
 * the response for the token, priority-ordered. Pure + unit-tested; the SDK call
 * that produces the response lives in `live.ts` and is verified against a real
 * connection at deploy.
 */

/** Credential keys to look for, highest priority first. */
const TOKEN_KEYS = ["access_token", "accessToken", "oauth_token", "token"] as const;

/**
 * Find a GitHub access token anywhere in a Composio account response. Returns the
 * highest-priority non-blank string token found, or null (→ the worker halts safe,
 * never injecting a bogus token).
 */
export function extractAccessToken(obj: unknown): string | null {
  const found: Partial<Record<(typeof TOKEN_KEYS)[number], string>> = {};
  const seen = new Set<unknown>();

  const walk = (v: unknown): void => {
    if (!v || typeof v !== "object" || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    for (const [key, val] of Object.entries(v as Record<string, unknown>)) {
      const k = (TOKEN_KEYS as readonly string[]).indexOf(key);
      if (k >= 0 && typeof val === "string" && val.trim() && !found[TOKEN_KEYS[k]]) {
        found[TOKEN_KEYS[k]] = val.trim();
      }
      if (val && typeof val === "object") walk(val);
    }
  };
  walk(obj);

  for (const key of TOKEN_KEYS) {
    const t = found[key];
    if (t) return t;
  }
  return null;
}
