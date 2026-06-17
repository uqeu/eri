-- 0024_learned_facts_embeddings — semantic recall for learned_facts (the #1 SOTA gap).
--
-- Lexical-only retrieval (0023's fact_tsv) can't match paraphrases: "my dog"
-- never surfaces a stored fact about "Bella". This adds a pgvector embedding so
-- recall becomes HYBRID — the existing fact_tsv lexical search UNION a cosine
-- vector search, fused with Reciprocal Rank Fusion (see lib/agent/memory_recall.ts).
--
-- Embeddings are Voyage voyage-3.5-lite (1024 dims; Anthropic's recommended
-- embeddings provider — Claude has no embeddings API). The column is NULLABLE
-- on purpose: if VOYAGE_API_KEY is unset (or an embed call fails) the fact is
-- still stored with a NULL embedding and lexical retrieval keeps working — memory
-- degrades to lexical-only, it never breaks. Existing rows start NULL (backfill
-- lazily on next access, or via a one-off script — see the route integration notes).
--
-- Because every query is prefiltered by user_id, the ANN scan only ever covers one
-- person's slice (tens–hundreds of rows), so this stays well under 100ms.

create extension if not exists vector;

alter table learned_facts
  add column if not exists embedding vector(1024);

-- HNSW for cosine distance (<=>). pgvector README: HNSW has the best speed/recall
-- tradeoff and is the 2026 default for RAG. Rows with NULL embeddings are simply
-- skipped by the vector query (WHERE embedding IS NOT NULL), so a partly-backfilled
-- table is fine. m/ef_construction left at HNSW defaults (16 / 64).
create index if not exists learned_facts_embedding_hnsw_idx
  on learned_facts using hnsw (embedding vector_cosine_ops);
