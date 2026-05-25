import postgres, { type Sql } from "postgres";

/**
 * Canonical tier slugs. The `tier` column is free-form text in Postgres so
 * legacy rows survive; new writes flow through `isTierSlug` to fail-fast on
 * typos. Keep this in sync with `eri_auth::SubscriptionTier` and
 * `eri_billing::SubscriptionTier`.
 */
export type TierSlug =
  | "free"
  | "starter"
  | "pro"
  | "pro_plus"
  | "teams"
  | "enterprise";

const TIER_SLUGS: ReadonlyArray<TierSlug> = [
  "free",
  "starter",
  "pro",
  "pro_plus",
  "teams",
  "enterprise",
];

export function isTierSlug(value: unknown): value is TierSlug {
  return typeof value === "string" && (TIER_SLUGS as ReadonlyArray<string>).includes(value);
}

export interface UserRow {
  id: string;
  email: string;
  password_hash: string | null;
  display_name: string | null;
  tier: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string | null;
  current_period_end: number | null;
  created_at: number;
  last_threshold_email_at: number | null;
  oauth_provider: string | null;
  oauth_subject: string | null;
}

export interface RefreshTokenRow {
  token: string;
  user_id: string;
  expires_at: number;
  revoked: boolean;
  created_at: number;
}

export interface UsagePingRow {
  id: string;
  user_id: string;
  tokens_used: number;
  cost_usd: number;
  model: string | null;
  created_at: number;
}

export interface PasswordResetTokenRow {
  token: string;
  user_id: string;
  expires_at: number;
  used: boolean;
  created_at: number;
}

let cached: Sql | null = null;

/**
 * Lazily construct a `postgres` client using the service role credentials
 * stored in `DATABASE_URL`. The client is cached for the lifetime of the
 * serverless container so connection pooling and prepared-statement caches
 * are reused across invocations.
 */
export function sql(): Sql {
  if (cached) {
    return cached;
  }
  const url = process.env.DATABASE_URL;
  if (!url || url.length === 0) {
    throw new Error("DATABASE_URL environment variable must be set");
  }
  cached = postgres(url, {
    // Vercel serverless functions are short-lived and run many in parallel;
    // keep the per-instance pool small to avoid exhausting Supabase
    // connection limits.
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });
  return cached;
}

interface RawUser {
  id: string;
  email: string;
  password_hash: string | null;
  display_name: string | null;
  tier: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string | null;
  current_period_end: string | number | null;
  created_at: string | number;
  last_threshold_email_at: string | number | null;
  oauth_provider: string | null;
  oauth_subject: string | null;
}

function toNumber(value: string | number): number {
  return typeof value === "string" ? Number.parseInt(value, 10) : value;
}

function toNumberOrNull(value: string | number | null): number | null {
  if (value === null) return null;
  return toNumber(value);
}

function mapUser(row: RawUser): UserRow {
  return {
    id: row.id,
    email: row.email,
    password_hash: row.password_hash,
    display_name: row.display_name,
    tier: row.tier,
    stripe_customer_id: row.stripe_customer_id,
    stripe_subscription_id: row.stripe_subscription_id,
    subscription_status: row.subscription_status,
    current_period_end: toNumberOrNull(row.current_period_end),
    created_at: toNumber(row.created_at),
    last_threshold_email_at: toNumberOrNull(row.last_threshold_email_at),
    oauth_provider: row.oauth_provider ?? null,
    oauth_subject: row.oauth_subject ?? null,
  };
}

export function publicUser(row: UserRow): {
  id: string;
  email: string;
  display_name: string | null;
  tier: string;
  created_at: number;
  oauth_provider: string | null;
  has_password: boolean;
} {
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    tier: row.tier,
    created_at: row.created_at,
    oauth_provider: row.oauth_provider,
    has_password: row.password_hash !== null,
  };
}

export async function getUserById(id: string): Promise<UserRow | null> {
  const rows = await sql()<RawUser[]>`
    SELECT * FROM users WHERE id = ${id}
  `;
  const row = rows[0];
  return row ? mapUser(row) : null;
}

export async function getUserByEmail(email: string): Promise<UserRow | null> {
  const rows = await sql()<RawUser[]>`
    SELECT * FROM users WHERE email = ${email}
  `;
  const row = rows[0];
  return row ? mapUser(row) : null;
}

