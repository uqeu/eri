/**
 * The remote-control command queue (Phase 2, ADR-0002).
 *
 * Phone eri enqueues a goal; the computer-resident eri long-polls, atomically
 * CLAIMS its own pending rows (FOR UPDATE SKIP LOCKED so two devices never grab
 * the same one), runs each through the existing control stack, and completes it
 * — done / error, or `awaiting_confirm` when a risky action needs a "YES" from
 * the phone (remote mode NEVER auto-confirms). Everything is scoped to the
 * caller's user_id, so one user can never see or claim another's commands.
 *
 * The status helpers + relay formatting are pure and unit-tested; the DB ops are
 * thin, parameterized, and user-scoped.
 */

import { randomBytes } from "node:crypto";
import { sql } from "@/lib/db";

export type CommandStatus =
  | "pending"
  | "claimed"
  | "awaiting_confirm"
  | "done"
  | "error";

const TERMINAL: ReadonlySet<CommandStatus> = new Set(["done", "error"]);

export function isTerminalStatus(status: CommandStatus): boolean {
  return TERMINAL.has(status);
}

export interface CommandRow {
  id: string;
  goal: string;
  source: string;
}

/** How a finished/blocked command reads when texted back to the phone. */
export function relayMessage(input: {
  status: CommandStatus;
  result?: string | null;
  confirmPrompt?: string | null;
}): string {
  switch (input.status) {
    case "done":
      return input.result?.trim() ? `✓ ${input.result.trim()}` : "✓ Done.";
    case "error":
      return input.result?.trim()
        ? `✗ Couldn't finish that — ${input.result.trim()}`
        : "✗ I couldn't finish that one.";
    case "awaiting_confirm":
      return input.confirmPrompt?.trim() ?? "eri needs your OK to continue — reply YES.";
    default:
      return "Working on it — I'll text you when it's done. 🌿";
  }
}

function newCommandId(): string {
  return `cmd_${randomBytes(12).toString("base64url")}`;
}

const DEFAULT_TTL_MINUTES = 30;
/** Cap outstanding (non-terminal) commands per user so a runaway dispatch loop
 *  (or prompt injection) can't flood the queue (review H3). */
const MAX_PENDING_PER_USER = 5;

/**
 * Enqueue a goal for the user's computer to execute. Returns the new command id,
 * or null when the user is already at the outstanding-command cap (the caller
 * tells the user to wait).
 */
export async function enqueueCommand(input: {
  userId: string;
  source: string;
  goal: string;
  ttlMinutes?: number;
}): Promise<{ id: string } | null> {
  const pending = await sql()<{ n: number }[]>`
    SELECT count(*)::int AS n FROM command_queue
    WHERE user_id = ${input.userId}
      AND status IN ('pending', 'claimed', 'awaiting_confirm')
      AND expires_at > now()
  `;
  if ((pending[0]?.n ?? 0) >= MAX_PENDING_PER_USER) {
    return null;
  }
  const id = newCommandId();
  const ttl = input.ttlMinutes ?? DEFAULT_TTL_MINUTES;
  const expiresAt = new Date(Date.now() + ttl * 60_000).toISOString();
  await sql()`
    INSERT INTO command_queue (id, user_id, source, goal, expires_at)
    VALUES (${id}, ${input.userId}, ${input.source}, ${input.goal}, ${expiresAt})
  `;
  return { id };
}

/**
 * Atomically claim the oldest pending, non-expired command for `userId`. Returns
 * the claimed row or null. `FOR UPDATE SKIP LOCKED` means concurrent pollers
 * never claim the same row.
 */
export async function claimNextCommand(userId: string): Promise<CommandRow | null> {
  const rows = await sql()<CommandRow[]>`
    UPDATE command_queue SET status = 'claimed', claimed_at = now()
    WHERE id = (
      SELECT id FROM command_queue
      WHERE user_id = ${userId}
        AND expires_at > now()
        AND (
          status = 'pending'
          -- Reclaim a row whose daemon died mid-run (claimed but stale), or it
          -- would be stranded forever (review H2).
          OR (status = 'claimed' AND claimed_at < now() - interval '2 minutes')
        )
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, goal, source
  `;
  return rows[0] ?? null;
}

/**
 * Post the outcome of a claimed command. `done`/`error` stamp completed_at;
 * `awaiting_confirm` records the prompt to bounce to the phone. Scoped to
 * `userId` so a caller can only complete its own commands.
 */
export async function completeCommand(input: {
  id: string;
  userId: string;
  status: Extract<CommandStatus, "done" | "error" | "awaiting_confirm">;
  result?: string;
  confirmPrompt?: string;
}): Promise<boolean> {
  const stampDone = input.status === "done" || input.status === "error";
  // Only a CLAIMED row can be completed — makes completion idempotent and stops a
  // late/duplicate post from resurrecting a finished command (review M3).
  const rows = await sql()<{ id: string }[]>`
    UPDATE command_queue
    SET status = ${input.status},
        result = ${input.result ?? null},
        confirm_prompt = ${input.confirmPrompt ?? null},
        completed_at = CASE WHEN ${stampDone} THEN now() ELSE completed_at END
    WHERE id = ${input.id} AND user_id = ${input.userId} AND status = 'claimed'
    RETURNING id
  `;
  return rows.length > 0;
}
