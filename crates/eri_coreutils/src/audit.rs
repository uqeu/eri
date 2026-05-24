//! Local-only, opt-in audit log for the eri sidecar.
//!
//! The audit log is the local-first, privacy-respecting record of every
//! JSON-RPC dispatch the sidecar handles. It's append-only JSON Lines,
//! never contains user prompts/model outputs/secrets, and is rotated on a
//! simple file-size threshold.
//!
//! By design:
//!  * **Opt-in.** A logger is constructed but disabled until the IDE flips
//!    `eri/audit/enable`. `record()` short-circuits to a no-op when disabled.
//!  * **Never blocks dispatch.** `record()` is `async` but takes the lock,
//!    writes one line, flushes, and returns. Callers that don't want any
//!    latency at all should `tokio::spawn` the future — that is what the
//!    dispatch site in `lib.rs` does.
//!  * **Sanitized.** Use [`audit_params_shape`] to map a JSON-RPC params
//!    object onto a structure describing its *types and key names only* —
//!    no values, ever.
//!  * **Workspace-scoped, with global fallback.** When the caller knows a
//!    workspace path the log lives at `<workspace>/.eri/audit.log`;
//!    otherwise at `~/.eri/audit.log`.
//!
//! The module is intentionally lean — `std::fs` + `tokio::sync::Mutex`.
//! Rotation runs synchronously inside the write path because the cost is
//! one rename per ~16 MiB.

use std::fs::{self, File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use tokio::sync::Mutex;

/// Maximum number of recent entries `eri/audit/recent` returns.
pub const RECENT_LIMIT_MAX: usize = 500;
/// Maximum keys we list when summarising an object's shape.
const MAX_OBJECT_KEYS: usize = 10;

/// File-rotation policy. Defaults to 16 MiB per file with three backups
/// kept on disk (so `audit.log`, `audit.log.1`, `audit.log.2`, `audit.log.3`).
#[derive(Debug, Clone)]
pub struct RotationPolicy {
    pub max_file_bytes: u64,
    pub max_files: usize,
}

impl Default for RotationPolicy {
    fn default() -> Self {
        Self {
            max_file_bytes: 16 * 1024 * 1024,
            max_files: 4,
        }
    }
}

/// Outcome of the audited event. Mirrors `Ok` / `Err` from dispatch with an
/// extra `Skipped` slot for events that were short-circuited (e.g. by a
/// feature gate) without being errors.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuditStatus {
    Ok,
    Error,
    Skipped,
}

impl AuditStatus {
    fn as_str(self) -> &'static str {
        match self {
            AuditStatus::Ok => "ok",
            AuditStatus::Error => "error",
            AuditStatus::Skipped => "skipped",
        }
    }
}

impl Serialize for AuditStatus {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(self.as_str())
    }
}

/// One audit row. `metadata` is freeform but MUST NEVER contain prompt
/// bodies, model outputs, file contents, or secrets — sanitize at the call
/// site with [`audit_params_shape`].
#[derive(Debug, Clone, Serialize)]
pub struct AuditEntry {
    pub at_ms: u64,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace: Option<PathBuf>,
    pub status: AuditStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    pub metadata: Value,
}

impl AuditEntry {
    /// Build an entry pre-stamped with `at_ms = now`.
    pub fn new(kind: impl Into<String>, status: AuditStatus) -> Self {
        Self {
            at_ms: now_ms(),
            kind: kind.into(),
            method: None,
            workspace: None,
            status,
            duration_ms: None,
            metadata: Value::Null,
        }
    }

    pub fn with_method(mut self, method: impl Into<String>) -> Self {
        self.method = Some(method.into());
        self
    }

    pub fn with_workspace(mut self, ws: impl Into<PathBuf>) -> Self {
        self.workspace = Some(ws.into());
        self
    }

    pub fn with_duration(mut self, d_ms: u64) -> Self {
        self.duration_ms = Some(d_ms);
        self
    }

