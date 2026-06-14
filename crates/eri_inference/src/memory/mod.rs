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
pub mod embeddings;
pub mod profile;
pub mod sync;

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
    /// v2 hash-embedding of `body`. Empty vector on older observations
    /// that pre-date v2; `recall_semantic` lazily computes + persists
    /// the missing vectors so a single recall warms the cache.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub embedding: Vec<f32>,
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
    memory_path_for(None)
}

/// Resolve the memory-store path for a given session.
///
/// - `Some(user_id)` → `~/.eri/users/<partition(user_id)>/memory.json`. Each
///   signed-in user on a shared machine gets their own scoped file so two
///   accounts can't see each other's observations.
/// - `None` → `~/.eri/memory.json` (anonymous local-only mode, used when
///   eri is signed out).
///
/// The partition is a stable 16-hex-char hash of the user_id — collision
/// resistance against the small number of accounts on a single Mac, not a
/// cryptographic boundary (the file is on a local disk owned by one OS user).
pub fn memory_path_for(user_id: Option<&str>) -> io::Result<PathBuf> {
    let home = std::env::var("HOME")
        .ok()
        .or_else(|| std::env::var("USERPROFILE").ok())
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "no HOME or USERPROFILE"))?;
    let root = PathBuf::from(home).join(".eri");
    Ok(match user_id {
        Some(uid) => root
            .join("users")
            .join(user_partition(uid))
            .join("memory.json"),
        None => root.join("memory.json"),
    })
}

