/**
 * CodeJobRecord persistence — Phase 3 (the durable job-status rows the phone
 * polls, per the contract). The worker appends events as `eri code-job` streams;
 * the phone reads the row and texts each new event as a bubble.
 *
 * The interface is what the worker + client + relay depend on (mocked in tests);
 * `sqlCodeJobStore` is the thin postgres-backed impl over the `code_jobs` table
 * (migration 0032). Server-owned (RLS-on-no-policies).
 */

import { sql } from "@/lib/db";
import type { CodeJobRecord, CodeOutcome, CodeProgress } from "./contract";

export interface CodeJobStore {
  create(input: { jobId: string; userId: string; repo: string; task: string }): Promise<void>;
  appendEvent(jobId: string, event: CodeProgress): Promise<void>;
  setPrNumber(jobId: string, prNumber: number): Promise<void>;
  settle(jobId: string, outcome: CodeOutcome, prNumber: number | null): Promise<void>;
  read(jobId: string): Promise<CodeJobRecord | null>;
  /** Server-internal owner info for follow-up routing (userId isn't on the wire record). */
  owner(jobId: string): Promise<{ userId: string; repo: string; prNumber: number | null } | null>;
  /** The user's active (running) job, if any — for the P3 review-comment relay. */
  activeJob(userId: string): Promise<{ jobId: string; prNumber: number | null } | null>;
  /** Relay cursor: how many events have already been texted to the user as bubbles. */
  markBubblesSent(jobId: string, sent: number): Promise<void>;
}

interface Row {
  job_id: string;
  repo: string;
  phase: "running" | "settled";
  pr_number: number | null;
  events: CodeProgress[] | null;
  outcome: CodeOutcome | null;
}

function toRecord(row: Row): CodeJobRecord {
  return {
    jobId: row.job_id,
    repo: row.repo,
    phase: row.phase,
    prNumber: row.pr_number,
    events: row.events ?? [],
    outcome: row.outcome ?? null,
  };
}

/** Postgres-backed store over `code_jobs` (migration 0032). */
export function sqlCodeJobStore(): CodeJobStore {
  return {
    create: async ({ jobId, userId, repo, task }) => {
      await sql()`
        INSERT INTO code_jobs (job_id, user_id, repo, task, phase, events)
        VALUES (${jobId}, ${userId}, ${repo}, ${task}, 'running', '[]'::jsonb)
        ON CONFLICT (job_id) DO NOTHING
      `;
    },
    appendEvent: async (jobId, event) => {
      await sql()`
        UPDATE code_jobs
        SET events = events || ${JSON.stringify(event)}::jsonb, updated_at = now()
        WHERE job_id = ${jobId}
      `;
    },
    setPrNumber: async (jobId, prNumber) => {
      await sql()`UPDATE code_jobs SET pr_number = ${prNumber}, updated_at = now() WHERE job_id = ${jobId}`;
    },
    settle: async (jobId, outcome, prNumber) => {
      await sql()`
        UPDATE code_jobs
        SET phase = 'settled', outcome = ${JSON.stringify(outcome)}::jsonb,
            pr_number = COALESCE(${prNumber}, pr_number), settled_at = now(), updated_at = now()
        WHERE job_id = ${jobId}
      `;
    },
    read: async (jobId) => {
      const rows = await sql()<Row[]>`
        SELECT job_id, repo, phase, pr_number, events, outcome FROM code_jobs WHERE job_id = ${jobId}
      `;
      return rows[0] ? toRecord(rows[0]) : null;
    },
    owner: async (jobId) => {
      const rows = await sql()<{ user_id: string; repo: string; pr_number: number | null }[]>`
        SELECT user_id, repo, pr_number FROM code_jobs WHERE job_id = ${jobId}
      `;
      const r = rows[0];
      return r ? { userId: r.user_id, repo: r.repo, prNumber: r.pr_number } : null;
    },
    activeJob: async (userId) => {
      const rows = await sql()<{ job_id: string; pr_number: number | null }[]>`
        SELECT job_id, pr_number FROM code_jobs
        WHERE user_id = ${userId} AND phase = 'running'
        ORDER BY created_at DESC LIMIT 1
      `;
      const r = rows[0];
      return r ? { jobId: r.job_id, prNumber: r.pr_number } : null;
    },
    markBubblesSent: async (jobId, sent) => {
      await sql()`UPDATE code_jobs SET bubbles_sent = ${sent}, updated_at = now() WHERE job_id = ${jobId}`;
    },
  };
}
