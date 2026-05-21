//! End-to-end "open a PR" workflow.
//!
//! Wires together [`crate::pr`] (prompt builders + response parser),
//! [`crate::ClaudeCliBackend`] (subprocess transport), and the per-project
//! `eri_git` repo. Surfaces a single entry point — [`open_pr_workflow`] — that
//! the panel can call from a background task when the user voices
//! `OpenPullRequest`.
//!
//! Steps:
//!   1. Resolve the current branch and pick a base (`origin/main`, falling
//!      back to `main` when the upstream isn't configured).
//!   2. Snapshot the recent commits (so Claude sees the iteration history).
//!   3. `git diff <base>...HEAD` to give Claude the actual code delta.
//!   4. Build the PR-description prompt and shell out to Claude.
//!   5. Parse Claude's structured response into `(title, body)`.
//!   6. Push the current branch to the remote (default `origin`).
//!   7. Shell out to `gh pr create --title ... --body ...` and parse the URL.
//!
//! The push happens only after Claude has produced a valid title + body — if
//! Claude fails we don't pollute the remote with a half-baked branch.

use std::{
    path::Path,
    process::Command,
    sync::{Arc, atomic::AtomicBool},
};

use thiserror::Error;

use crate::{
    ClaudeCliBackend, InferenceError,
    pr::{CommitSummary, build_pr_description_prompt, parse_pr_response},
};

const DEFAULT_REMOTE: &str = "origin";
const DEFAULT_BASE_BRANCH: &str = "main";
const COMMIT_HISTORY_LIMIT: usize = 32;

