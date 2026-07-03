/**
 * The real `CodeJobClient` — Phase 3. Swaps the test mock for the store-backed
 * wire: `start` mints a job + kicks the worker, `fetchRecord` polls the row,
 * `comment` routes a review comment back to the SAME job as an `--update-pr`
 * follow-up (B4). The `kick` seam fires the worker fast (waitUntil / internal
 * POST) so the caller (the phone kickoff) returns immediately. Pure of transport;
 * unit-tested with a mock store + kick.
 */

import type { CodeJobClient } from "./contract";
import type { CodeJobStore } from "./job_store";
import type { RunCodeJobInput } from "./worker";

export interface CodeClientDeps {
  store: CodeJobStore;
  /** Mint a unique job id (`job_...`). */
  mintJobId(): string;
  /** Fire the worker for this job and return immediately (waitUntil / internal POST). */
  kick(input: RunCodeJobInput): Promise<void>;
}

function prUrl(repo: string, number: number): string {
  return `https://github.com/${repo}/pull/${number}`;
}

export function makeCodeJobClient(deps: CodeClientDeps): CodeJobClient {
  return {
    start: async ({ userId, task, repo, base, budget }) => {
      const jobId = deps.mintJobId();
      await deps.store.create({ jobId, userId, repo, task });
      await deps.kick({ jobId, userId, repo, task, base, budget });
      return { jobId };
    },
    fetchRecord: async (jobId) => {
      const rec = await deps.store.read(jobId);
      if (!rec) throw new Error(`code job ${jobId} not found`);
      return rec;
    },
    comment: async ({ jobId, comment }) => {
      const owner = await deps.store.owner(jobId);
      if (!owner) throw new Error(`code job ${jobId} not found`);
      // Same job, another attempt on the SAME PR branch — never a new PR.
      await deps.kick({
        jobId,
        userId: owner.userId,
        repo: owner.repo,
        task: comment,
        updatePr: owner.prNumber ? { number: owner.prNumber, url: prUrl(owner.repo, owner.prNumber) } : null,
      });
    },
  };
}
