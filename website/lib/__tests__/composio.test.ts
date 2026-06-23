import { strict as assert } from "node:assert";
import { isValidToolkit } from "../composio/accounts";
import { composioMcpUrl, normalizeStatus } from "../composio/client";
import {
  handleConnect,
  handleDisconnect,
  listFreshConnections,
  type ConnectDeps,
  type DisconnectDeps,
  type RefreshDeps,
} from "../composio/connect";
import type { ComposioAccountRow } from "../composio/accounts";
import {
  authConfigEnvKey,
  hasAuthConfig,
  isConnectable,
  markConnectable,
  resolveAuthConfigId,
} from "../composio/auth_config";
import type { ToolkitInfo } from "../composio/client";

async function run() {
  // isValidToolkit: strict slug allowlist.
  {
    assert.ok(isValidToolkit("gmail"));
    assert.ok(isValidToolkit("google_calendar"));
    assert.ok(isValidToolkit("github-issues"));
    assert.ok(!isValidToolkit("Gmail"), "uppercase rejected");
    assert.ok(!isValidToolkit("rm -rf"), "spaces/symbols rejected");
    assert.ok(!isValidToolkit(""), "empty rejected");
    assert.ok(!isValidToolkit(123), "non-string rejected");
    assert.ok(!isValidToolkit("a".repeat(65)), "over-long rejected");
  }

  // normalizeStatus maps Composio's strings onto eri's three states.
  {
    assert.equal(normalizeStatus("ACTIVE"), "active");
    assert.equal(normalizeStatus("connected"), "active");
    assert.equal(normalizeStatus("INITIATED"), "pending");
    assert.equal(normalizeStatus("pending"), "pending");
    assert.equal(normalizeStatus("FAILED"), "error");
    assert.equal(normalizeStatus(undefined), "error");
  }

  // composioMcpUrl builds a per-user, url-encoded MCP endpoint.
  {
    const url = composioMcpUrl("srv_123", "user/abc");
    assert.equal(url, "https://backend.composio.dev/v3/mcp/srv_123/mcp?user_id=user%2Fabc");
  }

  // handleConnect — happy path records pending + returns the redirect.
  {
    const recorded: unknown[] = [];
    const deps: ConnectDeps = {
      initiate: async () => ({ connectedAccountId: "ca_1", redirectUrl: "https://composio/oauth" }),
      record: async (input) => {
        recorded.push(input);
      },
    };
    const out = await handleConnect("u1", "gmail", deps);
    assert.equal(out.branch, "ok");
    assert.equal(out.redirectUrl, "https://composio/oauth");
    assert.deepEqual(recorded[0], {
      userId: "u1",
      toolkit: "gmail",
      connectedAccountId: "ca_1",
      status: "pending",
    });
  }

  // Invalid toolkit short-circuits before any external call.
  {
    let initiated = false;
    const deps: ConnectDeps = {
      initiate: async () => {
        initiated = true;
        return { connectedAccountId: "x", redirectUrl: "y" };
      },
      record: async () => {},
    };
    const out = await handleConnect("u1", "NOPE space", deps);
    assert.equal(out.branch, "invalid_toolkit");
    assert.equal(initiated, false, "no Composio call for an invalid toolkit");
  }

  // A Composio failure becomes composio_error, never an unhandled throw.
  {
    const deps: ConnectDeps = {
      initiate: async () => {
        throw new Error("composio 500");
      },
      record: async () => {},
    };
    const out = await handleConnect("u1", "gmail", deps);
    assert.equal(out.branch, "composio_error");
    assert.equal(out.redirectUrl, undefined);
  }

  // listFreshConnections — refreshes pending accounts so they flip to active.
  {
    const rows: ComposioAccountRow[] = [
      { toolkit: "gmail", connectedAccountId: "ca_1", status: "pending" },
      { toolkit: "github", connectedAccountId: "ca_2", status: "active" },
      { toolkit: "slack", connectedAccountId: null, status: "pending" },
    ];
    const recorded: unknown[] = [];
    const deps: RefreshDeps = {
      list: async () => rows,
      status: async (id) => (id === "ca_1" ? "active" : "error"),
      record: async (input) => {
        recorded.push(input);
      },
    };
    const out = await listFreshConnections("u1", deps);
    // gmail refreshed pending→active and persisted; github untouched (not pending);
    // slack untouched (no connectedAccountId to query).
    assert.equal(out.find((c) => c.toolkit === "gmail")?.status, "active");
    assert.equal(out.find((c) => c.toolkit === "github")?.status, "active");
    assert.equal(out.find((c) => c.toolkit === "slack")?.status, "pending");
    assert.equal(recorded.length, 1, "only the changed gmail row is persisted");
    assert.deepEqual(recorded[0], {
      userId: "u1",
      toolkit: "gmail",
      connectedAccountId: "ca_1",
      status: "active",
    });
  }

  // A transient status-fetch failure leaves the row showing pending (not error).
  {
    const deps: RefreshDeps = {
      list: async () => [{ toolkit: "gmail", connectedAccountId: "ca_1", status: "pending" }],
      status: async () => {
        throw new Error("composio 503");
      },
      record: async () => {
        throw new Error("should not record on a fetch failure");
      },
    };
    const out = await listFreshConnections("u1", deps);
    assert.equal(out[0].status, "pending");
  }

  // auth_config: env-var key derivation (slug → COMPOSIO_AUTH_CONFIG_<SLUG>).
  {
    assert.equal(authConfigEnvKey("spotify"), "COMPOSIO_AUTH_CONFIG_SPOTIFY");
    assert.equal(authConfigEnvKey("google_calendar"), "COMPOSIO_AUTH_CONFIG_GOOGLE_CALENDAR");
    assert.equal(authConfigEnvKey("github-issues"), "COMPOSIO_AUTH_CONFIG_GITHUB_ISSUES");
  }

  // auth_config: resolveAuthConfigId reads the slug; blank/missing → null.
  {
    const env = { COMPOSIO_AUTH_CONFIG_SPOTIFY: "ac_QQW2tlbMsEdq", COMPOSIO_AUTH_CONFIG_X: "  " };
    assert.equal(resolveAuthConfigId("spotify", env), "ac_QQW2tlbMsEdq");
    assert.equal(resolveAuthConfigId("x", env), null, "whitespace-only → null");
    assert.equal(resolveAuthConfigId("notion", env), null, "missing → null");
    assert.equal(hasAuthConfig("spotify", env), true);
    assert.equal(hasAuthConfig("notion", env), false);
  }

  // auth_config: connectability honesty — managed/api_key/none always; custom_oauth
  // only with a registered config.
  {
    const env = { COMPOSIO_AUTH_CONFIG_SPOTIFY: "ac_1" };
    assert.equal(isConnectable("managed", "gmail", env), true);
    assert.equal(isConnectable("api_key", "openai", env), true);
    assert.equal(isConnectable("none", "hackernews", env), true);
    assert.equal(isConnectable("custom_oauth", "spotify", env), true, "configured custom → connectable");
    assert.equal(isConnectable("custom_oauth", "twitter", env), false, "unconfigured custom → not");
  }

  // auth_config: markConnectable stamps the catalog without mutating inputs.
  {
    const env = { COMPOSIO_AUTH_CONFIG_SPOTIFY: "ac_1" };
    const catalog: ToolkitInfo[] = [
      { slug: "gmail", name: "Gmail", authKind: "managed" },
      { slug: "spotify", name: "Spotify", authKind: "custom_oauth" },
      { slug: "twitter", name: "X", authKind: "custom_oauth" },
    ];
    const marked = markConnectable(catalog, env);
    assert.equal(marked.find((t) => t.slug === "gmail")?.connectable, true);
    assert.equal(marked.find((t) => t.slug === "spotify")?.connectable, true);
    assert.equal(marked.find((t) => t.slug === "twitter")?.connectable, false);
    assert.equal(catalog[0].connectable, undefined, "original catalog untouched");
  }

  // handleConnect threads an apiKey through to initiate (API-key toolkits).
  {
    let seenOpts: { apiKey?: string } | undefined;
    const deps: ConnectDeps = {
      initiate: async (_u, _tk, opts) => {
        seenOpts = opts;
        return { connectedAccountId: "ca_k", redirectUrl: "" };
      },
      record: async () => {},
    };
    const out = await handleConnect("u1", "openai", deps, { apiKey: "sk-test" });
    assert.equal(out.branch, "ok");
    assert.equal(out.redirectUrl, "", "API-key connect has no redirect");
    assert.equal(seenOpts?.apiKey, "sk-test", "apiKey forwarded to initiate");
  }

  // handleDisconnect — revokes at Composio then forgets the row.
  {
    const calls: string[] = [];
    const deps: DisconnectDeps = {
      find: async () => ({ toolkit: "gmail", connectedAccountId: "ca_1", status: "active" }),
      revoke: async (id) => {
        calls.push(`revoke:${id}`);
      },
      remove: async (_u, tk) => {
        calls.push(`remove:${tk}`);
      },
    };
    const out = await handleDisconnect("u1", "gmail", deps);
    assert.equal(out.branch, "ok");
    assert.deepEqual(calls, ["revoke:ca_1", "remove:gmail"], "revoke before remove");
  }

  // handleDisconnect — nothing connected → not_connected, no external call.
  {
    let revoked = false;
    const deps: DisconnectDeps = {
      find: async () => null,
      revoke: async () => {
        revoked = true;
      },
      remove: async () => {},
    };
    const out = await handleDisconnect("u1", "gmail", deps);
    assert.equal(out.branch, "not_connected");
    assert.equal(revoked, false);
  }

  // handleDisconnect — invalid toolkit short-circuits.
  {
    const deps: DisconnectDeps = {
      find: async () => {
        throw new Error("should not be called");
      },
      revoke: async () => {},
      remove: async () => {},
    };
    const out = await handleDisconnect("u1", "BAD slug", deps);
    assert.equal(out.branch, "invalid_toolkit");
  }

  // handleDisconnect — a revoke failure keeps the row (composio_error), so the
  // user can retry rather than the account silently lingering at Composio.
  {
    let removed = false;
    const deps: DisconnectDeps = {
      find: async () => ({ toolkit: "gmail", connectedAccountId: "ca_1", status: "active" }),
      revoke: async () => {
        throw new Error("composio 503");
      },
      remove: async () => {
        removed = true;
      },
    };
    const out = await handleDisconnect("u1", "gmail", deps);
    assert.equal(out.branch, "composio_error");
    assert.equal(removed, false, "row kept when revoke fails");
  }

  // handleDisconnect — a pending row with no account id just forgets the row.
  {
    const calls: string[] = [];
    const deps: DisconnectDeps = {
      find: async () => ({ toolkit: "slack", connectedAccountId: null, status: "pending" }),
      revoke: async () => {
        calls.push("revoke");
      },
      remove: async () => {
        calls.push("remove");
      },
    };
    const out = await handleDisconnect("u1", "slack", deps);
    assert.equal(out.branch, "ok");
    assert.deepEqual(calls, ["remove"], "no revoke without an account id");
  }

  // eslint-disable-next-line no-console
  console.log("composio.test.ts: all assertions passed");
}

run();
