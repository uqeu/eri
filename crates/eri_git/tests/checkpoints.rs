//! Integration tests for the checkpoint API. These shell out to the real
//! `git` CLI and so are skipped when git isn't on PATH.

use std::{fs, path::Path, process::Command};

use eri_git::{ChangeKind, CheckpointStore, RestoreOptions, ensure_git_repo};
use tempfile::TempDir;

fn git_on_path() -> bool {
    Command::new("git")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn fresh_repo() -> Option<(TempDir, std::path::PathBuf)> {
    if !git_on_path() {
        eprintln!("git not on PATH — skipping");
        return None;
    }
    let tmp = TempDir::new().unwrap();
    let project = tmp.path().join("proj");
    ensure_git_repo(&project).unwrap();
    Some((tmp, project))
}

fn commit_all(project: &Path, message: &str) {
    let status = Command::new("git")
        .arg("-C")
        .arg(project)
        .args(["add", "-A"])
        .status()
        .unwrap();
    assert!(status.success());
    let status = Command::new("git")
        .arg("-C")
        .arg(project)
        .args(["commit", "--allow-empty", "-m", message])
        .status()
        .unwrap();
    assert!(status.success());
}

#[test]
fn open_rejects_non_repo() {
    if !git_on_path() {
        return;
    }
    let tmp = TempDir::new().unwrap();
    let result = CheckpointStore::open(tmp.path());
    assert!(matches!(result, Err(eri_git::GitError::NotARepo(_))));
}

#[test]
fn create_on_clean_tree_returns_valid_checkpoint() {
    let Some((_tmp, project)) = fresh_repo() else {
        return;
    };
    let store = CheckpointStore::open(&project).unwrap();
    let cp = store.create("clean snapshot").unwrap();
    assert!(cp.id.starts_with("eri-"));
    assert_eq!(cp.label, "clean snapshot");
    assert_eq!(cp.sha.len(), 40);
}

#[test]
fn create_on_dirty_tree_captures_tracked_and_untracked() {
    let Some((_tmp, project)) = fresh_repo() else {
        return;
    };
    // Tracked-but-dirty file.
    fs::write(project.join("tracked.txt"), "v1").unwrap();
    commit_all(&project, "add tracked");
    fs::write(project.join("tracked.txt"), "v2-uncommitted").unwrap();
    // Untracked file.
    fs::write(project.join("new.txt"), "fresh").unwrap();

    let store = CheckpointStore::open(&project).unwrap();
    let cp = store.create("before edits").unwrap();

    // Verify the captured tree contains both files at their working state.
    let tracked = Command::new("git")
        .arg("-C")
        .arg(&project)
        .args(["show", &format!("{}:tracked.txt", cp.sha)])
        .output()
        .unwrap();
    assert!(tracked.status.success());
    assert_eq!(
        String::from_utf8_lossy(&tracked.stdout).trim_end(),
        "v2-uncommitted"
    );

    let untracked = Command::new("git")
        .arg("-C")
        .arg(&project)
        .args(["show", &format!("{}:new.txt", cp.sha)])
        .output()
        .unwrap();
    assert!(untracked.status.success());
    assert_eq!(
        String::from_utf8_lossy(&untracked.stdout).trim_end(),
        "fresh"
    );
}

#[test]
fn list_returns_checkpoints_newest_first() {
    let Some((_tmp, project)) = fresh_repo() else {
        return;
    };
    let store = CheckpointStore::open(&project).unwrap();
    fs::write(project.join("a.txt"), "1").unwrap();
    let first = store.create("first").unwrap();
    // Sleep one second so creator timestamps differ — git records reflog
    // timestamps at second resolution.
    std::thread::sleep(std::time::Duration::from_millis(1100));
    fs::write(project.join("b.txt"), "2").unwrap();
    let second = store.create("second").unwrap();

    let listed = store.list().unwrap();
    assert_eq!(listed.len(), 2);
    assert_eq!(listed[0].id, second.id);
    assert_eq!(listed[0].label, "second");
    assert_eq!(listed[1].id, first.id);
    assert_eq!(listed[1].label, "first");
}

#[test]
fn restore_roundtrips_to_checkpoint_state() {
    let Some((_tmp, project)) = fresh_repo() else {
        return;
    };
    fs::write(project.join("data.txt"), "original").unwrap();
    commit_all(&project, "seed data");

    let store = CheckpointStore::open(&project).unwrap();
    let cp = store.create("pre-edit").unwrap();

    // Simulate agent edits.
    fs::write(project.join("data.txt"), "agent-modified").unwrap();
    fs::write(project.join("agent-new.txt"), "added by agent").unwrap();

    let report = store
        .restore(
            &cp.id,
            RestoreOptions {
                force: true,
                dry_run: false,
            },
        )
        .unwrap();

    assert_eq!(
        fs::read_to_string(project.join("data.txt")).unwrap(),
        "original"
    );
    assert!(
        !project.join("agent-new.txt").exists(),
        "agent-added file must be removed on restore"
    );
    assert!(report.files_skipped.is_empty());
}

#[test]
fn restore_refuses_when_uncommitted_changes_would_be_lost() {
    let Some((_tmp, project)) = fresh_repo() else {
        return;
    };
    fs::write(project.join("data.txt"), "v1").unwrap();
    commit_all(&project, "seed");

    let store = CheckpointStore::open(&project).unwrap();
    let cp = store.create("snapshot v1").unwrap();

    // User edits the same file the checkpoint would touch — not committed.
    fs::write(project.join("data.txt"), "user-edit").unwrap();

    let result = store.restore(&cp.id, RestoreOptions::default());
    assert!(
        result.is_err(),
        "must refuse without force when work would be lost"
    );

    // User's edit is still on disk.
    assert_eq!(
        fs::read_to_string(project.join("data.txt")).unwrap(),
        "user-edit"
    );
}

#[test]
fn restore_dry_run_lists_files_without_writing() {
    let Some((_tmp, project)) = fresh_repo() else {
        return;
    };
    fs::write(project.join("data.txt"), "v1").unwrap();
    commit_all(&project, "seed");

    let store = CheckpointStore::open(&project).unwrap();
    let cp = store.create("snapshot").unwrap();

    fs::write(project.join("data.txt"), "v2").unwrap();
    fs::write(project.join("untracked.txt"), "added").unwrap();
    commit_all(&project, "land edits");

    let report = store
        .restore(
            &cp.id,
            RestoreOptions {
                force: true,
                dry_run: true,
            },
        )
        .unwrap();

    // Dry run reports something but does not change the working tree.
    assert!(!report.files_restored.is_empty(), "dry run lists files");
    assert_eq!(
        fs::read_to_string(project.join("data.txt")).unwrap(),
        "v2",
        "dry run must not write"
    );
}

#[test]
fn prune_keeps_only_the_n_most_recent_checkpoints() {
    let Some((_tmp, project)) = fresh_repo() else {
        return;
    };
    let store = CheckpointStore::open(&project).unwrap();
    for i in 0..5 {
        fs::write(project.join(format!("f{i}.txt")), format!("{i}")).unwrap();
        store.create(&format!("cp {i}")).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(1100));
    }
    let removed = store.prune(2).unwrap();
    assert_eq!(removed, 3, "three oldest checkpoints pruned");

    let remaining = store.list().unwrap();
    assert_eq!(remaining.len(), 2);
    assert_eq!(remaining[0].label, "cp 4");
    assert_eq!(remaining[1].label, "cp 3");
}

