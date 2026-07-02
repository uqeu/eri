//! B3 — PR authoring: the real [`PrAuthor`] behind the CodeTurn seam.
//!
//! When [`crate::code_sandbox::SandboxCodeTurn`] reaches green (and only then —
//! it is called strictly after [`crate::code_turn::pr_gate`]), this opens the
//! actual pull request: push the job branch, then `POST /repos/{o}/{r}/pulls`
//! via the GitHub REST API with an **eri-voice** title/body that carries the
//! **passing-test evidence**. It NEVER opens a PR from the base/default branch
//! (PRs only, never push to default).
//!
//! The two I/O edges — the git push and the HTTP call — are seams ([`GitRemote`],
//! [`PullRequestApi`]) so the orchestration + the body composition are TDD-tested
//! without a network or a live repo. The body/title/payload/response builders are
//! pure. The real edges ([`GitRemoteCli`] over `eri_git`, [`GitHubHttpApi`] over
//! `reqwest`) delegate to those tested pure builders.
//!
//! The user's GitHub token is the user's own OAuth, injected into the sandbox
//! env at creation ([[project_eri_phase3_agentic_coding]] compute decision) —
//! never hard-coded, never logged, never in chat ([[project_credential_vault]]).
//!
//! `dead_code` allowed module-wide until the dispatch worker constructs the real
//! author.
#![allow(dead_code)]

use std::path::Path;

use anyhow::{Result, anyhow, bail};
use async_trait::async_trait;
use serde_json::{Value, json};

use crate::code_sandbox::{PrAuthor, PrRef};
use crate::code_turn::{CodeJob, CodeProgress};

/// A pull request to open. `head` is the job branch (never the base).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PullRequest {
    pub owner: String,
    pub repo: String,
    pub head: String,
    pub base: String,
    pub title: String,
    pub body: String,
}

/// The git edge: read the working tree's current branch and push it. Real impl
/// [`GitRemoteCli`] wraps `eri_git`; tests script it.
#[async_trait]
pub trait GitRemote: Send + Sync {
    async fn current_branch(&self, working_tree: &Path) -> Result<String>;
    async fn push(&self, working_tree: &Path, remote: &str) -> Result<()>;
}

/// The GitHub edge: open a pull request. Real impl [`GitHubHttpApi`] POSTs to the
/// REST API; tests record the request.
#[async_trait]
pub trait PullRequestApi: Send + Sync {
    async fn create(&self, pr: PullRequest) -> Result<PrRef>;
}

/// The real [`PrAuthor`]: push the job branch, then open the PR. Both edges are
/// injected so the flow (incl. the never-push-to-default guard) is testable.
pub struct GitHubPrAuthor {
    git: Box<dyn GitRemote>,
    api: Box<dyn PullRequestApi>,
    remote: String,
    default_base: String,
}

impl GitHubPrAuthor {
    /// Construct from injected edges (tests) or the real ones ([`from_token`]).
    pub fn new(
        git: Box<dyn GitRemote>,
        api: Box<dyn PullRequestApi>,
        remote: impl Into<String>,
        default_base: impl Into<String>,
    ) -> Self {
        Self {
            git,
            api,
            remote: remote.into(),
            default_base: default_base.into(),
        }
    }

    /// The production author: git via `eri_git`, GitHub via `reqwest`, using the
    /// user's OAuth `token` (injected into the sandbox env, never logged).
    pub fn from_token(token: impl Into<String>) -> Self {
        Self::new(
            Box::new(GitRemoteCli),
            Box::new(GitHubHttpApi::new(token)),
            "origin",
            "main",
        )
    }
}

#[async_trait]
impl PrAuthor for GitHubPrAuthor {
    async fn open(
        &self,
        job: &CodeJob,
        _commit_sha: &str,
        progress: &[CodeProgress],
    ) -> Result<PrRef> {
        let wt = job.working_tree.as_path();
        let head = self.git.current_branch(wt).await?;
        let base = job
            .base
            .clone()
            .unwrap_or_else(|| self.default_base.clone());
        // PRs only — never open a PR from the base/default branch as head. If the
        // work somehow landed on the base, refuse before touching the remote.
        if head == base {
            bail!(
                "refusing to open a PR: work is on the base branch '{base}' (PRs only, never push to default)"
            );
        }
        self.git.push(wt, &self.remote).await?;
        let (owner, repo) = split_repo(&job.repo)?;
        let pr = PullRequest {
            owner,
            repo,
            head,
            base,
            title: pr_title(job, progress),
            body: pr_body(job, progress),
        };
        self.api.create(pr).await
    }
}

