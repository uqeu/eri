//! Git tools for the agentic loop -- version-control awareness WITHOUT needing
//! the full `bash` capability.
//!
//! A coding agent constantly wants to know "what have I changed" and to commit
//! its work. Exposing `git_status` / `git_diff` / `git_log` / `git_commit` as
//! first-class tools lets it do that under the normal permission model (commit
//! needs writes; the rest are read-only) instead of forcing `--allow-shell`,
//! which would grant arbitrary command execution. All operations go through
//! `eri_git`, which jails to the workspace and shells `git` safely.

use std::path::Path;

use serde_json::Value;

/// Outcome of a git tool: rendered text + error flag, matching the loop's
/// ToolExec contract (the caller wraps this into a tool_result).
pub struct GitOut {
    pub content: String,
    pub is_error: bool,
}

fn ok(content: String) -> GitOut {
    GitOut {
        content,
        is_error: false,
    }
}
fn fail(content: String) -> GitOut {
    GitOut {
        content,
        is_error: true,
    }
}

/// Cap git output so a huge diff/log can't blow the context.
const MAX_GIT_BYTES: usize = 24_000;

fn clip(mut s: String) -> String {
    if s.len() > MAX_GIT_BYTES {
        s.truncate(MAX_GIT_BYTES);
        s.push_str("\n…[truncated]");
    }
    s
}

/// `git status --porcelain` -- what's changed (staged/unstaged/untracked).
pub fn git_status(root: &Path) -> GitOut {
    match eri_git::status_porcelain(root) {
        Ok(s) if s.trim().is_empty() => ok("working tree clean (no changes)".to_string()),
        Ok(s) => ok(clip(s)),
        Err(e) => fail(format!("git status failed: {e}")),
    }
}

/// `git diff HEAD` -- uncommitted changes to tracked files.
pub fn git_diff(root: &Path) -> GitOut {
    match eri_git::working_tree_diff(root) {
        Ok(s) if s.trim().is_empty() => ok("no uncommitted changes to tracked files".to_string()),
        Ok(s) => ok(clip(s)),
        Err(e) => fail(format!("git diff failed: {e}")),
    }
}

/// Recent commits, newest first. Optional `limit` (default 10, capped 100).
pub fn git_log(root: &Path, input: &Value) -> GitOut {
    let limit = input
        .get("limit")
        .and_then(Value::as_u64)
        .map(|n| (n as usize).clamp(1, 100))
        .unwrap_or(10);
    match eri_git::list_commits(root, limit) {
        Ok(commits) if commits.is_empty() => ok("no commits yet".to_string()),
        Ok(commits) => {
            let body = commits
                .iter()
                .map(|c| {
                    let short = c.hash.get(..8).unwrap_or(&c.hash);
                    format!("{short}  {}", c.message)
                })
                .collect::<Vec<_>>()
                .join("\n");
            ok(body)
        }
        Err(e) => fail(format!("git log failed: {e}")),
    }
}

/// Stage and commit. Requires a non-empty `message`. `files` (optional) limits
/// the commit to those paths; omitted -> commit everything (`git add -A`).
/// A write operation -- the loop gates this behind write permission.
pub fn git_commit(root: &Path, input: &Value) -> GitOut {
    let message = input
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if message.is_empty() {
        return fail("git_commit: a non-empty commit message is required".to_string());
    }
    let files: Vec<String> = input
        .get("files")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    let file_refs: Vec<&str> = files.iter().map(String::as_str).collect();
    match eri_git::commit_iteration(root, message, &file_refs) {
        Ok(hash) => {
            let short = hash.get(..8).unwrap_or(&hash);
            ok(format!("committed {short}: {message}"))
        }
        Err(e) => fail(format!("git commit failed: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::process::Command;
    use tempfile::TempDir;

    fn git(dir: &Path, args: &[&str]) {
        let ok = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .output()
            .expect("run git")
            .status
            .success();
        assert!(ok, "git {args:?} failed");
    }

    fn repo() -> TempDir {
        let d = TempDir::new().unwrap();
        git(d.path(), &["init", "-q"]);
        git(d.path(), &["config", "user.email", "t@e.ri"]);
        git(d.path(), &["config", "user.name", "eri"]);
        std::fs::write(d.path().join("a.txt"), "hello\n").unwrap();
        git(d.path(), &["add", "-A"]);
        git(d.path(), &["commit", "-qm", "initial"]);
        d
    }

    #[test]
    fn status_clean_then_dirty() {
        let d = repo();
        assert!(git_status(d.path()).content.contains("clean"));
        std::fs::write(d.path().join("a.txt"), "changed\n").unwrap();
        let s = git_status(d.path());
        assert!(!s.is_error);
        assert!(s.content.contains("a.txt"));
    }

    #[test]
    fn diff_shows_uncommitted_changes() {
        let d = repo();
        std::fs::write(d.path().join("a.txt"), "changed line\n").unwrap();
        let diff = git_diff(d.path());
        assert!(!diff.is_error);
        assert!(diff.content.contains("changed line"));
    }

    #[test]
    fn commit_requires_message_and_records() {
        let d = repo();
        std::fs::write(d.path().join("b.txt"), "new\n").unwrap();
        // Empty message rejected.
        assert!(git_commit(d.path(), &json!({ "message": "  " })).is_error);
        // Real commit lands and shows in the log.
        let c = git_commit(d.path(), &json!({ "message": "add b" }));
        assert!(!c.is_error, "{}", c.content);
        let log = git_log(d.path(), &json!({}));
        assert!(log.content.contains("add b"));
        assert!(log.content.contains("initial"));
        // After committing everything, the tree is clean.
        assert!(git_status(d.path()).content.contains("clean"));
    }

    #[test]
    fn log_respects_limit() {
        let d = repo();
        for i in 0..5 {
            std::fs::write(d.path().join("a.txt"), format!("v{i}\n")).unwrap();
            git_commit(d.path(), &json!({ "message": format!("c{i}") }));
        }
        let log = git_log(d.path(), &json!({ "limit": 2 }));
        assert_eq!(log.content.lines().count(), 2);
    }
}
