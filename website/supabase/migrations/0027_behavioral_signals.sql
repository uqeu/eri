-- 0027_behavioral_signals — the KTO training signal, logged from day one.
--
-- The papers (KTO, When2Call) say eri's own model should be tuned on BINARY
-- accept/reject signal — and that signal is impossible to backfill, so we capture
-- it the moment eri ships, long before any training run. Each eri reply is logged
-- 'kept'; if the user's next message corrects it, the prior row flips to
-- 'rejected'. When there's enough volume + a GPU, this table IS the KTO dataset
-- (kept = desirable, rejected = undesirable) — per user, so adapters stay isolated.
--
-- Server-owned (service-role only): RLS on, no policies.

create table if not exists behavioral_signals (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null references users(id) on delete cascade,
  prompt      text not null,
  response    text not null,
  signal      text not null default 'kept',  -- 'kept' | 'rejected' | 'corrected'
  model       text,
  created_at  timestamptz not null default now()
);

create index if not exists behavioral_signals_user_created_idx
  on behavioral_signals (user_id, created_at desc);

alter table behavioral_signals enable row level security;
