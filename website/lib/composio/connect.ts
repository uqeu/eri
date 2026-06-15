/**
 * Connect orchestrator (phone-eri connector layer).
 *
 * Decides what a "connect this toolkit" request does — validate the toolkit, ask
 * Composio to start the link, record it as pending — behind an injected-deps seam
 * so the branch logic is unit-tested without a DB or the Composio API. The route
 * keeps only transport (auth, tier gate, JSON).
 */

import { isValidToolkit, type ConnectionStatus } from "@/lib/composio/accounts";

export type ConnectBranch = "ok" | "invalid_toolkit" | "composio_error";

export interface ConnectOutcome {
  branch: ConnectBranch;
  /** The hosted OAuth URL to open (only on `ok`). */
  redirectUrl?: string;
}

export interface ConnectDeps {
  initiate(userId: string, toolkit: string): Promise<{ connectedAccountId: string; redirectUrl: string }>;
  record(input: {
    userId: string;
    toolkit: string;
    connectedAccountId: string | null;
    status: ConnectionStatus;
  }): Promise<void>;
}

/**
 * Initiate a connection for `userId` + `toolkit`. Returns the hosted redirect on
 * success. A Composio failure is caught and becomes `composio_error` (so the
 * route never 500s on a vendor hiccup); an invalid toolkit short-circuits before
 * any external call.
 */
export async function handleConnect(
  userId: string,
  toolkit: unknown,
  deps: ConnectDeps,
): Promise<ConnectOutcome> {
  if (!isValidToolkit(toolkit)) {
    return { branch: "invalid_toolkit" };
  }
  try {
    const { connectedAccountId, redirectUrl } = await deps.initiate(userId, toolkit);
    await deps.record({ userId, toolkit, connectedAccountId, status: "pending" });
    return { branch: "ok", redirectUrl };
  } catch {
    return { branch: "composio_error" };
  }
}