    pub fn with_metadata(mut self, meta: Value) -> Self {
        self.metadata = meta;
        self
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Locked, append-only handle to the JSONL file plus its rotation metadata.
struct Inner {
    writer: BufWriter<File>,
    bytes_written: u64,
}

/// Audit logger. Cheap to clone via `Arc`. Constructed via [`AuditLogger::open`].
pub struct AuditLogger {
    inner: Arc<Mutex<Option<Inner>>>,
    enabled: Arc<AtomicBool>,
    rotation: RotationPolicy,
    rotations: Arc<AtomicU64>,
    dropped: Arc<AtomicU64>,
    /// `None` means "no workspace provided — fall back to `~/.eri/audit.log`".
    /// Stored so `set_enabled(true)` after a delayed enable can re-resolve.
    base_dir: PathBuf,
}

impl AuditLogger {
    /// Open (or lazily prepare) the audit log for a given workspace.
    ///
    /// `workspace_root` resolves the log file to `<workspace>/.eri/audit.log`.
    /// When `None`, the log goes under `~/.eri/audit.log`. The file is
    /// created lazily on first enabled `record()` call so the disabled path
    /// never touches the filesystem.
    pub fn open(workspace_root: Option<&Path>, enabled: bool) -> Result<Self> {
        let base_dir = resolve_base_dir(workspace_root)?;
        let logger = Self {
            inner: Arc::new(Mutex::new(None)),
            enabled: Arc::new(AtomicBool::new(enabled)),
            rotation: RotationPolicy::default(),
            rotations: Arc::new(AtomicU64::new(0)),
            dropped: Arc::new(AtomicU64::new(0)),
            base_dir,
        };
        Ok(logger)
    }

    /// Always-succeeds constructor used as the failsafe in `Services::default`.
    /// Falls back to a temp-dir path with the logger disabled when even the
    /// global resolution path errors. Never panics.
    pub fn open_disabled_fallback() -> Self {
        let base_dir = resolve_base_dir(None)
            .unwrap_or_else(|_| std::env::temp_dir().join("eri-audit-fallback"));
        Self {
            inner: Arc::new(Mutex::new(None)),
            enabled: Arc::new(AtomicBool::new(false)),
            rotation: RotationPolicy::default(),
            rotations: Arc::new(AtomicU64::new(0)),
            dropped: Arc::new(AtomicU64::new(0)),
            base_dir,
        }
    }

    /// Open with a caller-supplied rotation policy. Mostly for tests so we
    /// can drive rotation without writing 16 MiB.
    pub fn open_with_policy(
        workspace_root: Option<&Path>,
        enabled: bool,
        rotation: RotationPolicy,
    ) -> Result<Self> {
        let mut logger = Self::open(workspace_root, enabled)?;
        logger.rotation = rotation;
        Ok(logger)
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::SeqCst)
    }

    pub fn set_enabled(&self, enabled: bool) {
        self.enabled.store(enabled, Ordering::SeqCst);
    }

    /// Path the audit log writes to (file may not exist yet if no entry
    /// has been recorded).
    pub fn path(&self) -> PathBuf {
        self.base_dir.join("audit.log")
    }

    /// Number of rotations performed since this logger was opened.
    pub fn rotations(&self) -> u64 {
        self.rotations.load(Ordering::SeqCst)
    }

    /// Best-effort current size, in bytes, of the active log file.
    pub fn current_size_bytes(&self) -> u64 {
        fs::metadata(self.path())
            .map(|m| m.len())
            .unwrap_or(0)
    }

    /// Append one entry. Returns immediately when disabled.
    ///
    /// Errors are *swallowed and counted* — auditing must never break
    /// dispatch. Callers can read [`AuditLogger::dropped_count`] to surface
    /// "audit is broken" diagnostics if they want.
    pub async fn record(&self, entry: AuditEntry) {
        if !self.is_enabled() {
            return;
        }
        if let Err(err) = self.write_entry(entry).await {
            self.dropped.fetch_add(1, Ordering::SeqCst);
            tracing::warn!(error = %err, "audit write failed; dropping entry");
        }
    }

    /// Number of entries dropped due to write errors.
    pub fn dropped_count(&self) -> u64 {
        self.dropped.load(Ordering::SeqCst)
    }

    /// Force a rotation now (e.g. exposed via `eri/audit/rotate` later).
    pub async fn rotate_now(&self) -> Result<()> {
        let mut guard = self.inner.lock().await;
        if let Some(inner) = guard.as_mut() {
            inner.writer.flush().ok();
        }
        // Drop current writer before renaming.
        *guard = None;
        rotate_files(&self.path(), self.rotation.max_files)?;
        self.rotations.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }

    /// Read up to `limit` recent entries from the current `audit.log` file.
    /// Used by `eri/audit/recent`. Reads synchronously — typical `limit` is
    /// well under 500 lines so cost is negligible.
    pub fn read_recent(&self, limit: usize) -> Result<Vec<Value>> {
        let limit = limit.min(RECENT_LIMIT_MAX);
        let path = self.path();
        if !path.exists() {
            return Ok(Vec::new());
        }
        let content = fs::read_to_string(&path)
            .with_context(|| format!("reading audit log {}", path.display()))?;
        let mut entries: Vec<Value> = Vec::new();
        // Iterate from the tail. Lines may not be uniform length; we take
        // the last `limit` parseable lines.
        let lines: Vec<&str> = content.lines().collect();
        let take_from = lines.len().saturating_sub(limit);
        for line in &lines[take_from..] {
            if line.trim().is_empty() {
                continue;
            }
            if let Ok(value) = serde_json::from_str::<Value>(line) {
                entries.push(value);
            }
        }
        Ok(entries)
    }

    async fn write_entry(&self, entry: AuditEntry) -> Result<()> {
        let serialized = serde_json::to_string(&entry).context("serializing audit entry")?;
        let mut line = serialized;
        line.push('\n');
        let line_bytes = line.len() as u64;

        let mut guard = self.inner.lock().await;
        // Lazy-open on first enabled write.
        if guard.is_none() {
            *guard = Some(open_inner(&self.path())?);
        }

        // Rotate-then-write so a single entry never lives across files.
        let needs_rotate = match guard.as_ref() {
            Some(inner) => inner.bytes_written + line_bytes > self.rotation.max_file_bytes,
            None => false,
        };
        if needs_rotate {
            // Drop the current writer so the rename can proceed on Windows.
            if let Some(inner) = guard.as_mut() {
                inner.writer.flush().ok();
            }
            *guard = None;
            rotate_files(&self.path(), self.rotation.max_files)?;
            self.rotations.fetch_add(1, Ordering::SeqCst);
            *guard = Some(open_inner(&self.path())?);
        }

        let inner = guard
            .as_mut()
            .expect("inner audit handle is opened above");
        inner
            .writer
            .write_all(line.as_bytes())
            .context("writing audit line")?;
        inner.writer.flush().context("flushing audit line")?;
        inner.bytes_written = inner.bytes_written.saturating_add(line_bytes);
        Ok(())
    }
}

impl std::fmt::Debug for AuditLogger {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AuditLogger")
            .field("path", &self.path())
            .field("enabled", &self.is_enabled())
            .finish()
    }
}

