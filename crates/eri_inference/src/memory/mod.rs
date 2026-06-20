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
//!   - `"communication_style"` — the learned writing register (`style_writer`)
//!
//! Pattern extraction (priority 1 system-prompt injection) is implemented
//! as a simple recency-+-frequency rank over the observations until the
//! v2 embedding pipeline lands.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

pub mod cloud;
pub mod collectors;
pub mod consolidation;
pub mod embeddings;
pub mod eventtime;
pub mod extraction;
pub mod graph_bridge;
pub mod keys;
pub mod profile;
pub mod profile_sync;
pub mod style_writer;
pub mod sync;
pub mod world_recall;

/// An observation's lifecycle/visibility — one state, so the old
/// `superseded`/`consolidated`/`valid_to` flag soup can't form illegal
/// combinations (architecture review C). Tombstones are NOT a variant here:
/// "is this a tombstone" is a `kind`, orthogonal to lifecycle, checked separately.
#[derive(Debug, Clone, PartialEq, Default)]
pub enum Visibility {
    /// Surfaced by recall + the Tier-A profile right now.
    #[default]
    Active,
    /// Superseded by a newer contradicting fact (mem0/supermemory). Bi-temporal:
    /// `valid_to` is when it stopped being true (Zep/Graphiti event-time end) —
    /// `None` for legacy data synced before the timestamp existed. Kept in the
    /// store + synced for history, hidden from current recall but answerable
    /// as-of a past instant via [`recall_as_of`](MemoryStore::recall_as_of).
    Superseded { valid_to: Option<u64> },
    /// Folded into a durable `semantic` rollup ([`consolidation`]) — kept for
    /// history/sync, hidden from recall so eri injects the pattern, not the
    /// raw episodes.
    Consolidated,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(from = "ObservationWire", into = "ObservationWire")]
pub struct Observation {
    pub id: String,
    /// Unix epoch milliseconds — the bi-temporal **transaction time**
    /// (`learned_at`): when eri *recorded* this observation.
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
    pub embedding: Vec<f32>,
    /// Bi-temporal **event-time start** (`valid_from`): when the fact *became
    /// true*, distinct from `ts_ms` (when eri learned it). `None` means "= ts_ms"
    /// — the default, since v1 has no event-time extraction; a future extractor
    /// ("I moved to NYC last year", learned today) sets it to the real instant so
    /// `recall_as_of` answers from the event timeline, not the ingestion one.
    /// Read it via [`valid_from`](Self::valid_from), never the raw field.
    pub valid_from: Option<u64>,
    /// Lifecycle state — see [`Visibility`]. Serializes to/from the flat
    /// `superseded`/`consolidated`/`valid_to` wire keys via [`ObservationWire`],
    /// so already-synced Tier-B blobs stay byte-for-byte compatible.
    pub visibility: Visibility,
    /// Static importance in [0,1], assigned once at write (Generative Agents):
    /// durable user facts/preferences high, episodic churn low. A standing weight
    /// in the recall score so important memories outrank merely-recent noise.
    pub importance: f32,
    /// How many times recall has SURFACED this memory (MemoryBank reinforcement).
    /// Grows retention strength `S = 1 + recall_count`, so memories the user keeps
    /// hitting stop decaying while never-recalled noise fades.
    pub recall_count: u32,
    /// When it was last surfaced (unix ms); `None` = never recalled. Drives the
    /// Ebbinghaus retention term `R = exp(-Δdays / S)`.
    pub last_recalled_ms: Option<u64>,
}

/// The on-the-wire shape of an [`Observation`] — the flat fields exactly as they
/// were before the [`Visibility`] enum, so cross-device sync + already-stored
/// blobs are unaffected. Conversions normalize any inconsistent flag combo into
/// a single valid [`Visibility`] (e.g. `valid_to: Some` with `superseded: false`
/// becomes `Superseded`), so illegal states never survive a round-trip.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct ObservationWire {
    id: String,
    ts_ms: u64,
    kind: String,
    workspace_hash: String,
    body: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    embedding: Vec<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    valid_from: Option<u64>,
    #[serde(default, skip_serializing_if = "is_false")]
    superseded: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    consolidated: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    valid_to: Option<u64>,
    // P1 (Generative Agents / MemoryBank): importance + earned-recall. All default
    // so pre-P1 Tier-B blobs deserialize unchanged; importance is backfilled from
    // `kind` on load (see From<ObservationWire>) so old memories aren't zeroed out.
    #[serde(default, skip_serializing_if = "is_zero_f32")]
    importance: f32,
    #[serde(default, skip_serializing_if = "is_zero_u32")]
    recall_count: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    last_recalled_ms: Option<u64>,
}

impl From<ObservationWire> for Observation {
    fn from(w: ObservationWire) -> Self {
        // consolidated wins over superseded (an episode is one or the other); a
        // recorded valid_to implies superseded even if the bool was unset.
        let visibility = if w.consolidated {
            Visibility::Consolidated
        } else if w.superseded || w.valid_to.is_some() {
            Visibility::Superseded {
                valid_to: w.valid_to,
            }
        } else {
            Visibility::Active
        };
        // Backfill importance for pre-P1 observations (stored 0.0) from their kind,
        // so legacy memories get a sensible standing weight instead of zero.
        let importance = if w.importance > 0.0 {
            w.importance
        } else {
            default_importance(&w.kind, &w.body)
        };
        Observation {
            id: w.id,
            ts_ms: w.ts_ms,
            kind: w.kind,
            workspace_hash: w.workspace_hash,
            body: w.body,
            embedding: w.embedding,
            valid_from: w.valid_from,
            visibility,
            importance,
            recall_count: w.recall_count,
            last_recalled_ms: w.last_recalled_ms,
        }
    }
}

impl From<Observation> for ObservationWire {
    fn from(o: Observation) -> Self {
        let (superseded, consolidated, valid_to) = match o.visibility {
            Visibility::Active => (false, false, None),
            Visibility::Superseded { valid_to } => (true, false, valid_to),
            Visibility::Consolidated => (false, true, None),
        };
        ObservationWire {
            id: o.id,
            ts_ms: o.ts_ms,
            kind: o.kind,
            workspace_hash: o.workspace_hash,
            body: o.body,
            embedding: o.embedding,
            valid_from: o.valid_from,
            superseded,
            consolidated,
            valid_to,
            importance: o.importance,
            recall_count: o.recall_count,
            last_recalled_ms: o.last_recalled_ms,
        }
    }
}

fn is_false(b: &bool) -> bool {
    !*b
}

fn is_zero_f32(f: &f32) -> bool {
    *f == 0.0
}

fn is_zero_u32(n: &u32) -> bool {
    *n == 0
}

