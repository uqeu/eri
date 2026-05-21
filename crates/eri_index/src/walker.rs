//! Workspace walker.
//!
//! Wraps the `ignore` crate so `.gitignore`, global gitignore, and our
//! custom `.eriignore` (same syntax) are all honored automatically.

use std::path::{Path, PathBuf};

/// Default per-file byte cap. Files larger than this are skipped to avoid
/// indexing lockfiles, vendored bundles, minified JS, and binary blobs.
pub const DEFAULT_MAX_FILE_BYTES: u64 = 1 << 20;

#[derive(Clone, Debug)]
pub struct WalkOptions {
    pub max_file_bytes: u64,
}

impl Default for WalkOptions {
    fn default() -> Self {
        Self {
            max_file_bytes: DEFAULT_MAX_FILE_BYTES,
        }
    }
}

#[derive(Clone, Debug)]
pub struct WalkedFile {
    pub path: PathBuf,
    pub bytes: u64,
}

/// Walk `root` and yield every indexable file path.
///
/// `.gitignore` and `.eriignore` rules apply transparently. Files above
/// `options.max_file_bytes` and entries inside `.eri/` (our own state
/// directory) are filtered out.
pub fn walk(root: &Path, options: &WalkOptions) -> Vec<WalkedFile> {
    let mut builder = ignore::WalkBuilder::new(root);
    builder
        .standard_filters(true)
        .hidden(false)
        .require_git(false)
        .add_custom_ignore_filename(".eriignore");

    let max_bytes = options.max_file_bytes;
    let mut out: Vec<WalkedFile> = Vec::new();

    for entry in builder.build().flatten() {
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let path = entry.path();
        if is_inside_state_dir(path, root) {
            continue;
        }
        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if metadata.len() > max_bytes {
            continue;
        }
        out.push(WalkedFile {
            path: path.to_path_buf(),
            bytes: metadata.len(),
        });
    }

    out
}

fn is_inside_state_dir(path: &Path, root: &Path) -> bool {
    let rel = match path.strip_prefix(root) {
        Ok(r) => r,
        Err(_) => return false,
    };
    rel.components()
        .next()
        .and_then(|c| c.as_os_str().to_str())
        .map(|s| s == ".eri")
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn walks_files_and_respects_size_cap() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();
        fs::write(root.join("small.txt"), b"hi").unwrap();
        fs::write(root.join("big.bin"), vec![0u8; 4096]).unwrap();
        let opts = WalkOptions {
            max_file_bytes: 1024,
        };
        let files = walk(root, &opts);
        let names: Vec<String> = files
            .iter()
            .map(|f| f.path.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert!(names.contains(&"small.txt".to_string()));
        assert!(!names.contains(&"big.bin".to_string()));
    }

    #[test]
    fn honors_gitignore() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();
        fs::write(root.join(".gitignore"), b"ignored.txt\n").unwrap();
        fs::write(root.join("ignored.txt"), b"x").unwrap();
        fs::write(root.join("kept.txt"), b"x").unwrap();
        let files = walk(root, &WalkOptions::default());
        let names: Vec<String> = files
            .iter()
            .map(|f| f.path.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert!(names.contains(&"kept.txt".to_string()));
        assert!(!names.contains(&"ignored.txt".to_string()));
    }

    #[test]
    fn honors_eriignore() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();
        fs::write(root.join(".eriignore"), b"secret.txt\n").unwrap();
        fs::write(root.join("secret.txt"), b"x").unwrap();
        fs::write(root.join("public.txt"), b"x").unwrap();
        let files = walk(root, &WalkOptions::default());
        let names: Vec<String> = files
            .iter()
            .map(|f| f.path.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert!(names.contains(&"public.txt".to_string()));
        assert!(!names.contains(&"secret.txt".to_string()));
    }

    #[test]
    fn skips_state_directory() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();
        fs::create_dir_all(root.join(".eri")).unwrap();
        fs::write(root.join(".eri/index.sqlite"), b"db").unwrap();
        fs::write(root.join("src.rs"), b"fn main() {}").unwrap();
        let files = walk(root, &WalkOptions::default());
        let names: Vec<String> = files
            .iter()
            .map(|f| f.path.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert!(names.contains(&"src.rs".to_string()));
        assert!(!names.contains(&"index.sqlite".to_string()));
    }
}