fn user_partition(user_id: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    user_id.hash(&mut h);
    format!("{:016x}", h.finish())
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
        Self::open_for(None)
    }

    /// Open the memory store for a session.
    ///
    /// `Some(user_id)` opens `~/.eri/users/<partition>/memory.json`. On the
    /// first open for that user, if the per-user file does not yet exist
    /// but the anonymous `~/.eri/memory.json` does, the anon file is
    /// renamed (not copied) into the per-user folder so the signed-in
    /// user inherits their pre-sign-in observations — and so a second
    /// user signing in later does NOT also see them.
    ///
    /// `None` opens the anon path directly with no migration.
    pub fn open_for(user_id: Option<&str>) -> io::Result<Self> {
        let path = memory_path_for(user_id)?;
        if user_id.is_some()
            && !path.exists()
            && let Ok(anon) = memory_path_for(None)
            && anon.exists()
        {
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent)?;
            }
            // Best-effort rename. If it fails (e.g. cross-device on
            // an unusual setup) we fall through to opening an empty
            // store at the per-user path; the anon file stays put.
            let _ = fs::rename(&anon, &path);
        }
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
        let raw = serde_json::to_string(&self.file)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, format!("serialize: {e}")))?;
        fs::write(&self.path, raw)
    }

    /// Append an observation and persist. v2: the body's hash-embedding
    /// is computed at insert time so semantic recall has the vector
    /// already cached and never pays a recompute cost on the read path.
    pub fn insert(&mut self, kind: &str, workspace: &Path, body: &str) -> io::Result<Observation> {
        let observation = Observation {
            id: new_id(),
            ts_ms: now_ms(),
            kind: kind.to_string(),
            workspace_hash: workspace_hash(workspace),
            body: body.to_string(),
            embedding: embeddings::embed_text(body),
        };
        let cloned = observation.clone();
        self.file.observations.push(observation);
        // Anti-bloat: keep eri lean ("hydrated, not fat"). Bound the store by
        // count so recall stays fast and the context fed to the local model
        // stays tight — explicit facts are preserved, churn is trimmed.
        let capped = cap_observations(
            std::mem::take(&mut self.file.observations),
            MAX_OBSERVATIONS,
        );
        self.file.observations = capped;
        self.save()?;
        Ok(cloned)
    }

    /// Semantic recall (Phase 20). Embeds the query, ranks all
    /// observations by cosine similarity, returns the top `limit`.
    /// Filters by workspace so cross-workspace observations only show
    /// up when their kind is `"fact"` (same scope rule as the keyword
    /// recall). Observations missing an embedding (pre-v2 entries)
    /// get one lazily and `save()` is called once if any were filled.
    pub fn recall_semantic(
        &mut self,
        query: &str,
        workspace: &Path,
        limit: usize,
    ) -> io::Result<Vec<(Observation, f32)>> {
        let query_vec = embeddings::embed_text(query);
        let hash = workspace_hash(workspace);
        let mut dirty = false;
        for o in self.file.observations.iter_mut() {
            if o.embedding.is_empty() {
                o.embedding = embeddings::embed_text(&o.body);
                dirty = true;
            }
        }
        if dirty {
            self.save()?;
        }
        let mut scored: Vec<(Observation, f32)> = self
            .file
            .observations
            .iter()
            .filter(|o| o.workspace_hash == hash || o.kind == "fact")
            .map(|o| (o.clone(), embeddings::cosine(&query_vec, &o.embedding)))
            .collect();
        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        scored.truncate(limit);
        Ok(scored)
    }

    /// The visible observations — excludes internal tombstone records (a
    /// `/forget` marker; see [`merge_observations`]). Recall paths already skip
    /// tombstones via the workspace/`fact` filter, so this is the only surface
    /// that needed the explicit exclusion.
    pub fn all(&self) -> Vec<Observation> {
        self.file
            .observations
            .iter()
            .filter(|o| o.kind != TOMBSTONE_KIND)
            .cloned()
            .collect()
    }

    /// Forget an observation by id (or `"all"` to clear everything). A specific
    /// `/forget` removes the target locally AND records a **tombstone**, so a
    /// later cross-device merge can't resurrect it from a stale copy (ADR-0001).
    /// `"all"` is a nuclear local reset (no tombstones — it's not sync-merged).
    pub fn forget(&mut self, id_or_all: &str) -> io::Result<usize> {
        let before = self.all().len();
        if id_or_all == "all" {
            self.file.observations.clear();
        } else if self
            .file
            .observations
            .iter()
            .any(|o| o.id == id_or_all && o.kind != TOMBSTONE_KIND)
        {
            self.file.observations.retain(|o| o.id != id_or_all);
            self.file.observations.push(tombstone(id_or_all));
        }
        let removed = before - self.all().len();
        if removed > 0 {
            self.save()?;
        }
        Ok(removed)
    }

    /// The full observation log **including tombstones** — the wire form for
    /// cross-device sync ([`crate::memory::sync`]). Unlike [`all`](Self::all),
    /// this keeps tombstones so a `/forget` propagates and can't be resurrected
    /// by a stale copy on another device.
    pub fn snapshot(&self) -> Vec<Observation> {
        self.file.observations.clone()
    }

    /// Merge a remote observation set (pulled from the cloud blob) into the
    /// local store and persist — union by id, last-write-wins, tombstone-aware
    /// (see [`merge_observations`]). The cross-device sync entry point.
    pub fn apply_merge(&mut self, remote: Vec<Observation>) -> io::Result<()> {
        let local = std::mem::take(&mut self.file.observations);
        self.file.observations = merge_observations(local, remote);
        self.save()
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
                o.body.to_lowercase().contains(&needle) || o.kind.to_lowercase().contains(&needle)
            })
            .collect();
        hits.sort_by_key(|h| std::cmp::Reverse(h.ts_ms));
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
        hits.sort_by_key(|h| std::cmp::Reverse(h.ts_ms));
        hits.into_iter().take(limit).cloned().collect()
    }

    /// Hybrid retrieval (mem0-inspired): fuse semantic similarity, lexical
    /// keyword overlap, and recency — ranked entirely on the CPU, so it spends
    /// ZERO model tokens. Semantic alone misses keyword-exact hits (proper
    /// nouns, identifiers) that hash-embeddings score near zero; lexical alone
    /// misses paraphrases; recency keeps fresh context on top. Backfills any
    /// missing embeddings once (like `recall_semantic`). Returns `(obs, score)`
    /// best-first. This is eri's anticipation backbone.
    pub fn recall_hybrid(
        &mut self,
        query: &str,
        workspace: &Path,
        limit: usize,
    ) -> io::Result<Vec<(Observation, f32)>> {
        let mut dirty = false;
        for o in self.file.observations.iter_mut() {
            if o.embedding.is_empty() {
                o.embedding = embeddings::embed_text(&o.body);
                dirty = true;
            }
        }
        if dirty {
            self.save()?;
        }

        let hash = workspace_hash(workspace);
        let now = now_ms();
        let qvec = embeddings::embed_text(query);
        let qtokens = tokenize(query);

        let mut scored: Vec<(Observation, f32)> = self
            .file
            .observations
            .iter()
            .filter(|o| o.workspace_hash == hash || o.kind == "fact")
            .map(|o| {
                // cosine is [-1,1]; map to [0,1] so the weighted sum is sane.
                let sem = (embeddings::cosine(&qvec, &o.embedding) + 1.0) / 2.0;
                let lex = lexical_overlap(&qtokens, &o.body);
                let rec = recency_score(o.ts_ms, now);
                // Durable, user-chosen memories get a small standing boost.
                let kind_boost = match o.kind.as_str() {
                    "fact" => 0.10,
                    "preference" | "habit" => 0.08,
                    _ => 0.0,
                };
                let score = 0.55 * sem + 0.30 * lex + 0.15 * rec + kind_boost;
                (o.clone(), score)
            })
            .collect();
        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        scored.truncate(limit);
        Ok(scored)
    }
}