/// Mirror counter so callers can clone the inner Arc without holding the
/// whole logger.
#[allow(dead_code)]
fn _atomic_clone_proof(a: &Arc<AtomicUsize>) -> Arc<AtomicUsize> {
    Arc::clone(a)
}

fn open_inner(path: &Path) -> Result<Inner> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("creating audit dir {}", parent.display()))?;
    }
    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .with_context(|| format!("opening audit log {}", path.display()))?;
    let bytes_written = file
        .metadata()
        .map(|m| m.len())
        .unwrap_or(0);
    Ok(Inner {
        writer: BufWriter::new(file),
        bytes_written,
    })
}

fn rotate_files(path: &Path, max_files: usize) -> Result<()> {
    if max_files <= 1 || !path.exists() {
        // If we keep only one file, just truncate by removing.
        if max_files <= 1 && path.exists() {
            fs::remove_file(path).ok();
        }
        return Ok(());
    }
    // Shift: audit.log.(n-1) → audit.log.n ... audit.log → audit.log.1
    for index in (1..max_files).rev() {
        let src = backup_path(path, index);
        let dst = backup_path(path, index + 1);
        if index + 1 > max_files - 1 {
            // The would-be destination is past the retention window — drop it.
            if src.exists() {
                fs::remove_file(&src).ok();
            }
            continue;
        }
        if src.exists() {
            fs::rename(&src, &dst).with_context(|| {
                format!("rotating {} -> {}", src.display(), dst.display())
            })?;
        }
    }
    let first_backup = backup_path(path, 1);
    fs::rename(path, &first_backup).with_context(|| {
        format!("rotating {} -> {}", path.display(), first_backup.display())
    })?;
    Ok(())
}

