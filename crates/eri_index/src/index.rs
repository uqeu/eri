//! Top-level [`Index`] type — workspace walk, chunk, embed, persist, search.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::Instant;

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::chunker::{chunk_file, Chunk};
use crate::embedder::{DummyEmbedder, Embedder, EmbedderError};
use crate::store::{Store, StoreError};
use crate::walker::{walk, WalkOptions, WalkedFile};

const STATE_DIR: &str = ".eri";
const DB_FILENAME: &str = "index.sqlite";

#[derive(Debug, Error)]
pub enum IndexError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("storage: {0}")]
    Store(#[from] StoreError),
    #[error("embedding: {0}")]
    Embedder(#[from] EmbedderError),
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SyncReport {
    pub files_added: usize,
    pub files_modified: usize,
    pub files_removed: usize,
    pub chunks_total: usize,
    pub duration_ms: u128,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct IndexStats {
    pub files: usize,
    pub chunks: usize,
    pub bytes_indexed: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SearchResult {
    pub chunk: Chunk,
    pub score: f32,
}

pub struct Index {
    workspace_root: PathBuf,
    store: Store,
    embedder: Box<dyn Embedder>,
    walk_options: WalkOptions,
}

impl Index {
    /// Open (or create) an index for `workspace_root`. Uses the default
    /// embedder — currently [`DummyEmbedder`]. Callers that want a real
    /// embedding backend should use [`Index::open_with_embedder`].
    pub fn open(workspace_root: &Path) -> Result<Self, IndexError> {
        Self::open_with_embedder(workspace_root, Box::new(DummyEmbedder::new()))
    }

    pub fn open_with_embedder(
        workspace_root: &Path,
        embedder: Box<dyn Embedder>,
    ) -> Result<Self, IndexError> {
        let db_path = workspace_root.join(STATE_DIR).join(DB_FILENAME);
        let store = Store::open(&db_path)?;
        Ok(Self {
            workspace_root: workspace_root.to_path_buf(),
            store,
            embedder,
            walk_options: WalkOptions::default(),
        })
    }

    pub fn with_walk_options(mut self, options: WalkOptions) -> Self {
        self.walk_options = options;
        self
    }

    /// Walk the workspace, hash each file, re-chunk and re-embed any
    /// file whose hash changed, and delete state for files that no
    /// longer exist.
    pub fn sync(&mut self) -> Result<SyncReport, IndexError> {
        let started = Instant::now();
        let files = walk(&self.workspace_root, &self.walk_options);

        let mut seen_paths: HashSet<String> = HashSet::with_capacity(files.len());
        let mut added = 0usize;
        let mut modified = 0usize;

        for file in &files {
            let rel = relative_path(&self.workspace_root, &file.path);
            seen_paths.insert(rel.clone());
            match self.sync_file(&rel, file)? {
                FileSyncOutcome::Added => added += 1,
                FileSyncOutcome::Modified => modified += 1,
                FileSyncOutcome::Unchanged => {}
            }
        }

        let mut removed = 0usize;
        let existing_paths = self.store.list_file_paths()?;
        for path in existing_paths {
            if !seen_paths.contains(&path) {
                self.store.delete_file(&path)?;
                removed += 1;
            }
        }

        Ok(SyncReport {
            files_added: added,
            files_modified: modified,
            files_removed: removed,
            chunks_total: self.store.count_chunks()?,
            duration_ms: started.elapsed().as_millis(),
        })
    }

    /// Embed `query` and return the top-k chunks by cosine similarity.
    /// Brute force over every (chunk, vector) pair — fine for the
    /// hundreds-of-thousands of chunks a typical workspace produces.
    pub fn search(&self, query: &str, top_k: usize) -> Result<Vec<SearchResult>, IndexError> {
        if top_k == 0 {
            return Ok(Vec::new());
        }
        let query_vec = self.embedder.embed_one(query)?;
        let pairs = self.store.iter_chunks_with_vectors()?;
        let mut scored: Vec<SearchResult> = pairs
            .into_iter()
            .map(|(stored, vec)| SearchResult {
                chunk: stored.chunk,
                score: cosine_similarity(&query_vec, &vec),
            })
            .collect();
        scored.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
        scored.truncate(top_k);
        Ok(scored)
    }

    pub fn stats(&self) -> IndexStats {
        IndexStats {
            files: self.store.count_files().unwrap_or(0),
            chunks: self.store.count_chunks().unwrap_or(0),
            bytes_indexed: self.store.total_bytes().unwrap_or(0),
        }
    }

    fn sync_file(
        &mut self,
        rel_path: &str,
        file: &WalkedFile,
    ) -> Result<FileSyncOutcome, IndexError> {
        let bytes = std::fs::read(&file.path)?;
        let content_hash = blake3::hash(&bytes).as_bytes().to_vec();
        let mtime = file_mtime_secs(&file.path).unwrap_or(0);

        let existing = self.store.get_file_state(rel_path)?;
        let outcome = match &existing {
            Some(state) if state.content_hash == content_hash => {
                return Ok(FileSyncOutcome::Unchanged);
            }
            Some(_) => FileSyncOutcome::Modified,
            None => FileSyncOutcome::Added,
        };

        let content = match std::str::from_utf8(&bytes) {
            Ok(s) => s.to_string(),
            Err(_) => {
                self.store
                    .upsert_file(rel_path, mtime, &content_hash, &[])?;
                return Ok(outcome);
            }
        };

        let chunks = chunk_file(rel_path, &content);
        if chunks.is_empty() {
            self.store
                .upsert_file(rel_path, mtime, &content_hash, &[])?;
            return Ok(outcome);
        }

        let inputs: Vec<String> = chunks.iter().map(|c| c.content.clone()).collect();
        let vectors = self.embedder.embed_batch(&inputs)?;
        let pairs: Vec<(Chunk, Vec<f32>)> = chunks.into_iter().zip(vectors).collect();
        self.store
            .upsert_file(rel_path, mtime, &content_hash, &pairs)?;
        Ok(outcome)
    }
}

enum FileSyncOutcome {
    Added,
    Modified,
    Unchanged,
}

fn relative_path(root: &Path, absolute: &Path) -> String {
    absolute
        .strip_prefix(root)
        .unwrap_or(absolute)
        .to_string_lossy()
        .into_owned()
}

fn file_mtime_secs(path: &Path) -> Option<i64> {
    let metadata = std::fs::metadata(path).ok()?;
    let modified = metadata.modified().ok()?;
    let elapsed = modified
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_secs();
    Some(elapsed as i64)
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.is_empty() || b.is_empty() || a.len() != b.len() {
        return 0.0;
    }
    let mut dot = 0.0f32;
    let mut na = 0.0f32;
    let mut nb = 0.0f32;
    for (x, y) in a.iter().zip(b) {
        dot += x * y;
        na += x * x;
        nb += y * y;
    }
    let denom = na.sqrt() * nb.sqrt();
    if denom == 0.0 {
        0.0
    } else {
        dot / denom
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn sync_adds_files_then_detects_unchanged() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();
        fs::write(root.join("alpha.rs"), b"fn alpha() {}\n").unwrap();
        fs::write(root.join("beta.py"), b"def beta():\n    return 1\n").unwrap();

        let mut index = Index::open(root).unwrap();
        let first = index.sync().unwrap();
        assert_eq!(first.files_added, 2);
        assert_eq!(first.files_modified, 0);
        assert_eq!(first.files_removed, 0);
        assert!(first.chunks_total >= 2);

        let second = index.sync().unwrap();
        assert_eq!(second.files_added, 0);
        assert_eq!(second.files_modified, 0);
        assert_eq!(second.files_removed, 0);
    }

    #[test]
    fn sync_detects_modifications_and_removals() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();
        fs::write(root.join("a.rs"), b"fn a() {}\n").unwrap();
        fs::write(root.join("b.rs"), b"fn b() {}\n").unwrap();

        let mut index = Index::open(root).unwrap();
        index.sync().unwrap();

        fs::write(root.join("a.rs"), b"fn a() { let x = 1; }\n").unwrap();
        fs::remove_file(root.join("b.rs")).unwrap();
        let report = index.sync().unwrap();
        assert_eq!(report.files_modified, 1);
        assert_eq!(report.files_removed, 1);
    }

    #[test]
    fn search_returns_the_relevant_file_for_a_topical_query() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();
        fs::write(
            root.join("contact_form.ts"),
            b"export function submitContactForm(email: string) { return fetch('/contact', { method: 'POST', body: email }); }\n",
        )
        .unwrap();
        fs::write(
            root.join("pricing.ts"),
            b"export function renderPricingTable() { return ['basic', 'pro', 'enterprise']; }\n",
        )
        .unwrap();
        fs::write(
            root.join("auth.ts"),
            b"export function loginUser(username: string, password: string) { return { token: 'abc' }; }\n",
        )
        .unwrap();

        let mut index = Index::open(root).unwrap();
        index.sync().unwrap();

        let results = index.search("contact form submit email", 1).unwrap();
        assert_eq!(results.len(), 1);
        assert!(
            results[0].chunk.path.contains("contact_form"),
            "top result was {:?}",
            results[0].chunk.path
        );

        let stats = index.stats();
        assert_eq!(stats.files, 3);
        assert!(stats.chunks >= 3);
    }

    #[test]
    fn workspace_state_dir_is_skipped() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();
        fs::write(root.join("ok.rs"), b"fn ok() {}\n").unwrap();
        let mut index = Index::open(root).unwrap();
        index.sync().unwrap();
        // The .eri/index.sqlite file the store created must not appear
        // as an indexed file.
        let stats = index.stats();
        assert_eq!(stats.files, 1);
    }
}
