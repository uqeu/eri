-- Mercury (diffusion) turn counter — per-tier rate limit independent of
-- the frontier token bucket. Mercury is `bill: false`, so it never touches
-- tokens_used / tokens_included; this column gates the per-tier turn cap
-- from lib/tiers.ts::MERCURY_TURN_LIMITS.

alter table token_buckets
  add column if not exists mercury_turns_used integer not null default 0;

-- Reset Mercury counter at the same monthly boundary as tokens_used. The
-- existing upsertTokenBucket() ON CONFLICT path zeros tokens_used + warned_at
-- on period rollover; mirror that for mercury_turns_used by patching the
-- helper in lib/inference/db.ts.
