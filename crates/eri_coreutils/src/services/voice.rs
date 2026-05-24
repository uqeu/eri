//! Voice service: thin async front for the `eri_voice::VoiceEngine`.
//!
//! `cpal::Stream` is `!Send`, so we cannot hold it inside the dispatch-wide
//! `Services` registry. The crate-level `VoiceEngine` solves this with a
//! pinned-thread + mpsc pattern: the audio stream is built inside the
//! `eri-voice` worker thread and never escapes. Only Send-safe handles
//! (`Arc<AtomicBool>`, `JoinHandle`) cross thread boundaries, so the
//! returned `VoiceEngine` is `Send + Sync` and embeds cleanly here.
//!
//! ## Wire surface
//!
//! - `eri/voice/start`  — spawn capture, return `{ running, started }`.
//! - `eri/voice/stop`   — tear capture down, return `{ stopped }`.
//! - `eri/voice/toggle` — flip current state.
//! - `eri/voice/status` — cached snapshot of running + last transcripts.
//! - `eri/voice/probe`  — non-destructive readiness check.
//!
//! All transcripts and status lines are forwarded back to the IDE as
//! `eri/voice/partial`, `eri/voice/final`, `eri/voice/status_message`,
//! `eri/voice/error` notifications via the shared [`Notifier`].

use std::path::PathBuf;
use std::sync::Arc;

use eri_voice::{VoiceConfig, VoiceEngine, VoiceSink};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::sync::Mutex;

use crate::DispatchError;
use crate::services::Services;

/// Snapshot of the most recent voice activity. Returned by `status`/`probe`.
#[derive(Debug, Default, Clone)]
pub struct VoiceState {
    pub running: bool,
    pub partial: Option<String>,
    pub last_final: Option<String>,
    pub last_error: Option<String>,
    pub last_status: Option<String>,
}

/// Inner mutable state. Held behind an `Arc<Mutex<...>>` so dispatch tasks
/// and the engine callbacks (which run on the `eri-voice` worker thread)
/// can both mutate it.
#[derive(Default)]
struct VoiceStateInner {
    /// Owned `VoiceEngine`. `Some` while capture is running, `None` when
    /// stopped. `VoiceEngine` is `Send + Sync` (the only thing holding the
    /// `cpal::Stream` is the pinned worker thread).
    engine: Option<VoiceEngine>,
    snapshot: VoiceState,
}

/// Cross-task voice state holder. Embedded in `Services` — must be
/// `Send + Sync` for tokio dispatch.
#[derive(Clone, Default)]
pub struct SharedVoiceState {
    inner: Arc<std::sync::Mutex<VoiceStateInner>>,
    // A separate async mutex would be ideal but the engine handle never
    // crosses await points — every mutation is a quick swap or a snapshot
    // clone, so std::sync::Mutex is fine here and avoids the tokio runtime
    // dependency in the engine callback path.
    notifier_lock: Arc<Mutex<()>>,
}

impl SharedVoiceState {
    pub async fn snapshot(&self) -> VoiceState {
        // Touch the async lock so this remains awaitable; the read itself is
        // sync and trivially fast.
        let _guard = self.notifier_lock.lock().await;
        self.inner
            .lock()
            .expect("voice state mutex poisoned")
            .snapshot
            .clone()
    }
}

/// Parameters accepted by `eri/voice/start`. All fields optional. The IDE
/// can pass a custom model path or language hint without redeploying the
/// sidecar.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct StartParams {
    model_path: Option<PathBuf>,
    language: Option<String>,
    vad_silence_ms: Option<u32>,
}

pub async fn start(params: Value, services: &Arc<Services>) -> Result<Value, DispatchError> {
    let parsed: StartParams =
        serde_json::from_value(params).map_err(|e| DispatchError::BadParams(e.to_string()))?;

    // Reject double-start: idempotent return so the extension's autostart
    // logic doesn't have to track running-state externally.
    {
        let inner = services
            .voice
            .inner
            .lock()
            .expect("voice state mutex poisoned");
        if inner.engine.is_some() {
            return Ok(json!({ "running": true, "started": false }));
        }
    }

    let cfg = build_config(parsed);
    let sink = build_sink(services);

    match VoiceEngine::start(cfg, sink) {
        Ok(engine) => {
            let mut inner = services
                .voice
                .inner
                .lock()
                .expect("voice state mutex poisoned");
            inner.engine = Some(engine);
            inner.snapshot.running = true;
            inner.snapshot.last_error = None;
            Ok(json!({ "running": true, "started": true }))
        }
        Err(error) => {
            let message = format!("voice engine start failed: {error}");
            let mut inner = services
                .voice
                .inner
                .lock()
                .expect("voice state mutex poisoned");
            inner.snapshot.running = false;
            inner.snapshot.last_error = Some(message.clone());
            Ok(json!({ "running": false, "reason": message }))
        }
    }
}

