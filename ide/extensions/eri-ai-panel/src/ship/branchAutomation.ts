// Branch automation for /ship — runs after a successful apply so the
// shipped commit lands on a dedicated branch like `eri/ship-add-stripe-checkout`.
// The user can then open a PR via `gh pr create` (auto-attempted when
// the `gh` binary is on PATH).
//
// Opt-in: the `eri.ship.autoBranch` setting defaults to false so a
// stable workflow that doesn't want a fresh branch per ship isn't
// surprised.

import { spawn } from "node:child_process";

/**
 * Slugify the user's ship instructions into a short, git-safe branch
 * suffix. Keeps lowercase ASCII + digits + hyphens, drops everything
 * else, caps at 50 chars. Always returns at least one character —
 * falls back to `"ship"` so the branch name is never empty.
 */
export function slugifyInstructions(instructions: string): string {
  const lower = instructions.toLowerCase();
  const clean = lower
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  const trimmed = clean.slice(0, 50).replace(/-+$/, "");
  return trimmed.length > 0 ? trimmed : "ship";
}

/**
 * Compose the full branch name. Adds a 4-char timestamp suffix so two
 * ships of the same intent in one session don't collide.
 */
export function branchName(instructions: string): string {
  const slug = slugifyInstructions(instructions);
  const stamp = Math.floor(Date.now() / 1000)
    .toString(36)
    .slice(-4);
  return `eri/ship-${slug}-${stamp}`;
}

export interface BranchAutomationDeps {
  readonly workspaceRoot: string;
}

/**
 * Switch the workspace to a new branch (created from HEAD) named after
 * the ship instructions. Returns the branch name on success, or `null`
 * when the workspace isn't a git repo / `git` isn't on PATH.
 *
 * Spawns `git` via execFile to avoid any shell-injection surface.
 */
export async function switchToShipBranch(
  deps: BranchAutomationDeps,
  instructions: string,
): Promise<string | null> {
  const name = branchName(instructions);
  const ok = await runGit(deps.workspaceRoot, ["switch", "-c", name]);
  return ok ? name : null;
}

/**
 * Attempt `gh pr create --fill --web`. Returns true when `gh` is on
 * PATH and exits cleanly; false otherwise. The web flag opens the
 * pre-filled draft in the user's browser so they review before
 * publishing.
 */
export async function openPullRequest(
  deps: BranchAutomationDeps,
): Promise<boolean> {
  return runBinary("gh", ["pr", "create", "--fill", "--web"], deps.workspaceRoot);
}

async function runGit(cwd: string, args: ReadonlyArray<string>): Promise<boolean> {
  return runBinary("git", args, cwd);
}

function runBinary(
  binary: string,
  args: ReadonlyArray<string>,
  cwd: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    try {
      const child = spawn(binary, [...args], { cwd, stdio: "ignore" });
      child.on("error", () => finish(false));
      child.on("exit", (code) => finish(code === 0));
    } catch {
      finish(false);
    }
  });
}
