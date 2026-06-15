//! Screen-extractor service — eri's "golden eyes" for computer-use.
//!
//! eri parses each screen frame into a clean, structured element list +
//! Set-of-Mark and **feeds that to Claude**. Vision *reasons* on Claude
//! (best-in-class GUI grounding); eri only *extracts* locally, so Claude clicks
//! more accurately with fewer tokens and fewer mis-clicks. See
//! `docs/architecture/vision-perception.md`.
//!
//! ## Layering
//!
//! * [`element`] — [`ScreenElement`]/[`BBox`]/[`ElementSource`] schema (the
//!   sidecar's JSON-per-line contract) + bbox/IoU math.
//! * [`fuse`] — merge AX ∪ OCR ∪ Vision into one de-duplicated, stably-id'd
//!   list (AX wins geometry/role; OCR/Vision fill labels).
//! * [`mark`] — Set-of-Mark numbering of interactables + the compact prompt
//!   listing for Claude.
//! * This module — the [`ScreenExtractService`]: spawns the capture sidecar,
//!   parses its element lines, runs [`fuse`], and holds the latest fused list +
//!   marks for the control loop to query.
//!
//! ## DEFERRED: the Swift capture layer is a documented stub.
//!
//! The real capture — `ScreenCaptureKit` window grab + `AXUIElement` walk +
//! Apple Vision `VNRecognizeTextRequest` OCR — is macOS-native and can only run
//! on-device, so it is **not** built here. `scripts/eri_screen_extract_stub.py`
//! emits a small SAMPLE element list so this pipeline is exercisable today; the
//! real Swift sidecar (blueprint: **Peekaboo**, MIT) lands in the on-device
//! integration pass. This module is source-agnostic: it parses whatever
//! `ScreenElement` lines the sidecar prints, so swapping the stub for the Swift
//! sidecar needs no Rust change here.
//!
//! Fail-safe: a missing or misbehaving sidecar yields an empty element list and
//! never panics.

mod element;
mod fuse;
mod mark;

pub use element::{BBox, ElementSource, ScreenElement};
pub use fuse::{DEFAULT_IOU_THRESHOLD, fuse, fuse_with_threshold};
pub use mark::{Mark, set_of_mark, to_prompt_list};

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;

use serde::Deserialize;
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

use crate::DispatchError;
use crate::services::Services;

/// A frame's worth of extracted perception: the fused element list, the
/// Set-of-Mark marks over its interactables, and the compact prompt listing.
/// This is exactly what the control loop hands Claude.
#[derive(Debug, Clone, Default)]
pub struct ScreenSnapshot {
    pub elements: Vec<ScreenElement>,
    pub marks: Vec<Mark>,
    pub prompt_list: String,
}

impl ScreenSnapshot {
    /// Build a snapshot from three raw extractor streams: fuse, then mark, then
    /// render the prompt listing. The single place the pure pipeline is
    /// assembled, so the service and any caller agree on ordering.
    pub fn from_sources(
        ax: Vec<ScreenElement>,
        ocr: Vec<ScreenElement>,
        vision: Vec<ScreenElement>,
    ) -> Self {
        let elements = fuse(ax, ocr, vision);
        let marks = set_of_mark(&elements);
        let prompt_list = to_prompt_list(&marks, &elements);
        Self {
            elements,
            marks,
            prompt_list,
        }
    }
}

/// Per-process screen-extractor state: the running sidecar child and the latest
/// fused snapshot. Mirrors `gaze::GazeState`.
#[derive(Default)]
pub struct ScreenExtractState {
    child: Mutex<Option<Child>>,
    latest: Mutex<ScreenSnapshot>,
}

impl ScreenExtractState {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    pub async fn is_running(&self) -> bool {
        self.child.lock().await.is_some()
    }

    /// Clone the latest fused snapshot for the control loop to hand Claude.
    pub async fn latest(&self) -> ScreenSnapshot {
        self.latest.lock().await.clone()
    }
}

/// Service-facing API. Thin so the dispatcher methods stay trivial and the
/// pure pipeline is what gets unit-tested.
pub struct ScreenExtractService;

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct StartParams {
    /// Optional override script path. Tests and the IDE both rely on the
    /// default location resolution below.
    script: Option<PathBuf>,
}

