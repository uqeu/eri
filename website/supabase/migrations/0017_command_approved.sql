-- Natural confirmation resume for remote control (Phase 2, review H1).
--
-- When a remote goal hits a risky action it parks as `awaiting_confirm` and eri
-- asks the phone "want me to go ahead?". The user's natural "yes/go/do it" flips
-- the row back to `pending` with approved = true; the daemon re-claims it and
-- runs with that goal pre-approved (single-use — the flag is consumed on the
-- next claim). A "no" marks it error/cancelled.

alter table command_queue
  add column if not exists approved boolean not null default false;
