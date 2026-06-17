-- 0026_learned_facts_supersede — consolidation for cloud memory (P6).
--
-- mem0/Zep: when the user updates a durable fact ("favourite colour is blue" →
-- "...is green", "lives in Toronto" → "...in Vancouver"), eri must not carry BOTH.
-- We invalidate-don't-delete: a newer fact in the same category that's
-- semantically near an older one marks the older `superseded_at` (kept for
-- history, hidden from recall). Newer wins by temporal precedence.
--
-- Nullable + indexed; all recall queries filter `superseded_at IS NULL`.

alter table learned_facts add column if not exists superseded_at timestamptz;

create index if not exists learned_facts_active_idx
  on learned_facts (user_id) where superseded_at is null;
