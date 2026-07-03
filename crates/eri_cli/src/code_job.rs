//! `eri code-job` — run the WHOLE CodeTurn loop in Rust, stream CodeProgress as
//! JSONL to stdout. This is the mini-contract with the cloud worker (Vercel
//! Function): the Function is a THIN host — spin the sandbox, inject the user's
//! GitHub token as `GITHUB_TOKEN`, run this ONE command, and forward its stdout,
//! writing each JSONL line to a `CodeJobRecord` row the phone polls. The retry/
//! feedback loop, the fail-closed gate, and the PR call all stay inside Rust; the
//! Function never drives per-step.
//!
//! stdout is JSONL, one object per line:
//!   - **progress** lines carry `stage` (plan/edit/test/commit/pr) — `CodeProgress::wire()`
//!   - the **final** line carries `kind` (opened/updated/testsRed/halted/refused) —
//!     `CodeOutcome::wire()`
//!
//! The worker discriminates on `stage` vs `kind`. Nothing else is written to
//! stdout (diagnostics go to stderr).
//!
//! `dead_code` allowed module-wide (matching the family) for the test-only bits.
#![allow(dead_code)]

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use anyhow::{Result, anyhow, bail};
use async_trait::async_trait;

use crate::code_pr::{FollowUpPrAuthor, GitHubPrAuthor};
use crate::code_sandbox::{
    Committer, Harness, HarnessAttempt, PrAuthor, SandboxCodeTurn, ShellTestRunner,
};
use crate::code_turn::{CodeBudget, CodeJob, CodeProgress, CodeProgressSink, CodeTurn};

/// Hard cap on edit→test attempts inside one job (a runaway backstop; the token
/// budget also bounds it).
const MAX_ATTEMPTS: usize = 4;

/// A [`CodeProgressSink`] that writes each event's wire envelope as one JSON line
/// to `W` (stdout in production). Line-buffered + flushed so the worker streams
/// milestones live.
pub struct JsonlProgressSink<W: Write + Send> {
    out: Mutex<W>,
}

impl<W: Write + Send> JsonlProgressSink<W> {
    pub fn new(out: W) -> Self {
        Self {
            out: Mutex::new(out),
        }
    }
    /// Recover the underlying writer (tests read back what was written).
    pub fn into_inner(self) -> W {
        self.out.into_inner().unwrap()
    }
}

impl<W: Write + Send> CodeProgressSink for JsonlProgressSink<W> {
    fn emit(&self, event: &CodeProgress) {
        let mut w = self.out.lock().unwrap();
        // Best-effort: a broken stdout pipe must not panic the job loop.
        let _ = writeln!(w, "{}", event.wire());
        let _ = w.flush();
    }
}

/// Detect the repo's test command from marker files. `None` → the caller must
/// pass `--test-cmd` (fail-closed can't run without a test command).
pub fn detect_test_command(repo: &Path) -> Option<String> {
    let has = |f: &str| repo.join(f).exists();
    if has("Cargo.toml") {
        Some("cargo test".into())
    } else if has("package.json") {
        Some("npm test".into())
    } else if has("pyproject.toml") || has("pytest.ini") || has("setup.py") {
        Some("pytest".into())
    } else if has("go.mod") {
        Some("go test ./...".into())
    } else {
        None
    }
}

/// Parse an `owner/name` slug out of a GitHub remote URL (https or SSH form,
/// with or without a trailing `.git`). `None` for a non-GitHub remote.
pub fn parse_github_slug(remote_url: &str) -> Option<(String, String)> {
    let (_, rest) = remote_url.trim().rsplit_once("github.com")?;
    let rest = rest.trim_start_matches([':', '/']);
    let rest = rest.strip_suffix(".git").unwrap_or(rest);
    let (owner, name) = rest.split_once('/')?;
    let (owner, name) = (owner.trim(), name.trim().trim_end_matches('/'));
    if owner.is_empty() || name.is_empty() {
        return None;
    }
    Some((owner.to_string(), name.to_string()))
}

/// A safe job branch name derived from the task — `eri/<slug>`. A FRESH job runs
/// on this (never the default branch), so [`GitHubPrAuthor`] can open a PR from
/// it (it refuses to open from the base branch). Deterministic + pure.
pub fn job_branch_name(task: &str) -> String {
    let mut slug = task
        .to_ascii_lowercase()
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|w| !w.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    slug.truncate(40);
    let slug = slug.trim_end_matches('-');
    if slug.is_empty() {
        "eri/job".to_string()
    } else {
        format!("eri/{slug}")
    }
}