fn backup_path(path: &Path, index: usize) -> PathBuf {
    let mut s = path.as_os_str().to_os_string();
    s.push(format!(".{index}"));
    PathBuf::from(s)
}

fn resolve_base_dir(workspace_root: Option<&Path>) -> Result<PathBuf> {
    if let Some(ws) = workspace_root {
        return Ok(ws.join(".eri"));
    }
    // Global fallback: ~/.eri
    let home = dirs_home_dir()
        .context("unable to resolve home directory for global audit log fallback")?;
    Ok(home.join(".eri"))
}

/// Tiny home-dir resolver to avoid pulling the `dirs` crate. Reads `HOME`
/// (and `USERPROFILE` on Windows). Returns `None` when neither is set.
fn dirs_home_dir() -> Option<PathBuf> {
    if let Ok(home) = std::env::var("HOME") {
        if !home.is_empty() {
            return Some(PathBuf::from(home));
        }
    }
    if let Ok(profile) = std::env::var("USERPROFILE") {
        if !profile.is_empty() {
            return Some(PathBuf::from(profile));
        }
    }
    None
}

/// Recursively map a JSON value onto its *shape* — type names and key
/// listings only. No original string/number/boolean values survive.
///
/// Rules:
///   * `null` → `"null"`
///   * `bool` → `"bool"`
///   * `number` → `"number"`
///   * `string` → `"string"`
///   * `array` → `{ "type": "array", "len": N, "items": <shape of first up to 3> }`
///   * `object` → `{ "type": "object", "keys": [up to 10 key names], "shape": { key: shape } }`
///
/// The first three array element shapes are summarised so we can spot
/// homogeneity without dumping payloads.
pub fn audit_params_shape(params: &Value) -> Value {
    audit_params_shape_inner(params, 0)
}

fn audit_params_shape_inner(params: &Value, depth: usize) -> Value {
    // Hard depth cap: we never need to introspect deeper than 4 levels for
    // an audit summary. Beyond that, just label the type.
    if depth >= 4 {
        return Value::String(type_name(params).to_string());
    }
    match params {
        Value::Null => Value::String("null".to_string()),
        Value::Bool(_) => Value::String("bool".to_string()),
        Value::Number(_) => Value::String("number".to_string()),
        Value::String(s) => Value::String(format!("string[len={}]", s.len())),
        Value::Array(arr) => {
            let mut items: Vec<Value> = Vec::new();
            for v in arr.iter().take(3) {
                items.push(audit_params_shape_inner(v, depth + 1));
            }
            json!({
                "type": "array",
                "len": arr.len(),
                "items": items,
            })
        }
        Value::Object(map) => {
            let total = map.len();
            let mut shape = Map::new();
            let mut keys: Vec<String> = Vec::new();
            for (k, v) in map.iter().take(MAX_OBJECT_KEYS) {
                keys.push(k.clone());
                shape.insert(k.clone(), audit_params_shape_inner(v, depth + 1));
            }
            if total > MAX_OBJECT_KEYS {
                keys.push("...".to_string());
            }
            json!({
                "type": "object",
                "keys": keys,
                "shape": Value::Object(shape),
                "key_count": total,
            })
        }
    }
}

fn type_name(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "bool",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

/// Convenience: derive a short, non-revealing error label from a
/// `DispatchError`-shaped message. We deliberately keep this to a
/// fixed token like `"bad_params"` so error bodies never bleed into the
/// audit log.
pub fn audit_error_kind(message: &str) -> &'static str {
    let lower = message.to_ascii_lowercase();
    if lower.contains("feature_locked") {
        "feature_locked"
    } else if lower.contains("bad params") || lower.contains("invalid") {
        "bad_params"
    } else if lower.contains("not implemented") {
        "not_implemented"
    } else if lower.contains("downloading") {
        "downloading"
    } else {
        "other"
    }
}

/// Shape we expose via `eri/audit/status`.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditStatusReport {
    pub enabled: bool,
    pub path: String,
    pub size_bytes: u64,
    pub rotations: u64,
    pub dropped: u64,
}

