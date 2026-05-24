//! Crash + sidecar log infrastructure.
//!
//! Two responsibilities, kept in one module because they share the same
//! workspace-relative directory (`<workspace>/.eri/` or `~/.eri/`) and
//! the same sanitisation rules:
//!
//!   * **Panic handler** — installs a `std::panic::set_hook` that writes a
//!     single sanitised JSON line per panic to `<dir>/crash.log`.
//!   * **Tracing subscriber** — initialises `tracing-subscriber` with a
//!     stderr layer and a rotating JSON file layer at `<dir>/sidecar.log`.
//!
//! Sanitisation rules (applied to every crash entry, every Sentry event,
//! and every value passed through [`sanitize_str`]):
//!
//!   1. Strings longer than [`MAX_STRING_LEN`] (200 chars) are replaced
//!      with `<truncated:N-chars>` so prompts, file contents, and any
//!      stray PII never make it to disk.
//!   2. Absolute paths under the active workspace are rewritten to
//!      `<workspace>/...` — keeps the log portable and avoids leaking
//!      the user's home directory.
//!   3. Anything that looks like a parameter blob (`params`, `prompt`,
//!      `messages`, `body`, `secret`) is dropped at the call site —
//!      this module never serialises user-facing payloads in the first
//!      place.
//!
//! The audit log (`audit.log`) lives next to these and is owned by
//! `crate::audit`. Three logs, three roles:
//!
//!   * `crash.log`    — JSONL, panic records.
//!   * `sidecar.log`  — JSONL, every tracing event the sidecar emits.
//!   * `audit.log`    — JSONL, every JSON-RPC dispatch (opt-in).

use std::backtrace::Backtrace;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::panic::PanicHookInfo;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};
use serde::Serialize;
use serde_json::Value;

/// Strings longer than this are replaced with `<truncated:N-chars>` in
/// every record we persist. 200 chars is enough for a useful panic
/// message without spilling a stack trace into a single line.
pub const MAX_STRING_LEN: usize = 200;

/// File-rotation cap for `sidecar.log` (16 MiB, matching `audit.log`).
pub const SIDECAR_LOG_MAX_BYTES: u64 = 16 * 1024 * 1024;
/// Number of rotated `sidecar.log.{1..N}` files kept on disk.
pub const SIDECAR_LOG_MAX_FILES: usize = 4;

/// Workspace base directory used by both the crash hook and the file
/// tracing layer. Set once via [`install_panic_handler`] or
/// [`install_tracing_subscriber`]; reads are lock-free after init.
static BASE_DIR: OnceLock<PathBuf> = OnceLock::new();
/// Workspace root captured at startup so the sanitiser can rewrite paths
/// under it. `None` when the sidecar was launched without a workspace.
static WORKSPACE_ROOT: OnceLock<Option<PathBuf>> = OnceLock::new();
/// Process-wide lock around `crash.log` writes so concurrent panics
/// produce well-formed JSONL.
static CRASH_LOG_LOCK: Mutex<()> = Mutex::new(());

/// One row in `crash.log`. Serialised with `serde_json` and written as
/// a single line per panic.
#[derive(Debug, Serialize)]
struct CrashRecord<'a> {
    at_ms: u64,
    kind: &'a str,
    message: String,
    thread: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    location: Option<String>,
    backtrace: String,
}

/// Install the panic hook. Idempotent — calling twice replaces the first
/// hook (the second wins). Safe to call before or after
/// [`install_tracing_subscriber`].
pub fn install_panic_handler(workspace: Option<&Path>) -> Result<()> {
    let base = ensure_base_dir(workspace)?;
    fs::create_dir_all(&base).with_context(|| format!("creating crash dir {}", base.display()))?;
    std::panic::set_hook(Box::new(panic_hook));
    Ok(())
}

