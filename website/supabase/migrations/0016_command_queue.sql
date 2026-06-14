-- Remote-control command queue for phone eri (Phase 2, ADR-0002).
--
-- Vercel has no worker, so the computer-resident eri DRIVES the work: phone eri
-- enqueues a goal ("open Spotify", "what did I do Tuesday") here; the computer
-- long-polls, atomically CLAIMS its own rows, runs each through the existing
-- control stack, and posts the result back (which is relayed to the phone).
--
-- Status lifecycle:
--   pending          — enqueued, waiting for the computer to claim it
--   claimed          — a computer eri is working on it
--   awaiting_confirm — the goal hit a risky action; a confirmation was bounced
--                      to the phone and we're waiting for "YES" (never auto-run)
--   done             — completed; `result` holds the outcome
--   error            — failed; `result` holds the reason
-- Offline computer → the row simply stays `pending` until it expires.

create table if not exists command_queue (
  id             text primary key,
  user_id        text not null references users(id) on delete cascade,
  source         text not null,                       -- 'imessage' | …
  goal           text not null,
  status         text not null default 'pending',
  result         text,
  confirm_prompt text,
  created_at     timestamptz not null default now(),
  claimed_at     timestamptz,
  completed_at   timestamptz,
  expires_at     timestamptz not null
);

-- The poll path claims the oldest pending, non-expired row for one user.
create index if not exists command_queue_poll_idx
  on command_queue(user_id, status, created_at);

comment on table command_queue is
  'Phone eri Phase 2: goals the computer-resident eri polls + executes; strictly user_id-scoped.';
