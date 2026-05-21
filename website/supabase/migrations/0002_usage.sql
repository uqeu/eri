-- Per-turn usage tracking + tier rate-limiting state.
--
-- The Rust desktop IDE calls /api/v1/turns/check before every voice turn
-- (or Cmd-K / composer edit). If allowed, the IDE issues the Mercury 2
-- request directly and then POSTs the result to /api/v1/turns/record. This
-- table is the source of truth for the rolling counters that drive both
-- the monthly quota and the per-day / per-hour rate limits.
--
-- Why a new table (vs. extending usage_pings):
--   usage_pings stores aggregated token totals tied to billing thresholds.
--   We need per-turn rows here so we can count "turns/hour" and "turns/day"
--   independently of the token aggregation pipeline, and so the IDE's
--   pre-flight gating is a single indexed COUNT(*) query.
--
-- RLS strategy follows 0001_init.sql: enable RLS but declare no policies.
-- All access is via the service role from server-side API routes.

-- Defensive: ensure the tier column exists. 0001_init.sql already creates
-- it, but adding it here makes this migration safe to re-run on databases
-- that were provisioned before the tier column was introduced.
alter table users add column if not exists tier text not null default 'free';

create table if not exists usage_turns (
  id text primary key,
  user_id text not null references users (id) on delete cascade,
  kind text not null check (kind in ('voice', 'cmdk', 'composer')),
  input_tokens integer,
  output_tokens integer,
  cost_cents integer,
  created_at timestamptz not null default now()
);

create index if not exists usage_turns_user_created_idx
  on usage_turns (user_id, created_at desc);

alter table usage_turns enable row level security;