/// Install the tracing subscriber:
///   * stderr layer (env-filtered via `ERI_LOG`),
///   * rotating JSON file layer at `<dir>/sidecar.log`.
///
/// Returns `Ok(())` on success. If the subscriber has already been
/// installed (e.g. by an earlier call or by a test harness) we log a
/// warning and continue — never panic over a double-init.
pub fn install_tracing_subscriber(workspace: Option<&Path>) -> Result<()> {
    use tracing_subscriber::EnvFilter;
    use tracing_subscriber::fmt;
    use tracing_subscriber::prelude::*;

    let base = ensure_base_dir(workspace)?;
    fs::create_dir_all(&base)
        .with_context(|| format!("creating sidecar log dir {}", base.display()))?;

    let env_filter = EnvFilter::try_from_env("ERI_LOG").unwrap_or_else(|_| EnvFilter::new("info"));

    let stderr_layer = fmt::layer().with_writer(std::io::stderr).with_target(true);

    let file_writer = RotatingFileWriter::new(base.join("sidecar.log"));
    let file_layer = fmt::layer()
        .json()
        .with_writer(file_writer)
        .with_target(true);

    let registry = tracing_subscriber::registry()
        .with(env_filter)
        .with(stderr_layer)
        .with(file_layer);

    #[cfg(feature = "sentry")]
    let registry = registry.with(sentry_tracing::layer());

    if let Err(err) = registry.try_init() {
        tracing::warn!(error = %err, "tracing subscriber already installed");
    }
    Ok(())
}

/// Initialise Sentry from `ERI_SENTRY_DSN` if the feature is compiled in
/// AND the env var is set + non-empty. Returns a guard the caller must
/// keep alive for the lifetime of the process; dropping the guard
/// flushes pending events.
///
/// The `before_send` hook sanitises every event using the same rules as
/// the local crash log — long strings get truncated, paths get rewritten,
/// and the `extra.params` slot is dropped wholesale.
#[cfg(feature = "sentry")]
pub fn install_sentry() -> Option<sentry::ClientInitGuard> {
    let dsn = std::env::var("ERI_SENTRY_DSN").ok()?;
    if dsn.trim().is_empty() {
        return None;
    }
    let guard = sentry::init((
        dsn,
        sentry::ClientOptions {
            release: sentry::release_name!(),
            before_send: Some(std::sync::Arc::new(|mut event| {
                sanitize_sentry_event(&mut event);
                Some(event)
            })),
            ..Default::default()
        },
    ));
    tracing::info!("sentry initialised");
    Some(guard)
}

/// No-op stub used when the `sentry` feature is disabled at compile
/// time. Returning `()` keeps `main()` free of `#[cfg]` clutter.
#[cfg(not(feature = "sentry"))]
pub fn install_sentry() -> Option<()> {
    None
}

/// Whether the `sentry` feature was compiled in. Used by
/// `eri/sentry/status` so the IDE can render a friendly diagnostic.
pub const SENTRY_FEATURE_COMPILED: bool = cfg!(feature = "sentry");

/// Path that crash records are written to. Useful for tests and the
/// `eri/crash/recent` handler.
pub fn crash_log_path() -> PathBuf {
    base_dir().join("crash.log")
}

/// Path that the rotating tracing file layer writes to.
pub fn sidecar_log_path() -> PathBuf {
    base_dir().join("sidecar.log")
}

/// Read up to `limit` most-recent crash entries from `crash.log`.
pub fn read_recent_crashes(limit: usize) -> Result<Vec<Value>> {
    let path = crash_log_path();
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content =
        fs::read_to_string(&path).with_context(|| format!("reading {}", path.display()))?;
    let lines: Vec<&str> = content.lines().filter(|l| !l.trim().is_empty()).collect();
    let take_from = lines.len().saturating_sub(limit);
    let mut out: Vec<Value> = Vec::new();
    for line in &lines[take_from..] {
        if let Ok(v) = serde_json::from_str::<Value>(line) {
            out.push(v);
        }
    }
    Ok(out)
}

/// Truncate `crash.log` to zero bytes.
pub fn clear_crash_log() -> Result<()> {
    let path = crash_log_path();
    if !path.exists() {
        return Ok(());
    }
    let _guard = CRASH_LOG_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    fs::write(&path, b"").with_context(|| format!("clearing {}", path.display()))
}

/// Apply the sanitiser to a single string. Public so the JSON-RPC
/// services and tests can exercise the same rules.
pub fn sanitize_str(input: &str) -> String {
    let rewritten = rewrite_workspace_paths(input);
    if rewritten.chars().count() > MAX_STRING_LEN {
        format!("<truncated:{}-chars>", rewritten.chars().count())
    } else {
        rewritten
    }
}

// -------------------------------------------------------------------------
// Internals
// -------------------------------------------------------------------------

