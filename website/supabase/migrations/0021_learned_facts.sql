-- 0021_learned_facts — cloud-primary conversational memory (cloud pivot 2026-06-16).
--
-- eri must remember things you tell it over text even with the laptop closed, so
-- these facts live server-side (cloud-primary), NOT in the device-only E2E store.
-- Kept in their OWN table rather than the Tier-A `personalization_profiles` blob
-- because the laptop's `eri sync` does a full PUT-replace of that blob and would
-- clobber anything the phone learned. This table is append-only and merged into
-- the prompt at read time, so the two sources coexist.
--
-- Server-owned (service-role writes only): RLS enabled with no policies, matching
-- the proactive_log / command_queue pattern — the app's service role bypasses RLS,
-- and no client can read another user's facts.

create table if not exists learned_facts (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null references users(id) on delete cascade,
  fact        text not null,
  kind        text not null default 'fact',  -- 'fact' | 'preference'
  source      text not null default 'imessage',
  created_at  timestamptz not null default now()
);

-- Recall is "newest first, capped" — index the read path.
create index if not exists learned_facts_user_created_idx
  on learned_facts (user_id, created_at desc);

-- One row per (user, exact fact text): re-stating a fact updates recency, never
-- duplicates it, so the prompt doesn't fill with repeats.
create unique index if not exists learned_facts_user_fact_uniq
  on learned_facts (user_id, fact);

alter table learned_facts enable row level security;