/// The resolved inputs for one `eri code-job` run.
pub struct CodeJobArgs {
    pub task: String,
    pub repo_path: PathBuf,
    pub slug: Option<String>,
    pub base: Option<String>,
    pub test_cmd: Option<String>,
    pub budget_tokens: u64,
    pub budget_seconds: u64,
    pub update_pr: Option<u64>,
    pub update_pr_url: Option<String>,
    /// Job branch for a fresh PR; `None` = derived from the task. Ignored for a
    /// follow-up (it stays on the existing PR's head branch).
    pub branch: Option<String>,
    pub model: String,
}

/// Run one coding job to completion, streaming JSONL to stdout. The command
/// entry point (`eri code-job`).
pub async fn run_code_job(args: CodeJobArgs) -> Result<()> {
    let slug = match args.slug.clone() {
        Some(s) => s,
        None => remote_slug(&args.repo_path)?,
    };
    let test_cmd = match args.test_cmd.clone() {
        Some(c) => c,
        None => detect_test_command(&args.repo_path).ok_or_else(|| {
            anyhow!(
                "could not detect a test command for {:?}; pass --test-cmd",
                args.repo_path
            )
        })?,
    };

    // The terminal author: a fresh PR (B3) needs the user's GitHub token; a
    // follow-up (B4) pushes to the existing PR's branch (whose remote already
    // carries the token from clone), so it needs no fresh token read.
    let pr_author: Box<dyn PrAuthor> = match args.update_pr {
        Some(number) => Box::new(FollowUpPrAuthor::for_pr(
            number,
            args.update_pr_url.clone().unwrap_or_default(),
        )),
        None => {
            let token = std::env::var("GITHUB_TOKEN").map_err(|_| {
                anyhow!("GITHUB_TOKEN is not set — the worker injects the user's GitHub token into the sandbox env")
            })?;
            Box::new(GitHubPrAuthor::from_token(token))
        }
    };

    let job = CodeJob {
        task: args.task,
        repo: slug,
        working_tree: args.repo_path,
        base: args.base,
        budget: CodeBudget {
            max_tokens: args.budget_tokens,
            max_seconds: args.budget_seconds,
        },
    };

    // A FRESH job must run on a NEW branch: the harness commits to the current
    // branch and the PR author refuses to open FROM the base/default branch (PRs
    // only, never push to default). A follow-up (--update-pr) stays on the PR's
    // head branch the worker checked out, so it does NOT re-branch.
    if args.update_pr.is_none() {
        let branch = args
            .branch
            .clone()
            .unwrap_or_else(|| job_branch_name(&job.task));
        eri_git::create_branch_if_needed(&job.working_tree, &branch)
            .map_err(|e| anyhow!("create job branch '{branch}': {e}"))?;
    }

    let turn = SandboxCodeTurn::new(
        Box::new(HarnessAdapter { model: args.model }),
        Box::new(ShellTestRunner::new(test_cmd)),
        Box::new(GitCommitter),
        pr_author,
        MAX_ATTEMPTS,
    );

    let sink = JsonlProgressSink::new(std::io::stdout());
    let outcome = turn.run(&job, &sink).await?;
    // The terminal line: the CodeOutcome envelope (has `kind`, not `stage`).
    println!("{}", outcome.wire());
    Ok(())
}

/// Derive `owner/name` from the working tree's `origin` remote.
fn remote_slug(repo: &Path) -> Result<String> {
    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["remote", "get-url", "origin"])
        .output()
        .map_err(|e| anyhow!("git remote: {e}"))?;
    if !out.status.success() {
        bail!("could not read the origin remote; pass --slug owner/name");
    }
    let url = String::from_utf8_lossy(&out.stdout);
    let (owner, name) = parse_github_slug(url.trim())
        .ok_or_else(|| anyhow!("origin '{}' is not a GitHub repo; pass --slug", url.trim()))?;
    Ok(format!("{owner}/{name}"))
}

// ── real seams wired to the live harness/git ──

