//! Cross-session embedded cache for eri.
//!
//! Backed by `sled`, stored under `~/.eri/cache.sled` by default. The cache is
//! designed to short-circuit recomputation across sessions: intent
//! classification, caveman-compressed prompts, per-project design preferences,
//! a small session recap log, learned voice phrasings, and a running tally of
//! tokens saved by serving requests from the cache.
//!
//! The crate is intentionally standalone — no eri_inference / eri_core
//! dependencies — so it can be wired into Mercury / Claude call sites in a
//! follow-up PR without churning in-flight work in those crates.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use thiserror::Error;

const DEFAULT_TTL_SECS: u64 = 60 * 60 * 24 * 30;
const SIZE_CHECK_ENV: &str = "ERI_CACHE_MAX_MB";
const DEFAULT_MAX_BYTES: u64 = 100 * 1024 * 1024;
const SLOW_OP_THRESHOLD: Duration = Duration::from_millis(50);

/// Logical bucket inside the single sled tree. Encoded as a single byte tag
/// prefixed to the user-supplied key — this keeps namespaces isolated and
/// allows efficient prefix scans without colliding on arbitrary user keys
/// containing `:` characters.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Namespace {
    IntentClassification,
    DesignPreferences,
    PromptCompression,
    MercuryTokenSavings,
    SessionRecap,
    VoiceCommandPatterns,
}

impl Namespace {
    fn tag(self) -> u8 {
        match self {
            Namespace::IntentClassification => 1,
            Namespace::DesignPreferences => 2,
            Namespace::PromptCompression => 3,
            Namespace::MercuryTokenSavings => 4,
            Namespace::SessionRecap => 5,
            Namespace::VoiceCommandPatterns => 6,
        }
    }
}

#[derive(Debug, Error)]
pub enum CacheError {
    #[error("sled error: {0}")]
    Sled(#[from] sled::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("bad cache key: {0}")]
    BadKey(String),
}

/// Pluggable clock so TTL behavior can be exercised deterministically in tests.
pub trait Clock: Send + Sync + 'static {
    fn now_unix(&self) -> u64;
}

#[derive(Debug, Default, Clone, Copy)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now_unix(&self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct Envelope {
    /// Unix seconds when this entry expires. `None` means no expiry.
    expires_at: Option<u64>,
    /// Unix seconds when the entry was last touched (set/get). Used for LRU
    /// eviction when the cache exceeds the size cap.
    last_access: u64,
    /// Raw JSON payload — kept as a string so we don't pay the cost of
    /// reparsing it during purges / eviction scans.
    payload: String,
}

pub struct Cache {
    db: sled::Db,
    clock: Arc<dyn Clock>,
    max_bytes: u64,
}

impl Cache {
    /// Open the cache at `~/.eri/cache.sled`, creating it if it does not exist.
    pub fn open() -> Result<Self, CacheError> {
        let path = default_path()?;
        Self::open_at(&path)
    }

    pub fn open_at(path: &Path) -> Result<Self, CacheError> {
        Self::open_with(path, Arc::new(SystemClock))
    }

