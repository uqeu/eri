//! Per-project git repo for eri iterations.
//!
//! Every Mercury build calls `commit_iteration`, so users get a real, browsable
//! version history — and the iteration scrubber gets a durable source of truth
//! that survives crashes and reboots. We shell out to the system `git` CLI
//! instead of pulling in libgit2 so eri stays a small, fast binary on user
//! machines and we never debug a vendored C build chain.

pub mod checkpoints;

pub use checkpoints::{
    ChangeKind, Checkpoint, CheckpointDiff, CheckpointStore, FileChange, RestoreOptions,
    RestoreReport,
};

use std::{
    path::{Path, PathBuf},
    process::{Command, Output},
};

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Marker file dropped on `git init` so we recognise our own repos and so
/// `git log` always has at least one commit reachable.
const ERI_MARKER_FILENAME: &str = ".eri-git";

const COMMITTER_NAME: &str = "eri";
const COMMITTER_EMAIL: &str = "eri@local";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommitInfo {
    pub hash: String,
    pub message: String,
    pub timestamp: i64,
}

#[derive(Debug, Error)]
pub enum GitError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("not a git repo: {0}")]
    NotARepo(PathBuf),
    #[error("git CLI not found on PATH — install with `brew install git`")]
    GitNotFound,
    #[error("git command failed ({command}): exit {exit_code}: {stderr}")]
    GitCommandFailed {
        command: String,
        exit_code: i32,
        stderr: String,
    },
}

impl GitError {
    /// True when the underlying cause is "git is not installed on this
    /// machine". Callers use this to drop into a one-time status message
    /// instead of repeating the same complaint every iteration.
    pub fn is_missing_git(&self) -> bool {
        matches!(self, GitError::GitNotFound)
    }
}

/// Ensure `project_dir/.git/` exists. Runs `git init -b main` and sets a
/// local `user.name` / `user.email` (so unconfigured machines can still
/// commit) and seeds one commit so `git log` is never empty. Idempotent.
pub fn ensure_git_repo(project_dir: &Path) -> Result<(), GitError> {
    if !project_dir.exists() {
        std::fs::create_dir_all(project_dir)?;
    }
    let git_dir = project_dir.join(".git");
    if git_dir.is_dir() {
        // Existing repo — still make sure local identity is set in case the
        // user has no global git identity. `git config --local` is idempotent.
        configure_local_identity(project_dir)?;
        return Ok(());
    }

    run_git(project_dir, &["init", "-b", "main"])?;
    configure_local_identity(project_dir)?;

    // Seed an initial commit so `git log` and `git rev-parse HEAD` work
    // before the first iteration lands. Without this, `commit_iteration`
    // on a brand new repo would have nothing to compare against and any
    // subsequent `git checkout <hash>` would fail.
    let marker = project_dir.join(ERI_MARKER_FILENAME);
    if !marker.exists() {
        std::fs::write(&marker, b"eri iteration history\n")?;
    }
    run_git(project_dir, &["add", ERI_MARKER_FILENAME])?;
    // --allow-empty handles the case where the marker existed already (e.g.
    // a stray file from a previously-deleted .git).
    run_git(project_dir, &["commit", "--allow-empty", "-m", "eri: init"])?;
    Ok(())
}

fn configure_local_identity(project_dir: &Path) -> Result<(), GitError> {
    run_git(
        project_dir,
        &["config", "--local", "user.name", COMMITTER_NAME],
    )?;
    run_git(
        project_dir,
        &["config", "--local", "user.email", COMMITTER_EMAIL],
    )?;
    Ok(())
}

