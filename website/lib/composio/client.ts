/**
 * Composio client seam (phone-eri connector layer, ADR-0002).
 *
 * Composio is the OAuth + token-vault layer eri uses so it can reach a user's
 * connected apps (Gmail, GitHub, Calendar, …) without eri ever holding their
 * tokens. The cloud's job is thin: ask Composio to start a connection (it returns
 * a hosted OAuth redirect the user opens) and expose the per-user MCP URL the
 * computer-resident eri streams tools from.
 *
 * Behind a `ComposioClient` seam: the orchestration is unit-tested with an
 * in-memory stub; the production adapter (`HttpComposioClient`) is a thin `fetch`
 * client against Composio's v3 REST API. Same shape as the memory-sync transport
 * seam — the external API is wired but verified live (it can't be unit-tested
 * without the vendor), so the testable logic stays green on its own.
 */

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

const COMPOSIO_BASE = "https://backend.composio.dev/api/v3";

interface ConnectedAccountResponse {
  id?: string;
  redirect_url?: string;
  redirectUrl?: string;
  status?: string;
}

/**
 * Production adapter — a thin `fetch` client over Composio v3. Reads
 * COMPOSIO_API_KEY (+ per-toolkit COMPOSIO_AUTH_CONFIG_<TOOLKIT> and
 * COMPOSIO_MCP_SERVER_ID) from the environment. Wired to the documented v3 shape;
 * verify live against the user's Composio account before production use.
 */
export class HttpComposioClient implements ComposioClient {
  async initiateConnection(userId: string, toolkit: string): Promise<ComposioConnection> {
    const apiKey = requireEnv("COMPOSIO_API_KEY");
    const authConfigId = requireEnv(`COMPOSIO_AUTH_CONFIG_${toolkit.toUpperCase()}`);
    const res = await fetch(`${COMPOSIO_BASE}/connected_accounts`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({ user_id: userId, auth_config_id: authConfigId }),
    });
    if (!res.ok) {
      throw new Error(`composio connect failed: ${res.status}`);
    }
    const body = (await res.json()) as ConnectedAccountResponse;
    const connectedAccountId = body.id;
    const redirectUrl = body.redirect_url ?? body.redirectUrl;
    if (!connectedAccountId || !redirectUrl) {
      throw new Error("composio connect returned no redirect");
    }
    return { connectedAccountId, redirectUrl };
  }

  async connectionStatus(connectedAccountId: string): Promise<"pending" | "active" | "error"> {
    const apiKey = requireEnv("COMPOSIO_API_KEY");
    const res = await fetch(
      `${COMPOSIO_BASE}/connected_accounts/${encodeURIComponent(connectedAccountId)}`,
      { headers: { "x-api-key": apiKey } },
    );
    if (!res.ok) return "error";
    const body = (await res.json()) as ConnectedAccountResponse;
    return normalizeStatus(body.status);
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
