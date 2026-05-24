//! Voice service placeholder.
//!
//! The real voice capture pipeline (cpal stream + Whisper) lives in
//! `eri_voice`. `cpal::Stream` is `!Send`, so it can't live inside the
//! shared `Services` struct (which must be `Send + Sync` for tokio
//! dispatch). The pinned-thread shim that lets us host it is tracked
//! separately; until it lands, these handlers return a deterministic
//! "engine offline" payload so the wire surface stays stable.
//!
//! ## Wire surface
//!
//! - `eri/voice/start`  — no-op, returns `{ running: false, reason }`.
//! - `eri/voice/stop`   — no-op, returns `{ running: false }`.
//! - `eri/voice/toggle` — no-op, returns `{ running: false, reason }`.
//! - `eri/voice/status` — returns the cached snapshot.
//! - `eri/voice/probe`  — non-destructive readiness check.

use std::sync::Arc;

use serde_json::{Value, json};
use tokio::sync::Mutex;

use crate::DispatchError;
use crate::services::Services;

/// Snapshot of the most recent voice activity.
#[derive(Debug, Default, Clone)]
pub struct VoiceState {
    pub running: bool,
    pub partial: Option<String>,
    pub last_final: Option<String>,
    pub last_error: Option<String>,
    pub last_status: Option<String>,
}

/// Cross-task voice state holder. Holds only the snapshot — the capture
/// session lives in a thread-pinned actor (not yet wired) so this struct
/// stays `Send + Sync` and can be embedded in `Services`.
#[derive(Clone, Default)]
pub struct SharedVoiceState {
    inner: Arc<Mutex<VoiceState>>,
}

impl SharedVoiceState {
    pub async fn snapshot(&self) -> VoiceState {
        self.inner.lock().await.clone()
    }
}

pub async fn start(_params: Value, _services: &Arc<Services>) -> Result<Value, DispatchError> {
    Ok(json!({ "running": false, "reason": "voice_engine_offline" }))
}

pub async fn stop(_params: Value, _services: &Arc<Services>) -> Result<Value, DispatchError> {
    Ok(json!({ "running": false }))
}

pub async fn toggle(_params: Value, _services: &Arc<Services>) -> Result<Value, DispatchError> {
    Ok(json!({ "running": false, "reason": "voice_engine_offline" }))
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
