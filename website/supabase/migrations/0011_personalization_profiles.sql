-- Tier-A personalization profile storage for phone eri (Phase 0, ADR-0001).
--
-- Unlike memory_blobs (Tier-B: opaque E2E ciphertext the server never reads),
-- the Tier-A profile is **server-readable** so phone eri can inject it into its
-- system prompt. It is a small projection (target <=32KB) of the user's memory —
-- static facts + preference rollups, plus a live `dynamic_context` ("today you
-- shipped X") — never the raw observation log or secrets (a Claude sensitivity
-- pass gates what reaches it).
--
-- Stored encrypted at rest under the application key K_server (see
-- lib/crypto/server_encryption.ts) so a leaked DB dump alone reveals nothing.
-- The two encrypted columns are split because dynamic_context refreshes far more
-- often than the static profile — Phase 1 can update it without rewriting both.
--
-- Single row per user; updates overwrite. Strict per-user_id isolation (every
-- read/write is scoped to the authenticated bearer's user_id).

create table if not exists personalization_profiles (
  user_id             text primary key references users(id) on delete cascade,
  profile_enc         bytea not null,
  dynamic_context_enc bytea not null,
  updated_at          timestamptz not null default now()
);

create index if not exists personalization_profiles_updated_idx
  on personalization_profiles(updated_at desc);

comment on table personalization_profiles is
  'Phone eri Tier-A: server-readable personalization profile, encrypted at rest with K_server, one per user.';
