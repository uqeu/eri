//! JSON-RPC handlers for the Swift preview window sidecar.
//!
//!   * `eri/preview/open`   → spawn the Swift preview binary, optionally with a URL
//!   * `eri/preview/close`  → kill the running preview process
//!   * `eri/preview/reload` → ask the preview to reload its current URL
//!   * `eri/preview/load`   → tell the preview to load a new URL
//!   * `eri/preview/gaze`   → forward a gaze relative-coord to the preview
//!   * `eri/preview/status` → `{ running, pid?, lastUrl? }`
//!
//! All free-tier — the preview window is a workspace primitive, not a paid
//! feature. The Swift binary listens on a UNIX socket at `~/.eri/preview.sock`
//! and accepts newline-delimited JSON messages: `{type, ...}`. This module
//! manages the lifetime of the child process and a single shared socket
//! client used to push commands to it.
//!
//! Resolution of the binary path:
//!   1. `ERI_PREVIEW_BIN`             (override; useful in dev)
//!   2. `$ERI_RESOURCES/bin/eri_preview` (bundled into eri.app)
//!   3. repo-relative `scripts/eri_preview` (dev checkout)

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::io::AsyncWriteExt;
use tokio::net::UnixStream;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio::time::sleep;

use crate::DispatchError;
use crate::services::Services;

/// Default socket path the Swift binary listens on. Mirrors the path the
/// Swift app derives via `NSHomeDirectory() + "/.eri/preview.sock"`.
fn default_socket_path() -> PathBuf {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    home.join(".eri").join("preview.sock")
}

/// Process-wide state for the preview window. `child` is the spawned Swift
/// binary; `last_url` is the most recent URL passed to `open` or `load`.
#[derive(Default)]
pub struct PreviewState {
    pub child: Option<Child>,
    pub last_url: Option<String>,
}

pub type SharedPreviewState = Arc<Mutex<PreviewState>>;

/// Open params: `{ "url"?: string, "binaryPath"?: string }`.
#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct OpenParams {
    url: Option<String>,
    binary_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoadParams {
    url: String,
}