/// Stage `files` and commit with `message`. Returns the new commit hash.
///
/// `files` are interpreted as paths relative to `project_dir` — they should
/// match what `auto_build_from_response` writes (e.g. `"index.html"`,
/// `"iterations/0007-mercury.html"`).
///
/// If nothing changed (Mercury produced byte-identical output to the previous
/// build), git would normally refuse to create a commit. We pass `--allow-empty`
/// so the iteration scrubber still gets a node — the timeline must be
/// contiguous with what the user spoke.
pub fn commit_iteration(
    project_dir: &Path,
    message: &str,
    files: &[&str],
) -> Result<String, GitError> {
    ensure_repo_exists(project_dir)?;

    if files.is_empty() {
        run_git(project_dir, &["add", "-A"])?;
    } else {
        let mut args = vec!["add", "--"];
        args.extend(files.iter().copied());
        run_git(project_dir, &args)?;
    }

    run_git(project_dir, &["commit", "--allow-empty", "-m", message])?;
    let hash = run_git(project_dir, &["rev-parse", "HEAD"])?;
    Ok(hash.trim().to_string())
}

/// Return up to `limit` recent commits, newest first. An empty repo with no
/// commits (shouldn't happen because `ensure_git_repo` seeds one) returns an
/// empty vec rather than erroring.
pub fn list_commits(project_dir: &Path, limit: usize) -> Result<Vec<CommitInfo>, GitError> {
    ensure_repo_exists(project_dir)?;

    // %H = full hash, %ct = committer unix timestamp, %s = subject. We use a
    // literal `\x1f` (unit separator) as the field separator so commit
    // messages containing tabs, pipes, etc. don't fool the parser.
    let format = "--pretty=format:%H%x1f%ct%x1f%s";
    let limit_arg = format!("-n{limit}");
    let output = run_git(project_dir, &["log", &limit_arg, format])?;

    let mut commits = Vec::new();
    for line in output.lines() {
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            continue;
        }
        let mut parts = line.splitn(3, '\x1f');
        let hash = match parts.next() {
            Some(hash) if !hash.is_empty() => hash.to_string(),
            _ => continue,
        };
        let timestamp = parts
            .next()
            .and_then(|raw| raw.parse::<i64>().ok())
            .unwrap_or(0);
        let message = parts.next().unwrap_or("").to_string();
        commits.push(CommitInfo {
            hash,
            message,
            timestamp,
        });
    }
    Ok(commits)
}

/// Checkout the given commit. Uses a detached HEAD checkout so the working
/// branch (usually `main`) isn't dragged backwards. The caller is responsible
/// for copying the desired file (e.g. `index.html`) into the live preview
/// path if they want a permanent revert — git's working tree will already
/// reflect the historical state at this point.
pub fn checkout_commit(project_dir: &Path, commit_hash: &str) -> Result<(), GitError> {
    ensure_repo_exists(project_dir)?;
    run_git(project_dir, &["checkout", "--detach", commit_hash])?;
    Ok(())
}

/// Return the name of the current branch, or `"HEAD"` when in a detached
/// HEAD state (after `checkout_commit`).
pub fn current_branch(project_dir: &Path) -> Result<String, GitError> {
    ensure_repo_exists(project_dir)?;
    let output = run_git(project_dir, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    Ok(output.trim().to_string())
}

/// Same as [`current_branch`] but folds a detached `HEAD` into `"main"` so the
/// PR workflow always has a real branch name to push. Use this when you need
/// a branch identifier to feed to `gh pr create` rather than to inspect the
/// scrubber's "are we on a snapshot?" state — `current_branch` is correct for
/// the latter.
pub fn current_branch_or_main(project_dir: &Path) -> Result<String, GitError> {
    let branch = current_branch(project_dir)?;
    if branch.is_empty() || branch == "HEAD" {
        Ok("main".to_string())
    } else {
        Ok(branch)
    }
}

/// Look up the configured upstream branch for the current branch — what
/// `git push` would default to, in `remote/branch` form (e.g. `origin/main`).
/// Returns `Ok(None)` when the current branch has no upstream yet (a freshly
/// created branch that's never been pushed), and propagates other git errors.
pub fn upstream_branch(project_dir: &Path) -> Result<Option<String>, GitError> {
    ensure_repo_exists(project_dir)?;
    // `@{u}` resolves to the upstream of HEAD if configured. The command
    // fails when no upstream is set; we distinguish that case via stderr
    // contents rather than blindly propagating.
    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(project_dir)
        .args(["rev-parse", "--abbrev-ref", "@{u}"]);
    let output = match command.output() {
        Ok(output) => output,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(GitError::GitNotFound);
        }
        Err(error) => return Err(GitError::Io(error)),
    };
    if output.status.success() {
        let trimmed = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if trimmed.is_empty() {
            Ok(None)
        } else {
            Ok(Some(trimmed))
        }
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        // git's "no upstream configured" message; treat as a soft None.
        if stderr.contains("no upstream configured")
            || stderr.contains("does not point to a branch")
        {
            Ok(None)
        } else {
            Err(GitError::GitCommandFailed {
                command: "git rev-parse --abbrev-ref @{u}".to_string(),
                exit_code: output.status.code().unwrap_or(-1),
                stderr,
            })
        }
    }
}

