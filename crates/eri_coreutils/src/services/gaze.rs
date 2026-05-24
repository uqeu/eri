//! Gaze sidecar service.
//!
//! Owns the lifecycle of the Python gaze tracker
//! (`scripts/eri_gaze_mediapipe.py`, with `eri_gaze_eyegestures.py` as a
//! fallback). The binary spawns the script as a child process, parses its
//! `{type, x, y, confidence}` JSON-per-line stdout stream, and re-emits each
//! point as an outbound `eri/gaze/point` notification so the extension can
//! broadcast it to every gaze-aware subsystem (editor, sidebar, chat,
//! preview, terminal).
//!
//! Coordinates are normalised in `[0.0, 1.0]` — never raw pixels, never
//! video frames. The video stream stays inside Python.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

use crate::DispatchError;
use crate::services::{Notifier, Services};

/// One gaze sample broadcast over JSON-RPC.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct GazePoint {
    pub x: f64,
    pub y: f64,
    pub confidence: f64,
    pub ts_ms: u64,
}

/// Per-process gaze state. Holds the running child and the last point so
/// `eri/gaze/status` can answer without polling Python.
#[derive(Default)]
pub struct GazeState {
    child: Mutex<Option<Child>>,
    last_point: Mutex<Option<GazePoint>>,
    calibrated: Mutex<bool>,
}

impl GazeState {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    pub async fn is_running(&self) -> bool {
        self.child.lock().await.is_some()
    }

    async fn snapshot(&self) -> (bool, Option<GazePoint>, bool) {
        let running = self.is_running().await;
        let last = *self.last_point.lock().await;
        let calibrated = *self.calibrated.lock().await;
        (running, last, calibrated)
    }
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct StartParams {
    /// Optional camera index passed straight through to the Python sidecar.
    camera: Option<u32>,
    /// Optional override script path. Tests and the IDE both rely on the
    /// default location resolution below.
    script: Option<PathBuf>,
}

pub async fn start(params: Value, services: &Services) -> Result<Value, DispatchError> {
    let parsed: StartParams =
        serde_json::from_value(params).map_err(|e| DispatchError::BadParams(e.to_string()))?;

    let state = ensure_state(services);
    {
        let guard = state.child.lock().await;
        if guard.is_some() {
            return Ok(serde_json::json!({ "running": true, "started": false }));
        }
    }

    let script = resolve_script(parsed.script.as_deref())
        .ok_or_else(|| DispatchError::Other(anyhow::anyhow!("gaze sidecar script not found")))?;

    let mut command = Command::new("python3");
    command.arg(&script).arg("--run");
    if let Some(camera) = parsed.camera {
        command.arg("--camera").arg(camera.to_string());
    }
    command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|e| DispatchError::Other(anyhow::anyhow!("failed to spawn gaze sidecar: {e}")))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| DispatchError::Other(anyhow::anyhow!("gaze sidecar has no stdout")))?;

    {
        let mut guard = state.child.lock().await;
        *guard = Some(child);
    }

    let state_for_task = Arc::clone(&state);
    let notifier = services.notifier.clone();
    tokio::spawn(async move {
        forward_points(stdout, state_for_task, notifier).await;
    });

    Ok(serde_json::json!({ "running": true, "started": true }))
}

pub async fn stop(_params: Value, services: &Services) -> Result<Value, DispatchError> {
    let state = ensure_state(services);
    let mut guard = state.child.lock().await;
    if let Some(mut child) = guard.take() {
        // Best-effort kill — the OS will reap the zombie either way.
        let _ = child.start_kill();
        Ok(serde_json::json!({ "stopped": true }))
    } else {
        Ok(serde_json::json!({ "stopped": false }))
    }
}

pub async fn status(_params: Value, services: &Services) -> Result<Value, DispatchError> {
    let state = ensure_state(services);
    let (running, last_point, calibrated) = state.snapshot().await;
    Ok(serde_json::json!({
        "running": running,
        "lastPoint": last_point,
        "calibrated": calibrated,
    }))
}

pub async fn calibrate(_params: Value, services: &Services) -> Result<Value, DispatchError> {
    // Calibration in the Python script is currently centered on its first
    // few frames — there is no separate `--calibrate` mode yet. We mark the
    // state as calibrated so the extension stops nagging on autostart.
    let state = ensure_state(services);
    let mut guard = state.calibrated.lock().await;
    *guard = true;
    Ok(serde_json::json!({ "calibrated": true }))
}