/// Static importance in [0,1] for a memory, by kind + a cheap content cue
/// (Generative Agents §"importance"). Durable user-chosen memory ranks high;
/// episodic churn low. Used as the standing weight in the recall score, and to
/// backfill pre-P1 observations on load.
fn default_importance(kind: &str, body: &str) -> f32 {
    let base: f32 = match kind {
        "fact" | "preference" => 0.8,
        "habit" | consolidation::SEMANTIC_KIND => 0.7,
        // Episodic control/screen logs — low standing weight; they earn rank via
        // recency + reinforcement, not importance.
        _ => 0.3,
    };
    // A first-person durable claim ("I ...", "my ...") is more about-the-user than
    // a bare log line — a small bump (kept ≤ 1.0).
    let b = body.to_lowercase();
    let first_person = b.starts_with("i ") || b.contains(" i ") || b.contains("my ");
    (base + if first_person { 0.1 } else { 0.0 }).min(1.0)
}

impl Observation {
    /// Visible to recall + the Tier-A profile *right now*: lifecycle `Active` and
    /// not an internal tombstone (tombstone is a `kind`, orthogonal to lifecycle).
    /// The single source of truth for "should eri surface this today" — every
    /// recall path filters on it. For history use [`is_valid_at`](Self::is_valid_at).
    fn is_active(&self) -> bool {
        self.kind != TOMBSTONE_KIND && matches!(self.visibility, Visibility::Active)
    }

    /// **Transaction time** — when eri *recorded* this observation (bi-temporal
    /// `learned_at`).
    pub fn learned_at(&self) -> u64 {
        self.ts_ms
    }

    /// **Event-time start** — when the fact *became true* (bi-temporal
    /// `valid_from`). Defaults to `ts_ms` (learned_at) until an event-time
    /// extractor populates the field, so v1 treats "learned" and "became true"
    /// as the same instant.
    pub fn valid_from(&self) -> u64 {
        self.valid_from.unwrap_or(self.ts_ms)
    }

    /// Bi-temporal point-in-time validity: was this fact true at `as_of`? True
    /// iff it had become true by then (`valid_from <= as_of`) and was either
    /// still active or superseded only *after* `as_of`. A `Superseded` fact with
    /// no recorded `valid_to` (legacy) is invalid at every point — we can't date
    /// its invalidation, so we never resurrect it into a past-time view.
    fn is_valid_at(&self, as_of: u64) -> bool {
        if self.kind == TOMBSTONE_KIND || self.valid_from() > as_of {
            return false;
        }
        match &self.visibility {
            Visibility::Active => true,
            Visibility::Superseded { valid_to: Some(vt) } => as_of < *vt,
            Visibility::Superseded { valid_to: None } => false,
            Visibility::Consolidated => false,
        }
    }
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
    // SHA-256 (truncated to 16 hex), NOT DefaultHasher: SipHash's output is
    // explicitly unstable across Rust versions, so a compiler upgrade would
    // change the partition path and orphan the user's local memory (security:
    // H-4). A pinned hash keeps `~/.eri/users/<partition>` stable forever.
    stable_hash16(user_id.as_bytes())
}

/// First 8 bytes of SHA-256, hex-encoded (16 chars). Version-stable, so any
/// value derived from it survives a toolchain upgrade.
fn stable_hash16(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(bytes);
    digest[..8].iter().map(|b| format!("{b:02x}")).collect()
}

/// A point in time to judge an observation's visibility against — the temporal
/// half of the [`candidates`](MemoryStore::candidates) scope.
#[derive(Clone, Copy)]
enum TemporalScope {
    /// Visible right now: active (not superseded / consolidated / tombstone).
    Now,
    /// Valid at a past instant (bi-temporal point-in-time), unix-ms.
    AsOf(u64),
}