export async function getUserByStripeCustomerId(
  stripeCustomerId: string,
): Promise<UserRow | null> {
  const rows = await sql()<RawUser[]>`
    SELECT * FROM users WHERE stripe_customer_id = ${stripeCustomerId}
  `;
  const row = rows[0];
  return row ? mapUser(row) : null;
}

export interface CreateUserInput {
  id: string;
  email: string;
  password_hash: string;
  display_name: string | null;
  created_at: number;
}

export async function createUser(input: CreateUserInput): Promise<UserRow> {
  const rows = await sql()<RawUser[]>`
    INSERT INTO users (id, email, password_hash, display_name, tier, created_at)
    VALUES (
      ${input.id},
      ${input.email},
      ${input.password_hash},
      ${input.display_name},
      'free',
      ${input.created_at}
    )
    RETURNING *
  `;
  const row = rows[0];
  if (!row) {
    throw new Error("createUser: insert returned no rows");
  }
  return mapUser(row);
}

export async function setUserStripeCustomerId(
  userId: string,
  stripeCustomerId: string,
): Promise<void> {
  await sql()`
    UPDATE users SET stripe_customer_id = ${stripeCustomerId} WHERE id = ${userId}
  `;
}

export async function setUserThresholdEmailAt(
  userId: string,
  epoch: number,
): Promise<void> {
  await sql()`
    UPDATE users SET last_threshold_email_at = ${epoch} WHERE id = ${userId}
  `;
}

export interface ApplySubscriptionInput {
  tier: string;
  stripe_subscription_id: string;
  subscription_status: string;
  current_period_end: number;
}

/**
 * Update the user-controlled profile fields. Currently just `display_name`;
 * email + tier flow through other code paths (OAuth callback, Stripe webhook)
 * and aren't accepted here so the surface is intentionally small.
 *
 * `display_name === null` clears the name; the GET /me handler will fall back
 * to the OAuth-derived label in `publicUser` only when nothing's stored.
 */
export async function updateUserDisplayName(
  userId: string,
  displayName: string | null,
): Promise<void> {
  await sql()`
    UPDATE users SET display_name = ${displayName} WHERE id = ${userId}
  `;
}

export async function applySubscriptionByUserId(
  userId: string,
  input: ApplySubscriptionInput,
): Promise<void> {
  await sql()`
    UPDATE users SET
      tier = ${input.tier},
      stripe_subscription_id = ${input.stripe_subscription_id},
      subscription_status = ${input.subscription_status},
      current_period_end = ${input.current_period_end}
    WHERE id = ${userId}
  `;
}

export async function applySubscriptionByCustomerId(
  customerId: string,
  input: ApplySubscriptionInput,
): Promise<void> {
  await sql()`
    UPDATE users SET
      tier = ${input.tier},
      stripe_subscription_id = ${input.stripe_subscription_id},
      subscription_status = ${input.subscription_status},
      current_period_end = ${input.current_period_end}
    WHERE stripe_customer_id = ${customerId}
  `;
}

export async function clearSubscriptionByCustomerId(
  customerId: string,
  subscriptionStatus: string,
  currentPeriodEnd: number,
): Promise<void> {
  await sql()`
    UPDATE users SET
      tier = 'free',
      subscription_status = ${subscriptionStatus},
      current_period_end = ${currentPeriodEnd}
    WHERE stripe_customer_id = ${customerId}
  `;
}

export async function insertRefreshToken(input: {
  token: string;
  user_id: string;
  expires_at: number;
  created_at: number;
}): Promise<void> {
  await sql()`
    INSERT INTO refresh_tokens (token, user_id, expires_at, revoked, created_at)
    VALUES (${input.token}, ${input.user_id}, ${input.expires_at}, false, ${input.created_at})
  `;
}

interface RawRefreshToken {
  token: string;
  user_id: string;
  expires_at: string | number;
  revoked: boolean;
  created_at: string | number;
}

export async function getActiveRefreshToken(
  token: string,
): Promise<{ user_id: string; expires_at: number } | null> {
  const rows = await sql()<RawRefreshToken[]>`
    SELECT user_id, expires_at FROM refresh_tokens
    WHERE token = ${token} AND revoked = false
  `;
  const row = rows[0];
  if (!row) return null;
  return { user_id: row.user_id, expires_at: toNumber(row.expires_at) };
}

