/**
 * Composio client seam (phone-eri connector layer, ADR-0002).
 *
 * Composio is the OAuth + token-vault layer eri uses so it can reach a user's
 * connected apps (Gmail, GitHub, Calendar, …) without eri ever holding their
 * tokens. The cloud's job is thin: ask Composio to start a connection (it returns
 * a hosted OAuth redirect the user opens) and expose the per-user MCP URL the
 * computer-resident eri streams tools from.
 *
 * Behind a `ComposioClient` seam: the orchestration (`handleConnect`,
 * `listFreshConnections`) is unit-tested with an in-memory stub; the production
 * adapter (`ComposioApiClient`) wraps the official `@composio/core` SDK. Using the
 * SDK (not hand-rolled REST) means we get the maintained, typed `link()` flow —
 * Composio deprecated the older `initiate()` path — and the SDK tracks endpoint
 * changes for us. The seam is what made this an implementation-only swap.
 */

import { Composio } from "@composio/core";

/** One initiated connection: the hosted URL to open, plus Composio's account id. */
export interface ComposioConnection {
  connectedAccountId: string;
  /** Hosted OAuth page the user opens to authorize the toolkit. */
  redirectUrl: string;
}

/** The relevant subset of a Composio catalog item from the REST toolkits list.
 *  Internal — mapped to `ToolkitInfo` before leaving the seam. */
interface RawToolkit {
  slug: string;
  name: string;
  no_auth?: boolean;
  auth_schemes?: string[];
  composio_managed_auth_schemes?: string[];
  meta?: {
    logo?: string;
    description?: string;
    categories?: Array<{ slug?: string; name: string }>;
  };
}

/** What it takes for a user to connect an app:
 *  - `managed`     — Composio's OAuth: one click, zero admin setup.
 *  - `api_key`     — the user pastes their own API key; no admin OAuth app.
 *  - `custom_oauth`— needs an OAuth app configured in the Composio dashboard.
 *  - `none`        — no auth required. */
export type AuthKind = "managed" | "api_key" | "custom_oauth" | "none";

/** One app in Composio's catalog (the dynamic connector list — ~1000 apps). The
 *  per-user connection status is NOT here; it's overlaid from our own DB. */
export interface ToolkitInfo {
  slug: string;
  name: string;
  logo?: string;
  description?: string;
  category?: string;
  authKind: AuthKind;
}

/** Classify a catalog item by what connecting it requires. */
function classifyAuth(t: RawToolkit): AuthKind {
  if (t.no_auth) return "none";
  if ((t.composio_managed_auth_schemes ?? []).length > 0) return "managed";
  const schemes = (t.auth_schemes ?? []).map((s) => s.toUpperCase());
  if (schemes.some((s) => s.includes("API_KEY") || s.includes("BEARER") || s.includes("TOKEN"))) {
    return "api_key";
  }
  return "custom_oauth";
}

export interface ComposioClient {
  /**
   * Composio's full toolkit catalog (~900 apps), so the connections UI is
   * dynamic — no hand-maintained app list. Auth-requiring apps only (no-auth
   * toolkits are filtered out: there's nothing for the user to connect).
   */
  listToolkits(): Promise<ToolkitInfo[]>;
  /**
   * Start linking `toolkit` for `userId`. Composio returns a hosted redirect the
   * user opens to authorize; on success the connected account becomes active.
   */
  initiateConnection(userId: string, toolkit: string): Promise<ComposioConnection>;
  /** Current status of a connected account, refreshed from Composio. */
  connectionStatus(connectedAccountId: string): Promise<"pending" | "active" | "error">;
  /** The per-user streamable-HTTP MCP URL the computer-resident eri reads tools from. */
  mcpUrl(userId: string): string;
}

/** Build the per-user Composio MCP URL. Pure — the computer injects the user id.
 *  The `/mcp` transport segment is the canonical endpoint (the bare path
 *  307-redirects to it). */
export function composioMcpUrl(serverId: string, userId: string): string {
  return `https://backend.composio.dev/v3/mcp/${serverId}/mcp?user_id=${encodeURIComponent(userId)}`;
}

