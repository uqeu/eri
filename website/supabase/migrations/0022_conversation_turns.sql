-- 0022_conversation_turns — running conversation memory (cloud pivot 2026-06-16).
--
-- Phone eri was a one-off AI: each inbound text became a fresh model call with no
-- history, so eri would ask "where do you live?", get "Toronto", and reply "what
-- are you referring to?" — it forgot its own question. This table stores the
-- recent back-and-forth per user (cloud-primary, so it works laptop-closed), and
-- the inbound turn replays the last N rows as conversation context.
--
-- Server-owned (service-role writes only): RLS enabled, no policies — same as
-- learned_facts / command_queue.

create table if not exists conversation_turns (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null references users(id) on delete cascade,
  role        text not null,  -- 'user' | 'assistant'
  content     text not null,
  created_at  timestamptz not null default now()
);

-- The read path is "newest N for this user" — index it.
create index if not exists conversation_turns_user_created_idx
  on conversation_turns (user_id, created_at desc);

alter table conversation_turns enable row level security;
