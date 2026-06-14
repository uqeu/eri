-- Inbound iMessage idempotency for phone eri (Phase 1, ADR-0002).
--
-- Sendblue may deliver the same webhook more than once. We dedup on the
-- provider `message_handle`: the inbound route INSERTs the handle ON CONFLICT
-- DO NOTHING and only processes the message when the row was newly inserted, so
-- a retried delivery never produces a second reply or a second metered turn.

create table if not exists imessage_inbound (
  message_handle text primary key,
  received_at    timestamptz not null default now()
);

comment on table imessage_inbound is
  'Phone eri: processed inbound message_handles, for webhook idempotency.';