#[test]
fn delete_removes_a_single_checkpoint() {
    let Some((_tmp, project)) = fresh_repo() else {
        return;
    };
    let store = CheckpointStore::open(&project).unwrap();
    fs::write(project.join("a.txt"), "1").unwrap();
    let cp = store.create("doomed").unwrap();
    assert_eq!(store.list().unwrap().len(), 1);
    store.delete(&cp.id).unwrap();
    assert!(store.list().unwrap().is_empty());

    // Deleting an unknown id reports a clear error.
    let result = store.delete("eri-does-not-exist");
    assert!(result.is_err());
}

#[test]
fn show_lists_modified_files_between_checkpoint_and_working_tree() {
    let Some((_tmp, project)) = fresh_repo() else {
        return;
    };
    fs::write(project.join("data.txt"), "original\n").unwrap();
    commit_all(&project, "seed");

    let store = CheckpointStore::open(&project).unwrap();
    let cp = store.create("baseline").unwrap();

    fs::write(project.join("data.txt"), "edited\nnew line\n").unwrap();
    fs::write(project.join("added.txt"), "brand new\n").unwrap();

    let diff = store.show(&cp.id).unwrap();
    let paths: Vec<_> = diff
        .files_changed
        .iter()
        .map(|f| f.path.to_string_lossy().to_string())
        .collect();
    assert!(paths.iter().any(|p| p == "data.txt"));
    // `added.txt` exists in the working tree but not in the checkpoint, so it
    // shows up in `git diff <tree>` as an addition.
    assert!(paths.iter().any(|p| p == "added.txt"));

    let added_entry = diff
        .files_changed
        .iter()
        .find(|f| f.path.to_string_lossy() == "added.txt")
        .unwrap();
    assert_eq!(added_entry.kind, ChangeKind::Added);
}
