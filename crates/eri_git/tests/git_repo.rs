//! Integration tests for `eri_git`. These shell out to the real `git` CLI
//! and so are skipped (via `#[ignore]`) when git isn't on PATH. Run locally
//! with `cargo test -p eri_git -- --include-ignored`.

use std::{fs, process::Command};

use eri_git::{
    checkout_commit, commit_iteration, create_branch_if_needed, current_branch_or_main,
    diff_against, ensure_git_repo, export_iterations, list_commits, upstream_branch,
};
use tempfile::TempDir;

fn git_on_path() -> bool {
    Command::new("git")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[test]
fn ensure_git_repo_is_idempotent() {
    if !git_on_path() {
        eprintln!("git not on PATH — skipping");
        return;
    }
    let tmp = TempDir::new().unwrap();
    let project = tmp.path().join("proj");
    ensure_git_repo(&project).expect("first init succeeds");
    assert!(project.join(".git").is_dir(), ".git was created");
    // Calling again must NOT error and must NOT wipe the existing repo.
    ensure_git_repo(&project).expect("second init is a no-op");
    // The seed commit from the first init must still be reachable.
    let commits = list_commits(&project, 10).unwrap();
    assert!(!commits.is_empty(), "seed commit survived a repeat init");
}

#[test]
fn commit_iteration_creates_a_commit_in_tmp_repo() {
    if !git_on_path() {
        eprintln!("git not on PATH — skipping");
        return;
    }
    let tmp = TempDir::new().unwrap();
    let project = tmp.path().join("proj");
    ensure_git_repo(&project).unwrap();

    // Mercury wrote a new index.html — commit it.
    fs::write(project.join("index.html"), "<html>hello</html>").unwrap();
    let hash = commit_iteration(&project, "iter 0001: make a hello page", &["index.html"])
        .expect("commit succeeds");
    assert_eq!(hash.len(), 40, "git rev-parse returns a full SHA");

    let commits = list_commits(&project, 10).unwrap();
    // newest first: our commit then the seed.
    assert_eq!(commits.len(), 2);
    assert_eq!(commits[0].hash, hash);
    assert_eq!(commits[0].message, "iter 0001: make a hello page");
    assert!(commits[0].timestamp > 0);
}

#[test]
fn list_commits_returns_commits_in_reverse_chronological_order() {
    if !git_on_path() {
        eprintln!("git not on PATH — skipping");
        return;
    }
    let tmp = TempDir::new().unwrap();
    let project = tmp.path().join("proj");
    ensure_git_repo(&project).unwrap();

    fs::write(project.join("index.html"), "v1").unwrap();
    commit_iteration(&project, "iter 0001: v1", &["index.html"]).unwrap();
    fs::write(project.join("index.html"), "v2").unwrap();
    commit_iteration(&project, "iter 0002: v2", &["index.html"]).unwrap();
    fs::write(project.join("index.html"), "v3").unwrap();
    commit_iteration(&project, "iter 0003: v3", &["index.html"]).unwrap();

    let commits = list_commits(&project, 10).unwrap();
    // Seed + 3 iterations.
    assert_eq!(commits.len(), 4);
    // Newest first.
    assert_eq!(commits[0].message, "iter 0003: v3");
    assert_eq!(commits[1].message, "iter 0002: v2");
    assert_eq!(commits[2].message, "iter 0001: v1");
    assert_eq!(commits[3].message, "eri: init");

    // Timestamps are non-decreasing newest → oldest.
    for window in commits.windows(2) {
        assert!(window[0].timestamp >= window[1].timestamp);
    }
}

#[test]
fn checkout_commit_restores_historical_index_html() {
    if !git_on_path() {
        eprintln!("git not on PATH — skipping");
        return;
    }
    let tmp = TempDir::new().unwrap();
    let project = tmp.path().join("proj");
    ensure_git_repo(&project).unwrap();

    fs::write(project.join("index.html"), "v1").unwrap();
    let v1 = commit_iteration(&project, "v1", &["index.html"]).unwrap();
    fs::write(project.join("index.html"), "v2").unwrap();
    commit_iteration(&project, "v2", &["index.html"]).unwrap();

    checkout_commit(&project, &v1).expect("checkout v1");
    let restored = fs::read_to_string(project.join("index.html")).unwrap();
    assert_eq!(restored, "v1");
}

#[test]
fn export_iterations_returns_commits_in_chronological_order_with_prompts() {
    if !git_on_path() {
        eprintln!("git not on PATH — skipping");
        return;
    }
    let tmp = TempDir::new().unwrap();
    let project = tmp.path().join("proj");
    ensure_git_repo(&project).unwrap();

    fs::write(project.join("index.html"), "<html>v1</html>").unwrap();
    commit_iteration(
        &project,
        "iter 0001: build a coffee shop landing page",
        &["index.html"],
    )
    .unwrap();
    fs::write(project.join("index.html"), "<html>v2</html>").unwrap();
    commit_iteration(&project, "iter 0002: add a hero image", &["index.html"]).unwrap();
    fs::write(project.join("index.html"), "<html>v3</html>").unwrap();
    commit_iteration(&project, "iter 0003: make the hero green", &["index.html"]).unwrap();

    let exported = export_iterations(&project).expect("export succeeds");
    // Seed commit is skipped (subject does not match `iter NNNN: ...`).
    assert_eq!(exported.len(), 3, "one row per iteration commit");

    // Chronological: oldest → newest, matching how the user lived it.
    assert_eq!(exported[0].n, 1);
    assert_eq!(exported[0].prompt, "build a coffee shop landing page");
    assert_eq!(exported[0].html, "<html>v1</html>");

    assert_eq!(exported[1].n, 2);
    assert_eq!(exported[1].prompt, "add a hero image");
    assert_eq!(exported[1].html, "<html>v2</html>");

    assert_eq!(exported[2].n, 3);
    assert_eq!(exported[2].prompt, "make the hero green");
    assert_eq!(exported[2].html, "<html>v3</html>");

    // ISO-8601 UTC, zero-padded date and time.
    for row in &exported {
        assert!(row.ts.ends_with('Z'), "ISO-8601 UTC suffix");
        assert_eq!(row.ts.len(), 20, "YYYY-MM-DDTHH:MM:SSZ");
    }
}

#[test]
fn list_commits_on_non_repo_is_an_error() {
    if !git_on_path() {
        eprintln!("git not on PATH — skipping");
        return;
    }
    let tmp = TempDir::new().unwrap();
    let result = list_commits(tmp.path(), 5);
    assert!(matches!(result, Err(eri_git::GitError::NotARepo(_))));
}

#[test]
fn current_branch_or_main_returns_main_on_fresh_repo() {
    if !git_on_path() {
        eprintln!("git not on PATH — skipping");
        return;
    }
    let tmp = TempDir::new().unwrap();
    let project = tmp.path().join("proj");
    ensure_git_repo(&project).unwrap();
    assert_eq!(current_branch_or_main(&project).unwrap(), "main");
}

#[test]
fn create_branch_if_needed_is_idempotent_and_switches() {
    if !git_on_path() {
        eprintln!("git not on PATH — skipping");
        return;
    }
    let tmp = TempDir::new().unwrap();
    let project = tmp.path().join("proj");
    ensure_git_repo(&project).unwrap();
    create_branch_if_needed(&project, "feature/pr").unwrap();
    assert_eq!(current_branch_or_main(&project).unwrap(), "feature/pr");
    // Calling again with the same name must not error.
    create_branch_if_needed(&project, "feature/pr").unwrap();
    assert_eq!(current_branch_or_main(&project).unwrap(), "feature/pr");
}

#[test]
fn diff_against_emits_unified_diff_between_commits() {
    if !git_on_path() {
        eprintln!("git not on PATH — skipping");
        return;
    }
    let tmp = TempDir::new().unwrap();
    let project = tmp.path().join("proj");
    ensure_git_repo(&project).unwrap();
    fs::write(project.join("index.html"), "<html>v1</html>").unwrap();
    commit_iteration(&project, "iter 0001: v1", &["index.html"]).unwrap();
    let base = list_commits(&project, 10).unwrap()[0].hash.clone();
    fs::write(project.join("index.html"), "<html>v2</html>").unwrap();
    commit_iteration(&project, "iter 0002: v2", &["index.html"]).unwrap();
    let diff = diff_against(&project, &base).unwrap();
    assert!(diff.contains("v2"), "diff must include the new content");
    assert!(diff.contains("-"), "diff must show removed line");
}

#[test]
fn upstream_branch_returns_none_when_no_remote_is_configured() {
    if !git_on_path() {
        eprintln!("git not on PATH — skipping");
        return;
    }
    let tmp = TempDir::new().unwrap();
    let project = tmp.path().join("proj");
    ensure_git_repo(&project).unwrap();
    let upstream = upstream_branch(&project).unwrap();
    assert!(upstream.is_none(), "fresh repo has no upstream");
}
