/**
 * Retention sweep for phone eri's bookkeeping tables (review M3).
 *
 * `phone_pairings` accumulates unredeemed/expired codes, and `imessage_inbound`
 * grows one row per message forever. Both are pure bookkeeping with a natural
 * TTL, so a daily cron prunes them. Dedup only needs a window comfortably past
 * Sendblue's retry horizon.
 */

import { sql } from "@/lib/db";

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
