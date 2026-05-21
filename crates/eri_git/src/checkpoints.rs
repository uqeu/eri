//! Codebase checkpoints — pre-edit snapshots the agent creates before
//! significant changes, so users can roll back from the chat timeline.
//!
//! Checkpoints live in a private ref namespace (`refs/eri/checkpoints/<id>`)
//! so they never collide with the user's branches or stash list. Each
//! checkpoint is a tree object captured via `git stash create`, which encodes
//! the full working tree (tracked + untracked, gitignore respected) without
//! disturbing HEAD or pushing onto the user-visible stash list.

use std::{
    path::{Path, PathBuf},
    process::Command,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use uuid::Uuid;

use crate::{GitError, ensure_repo_exists, run_git};

const REF_PREFIX: &str = "refs/eri/checkpoints/";
const ID_PREFIX: &str = "eri-";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Checkpoint {
    pub id: String,
    pub created_at: SystemTime,
    pub label: String,
    pub sha: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CheckpointDiff {
    pub files_changed: Vec<FileChange>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileChange {
    pub path: PathBuf,
    pub kind: ChangeKind,
    pub added: usize,
    pub removed: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChangeKind {
    Added,
    Modified,
    Deleted,
    Renamed { from: PathBuf },
}

#[derive(Debug, Clone, Copy, Default)]
pub struct RestoreOptions {
    pub force: bool,
    pub dry_run: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RestoreReport {
    pub files_restored: Vec<PathBuf>,
    pub files_skipped: Vec<(PathBuf, String)>,
}

#[derive(Debug, Clone)]
pub struct CheckpointStore {
    workspace: PathBuf,
}

impl CheckpointStore {
    pub fn open(workspace_root: &Path) -> Result<Self, GitError> {
        ensure_repo_exists(workspace_root)?;
        Ok(Self {
            workspace: workspace_root.to_path_buf(),
        })
    }

    pub fn create(&self, label: &str) -> Result<Checkpoint, GitError> {
        let id = generate_id();
        let message = encode_label_message(label);
        let sha = capture_working_tree(&self.workspace, &message)?;
        let ref_name = format!("{REF_PREFIX}{id}");
        run_git(
            &self.workspace,
            &["update-ref", &ref_name, &sha],
        )?;
        let created_at = SystemTime::now();
        Ok(Checkpoint {
            id,
            created_at,
            label: label.to_string(),
            sha,
        })
    }

    pub fn list(&self) -> Result<Vec<Checkpoint>, GitError> {
        ensure_repo_exists(&self.workspace)?;
        // `for-each-ref --format` does not interpret `%xNN` escapes (unlike
        // `git log --pretty=format`), so we use a literal pipe — refs and our
        // own subjects (label is filtered) can't contain it.
        let format = "--format=%(refname)|%(objectname)|%(creatordate:unix)|%(subject)";
        let prefix_arg = REF_PREFIX.trim_end_matches('/');
        let output = run_git(&self.workspace, &["for-each-ref", format, prefix_arg])?;

        let mut checkpoints = Vec::new();
        for line in output.lines() {
            if line.is_empty() {
                continue;
            }
            let mut parts = line.splitn(4, '|');
            let refname = parts.next().unwrap_or("");
            let sha = parts.next().unwrap_or("").to_string();
            let ts = parts.next().and_then(|raw| raw.parse::<u64>().ok());
            let subject = parts.next().unwrap_or("");
            let Some(id) = refname.strip_prefix(REF_PREFIX) else {
                continue;
            };
            if id.is_empty() || sha.is_empty() {
                continue;
            }
            let created_at = ts
                .map(|secs| UNIX_EPOCH + Duration::from_secs(secs))
                .unwrap_or(SystemTime::now());
            checkpoints.push(Checkpoint {
                id: id.to_string(),
                created_at,
                label: decode_label_message(subject),
                sha,
            });
        }
        // Newest first — matches how the chat timeline renders.
        checkpoints.sort_by_key(|cp| std::cmp::Reverse(cp.created_at));
        Ok(checkpoints)
    }

    pub fn show(&self, id: &str) -> Result<CheckpointDiff, GitError> {
        let checkpoint_sha = self.resolve(id)?;
        // Capture the *current* working tree into its own commit object so
        // `git diff` sees untracked files too — plain `git diff <ref>` ignores
        // anything not in the index, which would hide newly-added agent files.
        let current_sha =
            capture_working_tree(&self.workspace, "eri checkpoint (current)")?;
        let numstat = run_git(
            &self.workspace,
            &[
                "diff",
                "--numstat",
                "-z",
                "--find-renames",
                &checkpoint_sha,
                &current_sha,
            ],
        )?;
        let files_changed = parse_numstat(&numstat);
        Ok(CheckpointDiff { files_changed })
    }

    pub fn restore(
        &self,
        id: &str,
        opts: RestoreOptions,
    ) -> Result<RestoreReport, GitError> {
        let sha = self.resolve(id)?;
        let diff = self.show(id)?;

        if !opts.force {
            // Refuse when the working tree holds uncommitted edits that aren't
            // captured anywhere — restoring would silently destroy them.
            let dirty = uncommitted_paths(&self.workspace)?;
            let restored_paths: Vec<PathBuf> =
                diff.files_changed.iter().map(|f| f.path.clone()).collect();
            let conflicts: Vec<PathBuf> = dirty
                .into_iter()
                .filter(|p| restored_paths.contains(p))
                .collect();
            if !conflicts.is_empty() {
                return Err(GitError::GitCommandFailed {
                    command: "checkpoint restore".to_string(),
                    exit_code: -1,
                    stderr: format!(
                        "uncommitted changes would be lost: {}",
                        conflicts
                            .iter()
                            .map(|p| p.display().to_string())
                            .collect::<Vec<_>>()
                            .join(", ")
                    ),
                });
            }
        }

        if opts.dry_run {
            return Ok(RestoreReport {
                files_restored: diff
                    .files_changed
                    .iter()
                    .map(|f| f.path.clone())
                    .collect(),
                files_skipped: Vec::new(),
            });
        }

        // read-tree primes the index from the checkpoint tree; checkout-index
        // then materialises the index into the working tree. We don't move
        // HEAD, which is the whole point — the user's branch stays put.
        run_git(&self.workspace, &["read-tree", &sha])?;
        run_git(
            &self.workspace,
            &["checkout-index", "--force", "--all"],
        )?;
        // Delete files that exist in the working tree but not in the
        // checkpoint — checkout-index can't remove what isn't in the index.
        let mut files_restored: Vec<PathBuf> = Vec::new();
        let mut files_skipped: Vec<(PathBuf, String)> = Vec::new();
        for change in &diff.files_changed {
            if matches!(change.kind, ChangeKind::Added) {
                // The working tree had this file, the checkpoint did not, so
                // restore means "remove it". `Added` is from the diff's
                // perspective (checkpoint -> working tree).
                let absolute = self.workspace.join(&change.path);
                if absolute.exists() {
                    match std::fs::remove_file(&absolute) {
                        Ok(()) => files_restored.push(change.path.clone()),
                        Err(error) => {
                            files_skipped.push((change.path.clone(), error.to_string()))
                        }
                    }
                }
            } else {
                files_restored.push(change.path.clone());
            }
        }
        Ok(RestoreReport {
            files_restored,
            files_skipped,
        })
    }

    pub fn prune(&self, keep: usize) -> Result<usize, GitError> {
        let mut all = self.list()?;
        if all.len() <= keep {
            return Ok(0);
        }
        // `list` is newest-first; everything past `keep` is the discard tail.
        let discard = all.split_off(keep);
        let mut removed = 0;
        for cp in discard {
            self.delete(&cp.id)?;
            removed += 1;
        }
        Ok(removed)
    }

    pub fn delete(&self, id: &str) -> Result<(), GitError> {
        ensure_repo_exists(&self.workspace)?;
        let ref_name = format!("{REF_PREFIX}{id}");
        // Probe first so a missing id reports cleanly rather than as a raw
        // git error from update-ref -d.
        let probe = Command::new("git")
            .arg("-C")
            .arg(&self.workspace)
            .args(["rev-parse", "--verify", &ref_name])
            .output()
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    GitError::GitNotFound
                } else {
                    GitError::Io(e)
                }
            })?;
        if !probe.status.success() {
            return Err(GitError::GitCommandFailed {
                command: format!("git rev-parse {ref_name}"),
                exit_code: probe.status.code().unwrap_or(-1),
                stderr: format!("checkpoint not found: {id}"),
            });
        }
        run_git(&self.workspace, &["update-ref", "-d", &ref_name])?;
        Ok(())
    }

    fn resolve(&self, id: &str) -> Result<String, GitError> {
        ensure_repo_exists(&self.workspace)?;
        let ref_name = format!("{REF_PREFIX}{id}");
        let output = Command::new("git")
            .arg("-C")
            .arg(&self.workspace)
            .args(["rev-parse", "--verify", &ref_name])
            .output()
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    GitError::GitNotFound
                } else {
                    GitError::Io(e)
                }
            })?;
        if !output.status.success() {
            return Err(GitError::GitCommandFailed {
                command: format!("git rev-parse {ref_name}"),
                exit_code: output.status.code().unwrap_or(-1),
                stderr: format!("checkpoint not found: {id}"),
            });
        }
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }
}

