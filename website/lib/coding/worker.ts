/**
 * The coding-job worker — Phase 3. The THIN host around `eri code-job`: the whole
 * edit→test→green→commit→PR loop, the retries, and the fail-closed gate live in
 * Rust behind ONE command (docs/contracts/codeturn-contract.md). This just runs
 * it in a sandbox and forwards its streamed JSONL into the CodeJobRecord row.
 *
 * NO loop logic in TS. `runSandbox` (the Vercel Sandbox adapter) owns the sandbox
 * lifecycle — create, inject GITHUB_TOKEN, clone, run `eri`, yield stdout lines,
 * tear down. This orchestration (parse → append → settle) is pure of the sandbox
 * and unit-tested with a scripted stdout stream.
 */

import { buildCodeJobArgv } from "./argv";
import { parseJsonlLine } from "./jsonl";
import type { CodeJobStore } from "./job_store";
import type { CodeOutcome } from "./contract";

/** Where the repo is cloned inside the sandbox (`--repo`), per the contract. */
export const SANDBOX_CLONE_DIR = "/sandbox/clone";

export interface RunCodeJobInput {
  jobId: string;
  userId: string;
  /** Resolved owner/name (single-principal — set at the phone kickoff). */
  repo: string;
  task: string;
  base?: string | null;
  testCmd?: string | null;
  budget?: { maxTokens?: number; maxSeconds?: number };
  /** B4 follow-up: push to an existing PR instead of opening a new one. */
  updatePr?: { number: number; url: string } | null;
}

export interface RunSandboxInput {
  repo: string;
  /** The user's GitHub token — injected ONCE into the sandbox env as GITHUB_TOKEN. */
  githubToken: string;
  cloneDir: string;
  /** argv for the `eri` binary (first element is `code-job`). */
  argv: string[];
  base?: string | null;
  updatePr?: { number: number; url: string } | null;
}

export interface WorkerDeps {
  store: CodeJobStore;
  /** The user's connected GitHub OAuth token; null → can't clone (fail-safe). */
  githubToken(userId: string): Promise<string | null>;
  /** Spin the sandbox, clone, run `eri`, yield stdout lines, tear down. */
  runSandbox(input: RunSandboxInput): AsyncIterable<string>;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Run one coding job to completion: forward the harness's streamed JSONL into the
 * job row and settle it. Returns the terminal outcome. Fail-safe: no token, a
 * sandbox error, or a stream that ends without a terminal line all settle the job
 * (as `halted`) rather than leaving it stuck `running`.
 */
export async function runCodeJob(input: RunCodeJobInput, deps: WorkerDeps): Promise<CodeOutcome | null> {
  const token = await deps.githubToken(input.userId);
  if (!token) {
    const outcome: CodeOutcome = {
      kind: "halted",
      text: "i couldn't reach your GitHub — reconnect it and try again 🌿",
      reason: "no github token",
    };
    await deps.store.settle(input.jobId, outcome, input.updatePr?.number ?? null);
    return outcome;
  }

  const argv = buildCodeJobArgv({
    task: input.task,
    workingTree: SANDBOX_CLONE_DIR,
    slug: input.repo,
    base: input.base,
    testCmd: input.testCmd,
    budgetTokens: input.budget?.maxTokens,
    budgetSeconds: input.budget?.maxSeconds,
    updatePr: input.updatePr,
  });

  let prNumber: number | null = input.updatePr?.number ?? null;
  let outcome: CodeOutcome | null = null;
  try {
    for await (const line of deps.runSandbox({
      repo: input.repo,
      githubToken: token,
      cloneDir: SANDBOX_CLONE_DIR,
      argv,
      base: input.base,
      updatePr: input.updatePr,
    })) {
      const parsed = parseJsonlLine(line);
      if (!parsed) continue;
      if (parsed.kind === "progress") {
        await deps.store.appendEvent(input.jobId, parsed.event);
        if (parsed.event.stage === "pr" && typeof parsed.event.number === "number") {
          prNumber = parsed.event.number;
          await deps.store.setPrNumber(input.jobId, prNumber);
        }
      } else {
        outcome = parsed.outcome;
        if (typeof parsed.outcome.number === "number") prNumber = parsed.outcome.number;
      }
    }
  } catch (err) {
    outcome = {
      kind: "halted",
      text: "something went wrong running that job — i've stopped it. try again in a bit 🌿",
      reason: errMsg(err),
    };
  }

  if (!outcome) {
    outcome = {
      kind: "halted",
      text: "that job ended before finishing — i've stopped it 🌿",
      reason: "stream ended without a terminal outcome",
    };
  }
  await deps.store.settle(input.jobId, outcome, prNumber);
  return outcome;
}
