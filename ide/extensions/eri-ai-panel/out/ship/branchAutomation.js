"use strict";
// Branch automation for /ship — runs after a successful apply so the
// shipped commit lands on a dedicated branch like `eri/ship-add-stripe-checkout`.
// The user can then open a PR via `gh pr create` (auto-attempted when
// the `gh` binary is on PATH).
//
// Opt-in: the `eri.ship.autoBranch` setting defaults to false so a
// stable workflow that doesn't want a fresh branch per ship isn't
// surprised.
Object.defineProperty(exports, "__esModule", { value: true });
exports.slugifyInstructions = slugifyInstructions;
exports.branchName = branchName;
exports.switchToShipBranch = switchToShipBranch;
exports.openPullRequest = openPullRequest;
const node_child_process_1 = require("node:child_process");
/**
 * Slugify the user's ship instructions into a short, git-safe branch
 * suffix. Keeps lowercase ASCII + digits + hyphens, drops everything
 * else, caps at 50 chars. Always returns at least one character —
 * falls back to `"ship"` so the branch name is never empty.
 */
function slugifyInstructions(instructions) {
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
function branchName(instructions) {
    const slug = slugifyInstructions(instructions);
    const stamp = Math.floor(Date.now() / 1000)
        .toString(36)
        .slice(-4);
    return `eri/ship-${slug}-${stamp}`;
}
/**
 * Switch the workspace to a new branch (created from HEAD) named after
 * the ship instructions. Returns the branch name on success, or `null`
 * when the workspace isn't a git repo / `git` isn't on PATH.
 *
 * Spawns `git` via execFile to avoid any shell-injection surface.
 */
async function switchToShipBranch(deps, instructions) {
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
async function openPullRequest(deps) {
    return runBinary("gh", ["pr", "create", "--fill", "--web"], deps.workspaceRoot);
}
async function runGit(cwd, args) {
    return runBinary("git", args, cwd);
}
function runBinary(binary, args, cwd) {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (ok) => {
            if (settled)
                return;
            settled = true;
            resolve(ok);
        };
        try {
            const child = (0, node_child_process_1.spawn)(binary, [...args], { cwd, stdio: "ignore" });
            child.on("error", () => finish(false));
            child.on("exit", (code) => finish(code === 0));
        }
        catch {
            finish(false);
        }
    });
}
//# sourceMappingURL=branchAutomation.js.map