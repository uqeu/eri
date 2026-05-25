//! eri's local memory store — the Learn-Do loop's persistent layer.
//!
//! v1 stores observations + explicit "remember" facts as JSON at
//! `~/.eri/memory.json`. Per-tier retention is enforced on every write.
//! v2 will move to SQLite + eri_graph embeddings; the public API in this
//! module is deliberately framework-light so the migration is a swap of
//! the `Store` trait impl rather than a caller-side change.
//!
//! Observation kinds collected today:
//!   - `"fact"` — explicit `/remember <text>`
//!   - `"edit_accepted"` / `"edit_rejected"` — diff-review outcomes
//!   - `"voice_pattern"` — voice cadence signals (Phase 8b)
//!
//! Pattern extraction (priority 1 system-prompt injection) is implemented
//! as a simple recency-+-frequency rank over the observations until the
//! v2 embedding pipeline lands.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

pub mod collectors;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Observation {
    pub id: String,
    /// Unix epoch milliseconds.
    pub ts_ms: u64,
    pub kind: String,
    /// Workspace path hash (fxhash) so observations are scoped without
    /// leaking the absolute path into the cloud-sync blob.
    pub workspace_hash: String,
    /// Free-form JSON-stringified payload. Keeps the column schemaless
    /// during v1 — typed accessors live in the collectors module.
    pub body: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetentionWindow {
    /// 24 hours — Free tier.
    Day,
    /// 30 days — Starter tier.
    Month,
    /// 6 months — Pro tier.
    Half,
    /// Unbounded — Pro+ tier.
    Forever,
}

impl RetentionWindow {
    pub fn from_tier(tier: &str) -> Self {
        match tier {
            "starter" => RetentionWindow::Month,
            "pro" => RetentionWindow::Half,
            "pro_plus" | "teams" | "enterprise" => RetentionWindow::Forever,
            _ => RetentionWindow::Day,
        }
    }

    fn cutoff_ms(self, now_ms: u64) -> Option<u64> {
        match self {
            RetentionWindow::Day => Some(now_ms.saturating_sub(24 * 60 * 60 * 1000)),
            RetentionWindow::Month => Some(now_ms.saturating_sub(30 * 24 * 60 * 60 * 1000)),
            RetentionWindow::Half => Some(now_ms.saturating_sub(182 * 24 * 60 * 60 * 1000)),
            RetentionWindow::Forever => None,
        }
    }
}

pub fn memory_path() -> io::Result<PathBuf> {
    let home = std::env::var("HOME")
        .ok()
        .or_else(|| std::env::var("USERPROFILE").ok())
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "no HOME or USERPROFILE"))?;
    Ok(PathBuf::from(home).join(".eri").join("memory.json"))
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
struct StoreFile {
    observations: Vec<Observation>,
}

pub struct MemoryStore {
    path: PathBuf,
    file: StoreFile,
}

impl MemoryStore {
    pub fn open() -> io::Result<Self> {
        let path = memory_path()?;
        Self::open_at(path)
    }

    pub fn open_at(path: PathBuf) -> io::Result<Self> {
        let file = match fs::read_to_string(&path) {
            Ok(raw) => serde_json::from_str::<StoreFile>(&raw).unwrap_or_default(),
            Err(err) if err.kind() == io::ErrorKind::NotFound => StoreFile::default(),
            Err(err) => return Err(err),
        };
        Ok(Self { path, file })
    }

    /// Persist to disk. Caller invokes after mutations.
    pub fn save(&self) -> io::Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let raw = serde_json::to_string(&self.file).map_err(|e| {
            io::Error::new(io::ErrorKind::InvalidData, format!("serialize: {e}"))
        })?;
        fs::write(&self.path, raw)
    }

    /// Append an observation and persist.
    pub fn insert(&mut self, kind: &str, workspace: &Path, body: &str) -> io::Result<Observation> {
        let observation = Observation {
            id: new_id(),
            ts_ms: now_ms(),
            kind: kind.to_string(),
            workspace_hash: workspace_hash(workspace),
            body: body.to_string(),
        };
        let cloned = observation.clone();
        self.file.observations.push(observation);
        self.save()?;
        Ok(cloned)
    }

    pub fn all(&self) -> &[Observation] {
        &self.file.observations
    }

    /// Drop observation by id, or `"all"` to clear everything.
    pub fn forget(&mut self, id_or_all: &str) -> io::Result<usize> {
        let before = self.file.observations.len();
        if id_or_all == "all" {
            self.file.observations.clear();
        } else {
            self.file.observations.retain(|o| o.id != id_or_all);
        }
        let removed = before - self.file.observations.len();
        if removed > 0 {
            self.save()?;
        }
        Ok(removed)
    }

    /// Drop observations older than the tier's retention window.
    pub fn prune(&mut self, window: RetentionWindow) -> io::Result<usize> {
        let Some(cutoff) = window.cutoff_ms(now_ms()) else {
            return Ok(0);
        };
        let before = self.file.observations.len();
        self.file.observations.retain(|o| o.ts_ms >= cutoff);
        let removed = before - self.file.observations.len();
        if removed > 0 {
            self.save()?;
        }
        Ok(removed)
    }

    /// Keyword search over `body`, recency-ranked. Embeddings land in v2.
    pub fn recall(&self, query: &str, workspace: &Path, limit: usize) -> Vec<Observation> {
        let needle = query.to_lowercase();
        let hash = workspace_hash(workspace);
        let mut hits: Vec<&Observation> = self
            .file
            .observations
            .iter()
            .filter(|o| o.workspace_hash == hash || o.kind == "fact")
            .filter(|o| {
                if needle.is_empty() {
                    return true;
                }
                o.body.to_lowercase().contains(&needle)
                    || o.kind.to_lowercase().contains(&needle)
            })
            .collect();
        hits.sort_by(|a, b| b.ts_ms.cmp(&a.ts_ms));
        hits.into_iter().take(limit).cloned().collect()
    }

    /// Top-N most-recent observations across all kinds. Used by the system-
    /// prompt injection in `build_parts` to populate `What I've learned about you`.
    pub fn top_patterns(&self, workspace: &Path, limit: usize) -> Vec<Observation> {
        let hash = workspace_hash(workspace);
        let mut hits: Vec<&Observation> = self
            .file
            .observations
            .iter()
            .filter(|o| o.workspace_hash == hash || o.kind == "fact")
            .collect();
        hits.sort_by(|a, b| b.ts_ms.cmp(&a.ts_ms));
        hits.into_iter().take(limit).cloned().collect()
    }
}

