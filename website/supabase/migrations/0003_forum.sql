-- Community forum: threads + replies.
--
-- Identifier scheme follows the existing `usr_<hex>` / `usg_<hex>` pattern from
-- 0001_init.sql. Application code (`lib/forum.ts`) mints `thr_<hex>` and
-- `rep_<hex>` ids so we use `text` primary keys.
--
-- RLS strategy mirrors 0001_init.sql / 0002_usage.sql: enable RLS but declare
-- no policies. All access flows through server-side API routes that use the
-- service-role connection from `lib/db.ts`. Anon / authenticated roles cannot
-- read or write directly.
--
-- Timestamp columns use `timestamptz` (not bigint epoch) per the task spec —
-- the forum is a new surface, so we adopt the more idiomatic Postgres type
-- and let the `lib/forum.ts` mapper coerce to milliseconds for the UI.

create table if not exists forum_threads (
  id text primary key,
  user_id text not null references users (id) on delete cascade,
  title text not null,
  body text not null,
  created_at timestamptz not null default now(),
  last_reply_at timestamptz not null default now(),
  reply_count integer not null default 0
);

create index if not exists forum_threads_last_reply_at_idx
  on forum_threads (last_reply_at desc);

create table if not exists forum_replies (
  id text primary key,
  thread_id text not null references forum_threads (id) on delete cascade,
  user_id text not null references users (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists forum_replies_thread_created_idx
  on forum_replies (thread_id, created_at);

alter table forum_threads enable row level security;
alter table forum_replies enable row level security;
