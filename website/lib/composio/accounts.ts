/**
 * Composio connected-account records (phone-eri connector layer).
 *
 * eri stores only WHICH toolkits a user connected + Composio's account id and a
 * coarse status — never tokens (those live in Composio's vault). All ops are
 * user-scoped. The toolkit validator + status type are pure and unit-tested; the
 * DB ops are thin, parameterized, and keyed by (user_id, toolkit).
 */

import { sql } from "@/lib/db";

export type ConnectionStatus = "pending" | "active" | "error";

export interface ComposioAccountRow {
  toolkit: string;
  connectedAccountId: string | null;
  status: ConnectionStatus;
}

/** Composio toolkit slugs are lowercase alphanumerics + `_`/`-`, ≤ 64 chars. A
 *  strict allowlist shape so a request can't smuggle anything odd into the URL or
 *  the env-var name the client derives from it. Pure + tested. */
export function isValidToolkit(toolkit: unknown): toolkit is string {
  return (
    typeof toolkit === "string" &&
    toolkit.length > 0 &&
    toolkit.length <= 64 &&
    /^[a-z0-9_-]+$/.test(toolkit)
  );
}

/** Record (or refresh) a user's connection to a toolkit. Upsert on (user, toolkit). */
export async function upsertConnection(input: {
  userId: string;
  toolkit: string;
  connectedAccountId: string | null;
  status: ConnectionStatus;
}): Promise<void> {
  await sql()`
    INSERT INTO composio_accounts (user_id, toolkit, connected_account_id, status, updated_at)
    VALUES (${input.userId}, ${input.toolkit}, ${input.connectedAccountId}, ${input.status}, now())
    ON CONFLICT (user_id, toolkit) DO UPDATE
      SET connected_account_id = EXCLUDED.connected_account_id,
          status = EXCLUDED.status,
          updated_at = now()
  `;
}

/** Every toolkit this user has connected (or is connecting), newest first. */
export async function listConnections(userId: string): Promise<ComposioAccountRow[]> {
  const rows = await sql()<
    { toolkit: string; connected_account_id: string | null; status: string }[]
  >`
    SELECT toolkit, connected_account_id, status
    FROM composio_accounts
    WHERE user_id = ${userId}
    ORDER BY updated_at DESC
  `;
  return rows.map((r) => ({
    toolkit: r.toolkit,
    connectedAccountId: r.connected_account_id,
    status: normalizeRowStatus(r.status),
  }));
}

/** One user's connection to a single toolkit, or null if they have none. */
export async function findConnection(
  userId: string,
  toolkit: string,
): Promise<ComposioAccountRow | null> {
  const rows = await sql()<
    { toolkit: string; connected_account_id: string | null; status: string }[]
  >`
    SELECT toolkit, connected_account_id, status
    FROM composio_accounts
    WHERE user_id = ${userId} AND toolkit = ${toolkit}
    LIMIT 1
  `;
  const r = rows[0];
  if (!r) return null;
  return {
    toolkit: r.toolkit,
    connectedAccountId: r.connected_account_id,
    status: normalizeRowStatus(r.status),
  };
}

/** Forget a user's connection to a toolkit (after revoking it at Composio). */
export async function deleteConnection(userId: string, toolkit: string): Promise<void> {
  await sql()`
    DELETE FROM composio_accounts
    WHERE user_id = ${userId} AND toolkit = ${toolkit}
  `;
}

function normalizeRowStatus(s: string): ConnectionStatus {
  return s === "active" || s === "pending" ? s : "error";
}