// ── pure builders ──

/// Split `owner/name` into its parts (first `/` only). Errors on a missing or
/// empty half so a malformed repo never reaches the API.
pub fn split_repo(repo: &str) -> Result<(String, String)> {
    let (owner, name) = repo
        .trim()
        .split_once('/')
        .ok_or_else(|| anyhow!("repo '{repo}' is not owner/name"))?;
    let (owner, name) = (owner.trim(), name.trim());
    if owner.is_empty() || name.is_empty() {
        bail!("repo '{repo}' is not owner/name");
    }
    Ok((owner.to_string(), name.to_string()))
}

/// The GitHub REST endpoint for opening a pull request in a repo.
pub fn github_pulls_url(owner: &str, repo: &str) -> String {
    format!("https://api.github.com/repos/{owner}/{repo}/pulls")
}

/// The JSON body for `POST .../pulls`.
pub fn pull_request_payload(pr: &PullRequest) -> Value {
    json!({ "title": pr.title, "head": pr.head, "base": pr.base, "body": pr.body })
}

/// Parse GitHub's PR response into a [`PrRef`] (its `number` + `html_url`).
/// Errors when either is missing so a half-created PR isn't reported as success.
pub fn parse_pr_response(v: &Value) -> Result<PrRef> {
    let number = v
        .get("number")
        .and_then(Value::as_u64)
        .ok_or_else(|| anyhow!("GitHub PR response missing `number`"))?;
    let url = v
        .get("html_url")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("GitHub PR response missing `html_url`"))?
        .to_string();
    let title = v
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    Ok(PrRef { number, url, title })
}

/// The PR title — the task's first line, clipped. (A model-polished title is a
/// later refinement; B3 ships a deterministic one.)
pub fn pr_title(job: &CodeJob, _progress: &[CodeProgress]) -> String {
    let clipped: String = job
        .task
        .lines()
        .next()
        .unwrap_or("")
        .trim()
        .chars()
        .take(72)
        .collect();
    if clipped.is_empty() {
        "eri: automated change".to_string()
    } else {
        clipped
    }
}

/// The PR body — an eri-voice summary of what changed + the **passing-test
/// evidence** (the green test command + result). Reads the emitted `progress`,
/// the same events [`crate::code_turn::pr_gate`] cleared.
pub fn pr_body(job: &CodeJob, progress: &[CodeProgress]) -> String {
    let mut b = format!("Hey — I took a pass at: “{}”.\n\n", headline(&job.task));

    let edits = edit_summaries(progress);
    if !edits.is_empty() {
        b.push_str("**What I changed**\n");
        for e in &edits {
            b.push_str(&format!("- {e}\n"));
        }
        b.push('\n');
    }

    let files = changed_files(progress);
    if !files.is_empty() {
        b.push_str(&format!("**Files:** {}\n\n", files.join(", ")));
    }

    b.push_str("**Tests**\n");
    match last_green_test(progress) {
        Some((cmd, summary)) if !summary.trim().is_empty() => {
            b.push_str(&format!("✓ `{cmd}` — {summary}\n\n"));
        }
        Some((cmd, _)) => b.push_str(&format!("✓ `{cmd}` passed\n\n")),
        // pr_gate guarantees this branch is unreachable in practice.
        None => b.push_str("_(no passing-test evidence — this PR should not exist)_\n\n"),
    }

    b.push_str("_Opened by eri. Reply with changes and I'll push another commit._\n");
    b
}

/// The distinct files edited over the run, in first-seen order.
fn changed_files(progress: &[CodeProgress]) -> Vec<String> {
    let mut files: Vec<String> = Vec::new();
    for e in progress {
        if let CodeProgress::Edited { files: f, .. } = e {
            for x in f {
                if !files.contains(x) {
                    files.push(x.clone());
                }
            }
        }
    }
    files
}

/// The non-empty edit summaries, in order.
fn edit_summaries(progress: &[CodeProgress]) -> Vec<String> {
    progress
        .iter()
        .filter_map(|e| match e {
            CodeProgress::Edited { summary, .. } if !summary.trim().is_empty() => {
                Some(summary.clone())
            }
            _ => None,
        })
        .collect()
}

/// The most recent GREEN test run's (command, summary) — the PR's evidence.
fn last_green_test(progress: &[CodeProgress]) -> Option<(String, String)> {
    progress.iter().rev().find_map(|e| match e {
        CodeProgress::Tested {
            command,
            passed: true,
            summary,
        } => Some((command.clone(), summary.clone())),
        _ => None,
    })
}

