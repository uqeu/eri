/**
 * Build the `eri code-job` argv — Phase 3 worker (mini-contract in
 * docs/contracts/codeturn-contract.md).
 *
 *   eri code-job --task <t> --repo <path> [--slug owner/name] [--base <b>]
 *     [--test-cmd <c>] [--budget-tokens N] [--budget-seconds M]
 *     [--update-pr N --update-pr-url <url>]
 *
 * Returned as an argv ARRAY (never a shell string) — the sandbox runs the `eri`
 * binary with these args, so the task text needs no escaping and can't inject
 * shell. Pure + unit-tested.
 */

export interface CodeJobArgs {
  /** The user's coding task, verbatim (DATA to the brain). */
  task: string;
  /** Path to the cloned working tree inside the sandbox (`--repo`). */
  workingTree: string;
  /** owner/name; omit to let code-job derive it from the origin remote. */
  slug?: string | null;
  /** Base branch for the PR; omit for the repo default. */
  base?: string | null;
  /** Test command; omit to let code-job detect (cargo/npm/pytest/go). */
  testCmd?: string | null;
  budgetTokens?: number;
  budgetSeconds?: number;
  /** B4 follow-up: push to an existing PR instead of opening a new one. */
  updatePr?: { number: number; url: string } | null;
}

/** The argv for `eri` (first element is the subcommand `code-job`). */
export function buildCodeJobArgv(args: CodeJobArgs): string[] {
  const argv = ["code-job", "--task", args.task, "--repo", args.workingTree];
  if (args.slug) argv.push("--slug", args.slug);
  if (args.base) argv.push("--base", args.base);
  if (args.testCmd) argv.push("--test-cmd", args.testCmd);
  if (typeof args.budgetTokens === "number") argv.push("--budget-tokens", String(args.budgetTokens));
  if (typeof args.budgetSeconds === "number") argv.push("--budget-seconds", String(args.budgetSeconds));
  if (args.updatePr) argv.push("--update-pr", String(args.updatePr.number), "--update-pr-url", args.updatePr.url);
  return argv;
}
