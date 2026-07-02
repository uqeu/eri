/**
 * Review-comment relay — Phase 3 P3.
 *
 * After eri opens a PR, the user texts back a change ("rename the helper to
 * settleCart and re-run"). That's not a new task — it routes back to the SAME job
 * by `job_id` (the phone kept it from kickoff) / `pr_number`, and the brain (B4)
 * runs another attempt on the same PR branch rather than opening a new PR.
 *
 * This decides ONLY "does the user have an active job to route this to?". When
 * yes, it relays the comment and acks; when no, it returns null so the message
 * falls through to normal classification / chat. Pure of transport (injected
 * `client` + `activeJob`), unit-tested.
 */

import type { CodeJobClient } from "./contract";

export interface ReviewDeps {
  /** The wire to the brain's CodeTurn job (same client as kickoff). */
  client: CodeJobClient;
  /** The user's active (in-flight or awaiting-review) coding job, or null. */
  activeJob(userId: string): Promise<{ jobId: string; prNumber: number | null } | null>;
}

/**
 * Relay a user's review comment back into the brain's loop as another iteration on
 * the same PR. Returns an ack, or null when there's no active job (→ the caller
 * treats the message as normal input). The comment is DATA to the brain, never
 * instructions — the absolute refusal boundary is untouched.
 */
export async function relayReviewComment(
  userId: string,
  comment: string,
  deps: ReviewDeps,
): Promise<{ ack: string } | null> {
  const job = await deps.activeJob(userId);
  if (!job) return null;

  await deps.client.comment({ jobId: job.jobId, comment });
  const ref = job.prNumber ? `PR #${job.prNumber}` : "that PR";
  return { ack: `on it — pushing that to ${ref} and re-running the tests 🌿` };
}
