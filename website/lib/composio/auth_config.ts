/**
 * Auth-config resolution for Composio connections (phone-eri connector layer).
 *
 * Composio links a toolkit through an *auth config*. There are three shapes, and
 * which one a toolkit needs decides whether a user can connect it today:
 *
 *  - **managed OAuth** — Composio's shared OAuth app. `toolkits.authorize` mints
 *    the auth config on the fly, so we pass NO id and it just works. (gmail,
 *    googlecalendar, github, slack, notion, … — the core apps.)
 *  - **custom OAuth**  — our OWN OAuth app, registered once in the Composio
 *    dashboard and identified by an auth-config slug like `ac_QQW2tlbMsEdq`.
 *    A toolkit only becomes connectable once we've registered that slug.
 *  - **API key**       — the user pastes their own key; it still has to attach to
 *    an API_KEY auth config, so the same slug lookup applies.
 *
 * The slug lives in env — one var per toolkit — never in the repo. Only the var
 * NAMES are committed; the `ac_...` values are set in Vercel / .env.local. A
 * missing var means "no custom config" → managed fallback.
 *
 * Env-var convention: `COMPOSIO_AUTH_CONFIG_<SLUG>`, where `<SLUG>` is the
 * toolkit slug uppercased with every non-alphanumeric replaced by `_`:
 *   spotify          → COMPOSIO_AUTH_CONFIG_SPOTIFY
 *   google_calendar  → COMPOSIO_AUTH_CONFIG_GOOGLE_CALENDAR
 *   github-issues    → COMPOSIO_AUTH_CONFIG_GITHUB_ISSUES
 *
 * Everything here is pure (env injected) so it's unit-tested without process
 * state and reused identically by the connect route and the catalog route.
 */

import type { AuthKind, ToolkitInfo } from "@/lib/composio/client";

type Env = Record<string, string | undefined>;

/** The env-var name that would hold `toolkit`'s auth-config slug. */
export function authConfigEnvKey(toolkit: string): string {
  return `COMPOSIO_AUTH_CONFIG_${toolkit.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
}

/** The registered auth-config slug for `toolkit`, or null when none is set
 *  (→ caller falls back to Composio's managed OAuth). */
export function resolveAuthConfigId(toolkit: string, env: Env = process.env): string | null {
  const v = env[authConfigEnvKey(toolkit)];
  return v && v.trim() ? v.trim() : null;
}

/** Whether we've registered a custom auth config for `toolkit`. */
export function hasAuthConfig(toolkit: string, env: Env = process.env): boolean {
  return resolveAuthConfigId(toolkit, env) !== null;
}

/**
 * Can a user actually connect this app right now?
 *  - managed / none      → yes, Composio's shared app handles it.
 *  - api_key             → yes, the user supplies their own key.
 *  - custom_oauth        → ONLY if we've registered its auth config; otherwise
 *    connecting would 502 against Composio, so we surface "needs setup" instead.
 * Pure so the honesty rule (#4) is testable and identical server- and client-side.
 */
export function isConnectable(authKind: AuthKind, toolkit: string, env: Env = process.env): boolean {
  if (authKind === "custom_oauth") return hasAuthConfig(toolkit, env);
  return true;
}

/** Stamp each catalog entry with whether it's connectable today, so the UI only
 *  offers Connect where it works. */
export function markConnectable(
  toolkits: ReadonlyArray<ToolkitInfo>,
  env: Env = process.env,
): ToolkitInfo[] {
  return toolkits.map((t) => ({ ...t, connectable: isConnectable(t.authKind, t.slug, env) }));
}