    /// Open with a custom clock — primarily for tests.
    pub fn open_with(path: &Path, clock: Arc<dyn Clock>) -> Result<Self, CacheError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let db = sled::open(path)?;
        let max_bytes = read_max_bytes_from_env();
        let cache = Cache { db, clock, max_bytes };
        cache.spawn_background_maintenance();
        Ok(cache)
    }

    pub fn get<T: serde::de::DeserializeOwned>(
        &self,
        ns: Namespace,
        key: &str,
    ) -> Result<Option<T>, CacheError> {
        let start = Instant::now();
        let storage_key = encode_key(ns, key)?;
        let raw = self.db.get(&storage_key)?;
        let Some(raw) = raw else {
            warn_if_slow("get(miss)", start);
            return Ok(None);
        };
        let mut envelope: Envelope = serde_json::from_slice(&raw)?;
        let now = self.clock.now_unix();
        if let Some(expires_at) = envelope.expires_at
            && now >= expires_at
        {
            // Expired: drop the entry and report miss.
            self.db.remove(&storage_key)?;
            warn_if_slow("get(expired)", start);
            return Ok(None);
        }
        envelope.last_access = now;
        let refreshed = serde_json::to_vec(&envelope)?;
        self.db.insert(&storage_key, refreshed)?;
        let value: T = serde_json::from_str(&envelope.payload)?;
        warn_if_slow("get(hit)", start);
        Ok(Some(value))
    }

    pub fn set<T: serde::Serialize>(
        &self,
        ns: Namespace,
        key: &str,
        value: &T,
    ) -> Result<(), CacheError> {
        self.set_with_ttl(ns, key, value, Some(Duration::from_secs(DEFAULT_TTL_SECS)))
    }

    /// Set with a custom TTL. `None` keeps the entry until evicted manually
    /// or by the size cap.
    pub fn set_with_ttl<T: serde::Serialize>(
        &self,
        ns: Namespace,
        key: &str,
        value: &T,
        ttl: Option<Duration>,
    ) -> Result<(), CacheError> {
        let start = Instant::now();
        let storage_key = encode_key(ns, key)?;
        let now = self.clock.now_unix();
        let envelope = Envelope {
            expires_at: ttl.map(|t| now.saturating_add(t.as_secs())),
            last_access: now,
            payload: serde_json::to_string(value)?,
        };
        let bytes = serde_json::to_vec(&envelope)?;
        self.db.insert(&storage_key, bytes)?;
        warn_if_slow("set", start);
        Ok(())
    }

    pub fn delete(&self, ns: Namespace, key: &str) -> Result<(), CacheError> {
        let storage_key = encode_key(ns, key)?;
        self.db.remove(&storage_key)?;
        Ok(())
    }

    /// List keys in a namespace, optionally filtered by a key prefix. Keys are
    /// returned without the internal namespace tag.
    pub fn list(
        &self,
        ns: Namespace,
        prefix: Option<&str>,
    ) -> Result<Vec<String>, CacheError> {
        let mut scan_prefix = vec![ns.tag()];
        if let Some(p) = prefix {
            validate_key(p)?;
            scan_prefix.extend_from_slice(p.as_bytes());
        }
        let mut out = Vec::new();
        for entry in self.db.scan_prefix(&scan_prefix) {
            let (raw_key, _value) = entry?;
            if raw_key.len() < 1 {
                continue;
            }
            let key_bytes = &raw_key[1..];
            let key = std::str::from_utf8(key_bytes)
                .map_err(|e| CacheError::BadKey(format!("non-utf8 stored key: {e}")))?
                .to_string();
            out.push(key);
        }
        Ok(out)
    }

    pub fn flush(&self) -> Result<(), CacheError> {
        self.db.flush()?;
        Ok(())
    }

    /// Drop every expired entry. Returns the number of entries removed.
    pub fn purge_expired(&self) -> Result<usize, CacheError> {
        let now = self.clock.now_unix();
        let mut removed = 0usize;
        let mut to_remove = Vec::new();
        for entry in self.db.iter() {
            let (raw_key, raw_value) = entry?;
            let envelope: Envelope = match serde_json::from_slice(&raw_value) {
                Ok(env) => env,
                Err(_) => {
                    // Corrupt entry — schedule removal to keep the cache clean.
                    to_remove.push(raw_key.to_vec());
                    continue;
                }
            };
            if let Some(expires_at) = envelope.expires_at
                && now >= expires_at
            {
                to_remove.push(raw_key.to_vec());
            }
        }
        for key in to_remove {
            self.db.remove(&key)?;
            removed += 1;
        }
        Ok(removed)
    }

    /// Evict the oldest entries (by last access) until the on-disk size dips
    /// below the configured cap. No-op when already under cap.
    pub fn evict_to_size_cap(&self) -> Result<usize, CacheError> {
        let mut evicted = 0usize;
        if self.db.size_on_disk()? <= self.max_bytes {
            return Ok(0);
        }
        let mut entries: Vec<(Vec<u8>, u64)> = Vec::new();
        for entry in self.db.iter() {
            let (raw_key, raw_value) = entry?;
            let envelope: Envelope = match serde_json::from_slice(&raw_value) {
                Ok(env) => env,
                Err(_) => {
                    entries.push((raw_key.to_vec(), 0));
                    continue;
                }
            };
            entries.push((raw_key.to_vec(), envelope.last_access));
        }
        entries.sort_by_key(|(_, ts)| *ts);
        for (key, _) in entries {
            if self.db.size_on_disk()? <= self.max_bytes {
                break;
            }
            self.db.remove(&key)?;
            self.db.flush()?;
            evicted += 1;
        }
        Ok(evicted)
    }

    fn spawn_background_maintenance(&self) {
        let db = self.db.clone();
        let clock = self.clock.clone();
        let max_bytes = self.max_bytes;
        std::thread::Builder::new()
            .name("eri_cache::maintenance".into())
            .spawn(move || {
                if let Err(e) = run_maintenance(&db, clock.as_ref(), max_bytes) {
                    log::warn!("eri_cache maintenance failed: {e}");
                }
            })
            .ok();
    }
}