/// Wraps [`crate::build_agent::run_build_agent`] as one harness edit pass. A
/// retry passes the prior test failure back in the prompt so the model fixes it.
struct HarnessAdapter {
    model: String,
}

#[async_trait]
impl Harness for HarnessAdapter {
    async fn attempt(
        &self,
        task: &str,
        working_tree: &Path,
        feedback: Option<&str>,
    ) -> Result<HarnessAttempt> {
        let prompt = match feedback {
            Some(f) => format!(
                "{task}\n\nThe tests are still failing:\n{f}\n\nFix the code so the tests pass."
            ),
            None => task.to_string(),
        };
        // `run_build_agent` uses a `!Send` (RefCell-based) context, so it can't run
        // directly inside this `Send` `Harness` future. Run it on a blocking
        // thread with its own current-thread runtime — the `!Send` work stays on
        // that one thread; only the `Send` `BuildOutcome` crosses back. This keeps
        // the whole CodeTurn family `Send` without threading `?Send` everywhere.
        let model = self.model.clone();
        let wt = working_tree.to_path_buf();
        let outcome = tokio::task::spawn_blocking(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .map_err(|e| anyhow!("harness runtime: {e}"))?;
            // narrate=false is LOAD-BEARING: stdout is reserved for the JSONL
            // progress stream the worker parses line by line. The default
            // `run_build_agent` narrates the model's text to stdout, which would
            // interleave prose into the JSONL and break the parse. Run headless.
            let opts = crate::build_agent::LoopOpts {
                narrate: false,
                ..Default::default()
            };
            rt.block_on(crate::build_agent::run_headless(
                &prompt, &wt, &model, &opts,
            ))
        })
        .await
        .map_err(|e| anyhow!("harness task failed: {e}"))??;
        if let Some(reason) = outcome.halted {
            return Ok(HarnessAttempt::Halted(reason));
        }
        let files = outcome
            .files_written
            .iter()
            .map(|p| rel(p, working_tree))
            .collect();
        let summary = if outcome.final_text.trim().is_empty() {
            "made changes".to_string()
        } else {
            first_line(&outcome.final_text)
        };
        Ok(HarnessAttempt::Edited {
            files,
            summary,
            tokens: outcome.tokens_in + outcome.tokens_out,
        })
    }
}

/// The real committer over `eri_git`. Commits pending changes (`git add -A` +
/// commit) ONLY when the tree is dirty; when it's already clean — the harness has
/// its own `git_commit` tool and often commits its work itself — it returns HEAD
/// instead of an EMPTY commit, so a job is one clean commit per step, not two.
struct GitCommitter;

#[async_trait]
impl Committer for GitCommitter {
    async fn commit(&self, working_tree: &Path, message: &str) -> Result<String> {
        let clean = eri_git::status_porcelain(working_tree)
            .map_err(|e| anyhow!("git status: {e}"))?
            .trim()
            .is_empty();
        if clean {
            // Nothing to commit — the harness already committed. Return HEAD, not
            // an --allow-empty no-op commit (which is noise on a real PR).
            head_sha(working_tree)
        } else {
            eri_git::commit_iteration(working_tree, message, &[])
                .map_err(|e| anyhow!("git commit: {e}"))
        }
    }
}