/// Produce a unified diff of the working tree at HEAD against `base_ref`
/// (e.g. `"main"`, `"origin/main"`, a commit hash). Equivalent to
/// `git diff <base>...HEAD`, so it includes everything on the current branch
/// but excludes commits already on the base.
pub fn diff_against(project_dir: &Path, base_ref: &str) -> Result<String, GitError> {
    ensure_repo_exists(project_dir)?;
    let range = format!("{base_ref}...HEAD");
    run_git(project_dir, &["diff", &range])
}

/// Push the current branch to `remote`, setting upstream tracking so future
/// `git push` calls work without arguments. Equivalent to
/// `git push -u <remote> <current-branch>`. Returns the propagated git error
/// when the push is rejected (e.g. non-fast-forward) so the caller can surface
/// it through the panel status.
pub fn push_current_branch(project_dir: &Path, remote: &str) -> Result<(), GitError> {
    ensure_repo_exists(project_dir)?;
    let branch = current_branch_or_main(project_dir)?;
    run_git(project_dir, &["push", "-u", remote, &branch])?;
    Ok(())
}

/// Create a new branch with `name` pointing at HEAD and check it out, but
/// only when `name` doesn't already exist. When the branch already exists,
/// `git switch` is used to move HEAD onto it. Idempotent — safe to call
/// multiple times for the same name.
pub fn create_branch_if_needed(project_dir: &Path, name: &str) -> Result<(), GitError> {
    ensure_repo_exists(project_dir)?;
    if name.is_empty() {
        return Err(GitError::GitCommandFailed {
            command: "git switch".to_string(),
            exit_code: -1,
            stderr: "branch name must not be empty".to_string(),
        });
    }
    // `git rev-parse --verify` returns success when the ref resolves, which is
    // a cheap way to ask "does this branch already exist?".
    let mut probe = Command::new("git");
    probe
        .arg("-C")
        .arg(project_dir)
        .args(["rev-parse", "--verify", &format!("refs/heads/{name}")]);
    let probe_output = match probe.output() {
        Ok(output) => output,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(GitError::GitNotFound);
        }
        Err(error) => return Err(GitError::Io(error)),
    };
    if probe_output.status.success() {
        run_git(project_dir, &["switch", name])?;
    } else {
        run_git(project_dir, &["switch", "-c", name])?;
    }
    Ok(())
}

/// One iteration row in the public publish payload. Mirrors the JSON shape
/// the website expects for `POST /api/publish` — `n` is the 1-based iteration
/// number parsed from the commit subject (`iter NNNN: <prompt>`), `prompt`
/// is the natural-language instruction the user spoke, `html` is the
/// `index.html` content at that commit, and `ts` is the ISO-8601 committer
/// timestamp.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IterationExport {
    pub n: u64,
    pub prompt: String,
    pub html: String,
    pub ts: String,
}