/// Spawn the capture sidecar and begin streaming fused snapshots.
///
/// Mirrors `gaze::start`: spawn the script, take its stdout, store the child,
/// and forward parsed frames on a background task. Idempotent — a second start
/// while running is a no-op. Fail-safe: if the sidecar can't be found we return
/// a structured `{ running: false, started: false }` rather than erroring, so a
/// missing on-device capture layer degrades to "no elements" instead of taking
/// down the control loop.
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

    let Some(script) = resolve_script(parsed.script.as_deref()) else {
        // Fail-safe: no capture layer yet (e.g. Swift sidecar not installed).
        // Report not-running rather than erroring so callers keep working with
        // an empty element list.
        return Ok(serde_json::json!({
            "running": false,
            "started": false,
            "reason": "screen-extract sidecar script not found",
        }));
    };

    let mut command = Command::new("python3");
    command
        .arg(&script)
        .arg("--run")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|e| {
        DispatchError::Other(anyhow::anyhow!(
            "failed to spawn screen-extract sidecar: {e}"
        ))
    })?;

    let stdout = child.stdout.take().ok_or_else(|| {
        DispatchError::Other(anyhow::anyhow!("screen-extract sidecar has no stdout"))
    })?;

    {
        let mut guard = state.child.lock().await;
        *guard = Some(child);
    }

    let state_for_task = Arc::clone(&state);
    tokio::spawn(async move {
        forward_frames(stdout, state_for_task).await;
    });

    Ok(serde_json::json!({ "running": true, "started": true }))
}

/// Kill the sidecar if running. Idempotent.
pub async fn stop(_params: Value, services: &Services) -> Result<Value, DispatchError> {
    let state = ensure_state(services);
    let mut guard = state.child.lock().await;
    if let Some(mut child) = guard.take() {
        let _ = child.start_kill();
        Ok(serde_json::json!({ "stopped": true }))
    } else {
        Ok(serde_json::json!({ "stopped": false }))
    }
}

/// Report the latest fused snapshot (count + marks + prompt list) without
/// re-running the sidecar — the control loop's read path.
pub async fn status(_params: Value, services: &Services) -> Result<Value, DispatchError> {
    let state = ensure_state(services);
    let running = state.is_running().await;
    let snapshot = state.latest().await;
    Ok(serde_json::json!({
        "running": running,
        "elementCount": snapshot.elements.len(),
        "markCount": snapshot.marks.len(),
        "promptList": snapshot.prompt_list,
    }))
}

/// One frame as emitted by the sidecar: three element streams keyed by source.
/// Missing keys default to empty — the stub only needs to fill what it has.
#[derive(Debug, Deserialize, Default)]
#[serde(default)]
struct FramePayload {
    ax: Vec<ScreenElement>,
    ocr: Vec<ScreenElement>,
    vision: Vec<ScreenElement>,
}

/// Background task: parse the sidecar's stdout line-by-line. Each line is a
/// `{type:"frame", ax:[…], ocr:[…], vision:[…]}` JSON object; we fuse it and
/// store the snapshot. Non-frame / non-JSON lines are ignored (fail-safe).
/// Exits when the child closes stdout.
async fn forward_frames(stdout: tokio::process::ChildStdout, state: Arc<ScreenExtractState>) {
    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();
    while let Ok(Some(line)) = lines.next_line().await {
        if let Some(snapshot) = parse_frame(line.trim()) {
            let mut guard = state.latest.lock().await;
            *guard = snapshot;
        }
    }
    // stdout closed — clear the child slot so a future `start` can respawn.
    let mut guard = state.child.lock().await;
    if let Some(mut child) = guard.take() {
        let _ = child.start_kill();
    }
}

/// Parse one sidecar stdout line into a fused [`ScreenSnapshot`]. Returns `None`
/// for blank lines, non-JSON, or non-`frame` payloads so the forwarder can skip
/// them without panicking — the core fail-safe property.
fn parse_frame(line: &str) -> Option<ScreenSnapshot> {
    if line.is_empty() {
        return None;
    }
    let value: Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(err) => {
            tracing::debug!(error = %err, line, "ignoring non-JSON screen-extract line");
            return None;
        }
    };
    if value.get("type").and_then(Value::as_str) != Some("frame") {
        return None;
    }
    let payload: FramePayload = match serde_json::from_value(value) {
        Ok(p) => p,
        Err(err) => {
            tracing::debug!(error = %err, "ignoring malformed screen-extract frame");
            return None;
        }
    };
    Some(ScreenSnapshot::from_sources(
        payload.ax,
        payload.ocr,
        payload.vision,
    ))
}