export async function revokeRefreshTokenRow(token: string): Promise<void> {
  await sql()`
    UPDATE refresh_tokens SET revoked = true WHERE token = ${token}
  `;
}

export async function insertUsagePing(input: {
  id: string;
  user_id: string;
  tokens_used: number;
  cost_usd: number;
  model: string | null;
  created_at: number;
}): Promise<void> {
  await sql()`
    INSERT INTO usage_pings (id, user_id, tokens_used, cost_usd, model, created_at)
    VALUES (
      ${input.id},
      ${input.user_id},
      ${input.tokens_used},
      ${input.cost_usd},
      ${input.model},
      ${input.created_at}
    )
  `;
}

export async function sumTokensUsedSince(
  userId: string,
  sinceEpoch: number,
): Promise<number> {
  const rows = await sql()<{ total: string | number }[]>`
    SELECT COALESCE(SUM(tokens_used), 0) AS total
    FROM usage_pings
    WHERE user_id = ${userId} AND created_at >= ${sinceEpoch}
  `;
  const row = rows[0];
  return row ? toNumber(row.total) : 0;
}

export async function sumUsageSince(
  userId: string,
  sinceEpoch: number,
): Promise<{ tokens: number; cost: number }> {
  const rows = await sql()<{ tokens: string | number; cost: string | number }[]>`
    SELECT
      COALESCE(SUM(tokens_used), 0) AS tokens,
      COALESCE(SUM(cost_usd), 0) AS cost
    FROM usage_pings
    WHERE user_id = ${userId} AND created_at >= ${sinceEpoch}
  `;
  const row = rows[0];
  if (!row) return { tokens: 0, cost: 0 };
  return {
    tokens: toNumber(row.tokens),
    cost: typeof row.cost === "string" ? Number.parseFloat(row.cost) : row.cost,
  };
}

export async function listUsagePingsSince(
  userId: string,
  sinceEpoch: number,
): Promise<Array<{ created_at: number; tokens_used: number; cost_usd: number }>> {
  const rows = await sql()<{
    created_at: string | number;
    tokens_used: string | number;
    cost_usd: string | number;
  }[]>`
    SELECT created_at, tokens_used, cost_usd
    FROM usage_pings
    WHERE user_id = ${userId} AND created_at >= ${sinceEpoch}
    ORDER BY created_at ASC
  `;
  return rows.map((row) => ({
    created_at: toNumber(row.created_at),
    tokens_used: toNumber(row.tokens_used),
    cost_usd:
      typeof row.cost_usd === "string"
        ? Number.parseFloat(row.cost_usd)
        : row.cost_usd,
  }));
}

export interface CreateOAuthUserInput {
  id: string;
  email: string;
  display_name: string | null;
  oauth_provider: string;
  oauth_subject: string;
  created_at: number;
}

export async function createOAuthUser(
  input: CreateOAuthUserInput,
): Promise<UserRow> {
  const rows = await sql()<RawUser[]>`
    INSERT INTO users (
      id, email, password_hash, display_name, tier, created_at,
      oauth_provider, oauth_subject
    )
    VALUES (
      ${input.id},
      ${input.email},
      ${null},
      ${input.display_name},
      'free',
      ${input.created_at},
      ${input.oauth_provider},
      ${input.oauth_subject}
    )
    RETURNING *
  `;
  const row = rows[0];
  if (!row) {
    throw new Error("createOAuthUser: insert returned no rows");
  }
  return mapUser(row);
}

export async function linkOAuthToUser(
  userId: string,
  provider: string,
  subject: string,
): Promise<void> {
  await sql()`
    UPDATE users
    SET oauth_provider = ${provider},
        oauth_subject = ${subject}
    WHERE id = ${userId}
  `;
}

export async function insertPasswordResetToken(input: {
  token: string;
  user_id: string;
  expires_at: number;
  created_at: number;
}): Promise<void> {
  await sql()`
    INSERT INTO password_reset_tokens (token, user_id, expires_at, used, created_at)
    VALUES (
      ${input.token},
      ${input.user_id},
      ${input.expires_at},
      false,
      ${input.created_at}
    )
  `;
}