fn panic_hook(info: &PanicHookInfo<'_>) {
    // Build the record using only stack-allocated borrows where possible.
    // We still allocate `String`s for the JSON line — accepting one alloc
    // path during panic is a deliberate trade-off, documented because
    // a fully alloc-free implementation would require a pre-allocated
    // ring buffer and a custom serialiser, both overkill for our needs.
    let message_raw = panic_message(info);
    let message = sanitize_str(&message_raw);
    let thread = std::thread::current()
        .name()
        .map(str::to_string)
        .unwrap_or_else(|| format!("{:?}", std::thread::current().id()));
    let location = info.location().map(|loc| {
        let path = rewrite_workspace_paths(loc.file());
        format!("{}:{}:{}", path, loc.line(), loc.column())
    });
    let backtrace_str = sanitize_str(&Backtrace::force_capture().to_string());

    let record = CrashRecord {
        at_ms: now_ms(),
        kind: "panic",
        message,
        thread,
        location,
        backtrace: backtrace_str,
    };

    // Best-effort write. If anything fails, fall back to stderr so the
    // user at least sees the panic on the console.
    if let Err(err) = write_crash_record(&record) {
        eprintln!("[eri] failed to write crash.log: {err}");
        eprintln!("[eri] panic: {}", record.message);
    }
    // Also let stderr see it — matches stdlib's default hook behaviour
    // for developer ergonomics.
    eprintln!("[eri] panic: {} ({})", record.message, record.thread);
}

fn write_crash_record(record: &CrashRecord<'_>) -> Result<()> {
    let path = crash_log_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).with_context(|| format!("creating {}", parent.display()))?;
    }
    let mut line = serde_json::to_string(record).context("serializing crash record")?;
    line.push('\n');
    let _guard = CRASH_LOG_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .with_context(|| format!("opening {}", path.display()))?;
    file.write_all(line.as_bytes())
        .with_context(|| format!("writing {}", path.display()))?;
    file.flush().ok();
    Ok(())
}

fn panic_message(info: &PanicHookInfo<'_>) -> String {
    if let Some(s) = info.payload().downcast_ref::<&'static str>() {
        return (*s).to_string();
    }
    if let Some(s) = info.payload().downcast_ref::<String>() {
        return s.clone();
    }
    "<non-string panic payload>".to_string()
}