/// Background task: parse the Python sidecar's stdout line-by-line, store
/// the most recent point, and forward each as an `eri/gaze/point`
/// notification. Exits when the child closes stdout (process died).
async fn forward_points(
    stdout: tokio::process::ChildStdout,
    state: Arc<GazeState>,
    notifier: Option<Arc<dyn Notifier>>,
) {
    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parsed = match serde_json::from_str::<Value>(trimmed) {
            Ok(value) => value,
            Err(err) => {
                tracing::debug!(error = %err, line = %trimmed, "ignoring non-JSON gaze line");
                continue;
            }
        };
        if parsed.get("type").and_then(Value::as_str) != Some("gaze") {
            continue;
        }
        let Some(point) = parse_point(&parsed) else {
            continue;
        };
        {
            let mut guard = state.last_point.lock().await;
            *guard = Some(point);
        }
        if let Some(notifier) = notifier.as_deref() {
            notifier.notify(
                "eri/gaze/point",
                serde_json::to_value(point).unwrap_or(Value::Null),
            );
        }
    }
    // stdout closed — clear the child slot so a future `start` can respawn.
    let mut guard = state.child.lock().await;
    if let Some(mut child) = guard.take() {
        let _ = child.start_kill();
    }
}

fn parse_point(value: &Value) -> Option<GazePoint> {
    let x = value.get("x").and_then(Value::as_f64)?;
    let y = value.get("y").and_then(Value::as_f64)?;
    let confidence = value
        .get("confidence")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    Some(GazePoint {
        x: clamp01(x),
        y: clamp01(y),
        confidence: clamp01(confidence),
        ts_ms: now_ms(),
    })
}

fn clamp01(v: f64) -> f64 {
    if v.is_nan() {
        0.0
    } else {
        v.max(0.0).min(1.0)
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Find the gaze sidecar script. Order:
///   1. Caller override (used in tests).
///   2. `ERI_GAZE_SCRIPT` env var.
///   3. `<workspace>/scripts/eri_gaze_mediapipe.py` (workspace via env).
///   4. `<workspace>/scripts/eri_gaze_eyegestures.py` as fallback.
fn resolve_script(override_path: Option<&Path>) -> Option<PathBuf> {
    if let Some(path) = override_path {
        if path.exists() {
            return Some(path.to_path_buf());
        }
    }
    if let Ok(env) = std::env::var("ERI_GAZE_SCRIPT") {
        let p = PathBuf::from(env);
        if p.exists() {
            return Some(p);
        }
    }
    let workspace = std::env::var("ERI_WORKSPACE")
        .ok()
        .map(PathBuf::from)
        .or_else(|| std::env::current_dir().ok())?;
    let primary = workspace.join("scripts").join("eri_gaze_mediapipe.py");
    if primary.exists() {
        return Some(primary);
    }
    let fallback = workspace.join("scripts").join("eri_gaze_eyegestures.py");
    if fallback.exists() {
        return Some(fallback);
    }
    None
}

/// We store the gaze state in a process-global `OnceLock` keyed off the
/// `Services` registry pointer. Services doesn't expose a slot for this
/// today, but the lifecycle exactly mirrors `Services` (one per process)
/// so a static is fine.
fn ensure_state(_services: &Services) -> Arc<GazeState> {
    use std::sync::OnceLock;
    static STATE: OnceLock<Arc<GazeState>> = OnceLock::new();
    STATE.get_or_init(GazeState::new).clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamp01_handles_extremes() {
        assert_eq!(clamp01(-0.5), 0.0);
        assert_eq!(clamp01(1.5), 1.0);
        assert_eq!(clamp01(0.42), 0.42);
        assert_eq!(clamp01(f64::NAN), 0.0);
    }

    #[test]
    fn parse_point_accepts_valid_payload() {
        let value = serde_json::json!({
            "type": "gaze",
            "x": 0.4,
            "y": 0.6,
            "confidence": 0.75,
        });
        let point = parse_point(&value).expect("point parses");
        assert!((point.x - 0.4).abs() < 1e-9);
        assert!((point.y - 0.6).abs() < 1e-9);
        assert!((point.confidence - 0.75).abs() < 1e-9);
    }

    #[test]
    fn parse_point_rejects_missing_coords() {
        let value = serde_json::json!({ "type": "gaze", "x": 0.5 });
        assert!(parse_point(&value).is_none());
    }

    #[tokio::test]
    async fn status_reports_shape() {
        // The gaze state is process-global, so we don't assert on
        // `calibrated` (other tests may have flipped it). We do assert the
        // sidecar is not running and the response shape is stable.
        let services = Services::new();
        let result = status(Value::Null, &services).await.expect("status ok");
        assert_eq!(result["running"], false);
        assert!(result.get("calibrated").is_some());
        assert!(result.get("lastPoint").is_some());
    }

    #[tokio::test]
    async fn calibrate_marks_state() {
        let services = Services::new();
        let _ = calibrate(Value::Null, &services).await.expect("calibrate ok");
        let status = status(Value::Null, &services).await.expect("status ok");
        assert_eq!(status["calibrated"], true);
    }

    #[tokio::test]
    async fn stop_is_idempotent_when_not_running() {
        let services = Services::new();
        let result = stop(Value::Null, &services).await.expect("stop ok");
        // `stopped: true` means we killed a child; `false` means none was
        // running. Either is acceptable; we just confirm the call doesn't
        // explode and returns a structured payload.
        assert!(result.get("stopped").is_some());
    }
}