/// The current HEAD commit sha of a repo.
fn head_sha(repo: &Path) -> Result<String> {
    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["rev-parse", "HEAD"])
        .output()
        .map_err(|e| anyhow!("git rev-parse: {e}"))?;
    if !out.status.success() {
        bail!("git rev-parse HEAD failed in {repo:?}");
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// A path made workspace-relative (falls back to the full path if not under it).
fn rel(path: &Path, root: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .into_owned()
}

/// First line of some text, clipped.
fn first_line(s: &str) -> String {
    s.lines()
        .next()
        .unwrap_or("")
        .trim()
        .chars()
        .take(120)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn jsonl_sink_writes_one_wire_line_per_event() {
        let sink = JsonlProgressSink::new(Vec::<u8>::new());
        sink.emit(&CodeProgress::Planned {
            summary: "on it".into(),
        });
        sink.emit(&CodeProgress::Tested {
            command: "cargo test".into(),
            passed: true,
            summary: "green".into(),
        });
        let text = String::from_utf8(sink.into_inner()).unwrap();
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 2, "one JSON line per event");
        let first: Value = serde_json::from_str(lines[0]).unwrap();
        assert_eq!(first["stage"], "plan");
        assert!(first["text"].as_str().is_some());
        let second: Value = serde_json::from_str(lines[1]).unwrap();
        assert_eq!(second["stage"], "test");
        assert_eq!(second["passed"], true);
    }

    #[test]
    fn detects_the_test_command_per_ecosystem() {
        let base = std::env::temp_dir().join(format!("eri-cj-detect-{}", std::process::id()));
        let rust = base.join("rust");
        std::fs::create_dir_all(&rust).unwrap();
        std::fs::write(rust.join("Cargo.toml"), "[package]").unwrap();
        assert_eq!(detect_test_command(&rust).as_deref(), Some("cargo test"));

        let node = base.join("node");
        std::fs::create_dir_all(&node).unwrap();
        std::fs::write(node.join("package.json"), "{}").unwrap();
        assert_eq!(detect_test_command(&node).as_deref(), Some("npm test"));

        let empty = base.join("empty");
        std::fs::create_dir_all(&empty).unwrap();
        assert_eq!(
            detect_test_command(&empty),
            None,
            "no markers → caller must pass --test-cmd"
        );

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn parses_github_slug_from_https_and_ssh() {
        assert_eq!(
            parse_github_slug("https://github.com/eri-labs/eri.git"),
            Some(("eri-labs".into(), "eri".into()))
        );
        assert_eq!(
            parse_github_slug("git@github.com:eri-labs/eri.git"),
            Some(("eri-labs".into(), "eri".into()))
        );
        assert_eq!(
            parse_github_slug("https://github.com/eri-labs/eri"),
            Some(("eri-labs".into(), "eri".into()))
        );
    }

    #[test]
    fn rejects_a_non_github_remote() {
        assert_eq!(parse_github_slug("https://gitlab.com/x/y.git"), None);
        assert_eq!(parse_github_slug("not a url"), None);
    }

    #[test]
    fn job_branch_name_is_a_clean_eri_slug() {
        let b = job_branch_name("add a /health route + a test");
        assert!(b.starts_with("eri/"), "prefixed: {b}");
        assert!(b.contains("health"), "reflects the task: {b}");
        // Clean after the prefix — no spaces, no extra slashes, no punctuation.
        assert!(
            !b["eri/".len()..].contains(['/', ' ', '+']),
            "safe branch slug: {b}"
        );
        // Degenerate tasks fall back to a valid branch, never an empty ref.
        assert_eq!(job_branch_name(""), "eri/job");
        assert_eq!(job_branch_name("!!!"), "eri/job");
    }

    #[tokio::test]
    async fn git_committer_skips_a_clean_tree_and_commits_a_dirty_one() {
        // A real git repo (no network/token/harness). The old --allow-empty
        // committer would add an empty commit on a clean tree — one clean commit
        // per step is the contract for real PRs.
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path();
        let git = |args: &[&str]| {
            std::process::Command::new("git")
                .arg("-C")
                .arg(p)
                .args(args)
                .output()
                .unwrap()
        };
        git(&["init", "-q"]);
        git(&["config", "user.email", "t@e.st"]);
        git(&["config", "user.name", "t"]);
        std::fs::write(p.join("a.txt"), "1").unwrap();
        git(&["add", "-A"]);
        git(&["commit", "-q", "-m", "init"]);
        let count = || -> usize {
            let o = git(&["rev-list", "--count", "HEAD"]);
            String::from_utf8_lossy(&o.stdout).trim().parse().unwrap()
        };
        let head0 = head_sha(p).unwrap();

        let committer = GitCommitter;
        // Clean tree → returns HEAD, adds NO commit.
        let sha_clean = committer
            .commit(p, "must not add an empty commit")
            .await
            .unwrap();
        assert_eq!(sha_clean, head0, "clean tree → HEAD, no empty commit");
        assert_eq!(count(), 1, "no commit was added to a clean tree");

        // Dirty tree → exactly ONE new commit.
        std::fs::write(p.join("b.txt"), "2").unwrap();
        let sha_dirty = committer.commit(p, "add b").await.unwrap();
        assert_ne!(sha_dirty, head0, "a new commit sha");
        assert_eq!(count(), 2, "exactly one new commit for the pending change");
    }
}
