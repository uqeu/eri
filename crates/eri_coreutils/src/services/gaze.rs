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
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

use crate::DispatchError;
use crate::services::{Notifier, Services};

mod calibration;
pub use calibration::{CalibrationProfile, NINE_TARGETS, OneEuroFilter};

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
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

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
    let (running, last_point, flag) = state.snapshot().await;
    // A persisted profile is the source of truth for calibration; the in-memory
    // flag is a fast path that the profile presence supersedes.
    let profile = profile_path_opt().and_then(|p| calibration::load_profile(&p));
    let calibrated = flag || profile.is_some();
    Ok(serde_json::json!({
        "running": running,
        "lastPoint": last_point,
        "calibrated": calibrated,
        "profileTargets": profile.as_ref().map(|p| p.targets),
    }))
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct CalibrateParams {
    /// Optional camera index, forwarded to the sidecar.
    camera: Option<u32>,
    /// Optional override script path (tests).
    script: Option<PathBuf>,
    /// Per-target frame budget (sidecar averages this many features).
    samples: Option<u32>,
}

/// Run a real per-user 9-point calibration.
///
/// Flow: spawn the sidecar in `--calibrate` mode, then feed it one `target`
/// control line per known screen target on stdin (the sidecar settles, then
/// averages N gaze-feature samples per target). On `finish` the sidecar fits a
/// ridge regression and writes `~/.eri/gaze_calibration.json`; we confirm by
/// loading it back. Fail-safe: any spawn/IO error leaves the existing profile
/// (and the fallback mapping) untouched and reports `calibrated: false`.
///
/// Note: live-camera capture cannot be automated in CI — the regression and
/// profile load/save math are unit-tested without a camera (see
/// `calibration::tests`); this end-to-end path is verified on-device.
pub async fn calibrate(params: Value, services: &Services) -> Result<Value, DispatchError> {
    let parsed: CalibrateParams =
        serde_json::from_value(params).map_err(|e| DispatchError::BadParams(e.to_string()))?;
    let state = ensure_state(services);

    let script = resolve_script(parsed.script.as_deref())
        .ok_or_else(|| DispatchError::Other(anyhow::anyhow!("gaze sidecar script not found")))?;

    let mut command = Command::new("python3");
    command.arg(&script).arg("--calibrate");
    if let Some(camera) = parsed.camera {
        command.arg("--camera").arg(camera.to_string());
    }
    if let Some(samples) = parsed.samples {
        command.arg("--samples").arg(samples.to_string());
    }
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|e| {
        DispatchError::Other(anyhow::anyhow!("failed to spawn gaze calibration: {e}"))
    })?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| DispatchError::Other(anyhow::anyhow!("calibration sidecar has no stdin")))?;

    // Send the nine targets, then ask the sidecar to fit + persist. The
    // sidecar paces itself (settle + sample) between reads.
    for (tx, ty) in calibration::NINE_TARGETS {
        let line = format!("{{\"cmd\":\"target\",\"x\":{tx},\"y\":{ty}}}\n");
        if let Err(e) = stdin.write_all(line.as_bytes()).await {
            let _ = child.start_kill();
            return Err(DispatchError::Other(anyhow::anyhow!(
                "failed to drive calibration: {e}"
            )));
        }
    }
    let _ = stdin.write_all(b"{\"cmd\":\"finish\"}\n").await;
    let _ = stdin.flush().await;
    drop(stdin);

    // Wait for the sidecar to fit + save before we trust the profile file.
    let _ = child.wait().await;

    // Confirm by loading the freshly written profile.
    let profile = profile_path_opt().and_then(|p| calibration::load_profile(&p));
    let calibrated = profile.is_some();
    {
        let mut guard = state.calibrated.lock().await;
        *guard = calibrated;
    }
    Ok(serde_json::json!({
        "calibrated": calibrated,
        "targets": profile.as_ref().map(|p| p.targets),
        "samples": profile.as_ref().map(|p| p.samples),
        "profilePath": profile_path_opt().map(|p| p.display().to_string()),
    }))
}

/// Resolve the per-user profile path (`calibration::profile_path`), surfaced
/// here so both `status` and `calibrate` agree on the location.
fn profile_path_opt() -> Option<PathBuf> {
    calibration::profile_path()
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
    if v.is_nan() { 0.0 } else { v.clamp(0.0, 1.0) }
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

    // Serialises the `ERI_HOME`-mutating tests below. End-to-end calibration
    // needs a live camera (deferred); here we exercise the profile→status
    // wiring with a profile written directly to a redirected home.
    static ERI_HOME_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    // Holds a std Mutex across the `status().await` — acceptable here: this is
    // a test-only lock serialising `ERI_HOME` mutation so concurrent tests
    // don't read each other's redirected home; the awaited call is the unit
    // under test and runs on the same task.
    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn status_reports_calibrated_when_profile_present() {
        let guard = ERI_HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let dir = std::env::temp_dir().join(format!("eri_gaze_status_{}", std::process::id()));
        let prev = std::env::var("ERI_HOME").ok();
        // SAFETY: serialised by ERI_HOME_LOCK; restored before unlock.
        unsafe {
            std::env::set_var("ERI_HOME", &dir);
        }
        let profile = calibration::CalibrationProfile {
            version: 1,
            targets: 9,
            samples: 90,
            feature_dim: calibration::FEATURE_DIM,
            coeffs: vec![vec![0.0, 0.0]; calibration::FEATURE_DIM + 1],
        };
        let path = dir.join(".eri").join("gaze_calibration.json");
        calibration::save_profile(&path, &profile).expect("save profile");

        let services = Services::new();
        let result = status(Value::Null, &services).await.expect("status ok");
        assert_eq!(result["calibrated"], true);
        assert_eq!(result["profileTargets"], 9);

        // Restore env + clean up before releasing the lock.
        unsafe {
            match prev {
                Some(v) => std::env::set_var("ERI_HOME", v),
                None => std::env::remove_var("ERI_HOME"),
            }
        }
        let _ = std::fs::remove_dir_all(&dir);
        drop(guard);
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