#[derive(Debug, Error)]
pub enum PrWorkflowError {
    #[error("git error: {0}")]
    Git(#[from] eri_git::GitError),
    #[error("inference error: {0}")]
    Inference(#[from] InferenceError),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("`gh` CLI not found on PATH — install with `brew install gh`")]
    GhCliNotFound,
    #[error("`gh pr create` failed (exit {exit_code}): {stderr}")]
    GhCommandFailed { exit_code: i32, stderr: String },
    #[error("`gh pr create` succeeded but no PR URL was found in output")]
    NoPrUrlInOutput,
    #[error("Claude produced an empty PR title — refusing to call gh pr create")]
    EmptyTitle,
}

/// Run the full "voice-trigger an AI-generated PR" workflow for `project_dir`.
///
/// Returns the PR URL printed by `gh pr create` on success. The caller is
/// expected to forward the URL through the brain → TTS path so eri speaks it
/// back to the user.
///
/// `cancel` is propagated to the Claude subprocess — flipping the flag while
/// Claude is running kills the subprocess and returns
/// `PrWorkflowError::Inference(InferenceError::Transport("polish cancelled"))`.
pub fn open_pr_workflow(
    project_dir: &Path,
    claude: &ClaudeCliBackend,
    cancel: Arc<AtomicBool>,
) -> Result<String, PrWorkflowError> {
    let branch = eri_git::current_branch_or_main(project_dir)?;
    let base = resolve_base_branch(project_dir)?;
    let commits = collect_recent_commits(project_dir)?;
    let diff = eri_git::diff_against(project_dir, &base)?;

    let prompt = augment_prompt_with_diff(
        &build_pr_description_prompt(&branch, &base, &commits),
        &diff,
    );
    let response = claude.run_pr_generator(&prompt, cancel)?;
    let parsed = parse_pr_response(&response);
    if parsed.title.trim().is_empty() {
        return Err(PrWorkflowError::EmptyTitle);
    }

    // Push *after* we have a valid title/body so a Claude failure doesn't
    // leave a stray remote branch behind.
    eri_git::push_current_branch(project_dir, DEFAULT_REMOTE)?;

    let pr_url = run_gh_pr_create(project_dir, &parsed.title, &parsed.body, &base)?;
    Ok(pr_url)
}

/// Pick the base branch to diff against. Prefer the upstream of the current
/// branch when configured (e.g. `origin/main`); otherwise fall back to
/// `"main"`. This way the workflow works on fresh branches too.
fn resolve_base_branch(project_dir: &Path) -> Result<String, PrWorkflowError> {
    if let Some(upstream) = eri_git::upstream_branch(project_dir)? {
        Ok(upstream)
    } else {
        Ok(DEFAULT_BASE_BRANCH.to_string())
    }
}

fn collect_recent_commits(project_dir: &Path) -> Result<Vec<CommitSummary>, PrWorkflowError> {
    let raw = eri_git::list_commits(project_dir, COMMIT_HISTORY_LIMIT)?;
    // `list_commits` is newest-first; the prompt expects oldest-first so
    // Claude reads the history like the user lived it.
    let mut commits: Vec<CommitSummary> = raw
        .into_iter()
        .map(|c| CommitSummary {
            hash: c.hash,
            message: c.message,
        })
        .collect();
    commits.reverse();
    Ok(commits)
}

/// Append the unified diff to the PR-description prompt. Kept separate from
/// [`crate::pr::build_pr_description_prompt`] so the pure prompt-builder stays
/// free of `eri_git` and easy to unit-test, while the diff (which can be
/// large) only shows up on the live workflow path.
fn augment_prompt_with_diff(base_prompt: &str, diff: &str) -> String {
    let mut prompt = String::with_capacity(base_prompt.len() + diff.len() + 64);
    prompt.push_str(base_prompt);
    if !prompt.ends_with('\n') {
        prompt.push('\n');
    }
    prompt.push_str("\nDIFF:\n```diff\n");
    prompt.push_str(diff);
    if !diff.ends_with('\n') {
        prompt.push('\n');
    }
    prompt.push_str("```\n");
    prompt
}

fn run_gh_pr_create(
    project_dir: &Path,
    title: &str,
    body: &str,
    base: &str,
) -> Result<String, PrWorkflowError> {
    // Reduce `origin/main` to just `main` for `gh pr create --base` — gh
    // expects a branch name, not a remote-qualified ref.
    let base_branch = base.rsplit('/').next().unwrap_or(base);
    let mut command = Command::new("gh");
    command
        .arg("pr")
        .arg("create")
        .arg("--title")
        .arg(title)
        .arg("--body")
        .arg(body)
        .arg("--base")
        .arg(base_branch)
        .current_dir(project_dir);

    let output = match command.output() {
        Ok(output) => output,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(PrWorkflowError::GhCliNotFound);
        }
        Err(error) => return Err(PrWorkflowError::Io(error)),
    };
    if !output.status.success() {
        return Err(PrWorkflowError::GhCommandFailed {
            exit_code: output.status.code().unwrap_or(-1),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        });
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    extract_pr_url(&stdout).ok_or(PrWorkflowError::NoPrUrlInOutput)
}

/// Pull the first `https://github.com/.../pull/<n>` URL out of `gh pr create`
/// output. Public so callers (and tests) can verify the parser against captured
/// CLI output without re-running gh.
pub fn extract_pr_url(text: &str) -> Option<String> {
    let needle = "https://github.com/";
    let start = text.find(needle)?;
    let tail = &text[start..];
    let end = tail
        .find(|c: char| c.is_whitespace() || matches!(c, '"' | '\'' | '<' | '>' | '`' | ')'))
        .unwrap_or(tail.len());
    let mut candidate = &tail[..end];
    while let Some(last) = candidate.chars().last() {
        if matches!(last, '.' | ',' | ';' | ':' | '!' | '?') {
            candidate = &candidate[..candidate.len() - last.len_utf8()];
        } else {
            break;
        }
    }
    if candidate.contains("/pull/") {
        Some(candidate.to_string())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_pr_url_pulls_first_github_pull_url() {
        let stdout = "Creating pull request for branch foo into main\n\
                      https://github.com/khai/eri/pull/42\n";
        assert_eq!(
            extract_pr_url(stdout).as_deref(),
            Some("https://github.com/khai/eri/pull/42")
        );
    }

    #[test]
    fn extract_pr_url_ignores_non_pull_urls() {
        let stdout = "see https://github.com/khai/eri for the repo\n";
        assert_eq!(extract_pr_url(stdout), None);
    }

    #[test]
    fn extract_pr_url_strips_trailing_punctuation() {
        let stdout = "Opened https://github.com/khai/eri/pull/7.";
        assert_eq!(
            extract_pr_url(stdout).as_deref(),
            Some("https://github.com/khai/eri/pull/7")
        );
    }

    #[test]
    fn augment_prompt_with_diff_appends_fenced_block() {
        let augmented = augment_prompt_with_diff("base prompt", "@@ -1 +1 @@\n-a\n+b\n");
        assert!(augmented.contains("base prompt"));
        assert!(augmented.contains("```diff"));
        assert!(augmented.contains("-a\n+b"));
        assert!(augmented.ends_with("```\n"));
    }
}