/// Walk the per-project git history and emit one `IterationExport` per
/// iteration commit, in chronological (oldest → newest) order. The seed
/// commit (`eri: init`) and any commit whose subject does not match the
/// `iter NNNN: <prompt>` shape is skipped, as are commits whose `index.html`
/// is missing at that revision — both happen when a project was created
/// but never built.
pub fn export_iterations(project_dir: &Path) -> Result<Vec<IterationExport>, GitError> {
    ensure_repo_exists(project_dir)?;

    let mut commits = list_commits(project_dir, 10_000)?;
    // list_commits is newest-first; flip to chronological order so the
    // public timeline reads top-to-bottom like the user lived it.
    commits.reverse();

    let mut out = Vec::new();
    for commit in commits {
        let Some((n, prompt)) = parse_iter_subject(&commit.message) else {
            continue;
        };
        let html = match show_file_at_commit(project_dir, &commit.hash, "index.html") {
            Ok(html) => html,
            Err(GitError::GitCommandFailed { .. }) => {
                // Commit predates the first index.html — skip it rather than
                // poisoning the export with an error. This happens for the
                // seed commit even when its subject accidentally parses.
                continue;
            }
            Err(error) => return Err(error),
        };
        out.push(IterationExport {
            n,
            prompt,
            html,
            ts: format_unix_iso8601(commit.timestamp),
        });
    }
    Ok(out)
}

/// Parse a commit subject of the form `iter NNNN: <prompt>` into its parts.
/// Returns `None` for anything else (e.g. the `eri: init` seed commit, or a
/// hand-edited commit). The leading number must be all-digit; the colon is
/// the separator we wrote when committing.
fn parse_iter_subject(subject: &str) -> Option<(u64, String)> {
    let rest = subject.strip_prefix("iter ")?;
    let (number, prompt) = rest.split_once(':')?;
    let n = number.trim().parse::<u64>().ok()?;
    let prompt = prompt.trim().to_string();
    Some((n, prompt))
}

fn show_file_at_commit(
    project_dir: &Path,
    commit_hash: &str,
    relative_path: &str,
) -> Result<String, GitError> {
    let target = format!("{commit_hash}:{relative_path}");
    run_git(project_dir, &["show", &target])
}

/// Format a Unix epoch second as an ISO-8601 UTC timestamp without pulling
/// in a `chrono`/`time` dep. Negative or absurd values fall back to the
/// epoch — the timestamp is informational on the website, never load-bearing.
fn format_unix_iso8601(unix_seconds: i64) -> String {
    let secs = if unix_seconds < 0 {
        0
    } else {
        unix_seconds as u64
    };
    let days_since_epoch = (secs / 86_400) as i64;
    let seconds_in_day = secs % 86_400;
    let hour = (seconds_in_day / 3600) as u32;
    let minute = ((seconds_in_day % 3600) / 60) as u32;
    let second = (seconds_in_day % 60) as u32;
    let (year, month, day) = days_to_ymd(days_since_epoch);
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

/// Convert days since the Unix epoch (1970-01-01) to a Gregorian (Y, M, D).
/// Adapted from Howard Hinnant's date algorithms (public-domain).
fn days_to_ymd(days_since_epoch: i64) -> (i32, u32, u32) {
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = doy - (153 * mp + 2) / 5 + 1; // [1, 31]
    let m_signed: i64 = mp as i64 + if mp < 10 { 3 } else { -9 }; // [1, 12]
    let year = (y + if m_signed <= 2 { 1 } else { 0 }) as i32;
    (year, m_signed as u32, d as u32)
}

pub(crate) fn ensure_repo_exists(project_dir: &Path) -> Result<(), GitError> {
    if project_dir.join(".git").is_dir() {
        Ok(())
    } else {
        Err(GitError::NotARepo(project_dir.to_path_buf()))
    }
}

pub(crate) fn run_git(project_dir: &Path, args: &[&str]) -> Result<String, GitError> {
    let mut command = Command::new("git");
    command.arg("-C").arg(project_dir).args(args);
    let output = match command.output() {
        Ok(output) => output,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(GitError::GitNotFound);
        }
        Err(error) => return Err(GitError::Io(error)),
    };
    check_status(&output, args)
}

fn check_status(output: &Output, args: &[&str]) -> Result<String, GitError> {
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Err(GitError::GitCommandFailed {
            command: format!("git {}", args.join(" ")),
            exit_code: output.status.code().unwrap_or(-1),
            stderr,
        })
    }
}
