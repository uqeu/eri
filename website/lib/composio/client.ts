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

export interface ComposioClient {
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

/** Build the per-user Composio MCP URL. Pure — the computer injects the user id. */
export function composioMcpUrl(serverId: string, userId: string): string {
  return `https://backend.composio.dev/v3/mcp/${serverId}?user_id=${encodeURIComponent(userId)}`;
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
  async initiateConnection(userId: string, toolkit: string): Promise<ComposioConnection> {
    const authConfigId = requireEnv(`COMPOSIO_AUTH_CONFIG_${toolkit.toUpperCase()}`);
    // link() = Composio-managed OAuth (hosted redirect, multiple accounts) — the
    // non-deprecated replacement for initiate().
    const req = await composio().connectedAccounts.link(userId, authConfigId);
    if (!req.id || !req.redirectUrl) {
      throw new Error(`composio link returned no redirect for "${toolkit}"`);
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