#[derive(Debug, Deserialize)]
struct GazeParams {
    x: f64,
    y: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusReport {
    running: bool,
    pid: Option<u32>,
    last_url: Option<String>,
}

pub async fn open(params: Value, services: &Services) -> Result<Value, DispatchError> {
    let parsed: OpenParams =
        serde_json::from_value(params).map_err(|e| DispatchError::BadParams(e.to_string()))?;
    let binary = resolve_binary(parsed.binary_path.as_deref())
        .ok_or_else(|| DispatchError::Other(anyhow::anyhow!("eri_preview binary not found")))?;

    let mut guard = services.preview.lock().await;
    // If a previous process exited on its own, drop it so the next branch
    // sees a clean `None`.
    if let Some(child) = guard.child.as_mut() {
        if let Ok(Some(_)) = child.try_wait() {
            guard.child = None;
        }
    }

    if guard.child.is_none() {
        let mut cmd = Command::new(&binary);
        if let Some(url) = parsed.url.as_deref() {
            cmd.arg(url);
        }
        cmd.stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let child = cmd
            .spawn()
            .map_err(|e| DispatchError::Other(anyhow::anyhow!("spawn eri_preview: {e}")))?;
        guard.child = Some(child);
        guard.last_url = parsed.url.clone();

        // The Swift binary needs a moment to bind its socket before the
        // sidecar tries to push commands. We retry briefly so the first
        // `load`/`gaze` after `open` lands instead of racing.
        let socket = default_socket_path();
        drop(guard);
        wait_for_socket(&socket, Duration::from_millis(750)).await;
    } else if let Some(url) = parsed.url.as_deref() {
        guard.last_url = Some(url.to_string());
        drop(guard);
        send_message(&json!({ "type": "load", "url": url })).await.ok();
    }

    let guard = services.preview.lock().await;
    Ok(json!({
        "running": guard.child.is_some(),
        "pid": guard.child.as_ref().and_then(|c| c.id()),
        "binary": binary.to_string_lossy(),
    }))
}

pub async fn close(_params: Value, services: &Services) -> Result<Value, DispatchError> {
    let mut guard = services.preview.lock().await;
    if let Some(mut child) = guard.child.take() {
        // Best-effort SIGTERM via kill(). Errors here just mean the process
        // already exited — drop silently.
        let _ = child.start_kill();
        let _ = child.wait().await;
    }
    guard.last_url = None;
    Ok(json!({ "ok": true }))
}

pub async fn reload(_params: Value, _services: &Services) -> Result<Value, DispatchError> {
    send_message(&json!({ "type": "reload" }))
        .await
        .map_err(DispatchError::Other)?;
    Ok(json!({ "ok": true }))
}

pub async fn load(params: Value, services: &Services) -> Result<Value, DispatchError> {
    let parsed: LoadParams =
        serde_json::from_value(params).map_err(|e| DispatchError::BadParams(e.to_string()))?;
    {
        let mut guard = services.preview.lock().await;
        guard.last_url = Some(parsed.url.clone());
    }
    send_message(&json!({ "type": "load", "url": parsed.url }))
        .await
        .map_err(DispatchError::Other)?;
    Ok(json!({ "ok": true }))
}

pub async fn gaze(params: Value, _services: &Services) -> Result<Value, DispatchError> {
    let parsed: GazeParams =
        serde_json::from_value(params).map_err(|e| DispatchError::BadParams(e.to_string()))?;
    // Silently drop if the preview isn't connected — gaze fires at high
    // frequency and we don't want noisy errors on the hot path.
    let _ = send_message(&json!({
        "type": "gaze",
        "x": parsed.x,
        "y": parsed.y,
    }))
    .await;
    Ok(json!({ "ok": true }))
}

/// `eri/preview/zoom` — relay a voice "zoom in/out" intent to the Swift
/// preview window. The Swift side decides the actual step size; we only
/// forward direction + magnitude. Silently no-ops when the preview isn't
/// connected so the voice path never throws on a missed message.
pub async fn zoom(params: Value, _services: &Services) -> Result<Value, DispatchError> {
    let parsed: ZoomParams =
        serde_json::from_value(params).map_err(|e| DispatchError::BadParams(e.to_string()))?;
    let _ = send_message(&json!({
        "type": "zoom",
        "direction": parsed.direction,
        "magnitude": parsed.magnitude,
    }))
    .await;
    Ok(json!({ "ok": true }))
}

/// `eri/preview/scroll` — relay a voice "scroll up/down/left/right" intent
/// to the Swift preview window. Same shape + best-effort semantics as
/// `zoom` above.
pub async fn scroll(params: Value, _services: &Services) -> Result<Value, DispatchError> {
    let parsed: ScrollParams =
        serde_json::from_value(params).map_err(|e| DispatchError::BadParams(e.to_string()))?;
    let _ = send_message(&json!({
        "type": "scroll",
        "direction": parsed.direction,
        "magnitude": parsed.magnitude,
    }))
    .await;
    Ok(json!({ "ok": true }))
}

#[derive(Debug, Deserialize)]
struct ZoomParams {
    /// `"in"` or `"out"`.
    direction: String,
    /// `"small"` (one step) or `"big"` (multiple steps).
    magnitude: String,
}

#[derive(Debug, Deserialize)]
struct ScrollParams {
    /// `"up"` / `"down"` / `"left"` / `"right"`.
    direction: String,
    /// `"small"` (≈1/5 viewport) or `"big"` (≈1 viewport).
    magnitude: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoadHtmlParams {
    /// Raw HTML to render. Written to a temp file then loaded via the
    /// existing `load` path so the Swift binary doesn't need a new message
    /// type.
    content: String,
    /// Optional file stem so the temp file has a recognizable name
    /// (e.g. `"sketch-blue-button"`). Defaults to `"sketch"`.
    #[serde(default)]
    name: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiscoverReport {
    detected_url: Option<String>,
    scanned_ports: Vec<u16>,
}

/// `eri/preview/loadHtml` — render an HTML string into a temp file and
/// load it into the preview window. Used by `/sketch` to surface Mercury-
/// generated mockups without a roundtrip through the user's filesystem.
pub async fn load_html(params: Value, services: &Services) -> Result<Value, DispatchError> {
    let parsed: LoadHtmlParams =
        serde_json::from_value(params).map_err(|e| DispatchError::BadParams(e.to_string()))?;
    if parsed.content.trim().is_empty() {
        return Err(DispatchError::BadParams("empty_html".into()));
    }
    let stem = parsed.name.unwrap_or_else(|| "sketch".to_string());
    // Persistent path under ~/.eri/sketches/ so the user can revisit and
    // gaze events keep working between reloads.
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    let dir = home.join(".eri").join("sketches");
    std::fs::create_dir_all(&dir).map_err(|e| DispatchError::Other(anyhow::anyhow!(e)))?;
    let filename = format!("{}-{}.html", sanitize_stem(&stem), now_seconds());
    let path = dir.join(filename);
    std::fs::write(&path, parsed.content.as_bytes())
        .map_err(|e| DispatchError::Other(anyhow::anyhow!(e)))?;
    let url = format!("file://{}", path.to_string_lossy());

    {
        let mut guard = services.preview.lock().await;
        guard.last_url = Some(url.clone());
    }
    send_message(&json!({ "type": "load", "url": url }))
        .await
        .map_err(DispatchError::Other)?;
    Ok(json!({ "ok": true, "path": path.to_string_lossy(), "url": url }))
}

/// `eri/preview/discover` — scan common dev-server ports on localhost,
/// returning the first 200-ish responder. Cheap, used on workspace open
/// so the IDE can auto-open the preview when a dev server is already up.
pub async fn discover(_params: Value, _services: &Services) -> Result<Value, DispatchError> {
    const PORTS: &[u16] = &[3000, 3001, 4173, 5173, 5500, 8000, 8080];
    let mut detected: Option<String> = None;
    for &port in PORTS {
        if port_responds(port).await {
            detected = Some(format!("http://localhost:{port}"));
            break;
        }
    }
    let report = DiscoverReport {
        detected_url: detected,
        scanned_ports: PORTS.to_vec(),
    };
    serde_json::to_value(report).map_err(|e| DispatchError::Other(e.into()))
}

async fn port_responds(port: u16) -> bool {
    use tokio::net::TcpStream;
    use tokio::time::timeout;
    timeout(
        Duration::from_millis(150),
        TcpStream::connect(("127.0.0.1", port)),
    )
    .await
    .map(|r| r.is_ok())
    .unwrap_or(false)
}

fn sanitize_stem(stem: &str) -> String {
    stem.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .take(40)
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

fn now_seconds() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub async fn status(_params: Value, services: &Services) -> Result<Value, DispatchError> {
    let mut guard = services.preview.lock().await;
    // Drop dead children so `running` reflects reality.
    if let Some(child) = guard.child.as_mut() {
        if let Ok(Some(_)) = child.try_wait() {
            guard.child = None;
        }
    }
    let report = StatusReport {
        running: guard.child.is_some(),
        pid: guard.child.as_ref().and_then(|c| c.id()),
        last_url: guard.last_url.clone(),
    };
    serde_json::to_value(report).map_err(|e| DispatchError::Other(e.into()))
}

/// Resolve the preview binary path. Honors the explicit override first,
/// then `$ERI_PREVIEW_BIN`, then a bundled location relative to
/// `$ERI_RESOURCES`, then a repo-relative dev path.
fn resolve_binary(explicit: Option<&str>) -> Option<PathBuf> {
    if let Some(path) = explicit {
        if !path.is_empty() {
            let p = PathBuf::from(path);
            if p.exists() {
                return Some(p);
            }
        }
    }
    if let Ok(env) = std::env::var("ERI_PREVIEW_BIN") {
        let p = PathBuf::from(env);
        if p.exists() {
            return Some(p);
        }
    }
    if let Ok(resources) = std::env::var("ERI_RESOURCES") {
        let p = PathBuf::from(resources).join("bin").join("eri_preview");
        if p.exists() {
            return Some(p);
        }
    }
    // Dev checkout fallback: walk up from CARGO_MANIFEST_DIR.
    let dev = repo_dev_path();
    if dev.exists() {
        return Some(dev);
    }
    None
}

fn repo_dev_path() -> PathBuf {
    // crates/eri_coreutils → ../../scripts/eri_preview
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../scripts/eri_preview")
}

/// Open a fresh UNIX connection, write a single JSON message, close.
/// Each call is cheap (sub-millisecond locally) and avoids long-lived
/// connection state we'd otherwise have to recover after restarts.
async fn send_message(payload: &Value) -> anyhow::Result<()> {
    send_message_to(&default_socket_path(), payload).await
}

async fn send_message_to(socket: &Path, payload: &Value) -> anyhow::Result<()> {
    let mut stream = UnixStream::connect(socket)
        .await
        .map_err(|e| anyhow::anyhow!("connect {}: {e}", socket.display()))?;
    let mut bytes = serde_json::to_vec(payload)?;
    bytes.push(b'\n');
    stream.write_all(&bytes).await?;
    stream.flush().await?;
    Ok(())
}

async fn wait_for_socket(socket: &Path, total: Duration) {
    let step = Duration::from_millis(25);
    let mut waited = Duration::ZERO;
    while waited < total {
        if UnixStream::connect(socket).await.is_ok() {
            return;
        }
        sleep(step).await;
        waited += step;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use tempfile::TempDir;
    use tokio::io::AsyncReadExt;
    use tokio::net::UnixListener;

    fn tmp_socket(dir: &TempDir) -> PathBuf {
        dir.path().join("preview.sock")
    }

    #[tokio::test]
    async fn send_message_to_socket_writes_framed_json() {
        let tmp = TempDir::new().unwrap();
        let socket_path = tmp_socket(&tmp);
        let listener = UnixListener::bind(&socket_path).unwrap();

        let server = tokio::spawn(async move {
            let (mut conn, _) = listener.accept().await.unwrap();
            let mut buf = Vec::new();
            // Read until EOF so we capture the full line.
            let _ = conn.read_to_end(&mut buf).await;
            buf
        });

        send_message_to(&socket_path, &json!({"type": "reload"}))
            .await
            .unwrap();
        let buf = server.await.unwrap();
        let line = String::from_utf8(buf).unwrap();
        assert!(line.ends_with('\n'));
        let parsed: Value = serde_json::from_str(line.trim_end()).unwrap();
        assert_eq!(parsed["type"], "reload");
    }

    #[tokio::test]
    async fn gaze_payload_round_trips_floats() {
        let tmp = TempDir::new().unwrap();
        let socket_path = tmp_socket(&tmp);
        let listener = UnixListener::bind(&socket_path).unwrap();

        let server = tokio::spawn(async move {
            let (mut conn, _) = listener.accept().await.unwrap();
            let mut buf = Vec::new();
            let _ = conn.read_to_end(&mut buf).await;
            buf
        });

        send_message_to(
            &socket_path,
            &json!({"type": "gaze", "x": 0.42, "y": 0.5}),
        )
        .await
        .unwrap();
        let buf = server.await.unwrap();
        let line = String::from_utf8(buf).unwrap();
        let parsed: Value = serde_json::from_str(line.trim_end()).unwrap();
        assert_eq!(parsed["type"], "gaze");
        assert!((parsed["x"].as_f64().unwrap() - 0.42).abs() < 1e-9);
        assert!((parsed["y"].as_f64().unwrap() - 0.5).abs() < 1e-9);
    }

    #[tokio::test]
    async fn status_reports_no_child_when_not_opened() {
        let services = Services::new();
        let result = status(json!({}), &services).await.unwrap();
        assert_eq!(result["running"], json!(false));
        assert!(result["pid"].is_null());
    }

    #[tokio::test]
    async fn resolve_binary_honors_explicit_override() {
        let tmp = TempDir::new().unwrap();
        let bin = tmp.path().join("eri_preview");
        std::fs::write(&bin, b"#!/bin/sh\nexit 0\n").unwrap();
        let resolved = resolve_binary(Some(bin.to_str().unwrap()));
        assert_eq!(resolved.as_deref(), Some(bin.as_path()));
    }
}