/// First line of the task, clipped (shared shape with the sandbox headline).
fn headline(task: &str) -> String {
    task.lines()
        .next()
        .unwrap_or("")
        .trim()
        .chars()
        .take(80)
        .collect()
}

// ── real edges ──

/// The production git edge over `eri_git` (jails to the working tree, shells git
/// safely). The remote is already cloned with the user's token in its URL, so
/// `push` reuses that credential.
pub struct GitRemoteCli;

#[async_trait]
impl GitRemote for GitRemoteCli {
    async fn current_branch(&self, working_tree: &Path) -> Result<String> {
        eri_git::current_branch(working_tree).map_err(|e| anyhow!("git branch: {e}"))
    }
    async fn push(&self, working_tree: &Path, remote: &str) -> Result<()> {
        eri_git::push_current_branch(working_tree, remote).map_err(|e| anyhow!("git push: {e}"))
    }
}

/// The production GitHub edge over `reqwest`. Sends the user's OAuth token as a
/// bearer credential; the token is never logged.
pub struct GitHubHttpApi {
    client: reqwest::Client,
    token: String,
}

impl GitHubHttpApi {
    pub fn new(token: impl Into<String>) -> Self {
        Self {
            client: reqwest::Client::new(),
            token: token.into(),
        }
    }
}

