-- 0023_learned_facts_categorized — "brain sections" + relevance retrieval.
--
-- eri should remember EVERYTHING about a person and never make them repeat it,
-- while staying fast. The trick (the mem0/Zep/supermemory pattern, built native):
-- categorize each fact and retrieve only the slice RELEVANT to the current
-- message — talk games → games facts surface; talk work → work facts surface —
-- plus identity + recent, always. This scales to thousands of facts because we
-- never dump them all into the prompt.
--
-- v1 retrieval = Postgres full-text search (built in, no new keys/cost). A future
-- migration can add a pgvector embedding column for semantic recall.

-- A coarse "section" the fact belongs to (games / work / people / chores / health
-- / preferences / general). Assigned by eri when it saves the fact.
alter table learned_facts add column if not exists category text not null default 'general';

-- Full-text vector over the fact text, maintained automatically, for ranked
-- relevance retrieval against the incoming message.
alter table learned_facts
  add column if not exists fact_tsv tsvector
  generated always as (to_tsvector('english', fact)) stored;

create index if not exists learned_facts_tsv_idx on learned_facts using gin (fact_tsv);
create index if not exists learned_facts_user_category_idx on learned_facts (user_id, category);