fn generate_id() -> String {
    let raw = Uuid::new_v4().simple().to_string();
    // 12 chars is enough entropy for per-workspace checkpoint ids while
    // keeping refs readable in `git for-each-ref` output.
    format!("{ID_PREFIX}{}", &raw[..12])
}

/// Capture the full working tree (tracked + untracked, .gitignore respected)
/// as a commit-like object and return its SHA.
///
/// Implementation: build the tree against a *temporary* index file via
/// `GIT_INDEX_FILE`, so the user's real index is untouched. We populate the
/// temp index from HEAD, then `add -A` on top to pick up every edit and every
/// untracked-but-not-ignored file in one shot, then `write-tree` +
/// `commit-tree` to wrap the result in a parentless commit. `git stash create`
/// would have been more compact, but it silently produces no SHA when the
/// only changes are untracked — exactly the case an agent-edit checkpoint
/// needs to capture.
fn capture_working_tree(workspace: &Path, commit_message: &str) -> Result<String, GitError> {
    ensure_repo_exists(workspace)?;

    let git_dir = run_git(workspace, &["rev-parse", "--git-dir"])?;
    let git_dir_trimmed = git_dir.trim();
    let temp_index_rel = format!("eri-checkpoint-index-{}", Uuid::new_v4().simple());
    let temp_index_abs = Path::new(git_dir_trimmed);
    let temp_index_path = if temp_index_abs.is_absolute() {
        temp_index_abs.join(&temp_index_rel)
    } else {
        workspace.join(git_dir_trimmed).join(&temp_index_rel)
    };

    // Best-effort cleanup wrapper: anything that touches the temp index path
    // removes it on the way out so a panic doesn't litter the repo.
    let result = (|| -> Result<String, GitError> {
        // Seed the temp index from HEAD so tracked deletes show up correctly
        // when we add -A below.
        run_with_index(workspace, &temp_index_path, &["read-tree", "HEAD"])?;
        run_with_index(workspace, &temp_index_path, &["add", "-A"])?;
        let tree = run_with_index(workspace, &temp_index_path, &["write-tree"])?;
        let tree_sha = tree.trim();
        let parent = run_git(workspace, &["rev-parse", "HEAD"])?;
        let parent_sha = parent.trim();
        let commit = run_git(
            workspace,
            &[
                "commit-tree",
                tree_sha,
                "-p",
                parent_sha,
                "-m",
                commit_message,
            ],
        )?;
        Ok(commit.trim().to_string())
    })();

    let _ = std::fs::remove_file(&temp_index_path);
    result
}