#[async_trait]
impl PullRequestApi for GitHubHttpApi {
    async fn create(&self, pr: PullRequest) -> Result<PrRef> {
        let url = github_pulls_url(&pr.owner, &pr.repo);
        let payload = pull_request_payload(&pr);
        let resp = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.token))
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .header("User-Agent", "eri")
            .json(&payload)
            .send()
            .await
            .map_err(|e| anyhow!("GitHub PR request failed: {e}"))?;
        let status = resp.status();
        let body: Value = resp
            .json()
            .await
            .map_err(|e| anyhow!("GitHub sent invalid JSON: {e}"))?;
        if !status.is_success() {
            let msg = body
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("unknown error");
            bail!("GitHub PR creation failed ({status}): {msg}");
        }
        parse_pr_response(&body)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use crate::code_turn::CodeBudget;

    fn green_progress() -> Vec<CodeProgress> {
        vec![
            CodeProgress::Planned {
                summary: "reproducing".into(),
            },
            CodeProgress::Edited {
                files: vec!["src/cart.rs".into()],
                summary: "guard the null cart".into(),
            },
            CodeProgress::Tested {
                command: "cargo test".into(),
                passed: true,
                summary: "42 passed".into(),
            },
        ]
    }

    fn job() -> CodeJob {
        CodeJob {
            task: "fix the null-cart checkout crash".into(),
            repo: "eri-labs/eri".into(),
            working_tree: PathBuf::from("/tmp/clone"),
            base: None,
            budget: CodeBudget::default(),
        }
    }

    // ── pure builders ──

    #[test]
    fn split_repo_parses_owner_and_name() {
        assert_eq!(
            split_repo("eri-labs/eri").unwrap(),
            ("eri-labs".to_string(), "eri".to_string())
        );
    }

    #[test]
    fn split_repo_rejects_a_malformed_slug() {
        assert!(split_repo("noslug").is_err());
        assert!(split_repo("/eri").is_err());
        assert!(split_repo("eri-labs/").is_err());
    }

    #[test]
    fn pulls_url_targets_the_repo() {
        assert_eq!(
            github_pulls_url("eri-labs", "eri"),
            "https://api.github.com/repos/eri-labs/eri/pulls"
        );
    }

    #[test]
    fn payload_carries_title_head_base_body() {
        let pr = PullRequest {
            owner: "eri-labs".into(),
            repo: "eri".into(),
            head: "eri/fix-cart".into(),
            base: "main".into(),
            title: "Fix cart".into(),
            body: "did the thing".into(),
        };
        let p = pull_request_payload(&pr);
        assert_eq!(p["title"], "Fix cart");
        assert_eq!(p["head"], "eri/fix-cart");
        assert_eq!(p["base"], "main");
        assert_eq!(p["body"], "did the thing");
    }

    #[test]
    fn parse_pr_response_extracts_number_and_url() {
        let v = json!({ "number": 123, "html_url": "https://github.com/eri-labs/eri/pull/123" });
        let pr = parse_pr_response(&v).unwrap();
        assert_eq!(pr.number, 123);
        assert_eq!(pr.url, "https://github.com/eri-labs/eri/pull/123");
    }

    #[test]
    fn parse_pr_response_errors_when_number_missing() {
        let v = json!({ "html_url": "x" });
        assert!(parse_pr_response(&v).is_err());
    }

    #[test]
    fn pr_title_is_the_task_headline() {
        let t = pr_title(&job(), &green_progress());
        assert!(t.contains("null-cart"), "title reflects the task: {t}");
        assert!(!t.is_empty());
    }

    #[test]
    fn pr_body_carries_the_passing_test_evidence_and_files() {
        let b = pr_body(&job(), &green_progress());
        // the green evidence: the command + a pass marker
        assert!(b.contains("cargo test"), "body cites the test command: {b}");
        assert!(
            b.contains('✓') || b.to_lowercase().contains("pass"),
            "body shows the tests passed: {b}"
        );
        // what changed
        assert!(b.contains("src/cart.rs"), "body lists the changed file");
        assert!(b.contains("null cart"), "body summarises the edit");
    }

    // ── test doubles for the two edges ──
    //
    // GitHubPrAuthor consumes the boxed edges, so the doubles hold their push
    // counter / recorded calls behind an `Arc` we keep to inspect post-run.
    use std::sync::Arc;

    struct SharedGit {
        branch: String,
        pushed: Arc<AtomicUsize>,
    }
    #[async_trait]
    impl GitRemote for SharedGit {
        async fn current_branch(&self, _wt: &Path) -> Result<String> {
            Ok(self.branch.clone())
        }
        async fn push(&self, _wt: &Path, _remote: &str) -> Result<()> {
            self.pushed.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
    }

    struct SharedApi {
        calls: Arc<Mutex<Vec<PullRequest>>>,
    }
    #[async_trait]
    impl PullRequestApi for SharedApi {
        async fn create(&self, pr: PullRequest) -> Result<PrRef> {
            self.calls.lock().unwrap().push(pr.clone());
            Ok(PrRef {
                number: 7,
                url: "https://github.com/eri-labs/eri/pull/7".into(),
                title: pr.title,
            })
        }
    }

    // ── orchestration ──

    #[tokio::test]
    async fn opens_a_pr_from_the_job_branch_onto_the_default_base() {
        let pushed = Arc::new(AtomicUsize::new(0));
        let calls = Arc::new(Mutex::new(Vec::new()));
        let author = GitHubPrAuthor::new(
            Box::new(SharedGit {
                branch: "eri/fix-cart".into(),
                pushed: Arc::clone(&pushed),
            }),
            Box::new(SharedApi {
                calls: Arc::clone(&calls),
            }),
            "origin",
            "main",
        );
        let pr = author
            .open(&job(), "deadbeef", &green_progress())
            .await
            .unwrap();

        assert_eq!(pr.number, 7);
        assert_eq!(pushed.load(Ordering::SeqCst), 1, "the branch was pushed");
        let calls = calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].head, "eri/fix-cart");
        assert_eq!(calls[0].base, "main", "base defaults to the repo default");
        assert!(
            calls[0].body.contains("cargo test"),
            "body carries evidence"
        );
    }

    #[tokio::test]
    async fn honours_an_explicit_base_branch() {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let mut j = job();
        j.base = Some("develop".into());
        let author = GitHubPrAuthor::new(
            Box::new(SharedGit {
                branch: "eri/fix".into(),
                pushed: Arc::new(AtomicUsize::new(0)),
            }),
            Box::new(SharedApi {
                calls: Arc::clone(&calls),
            }),
            "origin",
            "main",
        );
        author.open(&j, "sha", &green_progress()).await.unwrap();
        assert_eq!(calls.lock().unwrap()[0].base, "develop");
    }

    #[tokio::test]
    async fn refuses_to_open_a_pr_from_the_base_branch() {
        // PRs only, never the default/base branch as head. If the work somehow
        // landed on `main`, refuse — no push, no API call.
        let pushed = Arc::new(AtomicUsize::new(0));
        let calls = Arc::new(Mutex::new(Vec::new()));
        let author = GitHubPrAuthor::new(
            Box::new(SharedGit {
                branch: "main".into(),
                pushed: Arc::clone(&pushed),
            }),
            Box::new(SharedApi {
                calls: Arc::clone(&calls),
            }),
            "origin",
            "main",
        );
        let out = author.open(&job(), "sha", &green_progress()).await;
        assert!(out.is_err(), "opening from the base branch is refused");
        assert_eq!(pushed.load(Ordering::SeqCst), 0, "nothing pushed");
        assert!(calls.lock().unwrap().is_empty(), "no PR opened");
    }
}
