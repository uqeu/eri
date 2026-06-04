// Append-only audit log for notable account events.
//
// `recordAudit` is BEST-EFFORT: it must never throw into or block the caller's
// main flow (auth, billing, device management). A failed audit write is logged
// and swallowed -- losing an audit row is preferable to failing a login.
//
// PRIVACY: `detail` carries only small structured metadata (ids, tiers, counts,
// statuses). NEVER pass prompt or response content here.

import { randomBytes } from "node:crypto";

import { sql } from "@/lib/db";

export type AuditAction =
  | "auth.login"
  | "auth.logout"
  | "tier.changed"
  | "device.token_created"
  | "device.token_revoked"
  | "quota.over_quota"
  | "quota.ghost_warning";

export interface AuditRow {
  id: string;
  user_id: string | null;
  action: string;
  detail: Record<string, unknown>;
  ts: string;
}

/**
 * Append an audit event. Best-effort: never throws.
 */
export async function recordAudit(
  userId: string | null,
  action: AuditAction,
  detail: Record<string, unknown> = {},
): Promise<void> {
  try {
    const id = `aud_${randomBytes(12).toString("hex")}`;
    // Bind detail as text + cast to jsonb (avoids postgres-js JSONValue typing).
    await sql()`
      INSERT INTO admin_audit_log (id, user_id, action, detail)
      VALUES (${id}, ${userId}, ${action}, ${JSON.stringify(detail)}::jsonb)
    `;
  } catch (error: unknown) {
    // Swallow -- auditing must not break the primary operation.
    console.error("[audit] failed to record", action, error);
  }
}

/**
 * Most-recent audit events (newest first), for the admin feed.
 */
export async function recentAudit(limit = 100): Promise<AuditRow[]> {
  const capped = Math.min(Math.max(1, limit), 500);
  const rows = await sql()<AuditRow[]>`
    SELECT id, user_id, action, detail, ts
    FROM admin_audit_log
    ORDER BY ts DESC
    LIMIT ${capped}
  `;
  return rows;
}
