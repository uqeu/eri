/**
 * Vercel Sandbox adapter — Phase 3 worker (the `runSandbox` seam).
 *
 * Spins a Vercel Sandbox, injects the user's GITHUB_TOKEN ONCE, clones the repo
 * (token in the remote so `git push` reuses it), runs `eri code-job` detached, and
 * yields its stdout lines. Diagnostics (stderr) are skipped — stdout is the clean
 * JSONL stream the worker parses. Tears the sandbox down in `finally`.
 *
 * `@vercel/sandbox` is loaded via a dynamic import so the rest of the app typechecks
 * and builds WITHOUT the package present locally; it resolves at deploy (add
 * `@vercel/sandbox` to dependencies). This only runs behind the ERI_CODEJOB_ENABLED
 * kill-switch, so it never executes until the operator turns the feature on.
 * DEPLOY-VERIFY: confirm the LogLine field names against the installed SDK version.
 */

import type { RunSandboxInput } from "./worker";

interface LogLine {
  stream?: string;
  data?: unknown;
  bytes?: unknown;
}
interface DetachedCommand {
  logs(): AsyncIterable<LogLine>;
  wait(): Promise<{ exitCode: number }>;
}
interface FinishedCommand {
  exitCode: number;
}
interface SandboxInstance {
  runCommand(params: {
    cmd: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    detached?: boolean;
  }): Promise<FinishedCommand | DetachedCommand>;
  stop(): Promise<void>;
}
interface SandboxSdk {
  create(opts: { runtime?: string; env?: Record<string, string>; timeout?: number }): Promise<SandboxInstance>;
}

/** Decode a LogLine's payload to text across the SDK's possible field shapes. */
function logText(line: LogLine): string {
  const raw = line.data ?? line.bytes;
  if (typeof raw === "string") return raw;
  if (raw && typeof (raw as { toString?: unknown }).toString === "function") return String(raw);
  return "";
}

/** The real Vercel Sandbox implementation of `runSandbox` (clone → run → stream). */
export async function* vercelSandboxRun(input: RunSandboxInput): AsyncIterable<string> {
  // Dynamic + type-erased so tsc/build don't need the package locally.
  const mod = (await import(/* @vite-ignore */ "@vercel/sandbox" as string)) as { Sandbox: SandboxSdk };
  const sandbox = await mod.Sandbox.create({
    runtime: "node24",
    // Injected ONCE — the clone remote carries it (push reuses it) and
    // GitHubPrAuthor::from_token reads it. Never logged, never in chat.
    env: { GITHUB_TOKEN: input.githubToken },
    timeout: 15 * 60 * 1000,
  });
  try {
    const cloneUrl = `https://x-access-token:${input.githubToken}@github.com/${input.repo}.git`;
    const clone = (await sandbox.runCommand({
      cmd: "git",
      args: ["clone", "--depth", "50", cloneUrl, input.cloneDir],
    })) as FinishedCommand;
    if (clone.exitCode !== 0) throw new Error(`git clone failed for ${input.repo} (exit ${clone.exitCode})`);

    const cmd = (await sandbox.runCommand({
      cmd: "eri",
      args: input.argv,
      cwd: input.cloneDir,
      detached: true,
    })) as DetachedCommand;

    // Reassemble stdout into whole lines (a chunk may split a JSONL line).
    let buf = "";
    for await (const line of cmd.logs()) {
      if (line.stream && line.stream !== "stdout") continue;
      buf += logText(line);
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        yield buf.slice(0, nl);
        buf = buf.slice(nl + 1);
      }
    }
    if (buf.trim()) yield buf;
    await cmd.wait();
  } finally {
    await sandbox.stop().catch(() => {});
  }
}
