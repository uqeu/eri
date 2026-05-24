-- Inference proxy: per-user API tokens, usage records, monthly token
-- buckets, and short-lived device-code grants.
--
-- Design notes
-- ────────────
-- * IDs follow the project's text-id convention (`apt_<hex>`, `usg_<hex>`,
--   `dcg_<hex>`) so postgres-js can keep `prepare: false` and the
--   application stays the single source of id truth (see 0001_init.sql).
-- * API bearer tokens are NEVER stored raw — only sha256(token_hex) lands
--   in `api_tokens.token_hash`. The plaintext is shown exactly once at
--   issuance time.
-- * `token_buckets` is keyed by user_id (one bucket per user). The cron
--   job in `lib/usage/quota.ts::resetMonthlyBuckets` rolls
--   period_start/period_end forward at the billing anniversary.
-- * RLS strategy follows 0001_init.sql: enable RLS but declare no
--   policies. All access flows through the service role from server-side
--   API routes; clients never query Postgres directly.

create table if not exists api_tokens (
  id            text primary key,
  user_id       text not null references users (id) on delete cascade,
  -- sha256(token) hex digest. Raw bearer is never persisted.
  token_hash    text not null unique,
  label         text not null default 'IDE',
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);

create index if not exists api_tokens_user_idx
  on api_tokens (user_id);

alter table api_tokens enable row level security;

create table if not exists usage_records (
  id              text primary key,
  user_id         text not null references users (id) on delete cascade,
  ts              timestamptz not null default now(),
  provider        text not null,
  model           text not null,
  intent          text,
  tokens_in       integer not null,
  tokens_out      integer not null,
  -- eri's upstream cost in micro-USD (1_000_000 = $1.00). Integer so we
  -- never see floating-point drift across millions of rows.
  cost_usd_micros integer not null,
  latency_ms      integer not null,
  status          text not null check (
    status in ('ok', 'error', 'rate_limited', 'over_quota')
  )
);

create index if not exists usage_records_user_ts_idx
  on usage_records (user_id, ts desc);

alter table usage_records enable row level security;

create table if not exists token_buckets (
  user_id         text primary key references users (id) on delete cascade,
  period_start    timestamptz not null,
  period_end      timestamptz not null,
  tokens_used     bigint not null default 0,
  tokens_included bigint not null,
  -- Soft "ghost" pool above tokens_included. Hard cap is
  -- tokens_included + tokens_overage; beyond that → HTTP 402.
  tokens_overage  bigint not null default 0,
  warned_at       timestamptz,
  updated_at      timestamptz not null default now()
);

alter table token_buckets enable row level security;

create table if not exists device_code_grants (
  -- 32-char URL-safe random string; used as the polling key.
  code             text primary key,
  user_id          text references users (id) on delete cascade,
  api_token_id     text references api_tokens (id) on delete cascade,
  -- Holds the plaintext bearer for the *first* successful poll after
  -- approval, then is wiped to NULL. Never stored long-term; the
  -- canonical persisted form is api_tokens.token_hash.
  pending_secret   text,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  redeemed_at      timestamptz,
  delivered_at     timestamptz
);

create index if not exists device_code_grants_expires_idx
  on device_code_grants (expires_at);

alter table device_code_grants enable row level security;