fn run_maintenance(
    db: &sled::Db,
    clock: &dyn Clock,
    max_bytes: u64,
) -> Result<(), CacheError> {
    let now = clock.now_unix();
    let mut to_remove = Vec::new();
    for entry in db.iter() {
        let (raw_key, raw_value) = entry?;
        let envelope: Envelope = match serde_json::from_slice(&raw_value) {
            Ok(env) => env,
            Err(_) => {
                to_remove.push(raw_key.to_vec());
                continue;
            }
        };
        if let Some(expires_at) = envelope.expires_at
            && now >= expires_at
        {
            to_remove.push(raw_key.to_vec());
        }
    }
    for key in to_remove {
        db.remove(&key)?;
    }
    if db.size_on_disk()? > max_bytes {
        let mut entries: Vec<(Vec<u8>, u64)> = Vec::new();
        for entry in db.iter() {
            let (raw_key, raw_value) = entry?;
            let envelope: Envelope = match serde_json::from_slice(&raw_value) {
                Ok(env) => env,
                Err(_) => {
                    entries.push((raw_key.to_vec(), 0));
                    continue;
                }
            };
            entries.push((raw_key.to_vec(), envelope.last_access));
        }
        entries.sort_by_key(|(_, ts)| *ts);
        for (key, _) in entries {
            if db.size_on_disk()? <= max_bytes {
                break;
            }
            db.remove(&key)?;
        }
    }
    db.flush()?;
    Ok(())
}

fn encode_key(ns: Namespace, key: &str) -> Result<Vec<u8>, CacheError> {
    validate_key(key)?;
    let mut out = Vec::with_capacity(key.len() + 1);
    out.push(ns.tag());
    out.extend_from_slice(key.as_bytes());
    Ok(out)
}

fn validate_key(key: &str) -> Result<(), CacheError> {
    if key.is_empty() {
        return Err(CacheError::BadKey("empty key".into()));
    }
    if key.as_bytes().contains(&0) {
        return Err(CacheError::BadKey("key contains null byte".into()));
    }
    Ok(())
}

fn default_path() -> Result<PathBuf, CacheError> {
    // Avoid pulling in a full dirs crate — `HOME` is universally set on the
    // platforms eri targets.
    let home = std::env::var_os("HOME")
        .ok_or_else(|| CacheError::BadKey("HOME env var not set".into()))?;
    let mut path = PathBuf::from(home);
    path.push(".eri");
    path.push("cache.sled");
    Ok(path)
}

fn read_max_bytes_from_env() -> u64 {
    match std::env::var(SIZE_CHECK_ENV) {
        Ok(raw) => match raw.trim().parse::<u64>() {
            Ok(mb) => mb.saturating_mul(1024 * 1024),
            Err(_) => DEFAULT_MAX_BYTES,
        },
        Err(_) => DEFAULT_MAX_BYTES,
    }
}

fn warn_if_slow(op: &str, start: Instant) {
    let elapsed = start.elapsed();
    if elapsed > SLOW_OP_THRESHOLD {
        log::warn!("eri_cache {op} took {elapsed:?} (>50ms)");
    }
}
