/**
 * Connect orchestrator (phone-eri connector layer).
 *
 * Decides what a "connect this toolkit" request does — validate the toolkit, ask
 * Composio to start the link, record it as pending — behind an injected-deps seam
 * so the branch logic is unit-tested without a DB or the Composio API. The route
 * keeps only transport (auth, tier gate, JSON).
 */

import {
  isValidToolkit,
  type ComposioAccountRow,
  type ConnectionStatus,
} from "@/lib/composio/accounts";
import { AuthConfigMissingError } from "@/lib/composio/auth_config";

export type ConnectBranch = "ok" | "invalid_toolkit" | "needs_setup" | "composio_error";

export interface ConnectOutcome {
  branch: ConnectBranch;
  /** The hosted OAuth URL to open (only on `ok`). */
  redirectUrl?: string;
}

export interface ConnectDeps {
  initiate(
    userId: string,
    toolkit: string,
    opts: { apiKey?: string },
  ): Promise<{ connectedAccountId: string; redirectUrl: string }>;
  record(input: {
    userId: string;
    toolkit: string;
    connectedAccountId: string | null;
    status: ConnectionStatus;
  }): Promise<void>;
}

/**
 * Initiate a connection for `userId` + `toolkit`. Returns the hosted redirect on
 * an OAuth connect, or an empty `redirectUrl` when an `apiKey` is imported
 * directly. A Composio failure is caught and becomes `composio_error` (so the
 * route never 500s on a vendor hiccup); an invalid toolkit short-circuits before
 * any external call.
 */
export async function handleConnect(
  userId: string,
  toolkit: unknown,
  deps: ConnectDeps,
  opts: { apiKey?: string } = {},
): Promise<ConnectOutcome> {
  if (!isValidToolkit(toolkit)) {
    return { branch: "invalid_toolkit" };
  }
  try {
    const { connectedAccountId, redirectUrl } = await deps.initiate(userId, toolkit, opts);
    await deps.record({ userId, toolkit, connectedAccountId, status: "pending" });
    return { branch: "ok", redirectUrl };
  } catch (err) {
    // A toolkit that needs our own OAuth config but has none registered yet isn't a
    // vendor failure — it's "not set up". Surface that distinctly so the route
    // returns a clear message instead of a 502.
    if (err instanceof AuthConfigMissingError) return { branch: "needs_setup" };
    return { branch: "composio_error" };
  }
}

export type DisconnectBranch = "ok" | "invalid_toolkit" | "not_connected" | "composio_error";

export interface DisconnectOutcome {
  branch: DisconnectBranch;
}

export interface DisconnectDeps {
  find(userId: string, toolkit: string): Promise<ComposioAccountRow | null>;
  /** Revoke the account at Composio. */
  revoke(connectedAccountId: string): Promise<void>;
  /** Forget our own row. */
  remove(userId: string, toolkit: string): Promise<void>;
}

/**
 * Disconnect `userId` from `toolkit`: revoke the account at Composio, then forget
 * our row. We always remove our row once we've tried to revoke — a revoke that
 * fails because the account is already gone at Composio must not strand the row
 * (it would show "connected" forever). A genuine Composio outage surfaces as
 * `composio_error` and leaves the row intact so the user can retry.
 */
export async function handleDisconnect(
  userId: string,
  toolkit: unknown,
  deps: DisconnectDeps,
): Promise<DisconnectOutcome> {
  if (!isValidToolkit(toolkit)) {
    return { branch: "invalid_toolkit" };
  }
  const row = await deps.find(userId, toolkit);
  if (!row) {
    return { branch: "not_connected" };
  }
  if (row.connectedAccountId) {
    try {
      await deps.revoke(row.connectedAccountId);
    } catch {
      return { branch: "composio_error" };
    }
  }
  await deps.remove(userId, toolkit);
  return { branch: "ok" };
}

export interface RefreshDeps {
  list(userId: string): Promise<ComposioAccountRow[]>;
  status(connectedAccountId: string): Promise<ConnectionStatus>;
  record(input: {
    userId: string;
    toolkit: string;
    connectedAccountId: string | null;
    status: ConnectionStatus;
  }): Promise<void>;
}

/**
 * List the user's connections, **refreshing any still-`pending` ones from
 * Composio** and persisting the change. Composio's connect is hosted-OAuth: the
 * user authorizes on Composio's page and there's no callback to our backend, so
 * a row would otherwise sit `pending` forever. This is the polling model that
 * actually drives `pending → active` (architecture review #3). A status fetch
 * that throws leaves the row as-is (transient — keep showing pending).
 */
export async function listFreshConnections(
  userId: string,
  deps: RefreshDeps,
): Promise<ComposioAccountRow[]> {
  const rows = await deps.list(userId);
  return Promise.all(
    rows.map(async (row) => {
      if (row.status !== "pending" || !row.connectedAccountId) {
        return row;
      }
      let fresh: ConnectionStatus;
      try {
        fresh = await deps.status(row.connectedAccountId);
      } catch {
        return row;
      }
      if (fresh !== row.status) {
        await deps.record({
          userId,
          toolkit: row.toolkit,
          connectedAccountId: row.connectedAccountId,
          status: fresh,
        });
      }
      return { ...row, status: fresh };
    }),
  );
}