fn run_with_index(
    workspace: &Path,
    index_path: &Path,
    args: &[&str],
) -> Result<String, GitError> {
    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(workspace)
        .env("GIT_INDEX_FILE", index_path)
        .args(args);
    let output = match command.output() {
        Ok(output) => output,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(GitError::GitNotFound);
        }
        Err(error) => return Err(GitError::Io(error)),
    };
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(GitError::GitCommandFailed {
            command: format!("git {}", args.join(" ")),
            exit_code: output.status.code().unwrap_or(-1),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        })
    }
}

fn encode_label_message(label: &str) -> String {
    // Newlines and `|` break the for-each-ref decoder (we use `|` as the
    // field separator because `--format` does not interpret `%xNN`).
    let cleaned: String = label
        .chars()
        .map(|c| match c {
            '\n' | '\r' | '|' => ' ',
            other => other,
        })
        .collect();
    format!("eri-checkpoint: {cleaned}")
}

fn decode_label_message(subject: &str) -> String {
    subject
        .strip_prefix("eri-checkpoint: ")
        .unwrap_or(subject)
        .to_string()
}

fn parse_numstat(raw: &str) -> Vec<FileChange> {
    let mut out = Vec::new();
    // `-z` makes git emit NUL-terminated records and split renames into
    // three NULs (numbers + old + new). Walk the stream tokenwise.
    let mut tokens = raw.split('\0').filter(|t| !t.is_empty());
    while let Some(stats) = tokens.next() {
        let mut parts = stats.split('\t');
        let added_raw = parts.next().unwrap_or("0");
        let removed_raw = parts.next().unwrap_or("0");
        let path_inline = parts.next().unwrap_or("");
        let added = added_raw.parse::<usize>().unwrap_or(0);
        let removed = removed_raw.parse::<usize>().unwrap_or(0);
        if path_inline.is_empty() {
            // Rename — next two tokens are old and new paths.
            let from = tokens.next().unwrap_or("").to_string();
            let to = tokens.next().unwrap_or("").to_string();
            if to.is_empty() {
                continue;
            }
            out.push(FileChange {
                path: PathBuf::from(to),
                kind: ChangeKind::Renamed { from: PathBuf::from(from) },
                added,
                removed,
            });
        } else {
            // Inferring add/modify/delete from numstat alone is ambiguous, but
            // git's convention is: added==0 && a corresponding file exists in
            // the checkpoint but not on disk -> Deleted from the workspace POV.
            // For checkpoint diffs we treat removed==0 as Added (new in
            // working tree), added==0 as Deleted, otherwise Modified.
            let kind = if added > 0 && removed == 0 {
                ChangeKind::Added
            } else if removed > 0 && added == 0 {
                ChangeKind::Deleted
            } else {
                ChangeKind::Modified
            };
            out.push(FileChange {
                path: PathBuf::from(path_inline),
                kind,
                added,
                removed,
            });
        }
    }
    out
}

