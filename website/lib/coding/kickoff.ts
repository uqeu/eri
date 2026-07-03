/**
 * Coding-job kickoff — Phase 3 P2 (start) + P4 (connect-flow).
 *
 * A classified coding intent (P1) becomes a real CodeTurn job here: resolve the
 * repo single-principally, start the job cloud-side, and return the instant ack to
 * text back ("never go silent"). Repo resolution mirrors the brain's
 * `resolve_repo` (codeturn-contract.md): only the user's connected repos are ever
 * eligible — an unlinked repo yields the P4 connect prompt, an unclear one asks.
 *
 * Pure of transport: the actual POST/clone/sandbox lives behind the injected
 * `CodeJobClient` + `resolveRepo`, so this decision logic is unit-tested with a
 * scripted client. Streaming the job's progress is `streamJob` (./stream); this is
 * only the kickoff turn.
 */

import type { CodeJobClient, CodingIntent, RepoResolution } from "./contract";

export interface KickoffDeps {
  /** The wire to the brain's CodeTurn job (mock now, real POST later). */
  client: CodeJobClient;
  /** Single-principal repo resolution — only the user's connected repos are eligible. */
  resolveRepo(userId: string, hint: string | null): Promise<RepoResolution>;
  /** Build a connect-GitHub URL for the user to link the (unlinked) repo (P4). */
  connectUrl(userId: string, hint: string | null): Promise<string>;
}

export type KickoffResult =
  | { kind: "started"; jobId: string; repo: string; ack: string }
  | { kind: "needs_connect"; ack: string }
  | { kind: "ask"; ack: string };

/**
 * Start a coding job for a classified intent, or return the connect/ask prompt.
 *
 * - `resolved`  → start the job cloud-side, return `{ started, jobId, ack }`. The
 *   ack is a phone-composed INSTANT receipt (the brain owns all subsequent
 *   engineering narration, streamed verbatim by `streamJob`).
 * - `needs_connect` → prompt to connect GitHub (P4); the job is NOT started, so an
 *   unlinked/cross-user repo is never touched.
 * - `ambiguous` / `no_hint` → ask which repo; the job is NOT started.
 */
export async function startCodingJob(
  userId: string,
  intent: CodingIntent,
  deps: KickoffDeps,
): Promise<KickoffResult> {
  const resolution = await deps.resolveRepo(userId, intent.repo);

  if (resolution.kind === "resolved") {
    const { jobId } = await deps.client.start({ userId, task: intent.task, repo: resolution.repo });
    return {
      kind: "started",
      jobId,
      repo: resolution.repo,
      ack: `on it 🌿 — starting on ${resolution.repo}. i'll text you as it goes.`,
    };
  }

  if (resolution.kind === "needs_connect") {
    const url = await deps.connectUrl(userId, resolution.hint);
    const name = resolution.hint ? `\`${resolution.hint}\`` : "that repo";
    return {
      kind: "needs_connect",
      ack: `happy to — i just need access to ${name} first. connect GitHub here and i'll get started:\n\n${url}`,
    };
  }

  // ambiguous or no_hint → ask (don't guess a repo; single-principal + no surprises).
  const question =
    resolution.kind === "ambiguous"
      ? "which repo should i work in?"
      : "which repo is this for?";
  return { kind: "ask", ack: `happy to — ${question}` };
}
