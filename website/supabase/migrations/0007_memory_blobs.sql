-- Per-user encrypted memory blob storage for Phase 8 cloud sync.
--
-- The server is **dumb storage** — the client encrypts the blob with a
-- key derived from the user's bearer + per-user salt before PUT and
-- decrypts it after GET. We only see opaque bytes; matches the
-- local-first inference policy.
--
-- Single row per user. Updates overwrite; GET returns the latest blob.
-- No history (the local store is the source of truth).

create table if not exists memory_blobs (
  user_id    text primary key references users(id) on delete cascade,
  blob       bytea not null,
  updated_at timestamptz not null default now()
);

create index if not exists memory_blobs_updated_idx
  on memory_blobs(updated_at desc);

comment on table memory_blobs is
  'Phase 8 cloud-sync: opaque E2E-encrypted memory blobs, one per user.';