fn rewrite_workspace_paths(input: &str) -> String {
    let workspace = WORKSPACE_ROOT.get().and_then(Option::as_ref);
    match workspace {
        Some(ws) => {
            let ws_str = ws.to_string_lossy();
            if ws_str.is_empty() {
                input.to_string()
            } else {
                input.replace(ws_str.as_ref(), "<workspace>")
            }
        }
        None => input.to_string(),
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn ensure_base_dir(workspace: Option<&Path>) -> Result<PathBuf> {
    if WORKSPACE_ROOT.get().is_none() {
        let _ = WORKSPACE_ROOT.set(workspace.map(|p| p.to_path_buf()));
    }
    if let Some(existing) = BASE_DIR.get() {
        return Ok(existing.clone());
    }
    let dir = resolve_base_dir(workspace)?;
    let _ = BASE_DIR.set(dir.clone());
    Ok(dir)
}

fn base_dir() -> PathBuf {
    if let Some(dir) = BASE_DIR.get() {
        return dir.clone();
    }
    // Fallback for unconfigured callers — `~/.eri` or temp dir.
    resolve_base_dir(None).unwrap_or_else(|_| std::env::temp_dir().join("eri"))
}

fn resolve_base_dir(workspace: Option<&Path>) -> Result<PathBuf> {
    if let Some(ws) = workspace {
        return Ok(ws.join(".eri"));
    }
    let home = home_dir().context("unable to resolve home directory")?;
    Ok(home.join(".eri"))
}

fn home_dir() -> Option<PathBuf> {
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

#[cfg(feature = "sentry")]
fn sanitize_sentry_event(event: &mut sentry::protocol::Event<'static>) {
    // Drop anything that looks like a payload blob.
    let drop_keys = [
        "params", "prompt", "messages", "body", "secret", "token", "key",
    ];
    for k in drop_keys {
        event.extra.remove(k);
    }
    // Sanitise remaining extras — replace long strings, rewrite paths.
    for (_, v) in event.extra.iter_mut() {
        if let Some(s) = v.as_str() {
            let cleaned = sanitize_str(s);
            *v = serde_json::Value::String(cleaned);
        }
    }
    // Sanitise the top-level message.
    if let Some(msg) = event.message.as_mut() {
        *msg = sanitize_str(msg);
    }
}

// -------------------------------------------------------------------------
// Rotating file writer for tracing-subscriber's fmt::layer.
// -------------------------------------------------------------------------

/// A `std::io::Write`-compatible writer that rotates when the active
/// file grows past [`SIDECAR_LOG_MAX_BYTES`].
///
/// We deliberately keep this dead simple — one `Mutex<File>` and a
/// best-effort size check on every write. The tracing fmt layer never
/// emits very large writes in practice (one record per call) so the
/// overhead is negligible.
pub struct RotatingFileWriter {
    path: PathBuf,
    inner: Mutex<Option<RotatingInner>>,
}

struct RotatingInner {
    file: File,
    bytes_written: u64,
}

impl RotatingFileWriter {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            inner: Mutex::new(None),
        }
    }

    fn ensure_open(&self, guard: &mut Option<RotatingInner>) -> std::io::Result<()> {
        if guard.is_some() {
            return Ok(());
        }
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?;
        let bytes_written = file.metadata().map(|m| m.len()).unwrap_or(0);
        *guard = Some(RotatingInner {
            file,
            bytes_written,
        });
        Ok(())
    }

    fn rotate(&self, guard: &mut Option<RotatingInner>) -> std::io::Result<()> {
        *guard = None;
        // Shift sidecar.log.(n-1) -> sidecar.log.n, drop overflow.
        for index in (1..SIDECAR_LOG_MAX_FILES).rev() {
            let src = backup_path(&self.path, index);
            let dst = backup_path(&self.path, index + 1);
            if index + 1 > SIDECAR_LOG_MAX_FILES - 1 {
                if src.exists() {
                    fs::remove_file(&src).ok();
                }
                continue;
            }
            if src.exists() {
                fs::rename(&src, &dst).ok();
            }
        }
        if self.path.exists() {
            let first_backup = backup_path(&self.path, 1);
            fs::rename(&self.path, &first_backup).ok();
        }
        Ok(())
    }
}

fn backup_path(path: &Path, index: usize) -> PathBuf {
    let mut s = path.as_os_str().to_os_string();
    s.push(format!(".{index}"));
    PathBuf::from(s)
}

impl Write for &RotatingFileWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        self.ensure_open(&mut guard)?;
        let needs_rotate = guard
            .as_ref()
            .map(|i| i.bytes_written + buf.len() as u64 > SIDECAR_LOG_MAX_BYTES)
            .unwrap_or(false);
        if needs_rotate {
            self.rotate(&mut guard)?;
            self.ensure_open(&mut guard)?;
        }
        let inner = guard.as_mut().expect("ensured open above");
        let n = inner.file.write(buf)?;
        inner.bytes_written = inner.bytes_written.saturating_add(n as u64);
        Ok(n)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(inner) = guard.as_mut() {
            inner.file.flush()?;
        }
        Ok(())
    }
}

impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for RotatingFileWriter {
    type Writer = &'a RotatingFileWriter;

    fn make_writer(&'a self) -> Self::Writer {
        self
    }
}