/// Lowercase alphanumeric tokens of length > 1 (drops punctuation + 1-char
/// noise). Shared by the lexical-overlap scorer for query + body.
fn tokenize(s: &str) -> Vec<String> {
    s.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| t.len() > 1)
        .map(str::to_string)
        .collect()
}

/// Fraction of the query's terms present in `body` — coverage, not raw count,
/// so a long memory doesn't win just by being long.
fn lexical_overlap(qtokens: &[String], body: &str) -> f32 {
    if qtokens.is_empty() {
        return 0.0;
    }
    let btoks: std::collections::HashSet<String> = tokenize(body).into_iter().collect();
    let hits = qtokens.iter().filter(|t| btoks.contains(*t)).count();
    hits as f32 / qtokens.len() as f32
}

/// Exponential recency decay with a ~7-day half-life, in [0,1].
fn recency_score(ts_ms: u64, now: u64) -> f32 {
    let age_days = now.saturating_sub(ts_ms) as f32 / (24.0 * 60.0 * 60.0 * 1000.0);
    0.5f32.powf(age_days / 7.0)
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

/// Hard ceiling on stored observations — the anti-bloat cap. Keeps recall fast
/// and the local-model context tight no matter how long a user runs eri.
const MAX_OBSERVATIONS: usize = 2_000;

/// Bound the observation set to `max`, keeping eri lean. Explicit `fact`s
/// (the user's `/remember`) are preserved; the churnier kinds are trimmed
/// oldest-first (the tail is newest, since `insert` pushes chronologically).
/// If facts alone exceed `max`, the oldest facts are trimmed too. Pure + tested.
/// Kind marker for a tombstone — a record whose `body` is the id of an
/// observation that was forgotten. Tombstones are synced so a `/forget` on one
/// device can't be resurrected by a stale copy on another (ADR-0001).
pub const TOMBSTONE_KIND: &str = "tombstone";

/// Build a tombstone for `target_id`. Carries its own `ts_ms` so it wins the
/// last-write-wins merge against the observation it suppresses.
pub fn tombstone(target_id: &str) -> Observation {
    Observation {
        id: new_id(),
        ts_ms: now_ms(),
        kind: TOMBSTONE_KIND.to_string(),
        workspace_hash: String::new(),
        body: target_id.to_string(),
        embedding: Vec::new(),
    }
}

/// Merge two observation sets for cross-device sync. Pure + total:
/// 1. **Union by `id`, last-write-wins on `ts_ms`** (a re-observed/edited record
///    keeps its newest version; ties keep the existing).
/// 2. **Apply tombstones:** any `TOMBSTONE_KIND` record whose `body` names an id
///    suppresses that observation from the result — but the tombstone itself is
///    retained, so it keeps suppressing across future merges.
///
/// Result is sorted by `ts_ms` ascending for deterministic storage + tests.
pub fn merge_observations(local: Vec<Observation>, remote: Vec<Observation>) -> Vec<Observation> {
    use std::collections::{HashMap, HashSet};
    let mut by_id: HashMap<String, Observation> = HashMap::new();
    for o in local.into_iter().chain(remote) {
        match by_id.get(&o.id) {
            Some(existing) if existing.ts_ms >= o.ts_ms => {} // keep the newer copy
            _ => {
                by_id.insert(o.id.clone(), o);
            }
        }
    }
    let tombstoned: HashSet<String> = by_id
        .values()
        .filter(|o| o.kind == TOMBSTONE_KIND)
        .map(|o| o.body.clone())
        .collect();
    let mut out: Vec<Observation> = by_id
        .into_values()
        .filter(|o| o.kind == TOMBSTONE_KIND || !tombstoned.contains(&o.id))
        .collect();
    out.sort_by_key(|o| o.ts_ms);
    out
}

fn cap_observations(obs: Vec<Observation>, max: usize) -> Vec<Observation> {
    if obs.len() <= max {
        return obs;
    }
    let (facts, rest): (Vec<_>, Vec<_>) = obs.into_iter().partition(|o| o.kind == "fact");
    let keep_rest = max.saturating_sub(facts.len());
    let rest_start = rest.len().saturating_sub(keep_rest);
    let mut kept = facts;
    kept.extend(rest.into_iter().skip(rest_start));
    if kept.len() > max {
        let drop = kept.len() - max;
        kept = kept.into_iter().skip(drop).collect();
    }
    kept
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

    fn obs(kind: &str, ts: u64) -> Observation {
        Observation {
            id: format!("{kind}-{ts}"),
            ts_ms: ts,
            kind: kind.to_string(),
            workspace_hash: "w".to_string(),
            body: "b".to_string(),
            embedding: Vec::new(),
        }
    }

    #[test]
    fn cap_is_a_noop_under_the_limit() {
        let v = vec![obs("x", 1), obs("x", 2)];
        assert_eq!(cap_observations(v, 10).len(), 2);
    }

    #[test]
    fn cap_keeps_facts_and_trims_oldest_churn() {
        // 3 facts + 5 edits, cap to 5 -> keep all 3 facts + the 2 newest edits.
        let mut v = Vec::new();
        for ts in 0..3 {
            v.push(obs("fact", ts));
        }
        for ts in 10..15 {
            v.push(obs("edit_accepted", ts));
        }
        let capped = cap_observations(v, 5);
        assert_eq!(capped.len(), 5);
        assert_eq!(capped.iter().filter(|o| o.kind == "fact").count(), 3);
        assert!(capped.iter().any(|o| o.ts_ms == 14), "newest edit kept");
        assert!(!capped.iter().any(|o| o.ts_ms == 10), "oldest edit trimmed");
    }

    #[test]
    fn cap_trims_oldest_facts_only_when_facts_alone_exceed_max() {
        let v: Vec<_> = (0..6).map(|ts| obs("fact", ts)).collect();
        let capped = cap_observations(v, 4);
        assert_eq!(capped.len(), 4);
        assert!(capped.iter().any(|o| o.ts_ms == 5), "newest fact kept");
        assert!(!capped.iter().any(|o| o.ts_ms == 0), "oldest fact trimmed");
    }

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
        store
            .insert("fact", ws, "user prefers PascalCase for components")
            .unwrap();
        store
            .insert("fact", ws, "user uses tabs not spaces")
            .unwrap();
        let hits = store.recall("pascalcase", ws, 5);
        assert_eq!(hits.len(), 1);
        assert!(hits[0].body.contains("PascalCase"));
    }

    #[test]
    fn recall_hybrid_surfaces_keyword_exact_match() {
        let (dir, mut store) = open_temp();
        let ws = dir.path();
        store
            .insert("fact", ws, "deploys to Vercel with the eri-web project")
            .unwrap();
        store
            .insert("fact", ws, "likes dark mode and tailwind")
            .unwrap();
        store
            .insert("fact", ws, "writes integration tests in playwright")
            .unwrap();
        // A keyword the hash-embedder would score near-randomly is still found
        // via the lexical channel and ranked first.
        let hits = store.recall_hybrid("playwright", ws, 3).unwrap();
        assert!(!hits.is_empty());
        assert!(
            hits[0].0.body.contains("playwright"),
            "expected the playwright fact on top, got: {}",
            hits[0].0.body
        );
    }

    #[test]
    fn recall_hybrid_scores_are_descending() {
        let (dir, mut store) = open_temp();
        let ws = dir.path();
        store.insert("fact", ws, "uses rust and cargo").unwrap();
        store.insert("fact", ws, "prefers vim keybindings").unwrap();
        let hits = store.recall_hybrid("rust cargo build", ws, 2).unwrap();
        assert_eq!(hits.len(), 2);
        assert!(hits[0].1 >= hits[1].1, "scores must be sorted desc");
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

    fn obs_id(id: &str, ts_ms: u64, kind: &str, body: &str) -> Observation {
        Observation {
            id: id.to_string(),
            ts_ms,
            kind: kind.to_string(),
            workspace_hash: String::new(),
            body: body.to_string(),
            embedding: Vec::new(),
        }
    }

    #[test]
    fn merge_unions_and_keeps_the_newer_copy_by_id() {
        let local = vec![obs_id("a", 10, "fact", "old"), obs_id("b", 20, "fact", "b")];
        let remote = vec![obs_id("a", 30, "fact", "new"), obs_id("c", 40, "fact", "c")];
        let merged = merge_observations(local, remote);
        let ids: Vec<&str> = merged.iter().map(|o| o.id.as_str()).collect();
        assert_eq!(ids, vec!["b", "a", "c"]); // sorted by ts_ms; a takes the ts=30 copy
        let a = merged.iter().find(|o| o.id == "a").unwrap();
        assert_eq!(
            a.body, "new",
            "last-write-wins keeps the higher ts_ms version"
        );
    }

    #[test]
    fn merge_applies_tombstones_and_retains_them() {
        // A tombstone for "a" suppresses a's observation, even when a fresh copy
        // of "a" arrives from the remote — and the tombstone itself survives so
        // it keeps suppressing on the next merge.
        let local = vec![
            obs_id("a", 10, "fact", "secret"),
            obs_id("t1", 50, TOMBSTONE_KIND, "a"),
        ];
        let remote = vec![obs_id("a", 99, "fact", "resurrected from another device")];
        let merged = merge_observations(local, remote);
        assert!(!merged.iter().any(|o| o.id == "a"), "tombstoned id is gone");
        assert!(
            merged
                .iter()
                .any(|o| o.kind == TOMBSTONE_KIND && o.body == "a"),
            "tombstone is retained to keep suppressing"
        );
    }

    #[test]
    fn forgotten_item_does_not_resurrect_after_a_remote_pull() {
        // The real cross-device scenario: forget on device A, then pull device B's
        // older copy. With a tombstone, it stays gone.
        let (dir, mut store) = open_temp();
        let id = store.insert("fact", dir.path(), "delete me").unwrap().id;
        // Simulate forget-as-tombstone (the wiring lands next slice; here we
        // assert the merge contract the wiring will rely on).
        let remote = vec![
            obs_id(&id, 1, "fact", "delete me"), // device B's stale copy
            tombstone(&id),                      // device A's forget
        ];
        store.apply_merge(remote).unwrap();
        assert!(
            !store
                .all()
                .iter()
                .any(|o| o.id == id && o.kind != TOMBSTONE_KIND),
            "a tombstoned observation must not come back from a remote pull"
        );
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
            embedding: Vec::new(),
        });
        store.insert("fact", dir.path(), "fresh").unwrap();
        store.prune(RetentionWindow::Day).unwrap();
        assert_eq!(store.all().len(), 1);
        assert_eq!(store.all()[0].body, "fresh");
    }

    #[test]
    fn retention_from_tier_maps_correctly() {
        assert_eq!(RetentionWindow::from_tier("free"), RetentionWindow::Day);
        assert_eq!(
            RetentionWindow::from_tier("starter"),
            RetentionWindow::Month
        );
        assert_eq!(RetentionWindow::from_tier("pro"), RetentionWindow::Half);
        assert_eq!(
            RetentionWindow::from_tier("pro_plus"),
            RetentionWindow::Forever
        );
    }

    #[test]
    fn insert_populates_embedding() {
        let (dir, mut store) = open_temp();
        let obs = store
            .insert("fact", dir.path(), "the user prefers pnpm")
            .unwrap();
        assert!(!obs.embedding.is_empty());
        assert_eq!(obs.embedding.len(), embeddings::DIM);
    }

    #[test]
    fn recall_semantic_ranks_related_observations_higher() {
        let (dir, mut store) = open_temp();
        let ws = dir.path();
        store
            .insert("fact", ws, "I use pnpm as my package manager")
            .unwrap();
        store
            .insert("fact", ws, "blue and purple are my favourite colours")
            .unwrap();
        let hits = store
            .recall_semantic("what package manager do you use", ws, 2)
            .unwrap();
        assert_eq!(hits.len(), 2);
        assert!(
            hits[0].0.body.contains("pnpm"),
            "expected pnpm fact at #1; got {}",
            hits[0].0.body
        );
    }

    #[test]
    fn recall_semantic_backfills_missing_embeddings() {
        let (dir, mut store) = open_temp();
        // Inject a pre-v2 observation with no embedding.
        store.file.observations.push(Observation {
            id: "legacy".into(),
            ts_ms: now_ms(),
            kind: "fact".into(),
            workspace_hash: workspace_hash(dir.path()),
            body: "I prefer dark themes".into(),
            embedding: Vec::new(),
        });
        let hits = store.recall_semantic("dark themes", dir.path(), 1).unwrap();
        assert_eq!(hits.len(), 1);
        // After recall, the legacy observation's embedding is filled.
        let visible = store.all();
        let stored = visible
            .iter()
            .find(|o| o.id == "legacy")
            .expect("legacy still there");
        assert!(!stored.embedding.is_empty());
    }

    #[test]
    fn user_partition_is_stable_and_distinct() {
        let a = user_partition("user_abc");
        let b = user_partition("user_abc");
        let c = user_partition("user_xyz");
        assert_eq!(a, b, "same input → same partition");
        assert_ne!(a, c, "different input → different partition");
        assert_eq!(a.len(), 16, "partition is a 16-hex-char hash");
    }

    /// HOME-mutating tests share a mutex so they don't race each other —
    /// `cargo test` runs unit tests in parallel by default and
    /// `std::env::set_var` is process-wide.
    static HOME_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn with_temp_home<F: FnOnce(&std::path::Path)>(f: F) {
        let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let tmp = TempDir::new().unwrap();
        let prev = std::env::var("HOME").ok();
        // SAFETY: serialised by HOME_LOCK; restored before return.
        unsafe { std::env::set_var("HOME", tmp.path()) };
        let _restore = scopeguard_restore(prev);
        f(tmp.path());
    }

    /// Tiny RAII restorer for HOME so test panics don't leak the temp dir.
    struct ScopeGuard<F: FnMut()>(Option<F>);
    impl<F: FnMut()> Drop for ScopeGuard<F> {
        fn drop(&mut self) {
            if let Some(mut f) = self.0.take() {
                f();
            }
        }
    }
    fn scopeguard_restore(prev: Option<String>) -> ScopeGuard<impl FnMut()> {
        ScopeGuard(Some(move || {
            // SAFETY: serialised by HOME_LOCK (held by the outer caller).
            unsafe {
                match prev.as_deref() {
                    Some(v) => std::env::set_var("HOME", v),
                    None => std::env::remove_var("HOME"),
                }
            }
        }))
    }

    #[test]
    fn memory_path_for_user_is_under_users_directory() {
        with_temp_home(|home| {
            let anon = memory_path_for(None).unwrap();
            let user = memory_path_for(Some("user_abc")).unwrap();
            assert_eq!(anon, home.join(".eri").join("memory.json"));
            assert!(user.starts_with(home.join(".eri").join("users")));
            assert_eq!(user.file_name().unwrap(), "memory.json");
        });
    }

    /// First sign-in migrates the anon file into the per-user folder. The
    /// observations the user accumulated while signed out should follow them
    /// into their account.
    #[test]
    fn open_for_migrates_anon_file_on_first_sign_in() {
        with_temp_home(|_home| {
            // Seed an anon observation.
            {
                let mut anon = MemoryStore::open_for(None).unwrap();
                anon.insert("fact", std::path::Path::new("/ws"), "pre-signin fact")
                    .unwrap();
                drop(anon);
            }
            let anon_path = memory_path_for(None).unwrap();
            assert!(anon_path.exists(), "anon file should exist after seed");

            // Sign in → open_for(Some(uid)). Migration should run.
            let user_store = MemoryStore::open_for(Some("user_abc")).unwrap();
            assert_eq!(user_store.all().len(), 1, "user inherits anon observations");
            assert_eq!(user_store.all()[0].body, "pre-signin fact");
            assert!(!anon_path.exists(), "anon file is renamed, not copied");
        });
    }

    /// A second user signing in on the same machine after the first user's
    /// data has been migrated must NOT see user A's observations. Their
    /// per-user file is fresh because the anon file is gone.
    #[test]
    fn open_for_does_not_leak_between_users() {
        with_temp_home(|_home| {
            // User A signs in (anon empty — no migration data).
            {
                let mut a = MemoryStore::open_for(Some("user_a")).unwrap();
                a.insert("fact", std::path::Path::new("/ws"), "A's fact")
                    .unwrap();
                drop(a);
            }
            // User B signs in.
            let b = MemoryStore::open_for(Some("user_b")).unwrap();
            assert_eq!(b.all().len(), 0, "user B starts empty");
        });
    }

    /// Second sign-in for the SAME user (per-user file already exists)
    /// must NOT migrate an unrelated anon file into their account.
    #[test]
    fn open_for_skips_migration_when_user_file_already_exists() {
        with_temp_home(|_home| {
            // User A signs in, has data.
            {
                let mut a = MemoryStore::open_for(Some("user_a")).unwrap();
                a.insert("fact", std::path::Path::new("/ws"), "A's fact")
                    .unwrap();
            }
            // Signed-out anon session accumulates separate data.
            {
                let mut anon = MemoryStore::open_for(None).unwrap();
                anon.insert("fact", std::path::Path::new("/ws"), "anon fact")
                    .unwrap();
            }
            let anon_path = memory_path_for(None).unwrap();
            assert!(anon_path.exists(), "anon file exists pre-reopen");

            // User A signs in again — must keep their data, must NOT
            // clobber it with the anon file. The anon file stays put.
            let a_again = MemoryStore::open_for(Some("user_a")).unwrap();
            assert_eq!(a_again.all().len(), 1);
            assert_eq!(a_again.all()[0].body, "A's fact");
            assert!(anon_path.exists(), "anon file is untouched on re-open");
        });
    }
}
