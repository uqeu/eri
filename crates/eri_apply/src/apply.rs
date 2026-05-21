use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::matcher::{locate, MatchOutcome};
use crate::Edit;

/// Outcome of an apply pass over multiple edits.
#[derive(Debug, Default)]
pub struct ApplyReport {
    pub applied: Vec<Applied>,
    pub failed: Vec<Failed>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Applied {
    pub path: PathBuf,
    pub bytes_before: usize,
    pub bytes_after: usize,
    pub kind: ApplyKind,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ApplyKind {
    Created,
    Modified,
    Deleted,
    Replaced,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Failed {
    pub path: PathBuf,
    pub reason: FailureReason,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FailureReason {
    SearchNotFound,
    AmbiguousMatch,
    IoError(String),
    PathOutsideRoot,
}

/// Apply every edit relative to `root`. Edits for the same file are batched
/// together so per-file atomicity holds — if any edit for a file fails, the
/// file is left untouched and the failures are recorded; other files still
/// proceed.
pub fn apply(edits: &[Edit], root: &Path) -> ApplyReport {
    let mut grouped: BTreeMap<PathBuf, Vec<&Edit>> = BTreeMap::new();
    let mut report = ApplyReport::default();

    let canonical_root = match fs::canonicalize(root) {
        Ok(p) => p,
        Err(e) => {
            // Root unreadable — every edit fails.
            for edit in edits {
                report.failed.push(Failed {
                    path: edit.path.clone(),
                    reason: FailureReason::IoError(e.to_string()),
                });
            }
            return report;
        }
    };

    for edit in edits {
        grouped.entry(edit.path.clone()).or_default().push(edit);
    }

    for (rel_path, file_edits) in grouped {
        let resolved = match resolve_inside_root(&canonical_root, &rel_path) {
            Ok(p) => p,
            Err(reason) => {
                for e in &file_edits {
                    report.failed.push(Failed {
                        path: e.path.clone(),
                        reason: reason.clone(),
                    });
                }
                continue;
            }
        };
        match apply_one_file(&resolved, &file_edits) {
            Ok(applied) => report.applied.push(Applied {
                path: rel_path,
                ..applied
            }),
            Err(failures) => {
                for f in failures {
                    report.failed.push(Failed {
                        path: rel_path.clone(),
                        reason: f,
                    });
                }
            }
        }
    }

    report
}

struct AppliedPartial {
    bytes_before: usize,
    bytes_after: usize,
    kind: ApplyKind,
}

impl From<AppliedPartial> for Applied {
    fn from(p: AppliedPartial) -> Self {
        Applied {
            path: PathBuf::new(),
            bytes_before: p.bytes_before,
            bytes_after: p.bytes_after,
            kind: p.kind,
        }
    }
}

// NOTE: `apply_one_file` returns the *inner* Applied (without path) so the
// caller can attach the original relative path.
fn apply_one_file(resolved: &Path, edits: &[&Edit]) -> Result<Applied, Vec<FailureReason>> {
    let file_exists = resolved.exists();
    let original: String = if file_exists {
        match fs::read_to_string(resolved) {
            Ok(s) => s,
            Err(e) => return Err(vec![FailureReason::IoError(e.to_string())]),
        }
    } else {
        String::new()
    };
    let bytes_before = original.len();

    let mut current = original.clone();
    let mut any_create = false;
    let mut any_delete = false;
    let mut failures = Vec::new();

    for edit in edits {
        if edit.search.is_empty() {
            // Empty SEARCH = create file (or seed content).
            if !current.is_empty() && file_exists {
                // Treat as append.
                if !current.ends_with('\n') {
                    current.push('\n');
                }
                current.push_str(&edit.replace);
            } else {
                current = edit.replace.clone();
            }
            any_create = !file_exists;
            continue;
        }
        match locate(&current, &edit.search, &edit.replace) {
            MatchOutcome::Unique {
                start,
                end,
                replacement,
            } => {
                let mut next = String::with_capacity(current.len() + replacement.len());
                next.push_str(&current[..start]);
                next.push_str(&replacement);
                next.push_str(&current[end..]);
                current = next;
                if edit.replace.is_empty() {
                    any_delete = true;
                }
            }
            MatchOutcome::NotFound => failures.push(FailureReason::SearchNotFound),
            MatchOutcome::Ambiguous => failures.push(FailureReason::AmbiguousMatch),
        }
    }

    if !failures.is_empty() {
        return Err(failures);
    }

    let bytes_after = current.len();

    // Determine kind. If all edits had empty replace AND the result is empty,
    // treat as Deleted (and remove the file).
    let kind = if any_create && !file_exists {
        ApplyKind::Created
    } else if any_delete && current.trim().is_empty() && file_exists {
        ApplyKind::Deleted
    } else if file_exists && edits.iter().all(|e| !e.search.is_empty()) {
        ApplyKind::Modified
    } else if file_exists {
        ApplyKind::Replaced
    } else {
        ApplyKind::Created
    };

    if matches!(kind, ApplyKind::Deleted) {
        if let Err(e) = fs::remove_file(resolved) {
            return Err(vec![FailureReason::IoError(e.to_string())]);
        }
    } else {
        if let Some(parent) = resolved.parent()
            && !parent.as_os_str().is_empty()
            && let Err(e) = fs::create_dir_all(parent)
        {
            return Err(vec![FailureReason::IoError(e.to_string())]);
        }
        if let Err(e) = atomic_write(resolved, current.as_bytes()) {
            return Err(vec![FailureReason::IoError(e.to_string())]);
        }
    }

    Ok(Applied {
        path: PathBuf::new(),
        bytes_before,
        bytes_after,
        kind,
    })
}

fn atomic_write(target: &Path, contents: &[u8]) -> std::io::Result<()> {
    let parent = target.parent().filter(|p| !p.as_os_str().is_empty());
    let dir = parent.unwrap_or_else(|| Path::new("."));
    let mut named = tempfile::NamedTempFile::new_in(dir)?;
    named.write_all(contents)?;
    named.as_file_mut().sync_all()?;
    named.persist(target).map_err(|e| e.error)?;
    Ok(())
}

fn resolve_inside_root(root: &Path, rel: &Path) -> Result<PathBuf, FailureReason> {
    if rel.is_absolute() {
        return Err(FailureReason::PathOutsideRoot);
    }
    // Reject `..` traversal at the component level before touching the FS so
    // we don't accidentally read symlinks outside the root.
    for component in rel.components() {
        if matches!(component, std::path::Component::ParentDir) {
            return Err(FailureReason::PathOutsideRoot);
        }
    }
    let joined = root.join(rel);
    // Canonicalize the deepest existing prefix; the rest is appended raw.
    let canonical = canonicalize_existing_prefix(&joined)
        .map_err(|e| FailureReason::IoError(e.to_string()))?;
    if !canonical.starts_with(root) {
        return Err(FailureReason::PathOutsideRoot);
    }
    Ok(canonical)
}

fn canonicalize_existing_prefix(path: &Path) -> std::io::Result<PathBuf> {
    if path.exists() {
        return fs::canonicalize(path);
    }
    // Find the deepest ancestor that exists, canonicalize it, then re-append
    // the remaining tail. This is required so we can safely place new files
    // (Created edits) inside the root while still rejecting symlink escapes.
    let mut tail: Vec<&std::ffi::OsStr> = Vec::new();
    let mut cursor = path;
    while !cursor.exists() {
        match cursor.parent() {
            Some(parent) => {
                if let Some(name) = cursor.file_name() {
                    tail.push(name);
                }
                cursor = parent;
            }
            None => break,
        }
    }
    let mut canonical = fs::canonicalize(cursor)?;
    for segment in tail.iter().rev() {
        canonical.push(segment);
    }
    Ok(canonical)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use tempfile::TempDir;

    fn write(root: &Path, rel: &str, body: &str) {
        let p = root.join(rel);
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(p, body).unwrap();
    }

    fn read(root: &Path, rel: &str) -> String {
        fs::read_to_string(root.join(rel)).unwrap()
    }

    #[test]
    fn applies_exact_match() {
        let dir = TempDir::new().unwrap();
        write(dir.path(), "a.txt", "hello world\n");
        let edits = vec![Edit {
            path: PathBuf::from("a.txt"),
            search: "hello".into(),
            replace: "HELLO".into(),
        }];
        let report = apply(&edits, dir.path());
        assert_eq!(report.applied.len(), 1);
        assert!(report.failed.is_empty());
        assert_eq!(read(dir.path(), "a.txt"), "HELLO world\n");
    }

    #[test]
    fn creates_new_file_from_empty_search() {
        let dir = TempDir::new().unwrap();
        let edits = vec![Edit {
            path: PathBuf::from("new/file.txt"),
            search: "".into(),
            replace: "fresh\n".into(),
        }];
        let report = apply(&edits, dir.path());
        assert_eq!(report.applied.len(), 1);
        assert_eq!(report.applied[0].kind, ApplyKind::Created);
        assert_eq!(read(dir.path(), "new/file.txt"), "fresh\n");
    }

    #[test]
    fn deletes_region_with_empty_replace() {
        let dir = TempDir::new().unwrap();
        write(dir.path(), "x.txt", "keep\nremove\nkeep\n");
        let edits = vec![Edit {
            path: PathBuf::from("x.txt"),
            search: "remove\n".into(),
            replace: "".into(),
        }];
        let report = apply(&edits, dir.path());
        assert_eq!(report.applied.len(), 1);
        assert_eq!(read(dir.path(), "x.txt"), "keep\nkeep\n");
    }

    #[test]
    fn ambiguous_match_fails() {
        let dir = TempDir::new().unwrap();
        write(dir.path(), "x.txt", "foo\nfoo\n");
        let edits = vec![Edit {
            path: PathBuf::from("x.txt"),
            search: "foo".into(),
            replace: "bar".into(),
        }];
        let report = apply(&edits, dir.path());
        assert!(report.applied.is_empty());
        assert_eq!(report.failed.len(), 1);
        assert_eq!(report.failed[0].reason, FailureReason::AmbiguousMatch);
        // File untouched.
        assert_eq!(read(dir.path(), "x.txt"), "foo\nfoo\n");
    }

    #[test]
    fn search_not_found_leaves_file_alone() {
        let dir = TempDir::new().unwrap();
        write(dir.path(), "x.txt", "content\n");
        let edits = vec![Edit {
            path: PathBuf::from("x.txt"),
            search: "nope".into(),
            replace: "yep".into(),
        }];
        let report = apply(&edits, dir.path());
        assert_eq!(report.failed.len(), 1);
        assert_eq!(report.failed[0].reason, FailureReason::SearchNotFound);
        assert_eq!(read(dir.path(), "x.txt"), "content\n");
    }

    #[test]
    fn path_escape_attempt_blocked() {
        let dir = TempDir::new().unwrap();
        let edits = vec![Edit {
            path: PathBuf::from("../escape.txt"),
            search: "".into(),
            replace: "evil".into(),
        }];
        let report = apply(&edits, dir.path());
        assert_eq!(report.failed.len(), 1);
        assert_eq!(report.failed[0].reason, FailureReason::PathOutsideRoot);
    }

    #[test]
    fn absolute_path_blocked() {
        let dir = TempDir::new().unwrap();
        let edits = vec![Edit {
            path: PathBuf::from("/etc/passwd"),
            search: "".into(),
            replace: "x".into(),
        }];
        let report = apply(&edits, dir.path());
        assert_eq!(report.failed.len(), 1);
        assert_eq!(report.failed[0].reason, FailureReason::PathOutsideRoot);
    }

    #[test]
    fn multi_block_same_file_atomic() {
        let dir = TempDir::new().unwrap();
        write(dir.path(), "x.txt", "alpha\nbeta\n");
        // First edit succeeds, second fails — entire file should be untouched.
        let edits = vec![
            Edit {
                path: PathBuf::from("x.txt"),
                search: "alpha".into(),
                replace: "ALPHA".into(),
            },
            Edit {
                path: PathBuf::from("x.txt"),
                search: "missing".into(),
                replace: "X".into(),
            },
        ];
        let report = apply(&edits, dir.path());
        assert_eq!(report.applied.len(), 0);
        assert_eq!(report.failed.len(), 1);
        assert_eq!(read(dir.path(), "x.txt"), "alpha\nbeta\n");
    }

    #[test]
    fn other_files_still_proceed_when_one_fails() {
        let dir = TempDir::new().unwrap();
        write(dir.path(), "good.txt", "yes\n");
        write(dir.path(), "bad.txt", "content\n");
        let edits = vec![
            Edit {
                path: PathBuf::from("good.txt"),
                search: "yes".into(),
                replace: "YES".into(),
            },
            Edit {
                path: PathBuf::from("bad.txt"),
                search: "nomatch".into(),
                replace: "X".into(),
            },
        ];
        let report = apply(&edits, dir.path());
        assert_eq!(report.applied.len(), 1);
        assert_eq!(report.failed.len(), 1);
        assert_eq!(read(dir.path(), "good.txt"), "YES\n");
        assert_eq!(read(dir.path(), "bad.txt"), "content\n");
    }

    #[test]
    fn no_temp_files_left_behind_on_success() {
        let dir = TempDir::new().unwrap();
        write(dir.path(), "a.txt", "hi\n");
        let edits = vec![Edit {
            path: PathBuf::from("a.txt"),
            search: "hi".into(),
            replace: "bye".into(),
        }];
        apply(&edits, dir.path());
        let leftover: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_name()
                    .to_string_lossy()
                    .contains(".tmp")
            })
            .collect();
        assert!(leftover.is_empty());
    }

    #[test]
    fn whitespace_tolerant_apply() {
        let dir = TempDir::new().unwrap();
        write(dir.path(), "a.txt", "fn   thing(  ) {\n    println!(\"hi\");\n}\n");
        let edits = vec![Edit {
            path: PathBuf::from("a.txt"),
            search: "fn thing() {\n    println!(\"hi\");\n}".into(),
            replace: "fn thing() {\n    println!(\"bye\");\n}".into(),
        }];
        let report = apply(&edits, dir.path());
        assert_eq!(report.applied.len(), 1);
        assert!(read(dir.path(), "a.txt").contains("bye"));
    }
}