/// Find the capture sidecar script. Order:
///   1. Caller override (tests).
///   2. `ERI_SCREEN_EXTRACT_SCRIPT` env var.
///   3. `<workspace>/scripts/eri_screen_extract_stub.py` (workspace via env).
///
/// The Swift sidecar will slot into the same resolution once it ships.
fn resolve_script(override_path: Option<&Path>) -> Option<PathBuf> {
    if let Some(path) = override_path {
        if path.exists() {
            return Some(path.to_path_buf());
        }
    }
    if let Ok(env) = std::env::var("ERI_SCREEN_EXTRACT_SCRIPT") {
        let p = PathBuf::from(env);
        if p.exists() {
            return Some(p);
        }
    }
    let workspace = std::env::var("ERI_WORKSPACE")
        .ok()
        .map(PathBuf::from)
        .or_else(|| std::env::current_dir().ok())?;
    let stub = workspace.join("scripts").join("eri_screen_extract_stub.py");
    if stub.exists() {
        return Some(stub);
    }
    None
}

/// Process-global state keyed off the `Services` lifetime, exactly as
/// `gaze::ensure_state` does (one per process).
fn ensure_state(_services: &Services) -> Arc<ScreenExtractState> {
    use std::sync::OnceLock;
    static STATE: OnceLock<Arc<ScreenExtractState>> = OnceLock::new();
    STATE.get_or_init(ScreenExtractState::new).clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    // The sidecar child slot is process-global, so tests that start/stop it
    // must not run concurrently. A tokio mutex serialises them.
    static SIDECAR_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

    #[test]
    fn parse_frame_fuses_ax_and_ocr() {
        let line = r#"{
            "type":"frame",
            "ax":[{"role":"button","bbox":{"x":0.1,"y":0.1,"w":0.2,"h":0.06},"interactable":true,"source":"ax"}],
            "ocr":[{"role":"text","label":"Submit","bbox":{"x":0.11,"y":0.1,"w":0.18,"h":0.06},"text":"Submit","source":"ocr"}]
        }"#;
        let snap = parse_frame(line).expect("frame parses");
        assert_eq!(snap.elements.len(), 1, "overlapping AX+OCR dedupe");
        assert_eq!(snap.elements[0].role, "button");
        assert_eq!(snap.elements[0].label, "Submit");
        assert_eq!(snap.marks.len(), 1);
        assert_eq!(snap.prompt_list, "1: button 'Submit' [interactable]");
    }

    #[test]
    fn parse_frame_rejects_non_frame_type() {
        let line = r#"{"type":"status","message":"ready"}"#;
        assert!(parse_frame(line).is_none());
    }

    #[test]
    fn parse_frame_rejects_non_json() {
        // Fail-safe: garbage never panics, just yields None.
        assert!(parse_frame("not json at all").is_none());
        assert!(parse_frame("").is_none());
    }

    #[test]
    fn parse_frame_handles_empty_streams() {
        let snap = parse_frame(r#"{"type":"frame"}"#).expect("empty frame parses");
        assert!(snap.elements.is_empty());
        assert!(snap.marks.is_empty());
        assert_eq!(snap.prompt_list, "");
    }

    #[test]
    fn snapshot_from_sources_assembles_pipeline() {
        let ax = vec![ScreenElement {
            id: String::new(),
            role: "link".into(),
            label: "Docs".into(),
            bbox: BBox::new(0.3, 0.3, 0.1, 0.05),
            interactable: true,
            text: None,
            source: ElementSource::Ax,
        }];
        let snap = ScreenSnapshot::from_sources(ax, vec![], vec![]);
        assert_eq!(snap.elements.len(), 1);
        assert_eq!(snap.elements[0].id, "el-0");
        assert_eq!(snap.marks.len(), 1);
        assert_eq!(snap.prompt_list, "1: link 'Docs' [interactable]");
    }

    #[tokio::test]
    async fn start_failsafe_when_script_missing() {
        let _guard = SIDECAR_LOCK.lock().await;
        // No script override + no stub in a bogus workspace → not-running,
        // never an error. Stop any prior child first (process-global state).
        let services = Services::new();
        let _ = stop(Value::Null, &services).await;
        // SAFETY: single-threaded test; we point the resolver at an empty temp
        // dir so the stub can't be found, then restore.
        let prev_ws = std::env::var("ERI_WORKSPACE").ok();
        let prev_env = std::env::var("ERI_SCREEN_EXTRACT_SCRIPT").ok();
        let empty = std::env::temp_dir().join(format!("eri_se_missing_{}", std::process::id()));
        unsafe {
            std::env::set_var("ERI_WORKSPACE", &empty);
            std::env::remove_var("ERI_SCREEN_EXTRACT_SCRIPT");
        }
        let params = serde_json::json!({ "script": "/no/such/script.py" });
        let result = start(params, &services).await.expect("start ok");
        assert_eq!(result["running"], false);
        assert_eq!(result["started"], false);
        unsafe {
            match prev_ws {
                Some(v) => std::env::set_var("ERI_WORKSPACE", v),
                None => std::env::remove_var("ERI_WORKSPACE"),
            }
            if let Some(v) = prev_env {
                std::env::set_var("ERI_SCREEN_EXTRACT_SCRIPT", v);
            }
        }
    }

    #[tokio::test]
    async fn live_stub_sidecar_produces_fused_snapshot() {
        let _guard = SIDECAR_LOCK.lock().await;
        // Drive the actual stub script end-to-end: spawn → parse → fuse →
        // mark, and confirm the snapshot the control loop would read. Skips
        // gracefully if python3 or the stub aren't present (CI without them).
        let script = std::env::current_dir()
            .ok()
            .map(|d| d.join("scripts").join("eri_screen_extract_stub.py"))
            // crate cwd is the crate dir under cargo test; walk up to repo root.
            .or_else(|| {
                std::env::current_dir().ok().and_then(|d| {
                    d.ancestors()
                        .map(|a| a.join("scripts").join("eri_screen_extract_stub.py"))
                        .find(|p| p.exists())
                })
            });
        let Some(script) = script.filter(|p| p.exists()) else {
            eprintln!("skipping: stub script not found from cwd");
            return;
        };

        let services = Services::new();
        let state = ensure_state(&services);
        // Make sure no prior child is around (process-global state).
        let _ = stop(Value::Null, &services).await;

        let started = start(serde_json::json!({ "script": script }), &services)
            .await
            .expect("start ok");
        if started["started"] != serde_json::Value::Bool(true) {
            eprintln!("skipping: sidecar did not start ({started})");
            return;
        }

        // The forwarder runs on a spawned task; poll briefly for the frame.
        let mut snap = ScreenSnapshot::default();
        for _ in 0..50 {
            snap = state.latest().await;
            if !snap.elements.is_empty() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        let _ = stop(Value::Null, &services).await;

        // AX button + OCR "Submit" dedupe to one; Vision "Docs" stays separate;
        // OCR "Welcome back" is context. → 3 elements, 2 interactable marks.
        assert_eq!(snap.elements.len(), 3, "fused element count");
        assert_eq!(snap.marks.len(), 2, "interactable marks");
        assert!(snap.prompt_list.contains("button 'Submit' [interactable]"));
        assert!(snap.prompt_list.contains("link 'Docs' [interactable]"));
        assert!(snap.prompt_list.contains("- text 'Welcome back'"));
    }

    #[tokio::test]
    async fn stop_is_idempotent_when_not_running() {
        let _guard = SIDECAR_LOCK.lock().await;
        let services = Services::new();
        let result = stop(Value::Null, &services).await.expect("stop ok");
        assert!(result.get("stopped").is_some());
    }

    #[tokio::test]
    async fn status_reports_stable_shape() {
        let services = Services::new();
        let result = status(Value::Null, &services).await.expect("status ok");
        assert!(result.get("running").is_some());
        assert!(result.get("elementCount").is_some());
        assert!(result.get("markCount").is_some());
        assert!(result.get("promptList").is_some());
    }
}