pub async fn stop(_params: Value, services: &Arc<Services>) -> Result<Value, DispatchError> {
    let engine = {
        let mut inner = services
            .voice
            .inner
            .lock()
            .expect("voice state mutex poisoned");
        inner.snapshot.running = false;
        inner.engine.take()
    };
    match engine {
        Some(engine) => {
            // Run the (potentially blocking) join on the blocking pool so
            // the dispatch task isn't parked on a thread join.
            let _ = tokio::task::spawn_blocking(move || engine.stop()).await;
            Ok(json!({ "stopped": true }))
        }
        None => Ok(json!({ "stopped": false })),
    }
}

pub async fn toggle(params: Value, services: &Arc<Services>) -> Result<Value, DispatchError> {
    let running = {
        let inner = services
            .voice
            .inner
            .lock()
            .expect("voice state mutex poisoned");
        inner.engine.is_some()
    };
    if running {
        stop(params, services).await
    } else {
        start(params, services).await
    }
}

pub async fn status(_params: Value, services: &Arc<Services>) -> Result<Value, DispatchError> {
    let state = services.voice.snapshot().await;
    Ok(json!({
        "running": state.running,
        "partial": state.partial,
        "last_final": state.last_final,
        "last_error": state.last_error,
        "last_status": state.last_status,
    }))
}

pub async fn probe(_params: Value, services: &Arc<Services>) -> Result<Value, DispatchError> {
    let state = services.voice.snapshot().await;
    Ok(json!({
        "running": state.running,
        "lastError": state.last_error,
    }))
}

fn build_config(params: StartParams) -> VoiceConfig {
    let mut cfg = VoiceConfig::default();
    if let Some(path) = params.model_path {
        cfg.model_path = Some(path);
    }
    if let Some(lang) = params.language {
        cfg.language = Some(lang);
    }
    if let Some(ms) = params.vad_silence_ms {
        cfg.vad_silence_ms = ms;
    }
    cfg
}

/// Build a `VoiceSink` whose callbacks update the cached snapshot and push
/// `eri/voice/*` notifications via the shared `Notifier`. Each callback
/// runs on the `eri-voice` worker thread, so we must avoid `.await` and
/// async-runtime tokens.
fn build_sink(services: &Arc<Services>) -> VoiceSink {
    let inner_partial = services.voice.inner.clone();
    let inner_final = services.voice.inner.clone();
    let inner_error = services.voice.inner.clone();
    let inner_status = services.voice.inner.clone();
    let notifier_partial = services.notifier.clone();
    let notifier_final = services.notifier.clone();
    let notifier_error = services.notifier.clone();
    let notifier_status = services.notifier.clone();

    VoiceSink {
        on_partial: Box::new(move |text| {
            if let Ok(mut guard) = inner_partial.lock() {
                guard.snapshot.partial = Some(text.clone());
            }
            if let Some(notifier) = notifier_partial.as_deref() {
                notifier.notify("eri/voice/partial", json!({ "text": text }));
            }
        }),
        on_final: Box::new(move |text| {
            if let Ok(mut guard) = inner_final.lock() {
                guard.snapshot.partial = None;
                guard.snapshot.last_final = Some(text.clone());
            }
            if let Some(notifier) = notifier_final.as_deref() {
                notifier.notify("eri/voice/final", json!({ "text": text }));
            }
        }),
        on_error: Box::new(move |message| {
            if let Ok(mut guard) = inner_error.lock() {
                guard.snapshot.last_error = Some(message.clone());
            }
            if let Some(notifier) = notifier_error.as_deref() {
                notifier.notify("eri/voice/error", json!({ "message": message }));
            }
        }),
        on_status: Box::new(move |message| {
            if let Ok(mut guard) = inner_status.lock() {
                guard.snapshot.last_status = Some(message.clone());
            }
            if let Some(notifier) = notifier_status.as_deref() {
                notifier.notify("eri/voice/status_message", json!({ "message": message }));
            }
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::Services;

    fn assert_send_sync<T: Send + Sync>() {}

    #[test]
    fn shared_voice_state_is_send_sync() {
        assert_send_sync::<SharedVoiceState>();
    }

    #[test]
    fn services_remains_send_sync() {
        assert_send_sync::<Services>();
    }

    #[tokio::test]
    async fn stop_without_start_is_idempotent() {
        let services = Services::new();
        let response = stop(Value::Null, &services).await.unwrap();
        assert_eq!(response["stopped"], false);
    }

    #[tokio::test]
    async fn status_before_start_reports_not_running() {
        let services = Services::new();
        let response = status(Value::Null, &services).await.unwrap();
        assert_eq!(response["running"], false);
    }
}
