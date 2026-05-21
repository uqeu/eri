-- Initial schema for the eri website backend on Supabase / Postgres.
--
-- RLS strategy: enable Row Level Security on every table but DO NOT declare
-- policies. All access happens server-side via API routes that use the
-- service role key (which bypasses RLS). Clients never query Postgres
-- directly, so an empty policy set is the safe default: anon / authenticated
-- roles can connect but cannot read or write anything.
--
-- Note on `id` columns: we use `text` (not `uuid`) so the existing
-- `usr_<hex>` / `usg_<hex>` identifier format minted by the application
-- (see `lib/auth.ts::newUserId` and `app/api/usage/ping/route.ts`) survives
-- the SQLite → Postgres migration unchanged. The application is the single
-- source of truth for id generation.

create extension if not exists "uuid-ossp";

create table if not exists users (
  id text primary key,
  email text unique not null,
  password_hash text not null,
  display_name text,
  tier text not null default 'free',
  stripe_customer_id text,
  stripe_subscription_id text,
  subscription_status text,
  current_period_end bigint,
  last_threshold_email_at bigint,
  created_at bigint not null default extract(epoch from now())::bigint
);

create unique index if not exists users_stripe_customer_id_idx
  on users (stripe_customer_id)
  where stripe_customer_id is not null;

create table if not exists refresh_tokens (
  token text primary key,
  user_id text not null references users (id) on delete cascade,
  expires_at bigint not null,
  revoked boolean not null default false,
  created_at bigint not null default extract(epoch from now())::bigint
);

create index if not exists refresh_tokens_user_id_idx
  on refresh_tokens (user_id);

create table if not exists usage_pings (
  id text primary key,
  user_id text not null references users (id) on delete cascade,
  tokens_used bigint not null,
  cost_usd numeric not null,
  model text,
  created_at bigint not null default extract(epoch from now())::bigint
);

create index if not exists usage_pings_user_created_idx
  on usage_pings (user_id, created_at);

create table if not exists password_reset_tokens (
  token text primary key,
  user_id text not null references users (id) on delete cascade,
  expires_at bigint not null,
  used boolean not null default false,
  created_at bigint not null default extract(epoch from now())::bigint
);

-- Lock the doors. The service role key bypasses RLS, so backend writes
-- continue to work; everything else is denied by default.
alter table users enable row level security;
alter table refresh_tokens enable row level security;
alter table usage_pings enable row level security;
alter table password_reset_tokens enable row level security;
