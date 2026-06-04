import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";

/**
 * Database helpers for the inference proxy layer — kept in a dedicated
 * module so `lib/db.ts` stays focused on the original user/auth tables.
 */

export interface ApiTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  label: string;
  created_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
}

export interface UsageRecordInput {
  id?: string;
  user_id: string;
  provider: string;
  model: string;
  intent: string | null;
  tokens_in: number;
  tokens_out: number;
  cost_usd_micros: number;
  latency_ms: number;
  status: "ok" | "error" | "rate_limited" | "over_quota";
}

export interface TokenBucketRow {
  user_id: string;
  period_start: Date;
  period_end: Date;
  tokens_used: number;
  tokens_included: number;
  tokens_overage: number;
  mercury_turns_used: number;
  warned_at: Date | null;
  updated_at: Date;
}

export interface DeviceCodeGrantRow {
  /** RFC 8628 device_code: the polling secret, held only by the client. */
  code: string;
  /** RFC 8628 user_code: shown in the browser, used to approve. */
  user_code: string | null;
  user_id: string | null;
  api_token_id: string | null;
  pending_secret: string | null;
  created_at: Date;
  expires_at: Date;
  redeemed_at: Date | null;
  delivered_at: Date | null;
}

export function newApiTokenId(): string {
  return `apt_${randomUUID().replace(/-/g, "")}`;
}

export function newUsageRecordId(): string {
  return `usg_${randomUUID().replace(/-/g, "")}`;
}