/// Format the top patterns as a markdown block suitable for prepending to
/// every model's system prompt. Trimmed to ~600 tokens worth of content.
pub fn format_learned_block(patterns: &[Observation]) -> String {
    if patterns.is_empty() {
        return String::new();
    }
    let mut buf = String::from("## What I've learned about you\n");
    let mut bytes = buf.len();
    for o in patterns {
        let line = format_observation_line(o);
        // ~600 tokens ≈ ~2400 bytes for English text.
        if bytes + line.len() > 2400 {
            break;
        }
        buf.push_str(&line);
        buf.push('\n');
        bytes += line.len() + 1;
    }
    buf
}

fn format_observation_line(o: &Observation) -> String {
    let prefix = match o.kind.as_str() {
        "fact" => "·",
        "edit_accepted" => "✓",
        "edit_rejected" => "✗",
        "voice_pattern" => "🎙",
        _ => "·",
    };
    let body = o.body.lines().next().unwrap_or("");
    let body = if body.len() > 200 { &body[..200] } else { body };
    format!("{prefix} {body}")
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn new_id() -> String {
    // Lightweight ulid-ish identifier. Sufficient uniqueness for a local
    // single-user JSON store; v2 SQLite will use proper ulids.
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let stamp = now_ms();
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("obs_{stamp:013x}{seq:04x}")
}

fn workspace_hash(workspace: &Path) -> String {
    // Stable, non-cryptographic hash of the canonical path. We only need
    // collision-resistance against the user's own workspace count, which
    // is always small.
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let canonical = workspace
        .canonicalize()
        .unwrap_or_else(|_| workspace.to_path_buf());
    let mut h = DefaultHasher::new();
    canonical.to_string_lossy().hash(&mut h);
    format!("{:016x}", h.finish())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn open_temp() -> (TempDir, MemoryStore) {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("memory.json");
        let store = MemoryStore::open_at(path).unwrap();
        (dir, store)
    }

    #[test]
    fn insert_then_recall_finds_keyword() {
        let (dir, mut store) = open_temp();
        let ws = dir.path();
        store.insert("fact", ws, "user prefers PascalCase for components").unwrap();
        store.insert("fact", ws, "user uses tabs not spaces").unwrap();
        let hits = store.recall("pascalcase", ws, 5);
        assert_eq!(hits.len(), 1);
        assert!(hits[0].body.contains("PascalCase"));
    }

    #[test]
    fn forget_removes_specific_id() {
        let (dir, mut store) = open_temp();
        let id = store.insert("fact", dir.path(), "x").unwrap().id;
        let removed = store.forget(&id).unwrap();
        assert_eq!(removed, 1);
        assert_eq!(store.all().len(), 0);
    }

    #[test]
    fn forget_all_clears_everything() {
        let (dir, mut store) = open_temp();
        store.insert("fact", dir.path(), "a").unwrap();
        store.insert("fact", dir.path(), "b").unwrap();
        store.forget("all").unwrap();
        assert_eq!(store.all().len(), 0);
    }

    #[test]
    fn prune_respects_retention_window() {
        let (dir, mut store) = open_temp();
        // Inject a stale observation directly.
        store.file.observations.push(Observation {
            id: "old".into(),
            ts_ms: 1, // 1970
            kind: "fact".into(),
            workspace_hash: workspace_hash(dir.path()),
            body: "ancient".into(),
        });
        store.insert("fact", dir.path(), "fresh").unwrap();
        store.prune(RetentionWindow::Day).unwrap();
        assert_eq!(store.all().len(), 1);
        assert_eq!(store.all()[0].body, "fresh");
    }

    #[test]
    fn retention_from_tier_maps_correctly() {
        assert_eq!(RetentionWindow::from_tier("free"), RetentionWindow::Day);
        assert_eq!(RetentionWindow::from_tier("starter"), RetentionWindow::Month);
        assert_eq!(RetentionWindow::from_tier("pro"), RetentionWindow::Half);
        assert_eq!(RetentionWindow::from_tier("pro_plus"), RetentionWindow::Forever);
    }
}