/// Paths with uncommitted changes in the working tree. Used by `restore` to
/// refuse to clobber work the user hasn't saved anywhere.
fn uncommitted_paths(workspace: &Path) -> Result<Vec<PathBuf>, GitError> {
    let raw = run_git(workspace, &["status", "--porcelain=v1", "-z"])?;
    let mut out = Vec::new();
    for record in raw.split('\0') {
        if record.len() < 4 {
            continue;
        }
        // Format: XY<space>path  (XY are two status chars).
        let path = &record[3..];
        if !path.is_empty() {
            out.push(PathBuf::from(path));
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_id_has_expected_prefix() {
        let id = generate_id();
        assert!(id.starts_with(ID_PREFIX));
        assert_eq!(id.len(), ID_PREFIX.len() + 12);
    }

    #[test]
    fn encode_decode_label_roundtrip() {
        let original = "before refactor";
        let encoded = encode_label_message(original);
        assert_eq!(decode_label_message(&encoded), original);
    }

    #[test]
    fn encode_strips_newlines() {
        let encoded = encode_label_message("line one\nline two");
        assert!(!encoded.contains('\n'));
    }

    #[test]
    fn encode_strips_pipe_separator() {
        let encoded = encode_label_message("before|after");
        assert!(!encoded.contains('|'));
    }
}
