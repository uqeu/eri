// The ONE running conversation, shared by every surface (phone + desktop).
//
// Cloud-primary (works laptop-closed) and server-owned (service-role writes; RLS
// no-policy, like learned_facts / command_queue). Both phone eri AND the
// computer-resident eri append to and read this single per-user thread — so you
// can say something on your laptop and pick it up on your phone mid-conversation.
// This is the unification seam: there is exactly one implementation of "the
// conversation", here, used by the iMessage inbound turn and the desktop sync.

import type { ConversationTurn } from "@/lib/agent/run_core";
import { sql } from "@/lib/db";

/** Replay cap + window — a month of normal back-and-forth. */
const HISTORY_LIMIT = 300;
const HISTORY_WINDOW = "30 days";

/** Recent turns (oldest→newest, ready for the model) for a user. Best-effort —
 *  returns [] on failure, never throws. */
export async function loadConversation(
  userId: string,
  limit: number = HISTORY_LIMIT,
): Promise<ConversationTurn[]> {
  try {
    const rows = await sql()<{ role: string; content: string }[]>`
      SELECT role, content FROM conversation_turns
      WHERE user_id = ${userId} AND created_at > now() - ${HISTORY_WINDOW}::interval
      ORDER BY created_at DESC
      LIMIT ${Math.max(1, Math.min(limit, HISTORY_LIMIT))}
    `;
    return rows.reverse().map(
      (r): ConversationTurn => ({
        role: r.role === "assistant" ? "assistant" : "user",
        content: r.content,
      }),
    );
  } catch (e) {
    console.error("conversation.load_failed", { userId, error: String(e) });
    return [];
  }
}

/** Append turns to the shared thread. Best-effort — skips blanks, never throws. */
export async function appendTurns(userId: string, turns: ConversationTurn[]): Promise<void> {
  for (const t of turns) {
    const content = (t?.content ?? "").trim();
    if (!content) continue;
    const role = t.role === "assistant" ? "assistant" : "user";
    try {
      await sql()`
        INSERT INTO conversation_turns (user_id, role, content)
        VALUES (${userId}, ${role}, ${content})
      `;
    } catch (e) {
      console.error("conversation.append_failed", { userId, error: String(e) });
    }
  }
}

/** Convenience: record one user→assistant exchange (the phone inbound shape). */
export async function recordExchange(
  userId: string,
  userText: string,
  assistantText: string,
): Promise<void> {
  await appendTurns(userId, [
    { role: "user", content: userText },
    { role: "assistant", content: assistantText },
  ]);
}
