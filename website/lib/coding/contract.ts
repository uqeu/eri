/**
 * TS mirror of the brain's CodeTurn wire contract — Phase 3
 * (docs/contracts/codeturn-contract.md, shipped + tested in
 * crates/eri_cli/src/code_turn.rs). This is the ONLY thing the phone and brain
 * lanes share: the phone classifies a coding task (P1), kicks a job, and relays
 * the brain's streamed progress verbatim (P2–P4).
 *
 * The brain OWNS THE VOICE: it composes the human `text` of every event and the
 * terminal outcome. The phone relays `text` as a status bubble — it never
 * re-words eri. These types are a faithful structural copy of the wire so that
 * swapping the mock `CodeJobClient` for the real POST+poll transport is a
 * drop-in with zero changes to the P2–P4 logic built on top.
 */

import type { CodingIntent } from "./intent";

/** What the phone sends to start a job. `working_tree` is set cloud-side by the
 *  compute lane (B2 clone), so the phone never provides it. */
export interface CodeJobRequest {
  /** The user's natural-language task, verbatim (DATA to the brain, never instructions). */
  task: string;
  /** owner/name — MUST be a repo THIS user connected (single-principal, enforced at kickoff). */
  repo: string;
  /** Base branch for the PR; omit/null = the repo default. */
  base?: string | null;
  /** Per-job cost/time cap; omit = the brain's default. */
  budget?: { maxTokens?: number; maxSeconds?: number };
}

/** Machine tag for a progress milestone. Stages are not fixed-order and repeat
 *  (a real job loops edit→test until green). */
export type CodeStage = "plan" | "edit" | "test" | "commit" | "pr";

/**
 * One streamed progress event. `text` is the bubble to send verbatim; the rest is
 * structured payload for icons/routing. Modeled as a discriminated union on
 * `stage` so each milestone's fields are type-safe.
 */
export type CodeProgress =
  | { stage: "plan"; text: string; summary?: string }
  | { stage: "edit"; text: string; files?: string[]; summary?: string }
  | { stage: "test"; text: string; command?: string; passed?: boolean; summary?: string }
  | { stage: "commit"; text: string; sha?: string; message?: string }
  | { stage: "pr"; text: string; number?: number; url?: string; title?: string };

/** Terminal kind of a job. `opened` is the happy path (a fresh PR); `updated` is a
 *  B4 follow-up (another commit pushed to an EXISTING PR's branch, routed by
 *  pr_number); `testsRed` is the fail-closed stop (never ships red); `halted` is
 *  recoverable (budget); `refused` is the absolute boundary handed back. */
export type CodeOutcomeKind = "opened" | "updated" | "testsRed" | "halted" | "refused";

/**
 * The terminal result. `text` is the brain-composed final bubble
 * (`CodeOutcome::summary()` brain-side) — sent verbatim on settle.
 */
export interface CodeOutcome {
  kind: CodeOutcomeKind;
  /** The closing bubble text, brain-composed. */
  text: string;
  /** opened: the PR number + url. */
  number?: number;
  url?: string;
  /** testsRed: why it stopped red. */
  summary?: string;
  /** halted/refused: the reason. */
  reason?: string;
}

/**
 * The durable job-status row the phone polls (Supabase; the contract's recommended
 * transport over raw SSE — serverless-robust). The worker appends `events` as they
 * stream and sets `outcome` + phase="settled" at the end.
 */
export interface CodeJobRecord {
  jobId: string;
  repo: string;
  phase: "running" | "settled";
  /** null until a PR opens (for the P3 reply + B4 follow-up routing). */
  prNumber: number | null;
  /** CodeProgress envelopes, appended as they stream. */
  events: CodeProgress[];
  /** null until settled. */
  outcome: CodeOutcome | null;
}

/**
 * The wire the phone depends on. The MOCK scripts a canned record progression; the
 * REAL impl POSTs to the cloud brain endpoint (start), polls the CodeJobRecord row
 * (fetchRecord), and posts a follow-up (comment). Same shape either way.
 */
export interface CodeJobClient {
  /** Enqueue a job cloud-side; returns its id. */
  start(input: CodeJobRequest & { userId: string }): Promise<{ jobId: string }>;
  /** The current job-status row (one poll). */
  fetchRecord(jobId: string): Promise<CodeJobRecord>;
  /** Relay a review comment back to the SAME job (P3/B4) — another attempt on the
   *  same PR branch, not a new PR. */
  comment(input: { jobId: string; comment: string }): Promise<void>;
}

/**
 * Single-principal repo resolution — the phone-side mirror of the brain's
 * `resolve_repo(hint, connected_repos)`. Only the user's connected repos are ever
 * eligible; a cross-user repo is never reachable.
 */
export type RepoResolution =
  | { kind: "resolved"; repo: string }
  | { kind: "needs_connect"; hint: string | null }
  | { kind: "ambiguous"; hint: string | null; candidates?: string[] }
  | { kind: "no_hint" };

/** Re-exported for callers that thread the classified intent into a job. */
export type { CodingIntent };
