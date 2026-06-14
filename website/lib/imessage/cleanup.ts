/**
 * Retention sweep for phone eri's bookkeeping tables (review M3).
 *
 * `phone_pairings` accumulates unredeemed/expired codes, and `imessage_inbound`
 * grows one row per message forever. Both are pure bookkeeping with a natural
 * TTL, so a daily cron prunes them. Dedup only needs a window comfortably past
 * Sendblue's retry horizon.
 */

import { sql } from "@/lib/db";
import { formatReply } from "@/lib/imessage/format";
import { sendReply } from "@/lib/imessage/provider";

const INBOUND_RETENTION_DAYS = 7;

export async function sweepPhoneTables(): Promise<{ pairings: number; inbound: number }> {
  const expiredPairings = await sql()<{ code: string }[]>`
    DELETE FROM phone_pairings WHERE expires_at < now() RETURNING code
  `;
  const oldInbound = await sql()<{ message_handle: string }[]>`
    DELETE FROM imessage_inbound
    WHERE received_at < now() - (${INBOUND_RETENTION_DAYS} || ' days')::interval
    RETURNING message_handle
  `;
  return { pairings: expiredPairings.length, inbound: oldInbound.length };
}

/**
 * Close out command-queue goals whose computer never came online: mark them
 * errored and TELL the user, instead of the goal silently vanishing (review M5).
 * Run on a frequent schedule so "your computer was offline" arrives promptly.
 */
export async function relayExpiredCommands(): Promise<number> {
  const expired = await sql()<{ user_id: string; goal: string }[]>`
    UPDATE command_queue
    SET status = 'error', result = 'computer was offline', completed_at = now()
    WHERE status IN ('pending', 'claimed', 'awaiting_confirm') AND expires_at < now()
    RETURNING user_id, goal
  `;
  for (const cmd of expired) {
    const links = await sql()<{ phone_e164: string }[]>`
      SELECT phone_e164 FROM phone_links
      WHERE user_id = ${cmd.user_id} AND verified_at IS NOT NULL
      ORDER BY verified_at DESC LIMIT 1
    `;
    if (links[0]) {
      const text = `I couldn't reach your computer to "${cmd.goal}" — it may have been offline. Text me again when it's on and I'll pick it back up. 🌿`;
      await sendReply(links[0].phone_e164, formatReply(text)).catch(() => {});
    }
  }
  return expired.length;
}
