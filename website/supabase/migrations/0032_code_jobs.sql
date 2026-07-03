-- Coding-job status rows (Phase 3). The worker runs `eri code-job` in a Vercel
-- Sandbox and appends each streamed CodeProgress here; the phone polls the row and
-- texts each new event as a bubble. See docs/contracts/codeturn-contract.md.
CREATE TABLE IF NOT EXISTS code_jobs (
  job_id       text PRIMARY KEY,               -- job_<random>
  user_id      uuid NOT NULL,                  -- single-principal owner
  repo         text NOT NULL,                  -- resolved owner/name
  task         text NOT NULL,                  -- the user's task (verbatim; follow-up context)
  phase        text NOT NULL DEFAULT 'running',-- 'running' | 'settled'
  pr_number    integer,                        -- null until a PR opens (P3 reply / B4 routing)
  events       jsonb NOT NULL DEFAULT '[]'::jsonb, -- CodeProgress[] appended as they stream
  outcome      jsonb,                          -- CodeOutcome, null until settled
  bubbles_sent integer NOT NULL DEFAULT 0,     -- relay cursor: events already texted as bubbles
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  settled_at   timestamptz
);

-- Find a user's active job (P3 review-comment relay) + the streaming relay's scan.
CREATE INDEX IF NOT EXISTS code_jobs_user_phase_idx ON code_jobs (user_id, phase);
CREATE INDEX IF NOT EXISTS code_jobs_running_idx ON code_jobs (phase) WHERE phase = 'running';

-- Server-owned: RLS on with no policies = no client (anon/authed) access.
ALTER TABLE code_jobs ENABLE ROW LEVEL SECURITY;