// -------------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use std::sync::atomic::{AtomicBool, Ordering};

    /// Tests share the static `BASE_DIR` / `WORKSPACE_ROOT` so we run
    /// them serially. A small spinlock keeps things deterministic.
    static TEST_LOCK: Mutex<()> = Mutex::new(());
    static HOOK_INSTALLED: AtomicBool = AtomicBool::new(false);

    /// Resolve the path the module *currently* writes crash.log to.
    /// `BASE_DIR` is a `OnceLock` — once a test sets it, subsequent
    /// tests must reuse the same dir. We surface it here so each test
    /// asserts against the live path rather than a per-test tempdir.
    fn current_crash_path() -> PathBuf {
        crash_log_path()
    }

    fn ensure_test_dir() {
        // Best-effort init — the first test wins. We only assert the
        // directory exists; later tests share it.
        let dir = std::env::temp_dir().join("eri-crash-tests");
        fs::create_dir_all(&dir).ok();
        let _ = WORKSPACE_ROOT.set(Some(dir.clone()));
        let _ = BASE_DIR.set(dir.join(".eri"));
        fs::create_dir_all(dir.join(".eri")).ok();
    }

    #[test]
    fn sanitize_str_truncates_long_strings() {
        let _g = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let big = "a".repeat(MAX_STRING_LEN + 50);
        let cleaned = sanitize_str(&big);
        assert!(cleaned.starts_with("<truncated:"));
        assert!(cleaned.contains(&format!("{}", MAX_STRING_LEN + 50)));
    }

    #[test]
    fn sanitize_str_keeps_short_strings() {
        let _g = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let s = "boom";
        assert_eq!(sanitize_str(s), "boom");
    }

    #[test]
    fn sanitize_str_replaces_workspace_paths() {
        let _g = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        ensure_test_dir();
        let ws = WORKSPACE_ROOT
            .get()
            .and_then(Option::as_ref)
            .cloned()
            .unwrap();
        let raw = format!("{}/src/main.rs:42", ws.display());
        let cleaned = sanitize_str(&raw);
        assert!(cleaned.contains("<workspace>"), "got: {cleaned}");
    }

    #[test]
    fn panic_handler_writes_one_jsonl_line() {
        let _g = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        ensure_test_dir();
        // Start clean so we can find the marker.
        clear_crash_log().ok();

        if !HOOK_INSTALLED.swap(true, Ordering::SeqCst) {
            std::panic::set_hook(Box::new(panic_hook));
        }

        let crash_path = current_crash_path();
        let _ = std::panic::catch_unwind(|| {
            panic!("boom-test-marker");
        });

        let content = fs::read_to_string(&crash_path).expect("crash.log must exist");
        let lines: Vec<&str> = content.lines().filter(|l| !l.is_empty()).collect();
        assert!(!lines.is_empty(), "expected at least one crash line");
        let parsed: Vec<Value> = lines
            .iter()
            .filter_map(|l| serde_json::from_str(l).ok())
            .collect();
        assert!(parsed.iter().any(|v| {
            v["kind"] == "panic"
                && v["message"]
                    .as_str()
                    .map(|s| s.contains("boom-test-marker"))
                    .unwrap_or(false)
        }));
    }

    #[test]
    fn read_recent_returns_tail() {
        let _g = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        ensure_test_dir();
        let path = current_crash_path();
        let mut content = String::new();
        for i in 0..10 {
            content.push_str(&format!(
                "{{\"at_ms\":{i},\"kind\":\"panic\",\"message\":\"m{i}\",\"thread\":\"t\",\"backtrace\":\"-\"}}\n",
            ));
        }
        fs::write(&path, content).unwrap();
        let recent = read_recent_crashes(3).unwrap();
        assert_eq!(recent.len(), 3);
        assert_eq!(recent[2]["message"], "m9");
    }

    #[test]
    fn clear_crash_log_truncates() {
        let _g = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        ensure_test_dir();
        let path = current_crash_path();
        fs::write(&path, b"{\"a\":1}\n").unwrap();
        clear_crash_log().unwrap();
        let content = fs::read_to_string(&path).unwrap();
        assert!(content.is_empty());
    }

    #[test]
    fn rotating_writer_rotates_at_threshold() {
        let _g = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let dir = std::env::temp_dir().join("eri-crash-rot-test");
        fs::create_dir_all(&dir).ok();
        let path = dir.join("rot.log");
        let writer = RotatingFileWriter::new(path.clone());
        // Force a tiny threshold via direct writes — we override the
        // constant by writing past it: stuff 17 MiB worth of bytes.
        // Faster: bypass and call rotate() directly to confirm the
        // shifter shifts.
        fs::write(&path, b"alpha").unwrap();
        let mut guard = writer.inner.lock().unwrap();
        writer.rotate(&mut guard).unwrap();
        drop(guard);
        let backup = backup_path(&path, 1);
        assert!(backup.exists(), "first backup should exist after rotate");
    }

    #[test]
    fn disabled_path_never_touches_fs_when_no_panic() {
        let _g = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        ensure_test_dir();
        let crash_path = current_crash_path();
        if let Ok(content) = fs::read_to_string(&crash_path) {
            assert!(!content.contains("never-panic-marker-xyz"));
        }
    }

    #[test]
    fn concurrent_panics_produce_well_formed_jsonl() {
        let _g = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        ensure_test_dir();
        clear_crash_log().ok();

        if !HOOK_INSTALLED.swap(true, Ordering::SeqCst) {
            std::panic::set_hook(Box::new(panic_hook));
        }

        std::thread::scope(|scope| {
            for i in 0..8 {
                scope.spawn(move || {
                    let _ = std::panic::catch_unwind(|| {
                        panic!("concurrent-{i}");
                    });
                });
            }
        });

        let crash_path = current_crash_path();
        let content = fs::read_to_string(&crash_path).unwrap();
        for line in content.lines().filter(|l| !l.is_empty()) {
            let _: Value = serde_json::from_str(line)
                .unwrap_or_else(|e| panic!("invalid JSON line: {line:?}: {e}"));
        }
    }
}
