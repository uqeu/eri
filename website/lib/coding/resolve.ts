/**
 * Single-principal repo resolution — Phase 3 (the phone-side mirror of the brain's
 * `resolve_repo`). Given the user's repo hint and the owner/name repos THEY have
 * connected, decide which to run in. Only the user's connected repos are ever
 * eligible — a cross-user repo is unreachable by construction. Pure + unit-tested.
 */

import type { RepoResolution } from "./contract";

/** Case-insensitive `owner/name` equality. */
function slugEq(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** The repo name (after the slash) for a bare-name match. */
function nameOf(slug: string): string {
  const i = slug.indexOf("/");
  return (i >= 0 ? slug.slice(i + 1) : slug).toLowerCase();
}

/**
 * Resolve `hint` against the user's `connected` repos (owner/name).
 *
 * - hint is `owner/name`  → resolved iff it's in the connected set, else needs_connect.
 * - hint is a bare name   → the connected repos whose name matches: exactly one →
 *   resolved; several → ambiguous; none → needs_connect.
 * - no hint               → one connected repo → resolved it; none → needs_connect;
 *   several → no_hint (the phone asks which).
 */
export function resolveRepoAgainst(hint: string | null, connected: readonly string[]): RepoResolution {
  const h = hint?.trim() || null;

  if (!h) {
    if (connected.length === 1) return { kind: "resolved", repo: connected[0] };
    if (connected.length === 0) return { kind: "needs_connect", hint: null };
    return { kind: "no_hint" };
  }

  if (h.includes("/")) {
    const match = connected.find((r) => slugEq(r, h));
    return match ? { kind: "resolved", repo: match } : { kind: "needs_connect", hint: h };
  }

  const matches = connected.filter((r) => nameOf(r) === h.toLowerCase());
  if (matches.length === 1) return { kind: "resolved", repo: matches[0] };
  if (matches.length === 0) return { kind: "needs_connect", hint: h };
  return { kind: "ambiguous", hint: h, candidates: matches };
}
