-- Turn the inbound dedup row into a processing LEASE (Phase 1 review C1).
--
-- The original 0013 inserted message_handle BEFORE the turn ran, so any crash
-- after the insert marked the message "processed" forever — Sendblue's retry saw
-- a duplicate and the user never got a reply. A lease fixes that: claim the
-- handle, run the turn, then set completed_at. A claim succeeds for a NEW handle
-- or one whose prior attempt is incomplete AND stale (the function was killed);
-- a completed handle is a true duplicate. On a catchable failure the route
-- releases the lease (deletes the row) so the retry reprocesses immediately.

alter table imessage_inbound
  add column if not exists completed_at timestamptz;

-- Supports both the stale-lease reclaim predicate and the M3 retention sweep.
create index if not exists imessage_inbound_received_idx
  on imessage_inbound(received_at);