impl AuditLogger {
    /// Snapshot of audit state for the IDE's status view.
    pub fn status_report(&self) -> AuditStatusReport {
        AuditStatusReport {
            enabled: self.is_enabled(),
            path: self.path().to_string_lossy().to_string(),
            size_bytes: self.current_size_bytes(),
            rotations: self.rotations(),
            dropped: self.dropped_count(),
        }
    }
}

// -------------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::tempdir;

    fn read_lines(path: &Path) -> Vec<String> {
        fs::read_to_string(path)
            .unwrap_or_default()
            .lines()
            .map(|s| s.to_string())
            .collect()
    }

    #[tokio::test]
    async fn writes_one_jsonl_entry_when_enabled() {
        let dir = tempdir().unwrap();
        let logger = AuditLogger::open(Some(dir.path()), true).unwrap();
        logger
            .record(
                AuditEntry::new("dispatch", AuditStatus::Ok)
                    .with_method("eri/ping")
                    .with_duration(3)
                    .with_metadata(json!({ "params": { "type": "object", "keys": [] } })),
            )
            .await;
        let lines = read_lines(&logger.path());
        assert_eq!(lines.len(), 1);
        let parsed: Value = serde_json::from_str(&lines[0]).unwrap();
        assert_eq!(parsed["kind"], "dispatch");
        assert_eq!(parsed["method"], "eri/ping");
        assert_eq!(parsed["status"], "ok");
        assert_eq!(parsed["duration_ms"], 3);
    }

    #[tokio::test]
    async fn disabled_logger_writes_nothing() {
        let dir = tempdir().unwrap();
        let logger = AuditLogger::open(Some(dir.path()), false).unwrap();
        logger
            .record(AuditEntry::new("dispatch", AuditStatus::Ok).with_method("eri/ping"))
            .await;
        assert!(!logger.path().exists(), "audit.log must not be created");
    }

    #[tokio::test]
    async fn toggle_runtime_enables_writes() {
        let dir = tempdir().unwrap();
        let logger = AuditLogger::open(Some(dir.path()), false).unwrap();
        logger.record(AuditEntry::new("a", AuditStatus::Ok)).await;
        assert!(!logger.path().exists());

        logger.set_enabled(true);
        logger.record(AuditEntry::new("b", AuditStatus::Ok)).await;
        let lines = read_lines(&logger.path());
        assert_eq!(lines.len(), 1);
        let parsed: Value = serde_json::from_str(&lines[0]).unwrap();
        assert_eq!(parsed["kind"], "b");
    }

    #[tokio::test]
    async fn rotation_triggers_at_threshold() {
        let dir = tempdir().unwrap();
        let policy = RotationPolicy {
            max_file_bytes: 256,
            max_files: 3,
        };
        let logger = AuditLogger::open_with_policy(Some(dir.path()), true, policy).unwrap();
        // Write enough entries to force >1 rotation.
        for i in 0..50 {
            logger
                .record(
                    AuditEntry::new("dispatch", AuditStatus::Ok)
                        .with_method(format!("eri/test/{i}")),
                )
                .await;
        }
        assert!(logger.rotations() >= 1, "expected at least one rotation");
        // The primary log should still exist (post-rotation), plus at least one backup.
        let backup1 = backup_path(&logger.path(), 1);
        assert!(backup1.exists(), "audit.log.1 should exist after rotation");
    }

    #[tokio::test]
    async fn rotation_caps_backup_count() {
        let dir = tempdir().unwrap();
        let policy = RotationPolicy {
            max_file_bytes: 128,
            max_files: 3, // → audit.log + audit.log.1 + audit.log.2
        };
        let logger = AuditLogger::open_with_policy(Some(dir.path()), true, policy).unwrap();
        for i in 0..100 {
            logger
                .record(AuditEntry::new("dispatch", AuditStatus::Ok).with_method(format!("m{i}")))
                .await;
        }
        let beyond_cap = backup_path(&logger.path(), 5);
        assert!(!beyond_cap.exists(), "no backup past max_files should exist");
    }

    #[tokio::test]
    async fn concurrent_records_do_not_interleave() {
        let dir = tempdir().unwrap();
        let logger = Arc::new(AuditLogger::open(Some(dir.path()), true).unwrap());

        let mut tasks = Vec::new();
        for i in 0..100 {
            let logger = Arc::clone(&logger);
            tasks.push(tokio::spawn(async move {
                logger
                    .record(
                        AuditEntry::new("dispatch", AuditStatus::Ok)
                            .with_method(format!("eri/test/{i}")),
                    )
                    .await;
            }));
        }
        for t in tasks {
            t.await.unwrap();
        }
        let lines = read_lines(&logger.path());
        assert_eq!(lines.len(), 100);
        for line in lines {
            // Each line must parse as standalone JSON — no interleaving.
            let parsed: Value = serde_json::from_str(&line)
                .unwrap_or_else(|e| panic!("non-JSON line {line:?}: {e}"));
            assert_eq!(parsed["kind"], "dispatch");
        }
    }

    #[test]
    fn audit_params_shape_omits_string_values() {
        let input = json!({
            "token": "super-secret-do-not-log",
            "count": 42,
            "nested": {
                "email": "alice@example.com",
                "tags": ["a", "b", "c", "d", "e"]
            },
            "flag": true,
        });
        let shape = audit_params_shape(&input);
        let s = serde_json::to_string(&shape).unwrap();
        assert!(!s.contains("super-secret-do-not-log"));
        assert!(!s.contains("alice@example.com"));
        // The literal value 42 must not survive either.
        assert!(!s.contains("\"value\":42"));
        // But keys do (they're metadata, not data).
        assert!(s.contains("token"));
        assert!(s.contains("nested"));
        assert!(s.contains("\"len\":5"));
    }

    #[test]
    fn audit_params_shape_truncates_large_objects() {
        let mut map = serde_json::Map::new();
        for i in 0..50 {
            map.insert(format!("key_{i}"), json!(i));
        }
        let shape = audit_params_shape(&Value::Object(map));
        let keys = shape["keys"].as_array().unwrap();
        // 10 real keys + 1 ellipsis marker.
        assert_eq!(keys.len(), MAX_OBJECT_KEYS + 1);
        assert_eq!(keys.last().unwrap(), "...");
        assert_eq!(shape["key_count"], 50);
    }

    #[tokio::test]
    async fn read_recent_returns_tail() {
        let dir = tempdir().unwrap();
        let logger = AuditLogger::open(Some(dir.path()), true).unwrap();
        for i in 0..10 {
            logger
                .record(AuditEntry::new("dispatch", AuditStatus::Ok).with_method(format!("m{i}")))
                .await;
        }
        let recent = logger.read_recent(3).unwrap();
        assert_eq!(recent.len(), 3);
        assert_eq!(recent[0]["method"], "m7");
        assert_eq!(recent[2]["method"], "m9");
    }

    #[tokio::test]
    async fn reopen_appends_without_corruption() {
        let dir = tempdir().unwrap();
        {
            let logger = AuditLogger::open(Some(dir.path()), true).unwrap();
            logger
                .record(AuditEntry::new("dispatch", AuditStatus::Ok).with_method("first"))
                .await;
        }
        {
            // Simulate process restart — open a fresh logger pointing at the
            // same file.
            let logger = AuditLogger::open(Some(dir.path()), true).unwrap();
            logger
                .record(AuditEntry::new("dispatch", AuditStatus::Ok).with_method("second"))
                .await;
            let lines = read_lines(&logger.path());
            assert_eq!(lines.len(), 2);
            let first: Value = serde_json::from_str(&lines[0]).unwrap();
            let second: Value = serde_json::from_str(&lines[1]).unwrap();
            assert_eq!(first["method"], "first");
            assert_eq!(second["method"], "second");
        }
    }

    #[test]
    fn audit_error_kind_buckets_messages() {
        assert_eq!(audit_error_kind("FEATURE_LOCKED: composer"), "feature_locked");
        assert_eq!(audit_error_kind("invalid params"), "bad_params");
        assert_eq!(audit_error_kind("method not implemented"), "not_implemented");
        assert_eq!(audit_error_kind("totally unexpected"), "other");
    }

    #[tokio::test]
    async fn status_report_reflects_state() {
        let dir = tempdir().unwrap();
        let logger = AuditLogger::open(Some(dir.path()), true).unwrap();
        logger
            .record(AuditEntry::new("dispatch", AuditStatus::Ok).with_method("ping"))
            .await;
        let report = logger.status_report();
        assert!(report.enabled);
        assert!(report.size_bytes > 0);
        assert_eq!(report.rotations, 0);
    }
}