/** Read a required Composio env var, failing fast with a clear message. */
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`${name} is not configured (Composio connector layer)`);
  }
  return v;
}

/** A Composio SDK instance keyed by the server API key. Constructed per call so a
 *  missing key fails at request time, never at module load / build. */
function composio(): Composio {
  return new Composio({ apiKey: requireEnv("COMPOSIO_API_KEY") });
}

/**
 * Production adapter over the official `@composio/core` SDK. Per-toolkit auth
 * configs are named COMPOSIO_AUTH_CONFIG_<TOOLKIT> (uppercased), e.g.
 * COMPOSIO_AUTH_CONFIG_GMAIL; the MCP server id is COMPOSIO_MCP_SERVER_ID.
 */
export class ComposioApiClient implements ComposioClient {
  async listToolkits(): Promise<ToolkitInfo[]> {
    // Read the catalog from Composio's REST list endpoint directly, paginating
    // to completion. WHY not the SDK's `toolkits.get({})`: it strips the
    // auth-scheme fields we need for the "what setup this takes" badge AND
    // returns only the first page. The SDK still owns connect/status, where it
    // adds value. Fail-soft: any page error stops with what we have.
    const key = requireEnv("COMPOSIO_API_KEY");
    const out: ToolkitInfo[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 25; page++) {
      const url = new URL("https://backend.composio.dev/api/v3/toolkits");
      url.searchParams.set("limit", "250");
      if (cursor) url.searchParams.set("cursor", cursor);
      const res = await fetch(url, { headers: { "x-api-key": key } });
      if (!res.ok) break;
      const body = (await res.json()) as { items?: RawToolkit[]; next_cursor?: string | null };
      for (const t of body.items ?? []) {
        if (!t.slug || !t.name) continue;
        out.push({
          slug: t.slug,
          name: t.name,
          logo: t.meta?.logo,
          description: t.meta?.description,
          category: t.meta?.categories?.[0]?.name,
          authKind: classifyAuth(t),
        });
      }
      cursor = body.next_cursor ?? null;
      if (!cursor) break;
    }
    return out;
  }

  async initiateConnection(userId: string, toolkit: string): Promise<ComposioConnection> {
    // On-demand + managed auth: `authorize` creates the auth config itself if one
    // doesn't exist and uses Composio's managed OAuth app — so NO per-app
    // COMPOSIO_AUTH_CONFIG_* env var is needed for the ~900 catalog apps. We still
    // honor a custom config when one IS set (custom scopes/branding for a few).
    const custom = process.env[`COMPOSIO_AUTH_CONFIG_${toolkit.toUpperCase()}`];
    const req = await composio().toolkits.authorize(userId, toolkit, custom || undefined);
    if (!req.id || !req.redirectUrl) {
      throw new Error(`composio authorize returned no redirect for "${toolkit}"`);
    }
    return { connectedAccountId: req.id, redirectUrl: req.redirectUrl };
  }

  async connectionStatus(connectedAccountId: string): Promise<"pending" | "active" | "error"> {
    const account = await composio().connectedAccounts.get(connectedAccountId);
    const status = normalizeStatus(account.status);
    // An unrecognized status (a future Composio enum value) maps to "error" —
    // surface it so it's diagnosable, not a silent broken account.
    if (status === "error" && account.status) {
      console.log(JSON.stringify({ event: "composio.unknown_status", status: account.status }));
    }
    return status;
  }

  mcpUrl(userId: string): string {
    return composioMcpUrl(requireEnv("COMPOSIO_MCP_SERVER_ID"), userId);
  }
}

/** Map Composio's status strings onto eri's three states. Pure + tested. */
export function normalizeStatus(raw: string | undefined): "pending" | "active" | "error" {
  switch ((raw ?? "").toUpperCase()) {
    case "ACTIVE":
    case "CONNECTED":
      return "active";
    case "INITIATED":
    case "PENDING":
    case "INITIALIZING":
      return "pending";
    default:
      return "error";
  }
}