/// Whether `o` matches a lowercased keyword `needle` (empty needle matches all).
/// Shared by the keyword-ranked readers so the match rule lives in one place.
fn keyword_hit(o: &Observation, needle: &str) -> bool {
    needle.is_empty()
        || o.body.to_lowercase().contains(needle)
        || o.kind.to_lowercase().contains(needle)
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
        let raw = match fs::read_to_string(&path) {
            Ok(raw) => raw,
            // A missing file is a fresh (empty) store — the normal first-run case.
            Err(err) if err.kind() == io::ErrorKind::NotFound => {
                return Ok(Self {
                    path,
                    file: StoreFile::default(),
                });
            }
            Err(err) => return Err(err),
        };
        match serde_json::from_str::<StoreFile>(&raw) {
            Ok(file) => Ok(Self { path, file }),
            // A CORRUPT file is NOT the same as an absent one. Silently defaulting
            // to empty would let the next `save()` overwrite the (recoverable)
            // bytes AND let `eri sync` push the emptiness to the cloud — a silent
            // wipe (security M-5). Surface it loudly; the file is left untouched
            // for recovery. (Atomic `save` makes this near-impossible going forward.)
            Err(e) => Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("memory store at {} is corrupt: {e}", path.display()),
            )),
        }
    }

    /// Persist to disk **atomically**: serialize, write to a temp file in the
    /// same directory, fsync, then `rename` over the target. A crash or power
    /// loss can only leave the old file or the new file intact — never a
    /// truncated one — so memory can't be corrupted mid-write (security M-5).
    pub fn save(&self) -> io::Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let raw = serde_json::to_string(&self.file)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, format!("serialize: {e}")))?;
        let dir = self.path.parent().unwrap_or_else(|| Path::new("."));
        // Unique temp name so two concurrent writers (e.g. a foreground command
        // and a background `eri sync`) don't clobber each other's temp file; the
        // final `rename` is atomic so the last writer wins cleanly, never torn.
        let tmp = dir.join(format!(".memory.{}.tmp", new_id()));
        {
            use std::io::Write;
            let mut f = fs::File::create(&tmp)?;
            f.write_all(raw.as_bytes())?;
            f.sync_all()?;
        }
        match fs::rename(&tmp, &self.path) {
            Ok(()) => Ok(()),
            Err(e) => {
                let _ = fs::remove_file(&tmp);
                Err(e)
            }
        }
    }

    /// Where the single-step rollback snapshot lives (sibling `.bak`).
    fn bak_path(&self) -> PathBuf {
        self.path.with_extension("bak")
    }

    /// P10 (memory rollback): copy the current on-disk store to its `.bak` BEFORE
    /// a user-meaningful mutation, so [`rollback`](Self::rollback) can restore the
    /// pre-mutation state ("eri, forget what you just learned"). Best-effort + a
    /// no-op on first write (nothing to back up); never fails the mutation.
    fn snapshot_backup(&self) {
        if self.path.exists() {
            let _ = fs::copy(&self.path, self.bak_path());
        }
    }

    /// Restore the last snapshot taken before a memory mutation — honest single-
    /// step undo. Returns `Ok(true)` if it rolled back, `Ok(false)` if there's no
    /// snapshot (nothing to undo). Consumes the snapshot, so you can't rollback
    /// twice past one step.
    pub fn rollback(&mut self) -> io::Result<bool> {
        let bak = self.bak_path();
        let raw = match fs::read_to_string(&bak) {
            Ok(r) => r,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(false),
            Err(e) => return Err(e),
        };
        let file: StoreFile = serde_json::from_str(&raw).map_err(|e| {
            io::Error::new(io::ErrorKind::InvalidData, format!("rollback parse: {e}"))
        })?;
        self.file = file;
        self.save()?;
        let _ = fs::remove_file(&bak);
        Ok(true)
    }

    /// Append an observation and persist. v2: the body's hash-embedding
    /// is computed at insert time so semantic recall has the vector
    /// already cached and never pays a recompute cost on the read path.
    pub fn insert(&mut self, kind: &str, workspace: &Path, body: &str) -> io::Result<Observation> {
        self.snapshot_backup(); // P10: enable rollback of this write
        let now = now_ms();
        // Event-time extraction (bi-temporal): a user-stated fact may describe
        // something that happened in the past ("two years ago I founded …"). Pull
        // the instant it became true out of the prose so `recall_as_of` can answer
        // on the event timeline, not just when eri learned it. Facts only — other
        // kinds carry structured bodies, not narrated time.
        let valid_from = if eventtime::is_prose_kind(kind) {
            eventtime::extract_valid_from(body, now)
        } else {
            None
        };
        let observation = Observation {
            id: new_id(),
            ts_ms: now,
            kind: kind.to_string(),
            workspace_hash: workspace_hash(workspace),
            body: body.to_string(),
            embedding: embeddings::embed_text(body),
            valid_from,
            visibility: Visibility::Active,
            importance: default_importance(kind, body),
            recall_count: 0,
            last_recalled_ms: None,
        };
        // P2 surprise-gated writes (Dong et al.): for high-churn EPISODIC kinds,
        // skip storing a literal re-log of something recent — re-seeing it instead
        // REINFORCES the existing memory (recall_count++), which collapses store
        // bloat without losing signal. User-stated facts/preferences always write
        // (they may supersede an older value, handled below); fuzzy near-dups are
        // left for consolidate() to cluster.
        if !matches!(kind, "fact" | "preference")
            && let Some(idx) = self.recent_duplicate(body, SURPRISE_WINDOW)
        {
            self.file.observations[idx].recall_count =
                self.file.observations[idx].recall_count.saturating_add(1);
            self.file.observations[idx].last_recalled_ms = Some(now);
            let reinforced = self.file.observations[idx].clone();
            self.save()?;
            return Ok(reinforced);
        }
        let cloned = observation.clone();
        // Contradiction/supersession (mem0/supermemory): a new `fact` that's
        // near-identical in meaning to an older fact REPLACES it — mark the old
        // ones superseded so recall never injects a stale fact next to its
        // update. Kept in the store (history), just hidden from recall.
        if cloned.kind == "fact" && !cloned.embedding.is_empty() {
            supersede_similar_facts(&mut self.file.observations, &cloned);
        }
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

    /// Index of a recent active observation whose body is byte-identical to
    /// `body`, scanning only the last `window` observations (the "recent window"
    /// of Dong et al.). `None` if nothing recent repeats it — i.e. the new write
    /// is novel enough to keep. Exact match (not fuzzy) on purpose: this gate only
    /// kills literal re-logs (the real bloat — identical screen/state lines);
    /// distinct-but-similar episodes are left for [`consolidate`](Self::consolidate)
    /// to cluster, which it already does. Pure read over the store.
    fn recent_duplicate(&self, body: &str, window: usize) -> Option<usize> {
        let n = self.file.observations.len();
        let start = n.saturating_sub(window);
        self.file.observations[start..]
            .iter()
            .enumerate()
            .position(|(_, o)| matches!(o.visibility, Visibility::Active) && o.body == body)
            .map(|p| start + p)
    }

    /// Semantic recall (Phase 20). Embeds the query, ranks all
    /// observations by cosine similarity, returns the top `limit`.
    /// Filters by workspace so cross-workspace observations only show
    /// up when their kind is `"fact"` (same scope rule as the keyword
    /// recall). Observations missing an embedding (pre-v2 entries)
    /// get one lazily and `save()` is called once if any were filled.
    /// The observations in scope for `workspace` at `scope` — **the single point
    /// of control** for the two cross-cutting recall rules: the *scope* rule
    /// (facts are global, every other kind is workspace-local) and the
    /// *visibility* rule (active now, or valid at a past instant). Every reader
    /// (`recall`, `recall_semantic`, `recall_hybrid`, `recall_as_of`,
    /// `top_patterns`) ranks over this, so changing either rule is one edit here
    /// instead of five scattered filters (architecture review B).
    fn candidates(&self, workspace: &Path, scope: TemporalScope) -> Vec<&Observation> {
        let hash = workspace_hash(workspace);
        self.file
            .observations
            .iter()
            .filter(|o| {
                let in_scope = o.workspace_hash == hash || o.kind == "fact";
                let visible = match scope {
                    TemporalScope::Now => o.is_active(),
                    TemporalScope::AsOf(t) => o.is_valid_at(t),
                };
                in_scope && visible
            })
            .collect()
    }

    pub fn recall_semantic(
        &mut self,
        query: &str,
        workspace: &Path,
        limit: usize,
    ) -> io::Result<Vec<(Observation, f32)>> {
        let query_vec = embeddings::embed_text(query);
        self.backfill_embeddings()?;
        let mut scored: Vec<(Observation, f32)> = self
            .candidates(workspace, TemporalScope::Now)
            .into_iter()
            .map(|o| (o.clone(), embeddings::cosine(&query_vec, &o.embedding)))
            .collect();
        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        scored.truncate(limit);
        Ok(scored)
    }

    /// Lazily compute + persist any missing embeddings (pre-v2 observations), so
    /// the embedding-ranked readers never pay a recompute on the read path. Saves
    /// once if anything was filled. Shared by `recall_semantic` + `recall_hybrid`.
    fn backfill_embeddings(&mut self) -> io::Result<()> {
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
        Ok(())
    }

    /// The visible observations — excludes internal tombstone records (a
    /// `/forget` marker; see [`merge_observations`]). Recall paths already skip
    /// tombstones via the workspace/`fact` filter, so this is the only surface
    /// that needed the explicit exclusion.
    pub fn all(&self) -> Vec<Observation> {
        self.file
            .observations
            .iter()
            .filter(|o| o.is_active())
            .cloned()
            .collect()
    }

    /// Forget an observation by id (or `"all"` to clear everything). A specific
    /// `/forget` removes the target locally AND records a **tombstone**, so a
    /// later cross-device merge can't resurrect it from a stale copy (ADR-0001).
    /// `"all"` is a nuclear local reset (no tombstones — it's not sync-merged).
    pub fn forget(&mut self, id_or_all: &str) -> io::Result<usize> {
        self.snapshot_backup(); // P10: a forget is undoable
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

    /// Drop observations older than the tier's retention window. Tombstones are
    /// **exempt** from the cutoff: a `/forget` marker must outlive the fact it
    /// suppresses, or an expired tombstone would let a forgotten fact resurrect
    /// from a stale copy on another device after the next merge (security: C-2).
    pub fn prune(&mut self, window: RetentionWindow) -> io::Result<usize> {
        let Some(cutoff) = window.cutoff_ms(now_ms()) else {
            return Ok(0);
        };
        let before = self.file.observations.len();
        self.file
            .observations
            .retain(|o| o.kind == TOMBSTONE_KIND || o.ts_ms >= cutoff);
        let removed = before - self.file.observations.len();
        if removed > 0 {
            self.save()?;
        }
        Ok(removed)
    }

    /// Keyword search over `body`, recency-ranked. Embeddings land in v2.
    pub fn recall(&self, query: &str, workspace: &Path, limit: usize) -> Vec<Observation> {
        let needle = query.to_lowercase();
        let mut hits: Vec<&Observation> = self
            .candidates(workspace, TemporalScope::Now)
            .into_iter()
            .filter(|o| keyword_hit(o, &needle))
            .collect();
        hits.sort_by_key(|h| std::cmp::Reverse(h.ts_ms));
        hits.into_iter().take(limit).cloned().collect()
    }

    /// **Bi-temporal point-in-time recall** (Zep/Graphiti): the observations that
    /// were valid **as of** `as_of_ms` — learned by then and not yet invalidated.
    /// Lets eri answer "what did I believe last Tuesday" without losing the
    /// history a plain supersede would hide: a fact superseded *after* `as_of` is
    /// still returned for that earlier instant. Same workspace/`fact` scope and
    /// recency ranking as [`recall`](Self::recall); keyword-filtered like it too.
    pub fn recall_as_of(
        &self,
        query: &str,
        workspace: &Path,
        limit: usize,
        as_of_ms: u64,
    ) -> Vec<Observation> {
        let needle = query.to_lowercase();
        let mut hits: Vec<&Observation> = self
            .candidates(workspace, TemporalScope::AsOf(as_of_ms))
            .into_iter()
            .filter(|o| keyword_hit(o, &needle))
            .collect();
        hits.sort_by_key(|h| std::cmp::Reverse(h.ts_ms));
        hits.into_iter().take(limit).cloned().collect()
    }

    /// Top-N most-recent observations across all kinds. Used by the system-
    /// prompt injection in `build_parts` to populate `What I've learned about you`.
    pub fn top_patterns(&self, workspace: &Path, limit: usize) -> Vec<Observation> {
        let mut hits = self.candidates(workspace, TemporalScope::Now);
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
        self.backfill_embeddings()?;
        let now = now_ms();
        let mut scored = self.score_active(query, workspace, now);
        scored.truncate(limit);
        self.reinforce(&scored, now);
        Ok(scored)
    }

    /// Token-budgeted, diversity-aware recall — the "remember everything, never
    /// bloat the prompt" path. Scores with the hybrid ranker, then selects a
    /// **diverse** high-relevance slice via MMR (λ·relevance − (1−λ)·max-similarity)
    /// and stops once the next observation would exceed `max_tokens`. So the
    /// injected context is relevant AND non-redundant AND bounded — the 2026 SOTA
    /// bar for token-frugal memory (ADR-0001).
    pub fn recall_hybrid_with_budget(
        &mut self,
        query: &str,
        workspace: &Path,
        max_tokens: usize,
    ) -> io::Result<Vec<(Observation, f32)>> {
        self.backfill_embeddings()?;
        let now = now_ms();
        // A generous candidate pool; MMR + the budget trim it to what fits. We
        // reinforce only the FINAL surfaced slice (not the whole pool), so recall
        // strength reflects what eri actually showed the user.
        let mut pool = self.score_active(query, workspace, now);
        pool.truncate(50);
        let selected = mmr_budget_select(pool, max_tokens, MMR_LAMBDA);
        self.reinforce(&selected, now);
        Ok(selected)
    }

    /// Score every active candidate with the P1 hybrid ranker and return them
    /// sorted best-first (no truncation, no mutation). Pure read.
    ///
    /// `score = 0.45·sem + 0.25·lex + 0.10·rec + 0.20·(importance·R) + kind_boost`,
    /// where `R = exp(-Δdays / (1 + recall_count))` is Ebbinghaus retention
    /// (MemoryBank): a memory's importance term decays with time-since-last-recall
    /// but each recall raises its strength `S = 1 + recall_count`, so memories the
    /// user keeps hitting stop decaying while never-recalled noise fades out.
    fn score_active(&self, query: &str, workspace: &Path, now: u64) -> Vec<(Observation, f32)> {
        let qvec = embeddings::embed_text(query);
        let qtokens = tokenize(query);
        let mut scored: Vec<(Observation, f32)> = self
            .candidates(workspace, TemporalScope::Now)
            .into_iter()
            .map(|o| {
                // cosine is [-1,1]; map to [0,1] so the weighted sum is sane.
                let sem = (embeddings::cosine(&qvec, &o.embedding) + 1.0) / 2.0;
                let lex = lexical_overlap(&qtokens, &o.body);
                let rec = recency_score(o.ts_ms, now);
                let strength = 1.0 + o.recall_count as f32;
                let since = now.saturating_sub(o.last_recalled_ms.unwrap_or(o.ts_ms)) as f32;
                let days = since / 86_400_000.0;
                let retention = (-days / strength).exp();
                let kind_boost = match o.kind.as_str() {
                    "fact" => 0.10,
                    "preference" | "habit" | consolidation::SEMANTIC_KIND => 0.08,
                    _ => 0.0,
                };
                let score = 0.45 * sem
                    + 0.25 * lex
                    + 0.10 * rec
                    + 0.20 * (o.importance * retention)
                    + kind_boost;
                (o.clone(), score)
            })
            .collect();
        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        scored
    }

    /// Reinforce the memories eri actually surfaced (MemoryBank): bump their
    /// `recall_count` and stamp `last_recalled_ms`, so used memories strengthen and
    /// stop decaying. Best-effort persist — a reinforcement save failure must never
    /// fail the recall itself.
    fn reinforce(&mut self, surfaced: &[(Observation, f32)], now: u64) {
        if surfaced.is_empty() {
            return;
        }
        let ids: std::collections::HashSet<&str> =
            surfaced.iter().map(|(o, _)| o.id.as_str()).collect();
        let mut changed = false;
        for o in self.file.observations.iter_mut() {
            if ids.contains(o.id.as_str()) {
                o.recall_count = o.recall_count.saturating_add(1);
                o.last_recalled_ms = Some(now);
                changed = true;
            }
        }
        if changed {
            let _ = self.save();
        }
    }

    /// Episodic→semantic consolidation (mem0/supermemory). Distill clusters of
    /// near-identical episodic observations into durable `semantic` rollups,
    /// hiding the raw episodes from recall while keeping them for history + sync.
    /// Returns the number of rollups created. Idempotent: a second pass finds the
    /// episodes already marked `consolidated` and does nothing. Runs on the CPU
    /// (zero model tokens), so it's safe to call on every sync.
    pub fn consolidate(&mut self) -> io::Result<usize> {
        let plan = consolidation::plan_consolidation(&self.file.observations);
        if plan.new_facts.is_empty() {
            return Ok(0);
        }
        for i in plan.consume {
            self.file.observations[i].visibility = Visibility::Consolidated;
        }
        let created = plan.new_facts.len();
        for draft in plan.new_facts {
            let embedding = embeddings::embed_text(&draft.body);
            let importance = default_importance(consolidation::SEMANTIC_KIND, &draft.body);
            let rollup = Observation {
                id: new_id(),
                ts_ms: draft.ts_ms,
                kind: consolidation::SEMANTIC_KIND.to_string(),
                workspace_hash: draft.workspace_hash,
                body: draft.body,
                embedding,
                valid_from: None,
                visibility: Visibility::Active,
                importance,
                recall_count: 0,
                last_recalled_ms: None,
            };
            // A fresh rollup replaces an older rollup on the same topic, so the
            // profile/recall never carry "accepts edits in src/x (3×)" twice.
            supersede_similar_facts(&mut self.file.observations, &rollup);
            self.file.observations.push(rollup);
        }
        self.save()?;
        Ok(created)
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

/// MMR diversity weight: relevance vs novelty. 0.7 keeps relevance dominant
/// while still dropping near-duplicates from the injected slice.
const MMR_LAMBDA: f32 = 0.7;

/// Cosine above which a new fact is treated as an UPDATE of an older one (same
/// topic, e.g. "favourite colour is blue" → "…is green" score ~0.80). High
/// enough that unrelated facts (score ~0) never supersede each other.
const SUPERSEDE_THRESHOLD: f32 = 0.75;

/// How many of the most-recent observations the surprise gate compares against
/// for a literal re-log (P2).
const SURPRISE_WINDOW: usize = 30;

/// Mark existing non-superseded observations of the **same kind** that are
/// semantically near-identical to `new_fact` as superseded (called before the
/// new one is pushed). Same-kind so a fresh `fact` only replaces an older `fact`
/// and a fresh `semantic` rollup only replaces an older rollup on the same topic
/// — never across kinds. Pure over the slice; tested via the store.
fn supersede_similar_facts(observations: &mut [Observation], new_fact: &Observation) {
    for o in observations.iter_mut() {
        if o.kind == new_fact.kind
            && matches!(o.visibility, Visibility::Active)
            && !o.embedding.is_empty()
            && embeddings::cosine(&o.embedding, &new_fact.embedding) > SUPERSEDE_THRESHOLD
        {
            // Invalidate-not-delete (bi-temporal): record WHEN it stopped being
            // true (the replacement's learned_at) so the old belief stays
            // answerable as-of a past time.
            o.visibility = Visibility::Superseded {
                valid_to: Some(new_fact.ts_ms),
            };
        }
    }
}

/// Rough token estimate for budgeting — ~4 chars/token, min 1 (so an empty body
/// still costs something and the loop terminates).
fn est_tokens(text: &str) -> usize {
    (text.chars().count() / 4).max(1)
}

/// Greedy Maximal Marginal Relevance selection within a token budget. Each step
/// picks the candidate maximising `λ·relevance − (1−λ)·max_cosine_to_selected`,
/// stopping once the next pick would exceed `max_tokens` (always keeps at least
/// the top one so recall is never empty when candidates exist). Pure + tested.
fn mmr_budget_select(
    mut candidates: Vec<(Observation, f32)>,
    max_tokens: usize,
    lambda: f32,
) -> Vec<(Observation, f32)> {
    let mut selected: Vec<(Observation, f32)> = Vec::new();
    let mut used = 0usize;
    while !candidates.is_empty() {
        let best = candidates
            .iter()
            .enumerate()
            .max_by(|(_, a), (_, b)| {
                mmr_value(a, &selected, lambda)
                    .partial_cmp(&mmr_value(b, &selected, lambda))
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .map(|(i, _)| i);
        let Some(idx) = best else { break };
        let cost = est_tokens(&candidates[idx].0.body);
        if !selected.is_empty() && used + cost > max_tokens {
            break;
        }
        let picked = candidates.remove(idx);
        used += cost;
        selected.push(picked);
    }
    selected
}

/// MMR value of `candidate` given what's already `selected`: relevance minus a
/// penalty for being similar (cosine) to anything chosen so far.
fn mmr_value(candidate: &(Observation, f32), selected: &[(Observation, f32)], lambda: f32) -> f32 {
    let relevance = candidate.1;
    let max_sim = selected
        .iter()
        .map(|(o, _)| embeddings::cosine(&candidate.0.embedding, &o.embedding))
        .fold(0.0_f32, f32::max);
    lambda * relevance - (1.0 - lambda) * max_sim
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
        valid_from: None,
        visibility: Visibility::Active,
        ..Default::default()
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

/// Bound the observation set to `max`, keeping eri lean. Explicit `fact`s
/// (the user's `/remember`) and tombstones are preserved; the churnier kinds are
/// trimmed oldest-first (the tail is newest, since `insert` pushes
/// chronologically). If facts alone exceed `max`, the oldest facts are trimmed
/// too. Pure + tested.
fn cap_observations(obs: Vec<Observation>, max: usize) -> Vec<Observation> {
    if obs.len() <= max {
        return obs;
    }
    // Preserve explicit `fact`s AND tombstones: a tombstone evicted before it
    // has synced everywhere would let the forgotten fact resurrect on another
    // device (security: C-2). Only the churnier kinds are trimmed oldest-first.
    let (preserved, rest): (Vec<_>, Vec<_>) = obs.into_iter().partition(|o| {
        o.kind == "fact" || o.kind == TOMBSTONE_KIND || o.kind == consolidation::SEMANTIC_KIND
    });
    let keep_rest = max.saturating_sub(preserved.len());
    let rest_start = rest.len().saturating_sub(keep_rest);
    let mut kept = preserved;
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
    // Stable hash of the canonical path (SHA-256 truncated, not DefaultHasher):
    // this digest is written into every Observation and travels in the synced
    // blob, so it must NOT change across Rust versions or cross-device recall
    // scoping would silently break after a toolchain bump (security: H-4). We
    // only need collision-resistance against the user's small workspace count.
    let canonical = workspace
        .canonicalize()
        .unwrap_or_else(|_| workspace.to_path_buf());
    stable_hash16(canonical.to_string_lossy().as_bytes())
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
            valid_from: None,
            visibility: Visibility::Active,
            ..Default::default()
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

    fn scored(id: &str, rel: f32, body: &str, embedding: Vec<f32>) -> (Observation, f32) {
        (
            Observation {
                id: id.into(),
                ts_ms: 1,
                kind: "fact".into(),
                workspace_hash: String::new(),
                body: body.into(),
                embedding,
                valid_from: None,
                visibility: Visibility::Active,
                ..Default::default()
            },
            rel,
        )
    }

    #[test]
    fn mmr_prefers_a_diverse_observation_over_a_near_duplicate() {
        // A and B are near-identical (same embedding); C is different. MMR should
        // pick C before the second of the A/B pair despite C's lower relevance —
        // so the injected slice isn't three ways of saying the same thing.
        let candidates = vec![
            scored("A", 0.90, "xxxxxxxx", vec![1.0, 0.0]),
            scored("B", 0.85, "xxxxxxxx", vec![1.0, 0.0]),
            scored("C", 0.80, "xxxxxxxx", vec![0.0, 1.0]),
        ];
        let out = mmr_budget_select(candidates, 1000, MMR_LAMBDA);
        let order: Vec<&str> = out.iter().map(|(o, _)| o.id.as_str()).collect();
        assert_eq!(
            order,
            vec!["A", "C", "B"],
            "diverse C beats the near-duplicate B"
        );
    }

    #[test]
    fn mmr_budget_stops_at_the_token_ceiling() {
        // Each 40-char body ≈ 10 tokens. With a 15-token budget the first fits
        // (always kept) and the second would overflow → exactly one selected.
        let forty = "y".repeat(40);
        let candidates = vec![
            scored("A", 0.9, &forty, vec![1.0, 0.0]),
            scored("B", 0.8, &forty, vec![0.0, 1.0]),
        ];
        let out = mmr_budget_select(candidates, 15, MMR_LAMBDA);
        assert_eq!(out.len(), 1, "budget caps the slice");
    }

    #[test]
    fn est_tokens_is_roughly_chars_over_four() {
        assert_eq!(est_tokens("12345678"), 2);
        assert_eq!(est_tokens(""), 1, "min 1 so the loop terminates");
    }

    #[test]
    fn a_new_fact_supersedes_a_contradicting_older_one() {
        let (dir, mut store) = open_temp();
        let ws = dir.path();
        store
            .insert("fact", ws, "my favourite colour is blue")
            .unwrap();
        store
            .insert("fact", ws, "my favourite colour is green")
            .unwrap();
        let visible: Vec<String> = store.all().into_iter().map(|o| o.body).collect();
        assert!(
            visible.iter().any(|b| b.contains("green")),
            "the new fact stays"
        );
        assert!(
            !visible.iter().any(|b| b.contains("blue")),
            "the superseded fact is hidden from recall/all"
        );
        // History preserved in the raw store (for sync + future bi-temporal).
        assert!(store.snapshot().iter().any(|o| o.body.contains("blue")));
    }

    #[test]
    fn an_unrelated_fact_does_not_supersede() {
        let (dir, mut store) = open_temp();
        let ws = dir.path();
        store
            .insert("fact", ws, "my favourite colour is blue")
            .unwrap();
        store
            .insert("fact", ws, "I deploy with cargo and rust")
            .unwrap();
        let visible: Vec<String> = store.all().into_iter().map(|o| o.body).collect();
        assert!(
            visible.iter().any(|b| b.contains("blue")),
            "unrelated fact survives"
        );
        assert!(visible.iter().any(|b| b.contains("cargo")));
    }

    #[test]
    fn consolidate_rolls_up_repeated_edits_and_hides_the_episodes() {
        let (dir, mut store) = open_temp();
        let ws = dir.path();
        for f in ["Header.tsx", "Footer.tsx", "Nav.tsx", "Card.tsx"] {
            let body = format!(r#"{{"path":"src/components/{f}","summary":"adjust layout"}}"#);
            store.insert("edit_accepted", ws, &body).unwrap();
        }
        let created = store.consolidate().unwrap();
        assert_eq!(created, 1, "the four similar edits become one rollup");

        // The raw episodes are hidden from recall; the rollup stands in for them.
        let visible = store.all();
        assert!(
            !visible.iter().any(|o| o.kind == "edit_accepted"),
            "episodes are hidden once consolidated"
        );
        let rollup = visible
            .iter()
            .find(|o| o.kind == consolidation::SEMANTIC_KIND)
            .expect("a semantic rollup is visible");
        assert!(rollup.body.contains("accepts"), "rollup: {}", rollup.body);
        assert!(
            rollup.body.contains("src/components"),
            "rollup: {}",
            rollup.body
        );
        // History is preserved in the raw store for sync + future bi-temporal.
        assert_eq!(
            store
                .snapshot()
                .iter()
                .filter(|o| o.kind == "edit_accepted")
                .count(),
            4,
            "episodes survive in the snapshot (sync wire form)"
        );
    }

    #[test]
    fn consolidate_is_idempotent() {
        let (dir, mut store) = open_temp();
        let ws = dir.path();
        for f in ["a.tsx", "b.tsx", "c.tsx"] {
            let body = format!(r#"{{"path":"src/ui/{f}","summary":"tweak spacing"}}"#);
            store.insert("edit_accepted", ws, &body).unwrap();
        }
        assert_eq!(store.consolidate().unwrap(), 1);
        assert_eq!(
            store.consolidate().unwrap(),
            0,
            "a second pass finds the episodes already consolidated"
        );
        assert_eq!(
            store
                .all()
                .iter()
                .filter(|o| o.kind == consolidation::SEMANTIC_KIND)
                .count(),
            1,
            "no duplicate rollup"
        );
    }

    #[test]
    fn legacy_wire_backfills_importance_from_kind() {
        // A pre-P1 Tier-B blob has no importance/recall_count fields — they must
        // deserialize to a kind-derived importance (not zero), so old memories
        // keep a sensible standing weight in the new scorer.
        let json =
            r#"{"id":"x","ts_ms":1,"kind":"fact","workspace_hash":"","body":"my name is Khai"}"#;
        let o: Observation = serde_json::from_str(json).unwrap();
        assert!(
            o.importance >= 0.8,
            "a first-person fact backfills high importance"
        );
        assert_eq!(o.recall_count, 0);
        assert!(o.last_recalled_ms.is_none());
    }

    #[test]
    fn recall_reinforces_surfaced_memories() {
        // MemoryBank: surfacing a memory raises its recall_count + stamps
        // last_recalled_ms, so used memories strengthen (and stop decaying).
        let (dir, mut store) = open_temp();
        let ws = dir.path();
        store.insert("fact", ws, "uses rust and cargo").unwrap();
        let _ = store.recall_hybrid("rust cargo", ws, 5).unwrap();
        let o = store
            .all()
            .into_iter()
            .find(|o| o.body.contains("rust"))
            .expect("the fact is in the store");
        assert_eq!(o.recall_count, 1, "a surfaced memory is reinforced");
        assert!(o.last_recalled_ms.is_some());
    }

    #[test]
    fn rollback_undoes_the_last_memory_write() {
        // P10: insert A then B, roll back → B is gone, A remains (honest undo).
        let (dir, mut store) = open_temp();
        let ws = dir.path();
        store.insert("fact", ws, "uses rust").unwrap();
        store.insert("fact", ws, "lives in Toronto").unwrap();
        assert_eq!(store.all().len(), 2);
        assert!(store.rollback().unwrap(), "there was a write to undo");
        let bodies: Vec<_> = store.all().into_iter().map(|o| o.body).collect();
        assert_eq!(
            bodies,
            vec!["uses rust".to_string()],
            "the last write is undone"
        );
        // Snapshot is consumed — a second rollback finds nothing.
        assert!(
            !store.rollback().unwrap(),
            "single-step: no double rollback"
        );
    }

    #[test]
    fn exact_relog_is_gated_and_reinforces_instead_of_duplicating() {
        // P2: a literal re-log of a recent episodic observation isn't stored twice
        // — it reinforces the existing one (collapses bloat).
        let (dir, mut store) = open_temp();
        let ws = dir.path();
        let body = r#"{"state":"screen shows the dashboard"}"#;
        store.insert("screen", ws, body).unwrap();
        store.insert("screen", ws, body).unwrap();
        let screens: Vec<_> = store
            .all()
            .into_iter()
            .filter(|o| o.kind == "screen")
            .collect();
        assert_eq!(screens.len(), 1, "exact re-log is not duplicated");
        assert_eq!(
            screens[0].recall_count, 1,
            "re-seeing reinforces the existing memory"
        );
    }

    #[test]
    fn supersession_records_valid_to_not_just_a_flag() {
        // Invalidate-not-delete: the older belief keeps its history AND learns
        // *when* it stopped being true (the replacement's learned_at).
        let (dir, mut store) = open_temp();
        let ws = dir.path();
        store
            .insert("fact", ws, "my favourite colour is blue")
            .unwrap();
        let green = store
            .insert("fact", ws, "my favourite colour is green")
            .unwrap();
        let blue = store
            .snapshot()
            .into_iter()
            .find(|o| o.body.contains("blue"))
            .expect("blue survives in history");
        assert_eq!(
            blue.visibility,
            Visibility::Superseded {
                valid_to: Some(green.ts_ms)
            },
            "blue is invalidated, and valid_to records when the belief ended"
        );
    }

    #[test]
    fn is_valid_at_models_the_bi_temporal_interval() {
        let mut o = obs("fact", 100);
        o.visibility = Visibility::Superseded {
            valid_to: Some(200),
        };
        assert!(!o.is_valid_at(50), "not yet learned");
        assert!(o.is_valid_at(100), "valid from its learned_at (inclusive)");
        assert!(o.is_valid_at(150), "valid mid-interval");
        assert!(
            !o.is_valid_at(200),
            "invalid once superseded (exclusive end)"
        );
        assert!(!o.is_valid_at(300), "invalid after");

        // Active (never superseded) → always valid once learned.
        let still_valid = obs("fact", 100);
        assert!(
            still_valid.is_valid_at(999),
            "open-ended fact is always valid after learn"
        );

        // Legacy: superseded with no recorded valid_to → never valid at any point
        // (we can't date its invalidation, so we don't resurrect it into history).
        let mut legacy = obs("fact", 100);
        legacy.visibility = Visibility::Superseded { valid_to: None };
        assert!(!legacy.is_valid_at(150));
    }

    #[test]
    fn recall_as_of_returns_the_belief_held_at_that_instant() {
        let (dir, mut store) = open_temp();
        let ws = dir.path();
        let hash = workspace_hash(ws);
        // Blue was true [100, 200); green is true from 200 on.
        store.file.observations.push(Observation {
            id: "blue".into(),
            ts_ms: 100,
            kind: "fact".into(),
            workspace_hash: hash.clone(),
            body: "favourite colour is blue".into(),
            embedding: Vec::new(),
            valid_from: None,
            visibility: Visibility::Superseded {
                valid_to: Some(200),
            },
            ..Default::default()
        });
        store.file.observations.push(Observation {
            id: "green".into(),
            ts_ms: 200,
            kind: "fact".into(),
            workspace_hash: hash,
            body: "favourite colour is green".into(),
            embedding: Vec::new(),
            valid_from: None,
            visibility: Visibility::Active,
            ..Default::default()
        });

        let at_150 = store.recall_as_of("colour", ws, 5, 150);
        assert_eq!(at_150.len(), 1, "only blue was valid at t=150");
        assert!(at_150[0].body.contains("blue"));

        let at_250 = store.recall_as_of("colour", ws, 5, 250);
        assert_eq!(at_250.len(), 1, "only green is valid at t=250");
        assert!(at_250[0].body.contains("green"));

        // And "now" recall (is_active) shows only the current belief.
        let now = store.recall("colour", ws, 5);
        assert_eq!(now.len(), 1);
        assert!(now[0].body.contains("green"));
    }

    #[test]
    fn candidates_scope_rule_is_uniform_across_readers() {
        // Facts are global; non-fact observations are workspace-local. The
        // candidates() seam owns this rule, so every reader honors it identically.
        let dir = TempDir::new().unwrap();
        let ws_a = dir.path().join("a");
        let ws_b = dir.path().join("b");
        std::fs::create_dir_all(&ws_a).unwrap();
        std::fs::create_dir_all(&ws_b).unwrap();
        let mut store = MemoryStore::open_at(dir.path().join("memory.json")).unwrap();
        store.insert("fact", &ws_a, "global truth").unwrap();
        store
            .insert("control_turn", &ws_a, "local-to-a action")
            .unwrap();

        // From workspace B: the fact crosses over, the workspace-local turn does not.
        for hit in [
            store.recall("", &ws_b, 10),
            store.top_patterns(&ws_b, 10),
            store
                .recall_hybrid("truth action", &ws_b, 10)
                .unwrap()
                .into_iter()
                .map(|(o, _)| o)
                .collect(),
        ] {
            let bodies: Vec<String> = hit.into_iter().map(|o| o.body).collect();
            assert!(
                bodies.iter().any(|b| b.contains("global truth")),
                "fact is global"
            );
            assert!(
                !bodies.iter().any(|b| b.contains("local-to-a")),
                "workspace-local obs must not leak across workspaces"
            );
        }
    }

    #[test]
    fn visibility_serializes_to_the_legacy_flat_wire_format() {
        // C's contract: the Visibility enum must round-trip through the SAME flat
        // superseded/consolidated/valid_to JSON keys, so already-synced Tier-B
        // blobs + cross-device merges with older clients stay compatible.
        let mut o = obs("fact", 1);
        // Active → none of the three keys present (all skip_serializing_if).
        let j = serde_json::to_value(&o).unwrap();
        assert!(
            j.get("superseded").is_none()
                && j.get("consolidated").is_none()
                && j.get("valid_to").is_none()
        );

        o.visibility = Visibility::Superseded { valid_to: Some(42) };
        let j = serde_json::to_value(&o).unwrap();
        assert_eq!(j["superseded"], serde_json::json!(true));
        assert_eq!(j["valid_to"], serde_json::json!(42));
        assert!(j.get("consolidated").is_none());

        o.visibility = Visibility::Consolidated;
        let j = serde_json::to_value(&o).unwrap();
        assert_eq!(j["consolidated"], serde_json::json!(true));
        assert!(j.get("superseded").is_none());
    }

    #[test]
    fn legacy_flat_json_deserializes_into_the_right_visibility() {
        let base = r#"{"id":"x","ts_ms":1,"kind":"fact","workspace_hash":"w","body":"b""#;
        let parse = |extra: &str| -> Observation {
            serde_json::from_str(&format!("{base}{extra}}}")).unwrap()
        };
        // Old blob with just superseded:true (no valid_to) → undateable Superseded.
        assert_eq!(
            parse(r#","superseded":true"#).visibility,
            Visibility::Superseded { valid_to: None }
        );
        // valid_to present but superseded omitted → still normalized to Superseded.
        assert_eq!(
            parse(r#","valid_to":99"#).visibility,
            Visibility::Superseded { valid_to: Some(99) }
        );
        assert_eq!(
            parse(r#","consolidated":true"#).visibility,
            Visibility::Consolidated
        );
        assert_eq!(parse("").visibility, Visibility::Active);
    }

    #[test]
    fn insert_extracts_event_time_from_a_remembered_fact() {
        // The producer end-to-end: remembering "two years ago …" stores a fact
        // whose valid_from is ~2 years before it was learned, so a recall_as_of
        // from back then surfaces it (review D + event-time extraction).
        let (dir, mut store) = open_temp();
        let ws = dir.path();
        let o = store
            .insert("fact", ws, "two years ago I founded a startup that failed")
            .unwrap();
        let two_years = 2 * 365 * 24 * 60 * 60 * 1000u64;
        assert!(o.valid_from.is_some(), "event-time was extracted");
        let vf = o.valid_from();
        assert!(
            vf < o.learned_at() && o.learned_at() - vf >= two_years - 24 * 60 * 60 * 1000,
            "valid_from is ~2 years before learned_at"
        );
        // A recall as-of one year ago finds it (it was already true then); the
        // event happened ~2 years ago, so it was valid 1 year ago.
        let one_year_ago = o.learned_at() - 365 * 24 * 60 * 60 * 1000;
        assert!(
            store
                .recall_as_of("startup", ws, 5, one_year_ago)
                .iter()
                .any(|h| h.body.contains("founded")),
            "the back-dated fact is valid as-of a year ago"
        );

        // A plain fact with no time cue keeps valid_from = learned_at (None).
        let plain = store.insert("fact", ws, "I prefer dark mode").unwrap();
        assert_eq!(plain.valid_from, None);
    }

    #[test]
    fn valid_from_decouples_event_time_from_learned_at() {
        // A fact learned today about a PAST event: valid_from precedes ts_ms.
        // It's valid as-of an instant after it became true even though eri learned
        // it later — the bi-temporal event timeline, distinct from ingestion (D).
        let mut o = obs("fact", 1000);
        o.valid_from = Some(200);
        assert_eq!(o.valid_from(), 200, "event-time start");
        assert_eq!(o.learned_at(), 1000, "transaction time is unchanged");
        assert!(o.is_valid_at(500), "true at 500 (after it became true)");
        assert!(!o.is_valid_at(100), "not yet true at 100");

        // Default: no valid_from → falls back to learned_at (v1 behaviour).
        assert_eq!(obs("fact", 1000).valid_from(), 1000);
    }

    #[test]
    fn valid_from_round_trips_on_the_wire_only_when_set() {
        let mut o = obs("fact", 1);
        // Default None → key absent (no bloat for the common case).
        assert!(
            serde_json::to_value(&o)
                .unwrap()
                .get("valid_from")
                .is_none()
        );
        o.valid_from = Some(77);
        let j = serde_json::to_value(&o).unwrap();
        assert_eq!(j["valid_from"], serde_json::json!(77));
        let back: Observation = serde_json::from_value(j).unwrap();
        assert_eq!(back.valid_from, Some(77));
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
            valid_from: None,
            visibility: Visibility::Active,
            ..Default::default()
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
    fn open_at_errors_on_a_corrupt_store_instead_of_silently_emptying() {
        // Security M-5: a corrupt file must NOT become an empty store (which would
        // then overwrite the bytes + push emptiness to the cloud). It must error,
        // leaving the file intact for recovery.
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("memory.json");
        fs::write(&path, b"{ this is not valid json").unwrap();
        match MemoryStore::open_at(path.clone()) {
            Ok(_) => panic!("a corrupt store must not open as empty"),
            Err(e) => assert_eq!(e.kind(), io::ErrorKind::InvalidData),
        }
        assert!(
            path.exists(),
            "corrupt file must be left in place for recovery"
        );
    }

    #[test]
    fn save_then_reopen_roundtrips_atomically() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("memory.json");
        {
            let mut store = MemoryStore::open_at(path.clone()).unwrap();
            store
                .insert("fact", dir.path(), "survives a rename")
                .unwrap();
        }
        let reopened = MemoryStore::open_at(path).unwrap();
        assert!(reopened.all().iter().any(|o| o.body == "survives a rename"));
    }

    #[test]
    fn prune_keeps_old_tombstones_so_a_forget_cannot_resurrect() {
        // Security C-2: a tombstone older than the retention window must NOT be
        // pruned, or the forgotten fact resurrects from a stale copy on merge.
        let (dir, mut store) = open_temp();
        store.file.observations.push(Observation {
            id: "t".into(),
            ts_ms: 1, // 1970 — far past any window
            kind: TOMBSTONE_KIND.into(),
            workspace_hash: String::new(),
            body: "forgotten-id".into(),
            embedding: Vec::new(),
            valid_from: None,
            visibility: Visibility::Active,
            ..Default::default()
        });
        store.insert("fact", dir.path(), "fresh").unwrap();
        store.prune(RetentionWindow::Day).unwrap();
        assert!(
            store
                .snapshot()
                .iter()
                .any(|o| o.kind == TOMBSTONE_KIND && o.body == "forgotten-id"),
            "an expired tombstone must survive prune"
        );
    }

    #[test]
    fn cap_preserves_tombstones_alongside_facts() {
        // Security C-2: tombstones are not churn — the cap must keep them like
        // facts, not trim them oldest-first with the edit history.
        let mut v = vec![obs(TOMBSTONE_KIND, 0)];
        for ts in 10..20 {
            v.push(obs("edit_accepted", ts));
        }
        let capped = cap_observations(v, 3);
        assert!(
            capped.iter().any(|o| o.kind == TOMBSTONE_KIND),
            "a tombstone must survive the anti-bloat cap"
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
            valid_from: None,
            visibility: Visibility::Active,
            ..Default::default()
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
            valid_from: None,
            visibility: Visibility::Active,
            ..Default::default()
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
