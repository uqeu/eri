-- 0025_embedding_cache — cache embeddings by text so we don't re-embed repeats.
--
-- The same query ("what's the weather") and the same fact get embedded over and
-- over. Embeddings are deterministic for identical text, so we cache them keyed
-- by a hash of the normalized text. A cache hit skips the Voyage API call
-- entirely (cheaper AND faster than the round-trip). Shared across users — the
-- vector for a given string is identical regardless of who asked.
--
-- Server-owned (service-role only): RLS on, no policies.

create table if not exists embedding_cache (
  text_hash   text primary key,
  embedding   vector(1024) not null,
  created_at  timestamptz not null default now()
);

alter table embedding_cache enable row level security;
