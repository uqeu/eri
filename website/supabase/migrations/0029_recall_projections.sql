-- Recall projection (ADR-0010, recall seam) — the server-readable Tier-A
-- projection of a user's world model, pushed by the Rust brain and read by the
-- phone to enrich replies. A SIBLING of personalization_profiles (NOT a column
-- on it): the existing profile PUT is lossy (stores only body.profile), so the
-- world-model fields get their own row, same K_server-at-rest + AAD=user_id.
--
-- Server-owned: RLS on with no policies, reachable only via the privileged
-- server connection (service role), same posture as personalization_profiles /
-- composio_accounts. The body is encrypted at rest (projection_enc); the server
-- never stores plaintext.

create table if not exists recall_projections (
  user_id text primary key references users(id) on delete cascade,
  -- the projection JSON (§1 of the recall-projection contract), K_server-encrypted.
  projection_enc bytea not null,
  updated_at timestamptz not null default now()
);

alter table recall_projections enable row level security;
