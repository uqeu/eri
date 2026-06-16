-- Proactive nudge log (proactive iMessage loop).
--
-- Drives the anti-annoyance gate: it records every proactive text eri sends so
-- the next sweep can enforce the daily cap + minimum gap, and (via the unique
-- (user_id, dedupe_key)) never nudge the same underlying signal twice. One row
-- per sent nudge; pruned by the same retention sweep as the other phone tables.

create table if not exists proactive_log (
  user_id text not null,
  -- Stable key for one underlying signal (e.g. "email:<id>", "event:<id>").
  dedupe_key text not null,
  -- urgent_email | upcoming_meeting | deadline.
  kind text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, dedupe_key)
);

-- Fast "how many did I send this user lately / when was the last one".
create index if not exists proactive_log_user_sent_idx
  on proactive_log (user_id, sent_at desc);

-- Server-owned like the other phone tables: RLS on, no policies, reachable only
-- through the privileged service-role connection (never the public API).
alter table proactive_log enable row level security;
