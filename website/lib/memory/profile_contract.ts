/**
 * Wire contract for the Tier-A profile route (`/api/v1/memory/profile`).
 *
 * The client (computer eri) sends its distilled profile as plaintext JSON — the
 * server is the one that encrypts it at rest with K_server. Pulled out as a pure
 * validator so the PUT contract is unit-tested without a live request: a
 * server-readable projection must be well-formed and bounded before we store it.
 */

/** Static profile cap — the projection targets <=32KB; 64KB is the hard ceiling. */
export const MAX_PROFILE_BYTES = 64 * 1024;
/** The live "today" slice is a glance, not a log. */
export const MAX_DYNAMIC_BYTES = 8 * 1024;

export type ProfileUpload =
  | { ok: true; profileJson: string; dynamicContext: string }
  | { ok: false; error: string };

function byteLength(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

/**
 * Validate + normalize a PUT body `{ profile: object, dynamic_context: string }`.
 * `profile` is re-serialized canonically (so we store exactly what we validated),
 * `dynamic_context` defaults to "" when absent. Rejects wrong types and oversize
 * payloads with a stable `error` code the route maps to a 400.
 */
export function parseProfileUpload(body: unknown): ProfileUpload {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "missing_body" };
  }
  const { profile, dynamic_context } = body as {
    profile?: unknown;
    dynamic_context?: unknown;
  };

  // `profile` must be a JSON object (the distilled Profile: facts, preferences…).
  if (typeof profile !== "object" || profile === null || Array.isArray(profile)) {
    return { ok: false, error: "invalid_profile" };
  }

  const dynamicContext =
    dynamic_context === undefined || dynamic_context === null ? "" : dynamic_context;
  if (typeof dynamicContext !== "string") {
    return { ok: false, error: "invalid_dynamic_context" };
  }

  const profileJson = JSON.stringify(profile);
  if (byteLength(profileJson) > MAX_PROFILE_BYTES) {
    return { ok: false, error: "profile_too_large" };
  }
  if (byteLength(dynamicContext) > MAX_DYNAMIC_BYTES) {
    return { ok: false, error: "dynamic_context_too_large" };
  }

  return { ok: true, profileJson, dynamicContext };
}
