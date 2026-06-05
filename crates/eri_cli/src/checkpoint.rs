//! Workspace checkpoints for `/rewind` -- eri's undo edge over text-only CLIs.
//!
//! Before each chat turn we snapshot the workspace's text files. `/rewind`
//! restores the most recent snapshot, reverting whatever the last turn wrote.
//! Snapshots live in memory for the session run (cheap for the small workspaces
//! eri builds into). Large or binary-heavy trees are skipped with a clear note.

use std::path::{Path, PathBuf};

/// Caps so snapshotting a huge tree can't blow memory or stall a turn.
const MAX_FILES: usize = 400;
const MAX_TOTAL_BYTES: usize = 8 * 1024 * 1024;
const MAX_FILE_BYTES: usize = 512 * 1024;

/// Directory names never worth snapshotting.
const SKIP_DIRS: &[&str] = &[".git", "node_modules", "target", ".next", "dist", "build"];

/// One captured file (relative path + bytes).
#[derive(Debug, Clone, PartialEq, Eq)]
struct Entry {
    rel: PathBuf,
    bytes: Vec<u8>,
}

/// An immutable snapshot of a workspace's files.
#[derive(Debug, Clone)]
pub struct Snapshot {
    entries: Vec<Entry>,
}

impl Snapshot {
    /// Number of files captured in this snapshot. Retained for status/UX
    /// display of a checkpoint's size.
    #[allow(dead_code)]
    pub fn file_count(&self) -> usize {
        self.entries.len()
    }
}

fn is_skippable_dir(name: &str) -> bool {
    name.starts_with('.') && name != "." || SKIP_DIRS.contains(&name)
}

fn walk(dir: &Path, root: &Path, out: &mut Vec<Entry>, total: &mut usize) -> bool {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return true;
    };
    for entry in rd.filter_map(std::result::Result::ok) {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let ft = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        if ft.is_symlink() {
            continue; // never follow symlinks
        }
        if ft.is_dir() {
            if is_skippable_dir(&name) {
                continue;
            }
            if !walk(&path, root, out, total) {
                return false; // cap hit
            }
            continue;
        }
        if !ft.is_file() {
            continue;
        }
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if meta.len() as usize > MAX_FILE_BYTES {
            continue; // skip oversized individual files
        }
        let Ok(bytes) = std::fs::read(&path) else {
            continue;
        };
        *total += bytes.len();
        if out.len() >= MAX_FILES || *total > MAX_TOTAL_BYTES {
            return false; // too big -> abort, no checkpoint
        }
        if let Ok(rel) = path.strip_prefix(root) {
            out.push(Entry {
                rel: rel.to_path_buf(),
                bytes,
            });
        }
    }
    true
}

/// Capture a snapshot of `root`. Returns `None` if the tree is too large to
/// checkpoint (caller should tell the user /rewind is unavailable here).
pub fn capture(root: &Path) -> Option<Snapshot> {
    let mut entries = Vec::new();
    let mut total = 0usize;
    if !walk(root, root, &mut entries, &mut total) {
        return None;
    }
    Some(Snapshot { entries })
}

/// Restore a snapshot's files under `root`, overwriting current content.
/// Returns the number of files written. Files created *after* the snapshot are
/// left in place (we only restore what we captured).
pub fn restore(root: &Path, snap: &Snapshot) -> std::io::Result<usize> {
    let mut written = 0;
    for e in &snap.entries {
        let path = root.join(&e.rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&path, &e.bytes)?;
        written += 1;
    }
    Ok(written)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn capture_then_restore_reverts_changes() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        std::fs::write(root.join("a.txt"), "original").unwrap();
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(root.join("src/main.rs"), "fn main() {}").unwrap();

        let snap = capture(root).unwrap();
        assert_eq!(snap.file_count(), 2);

        // Mutate after the snapshot.
        std::fs::write(root.join("a.txt"), "CHANGED").unwrap();
        std::fs::write(root.join("src/main.rs"), "broken").unwrap();

        let n = restore(root, &snap).unwrap();
        assert_eq!(n, 2);
        assert_eq!(
            std::fs::read_to_string(root.join("a.txt")).unwrap(),
            "original"
        );
        assert_eq!(
            std::fs::read_to_string(root.join("src/main.rs")).unwrap(),
            "fn main() {}"
        );
    }

    #[test]
    fn capture_skips_git_and_node_modules() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        std::fs::write(root.join("keep.txt"), "x").unwrap();
        std::fs::create_dir_all(root.join(".git")).unwrap();
        std::fs::write(root.join(".git/HEAD"), "ref").unwrap();
        std::fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        std::fs::write(root.join("node_modules/pkg/index.js"), "lib").unwrap();

        let snap = capture(root).unwrap();
        assert_eq!(snap.file_count(), 1);
    }
}