interface RawApiToken {
  id: string;
  user_id: string;
  token_hash: string;
  label: string;
  created_at: Date | string;
  last_used_at: Date | string | null;
  revoked_at: Date | string | null;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function toDateOrNull(value: Date | string | null): Date | null {
  if (value === null) return null;
  return toDate(value);
}

function mapApiToken(row: RawApiToken): ApiTokenRow {
  return {
    id: row.id,
    user_id: row.user_id,
    token_hash: row.token_hash,
    label: row.label,
    created_at: toDate(row.created_at),
    last_used_at: toDateOrNull(row.last_used_at),
    revoked_at: toDateOrNull(row.revoked_at),
  };
}

export async function getApiTokenByHash(
  tokenHash: string,
): Promise<ApiTokenRow | null> {
  const rows = await sql()<RawApiToken[]>`
    SELECT * FROM api_tokens
    WHERE token_hash = ${tokenHash} AND revoked_at IS NULL
  `;
  const row = rows[0];
  return row ? mapApiToken(row) : null;
}

export async function insertApiToken(input: {
  id: string;
  user_id: string;
  token_hash: string;
  label: string;
}): Promise<ApiTokenRow> {
  const rows = await sql()<RawApiToken[]>`
    INSERT INTO api_tokens (id, user_id, token_hash, label)
    VALUES (${input.id}, ${input.user_id}, ${input.token_hash}, ${input.label})
    RETURNING *
  `;
  const row = rows[0];
  if (!row) {
    throw new Error("insertApiToken: insert returned no rows");
  }
  return mapApiToken(row);
}

export async function touchApiToken(id: string): Promise<void> {
  await sql()`
    UPDATE api_tokens SET last_used_at = now() WHERE id = ${id}
  `;
}

export async function revokeApiToken(id: string): Promise<void> {
  await sql()`
    UPDATE api_tokens SET revoked_at = now() WHERE id = ${id}
  `;
}

/**
 * List every API token issued to a user (active + revoked). The /devices
 * page renders the active set with a Revoke button; revoked tokens are
 * shown grayed out as history. Sorted newest-first.
 */
export async function listApiTokensByUser(
  userId: string,
): Promise<ApiTokenRow[]> {
  const rows = await sql()<RawApiToken[]>`
    SELECT * FROM api_tokens
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `;
  return rows.map(mapApiToken);
}

/**
 * Revoke a token only if it belongs to the asking user. Returns true on
 * success, false on not-found / wrong-owner / already-revoked (callers
 * respond 404 either way — don't leak whether the token id exists for
 * someone else).
 */
export async function revokeApiTokenForUser(
  tokenId: string,
  userId: string,
): Promise<boolean> {
  const rows = await sql()<{ id: string }[]>`
    UPDATE api_tokens
    SET revoked_at = now()
    WHERE id = ${tokenId} AND user_id = ${userId} AND revoked_at IS NULL
    RETURNING id
  `;
  return rows.length > 0;
}

export async function insertUsageRecord(input: UsageRecordInput): Promise<void> {
  const id = input.id ?? newUsageRecordId();
  await sql()`
    INSERT INTO usage_records (
      id, user_id, provider, model, intent,
      tokens_in, tokens_out, cost_usd_micros, latency_ms, status
    )
    VALUES (
      ${id},
      ${input.user_id},
      ${input.provider},
      ${input.model},
      ${input.intent},
      ${input.tokens_in},
      ${input.tokens_out},
      ${input.cost_usd_micros},
      ${input.latency_ms},
      ${input.status}
    )
  `;
}

interface RawTokenBucket {
  user_id: string;
  period_start: Date | string;
  period_end: Date | string;
  tokens_used: string | number;
  tokens_included: string | number;
  tokens_overage: string | number;
  mercury_turns_used: string | number | null;
  warned_at: Date | string | null;
  updated_at: Date | string;
}

function toBigInt(value: string | number): number {
  // bigint columns come back as strings from postgres-js; convert safely.
  return typeof value === "string" ? Number.parseInt(value, 10) : value;
}

function mapTokenBucket(row: RawTokenBucket): TokenBucketRow {
  return {
    user_id: row.user_id,
    period_start: toDate(row.period_start),
    period_end: toDate(row.period_end),
    tokens_used: toBigInt(row.tokens_used),
    tokens_included: toBigInt(row.tokens_included),
    tokens_overage: toBigInt(row.tokens_overage),
    mercury_turns_used: row.mercury_turns_used === null
      ? 0
      : toBigInt(row.mercury_turns_used),
    warned_at: toDateOrNull(row.warned_at),
    updated_at: toDate(row.updated_at),
  };
}

export async function getTokenBucket(
  userId: string,
): Promise<TokenBucketRow | null> {
  const rows = await sql()<RawTokenBucket[]>`
    SELECT * FROM token_buckets WHERE user_id = ${userId}
  `;
  const row = rows[0];
  return row ? mapTokenBucket(row) : null;
}

export async function upsertTokenBucket(input: {
  user_id: string;
  period_start: Date;
  period_end: Date;
  tokens_included: number;
  tokens_overage: number;
}): Promise<TokenBucketRow> {
  const rows = await sql()<RawTokenBucket[]>`
    INSERT INTO token_buckets (
      user_id, period_start, period_end,
      tokens_used, tokens_included, tokens_overage, updated_at
    )
    VALUES (
      ${input.user_id},
      ${input.period_start},
      ${input.period_end},
      0,
      ${input.tokens_included},
      ${input.tokens_overage},
      now()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      period_start = EXCLUDED.period_start,
      period_end = EXCLUDED.period_end,
      tokens_included = EXCLUDED.tokens_included,
      tokens_overage = EXCLUDED.tokens_overage,
      tokens_used = 0,
      mercury_turns_used = 0,
      warned_at = NULL,
      updated_at = now()
    RETURNING *
  `;
  const row = rows[0];
  if (!row) {
    throw new Error("upsertTokenBucket: returned no rows");
  }
  return mapTokenBucket(row);
}

/**
 * Atomically add `delta` to tokens_used and return the new row. Atomicity
 * matters because two concurrent streams from the same user can finish at
 * once — a read-then-write would lose one of the increments.
 */
export async function incrementTokensUsed(
  userId: string,
  delta: number,
): Promise<TokenBucketRow | null> {
  if (delta <= 0) return getTokenBucket(userId);
  const rows = await sql()<RawTokenBucket[]>`
    UPDATE token_buckets
    SET tokens_used = tokens_used + ${delta},
        updated_at = now()
    WHERE user_id = ${userId}
    RETURNING *
  `;
  const row = rows[0];
  return row ? mapTokenBucket(row) : null;
}

/**
 * Atomically bump `mercury_turns_used`. Mercury is `bill: false` so this is
 * a separate counter from `tokens_used` — used by ensureMercuryTurnAvailable
 * to enforce the per-tier MERCURY_TURN_LIMITS rate cap.
 */
export async function incrementMercuryTurns(
  userId: string,
): Promise<TokenBucketRow | null> {
  const rows = await sql()<RawTokenBucket[]>`
    UPDATE token_buckets
    SET mercury_turns_used = mercury_turns_used + 1,
        updated_at = now()
    WHERE user_id = ${userId}
    RETURNING *
  `;
  const row = rows[0];
  return row ? mapTokenBucket(row) : null;
}

export async function markBucketWarned(userId: string): Promise<void> {
  await sql()`
    UPDATE token_buckets
    SET warned_at = now(), updated_at = now()
    WHERE user_id = ${userId} AND warned_at IS NULL
  `;
}

export async function updateBucketAllowance(input: {
  user_id: string;
  tokens_included: number;
  tokens_overage: number;
}): Promise<void> {
  await sql()`
    UPDATE token_buckets
    SET tokens_included = ${input.tokens_included},
        tokens_overage = ${input.tokens_overage},
        updated_at = now()
    WHERE user_id = ${input.user_id}
  `;
}

export async function sumUsageRecords24h(userId: string): Promise<{
  requests: number;
  tokens: number;
}> {
  const rows = await sql()<{
    requests: string | number;
    tokens: string | number;
  }[]>`
    SELECT COUNT(*)::bigint AS requests,
           COALESCE(SUM(tokens_in + tokens_out), 0)::bigint AS tokens
    FROM usage_records
    WHERE user_id = ${userId}
      AND ts >= now() - interval '24 hours'
  `;
  const row = rows[0];
  if (!row) return { requests: 0, tokens: 0 };
  return { requests: toBigInt(row.requests), tokens: toBigInt(row.tokens) };
}

interface RawDeviceCodeGrant {
  code: string;
  user_code: string | null;
  user_id: string | null;
  api_token_id: string | null;
  pending_secret: string | null;
  created_at: Date | string;
  expires_at: Date | string;
  redeemed_at: Date | string | null;
  delivered_at: Date | string | null;
}

function mapDeviceCodeGrant(row: RawDeviceCodeGrant): DeviceCodeGrantRow {
  return {
    code: row.code,
    user_code: row.user_code,
    user_id: row.user_id,
    api_token_id: row.api_token_id,
    pending_secret: row.pending_secret,
    created_at: toDate(row.created_at),
    expires_at: toDate(row.expires_at),
    redeemed_at: toDateOrNull(row.redeemed_at),
    delivered_at: toDateOrNull(row.delivered_at),
  };
}

export async function insertDeviceCodeGrant(input: {
  code: string;
  user_code: string;
  expires_at: Date;
}): Promise<DeviceCodeGrantRow> {
  const rows = await sql()<RawDeviceCodeGrant[]>`
    INSERT INTO device_code_grants (code, user_code, expires_at)
    VALUES (${input.code}, ${input.user_code}, ${input.expires_at})
    RETURNING *
  `;
  const row = rows[0];
  if (!row) {
    throw new Error("insertDeviceCodeGrant: insert returned no rows");
  }
  return mapDeviceCodeGrant(row);
}

/** Look up by the secret device_code — the polling path (/poll). */
export async function getDeviceCodeGrant(
  code: string,
): Promise<DeviceCodeGrantRow | null> {
  const rows = await sql()<RawDeviceCodeGrant[]>`
    SELECT * FROM device_code_grants WHERE code = ${code}
  `;
  const row = rows[0];
  return row ? mapDeviceCodeGrant(row) : null;
}

/** Look up by the public user_code — the approval path (/approve). */
export async function getDeviceCodeGrantByUserCode(
  userCode: string,
): Promise<DeviceCodeGrantRow | null> {
  const rows = await sql()<RawDeviceCodeGrant[]>`
    SELECT * FROM device_code_grants WHERE user_code = ${userCode}
  `;
  const row = rows[0];
  return row ? mapDeviceCodeGrant(row) : null;
}

/**
 * Approve a grant, keyed on the public user_code (the only value the browser
 * holds). Returns false if it was already redeemed (lost race / replay), so
 * the caller never double-issues. The device_code is never referenced here.
 */
export async function approveDeviceCodeGrant(input: {
  user_code: string;
  user_id: string;
  api_token_id: string;
  plaintext: string;
}): Promise<boolean> {
  const rows = await sql()<{ code: string }[]>`
    UPDATE device_code_grants
    SET user_id = ${input.user_id},
        api_token_id = ${input.api_token_id},
        pending_secret = ${input.plaintext},
        redeemed_at = now()
    WHERE user_code = ${input.user_code} AND redeemed_at IS NULL
    RETURNING code
  `;
  return rows.length > 0;
}

export async function denyDeviceCodeGrant(userCode: string): Promise<void> {
  // Mark as redeemed with no api_token_id → poll returns "denied".
  await sql()`
    UPDATE device_code_grants
    SET redeemed_at = now()
    WHERE user_code = ${userCode} AND redeemed_at IS NULL AND api_token_id IS NULL
  `;
}

/**
 * Atomically clear the pending plaintext after the IDE has retrieved it.
 * Single-use: a second poll after delivery sees pending_secret = NULL and
 * returns "approved" with no token (the IDE has already saved it).
 */
export async function consumeDeviceCodeSecret(
  code: string,
): Promise<string | null> {
  const rows = await sql()<{ pending_secret: string | null }[]>`
    UPDATE device_code_grants
    SET pending_secret = NULL,
        delivered_at = COALESCE(delivered_at, now())
    WHERE code = ${code}
      AND pending_secret IS NOT NULL
    RETURNING pending_secret
  `;
  const row = rows[0];
  return row?.pending_secret ?? null;
}
