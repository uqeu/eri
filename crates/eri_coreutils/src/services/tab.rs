//! `eri/tab/*` JSON-RPC handlers.
//!
//! Backed by the in-process `eri_tab::LlamaTabEngine` (llama.cpp via FFI).
//! No HTTP hop — the model is loaded once into the sidecar process and
//! kept warm for the lifetime of the process.
//!
//! Three states are reported back to the IDE:
//!   - `downloading` (`-32100`): model file not yet on disk; a background
//!     task is fetching it. The IDE shows a status-bar spinner.
//!   - `loading`: file on disk but engine not yet constructed. Internally
//!     we block here (~2-5s) on the first call.
//!   - `ready`: engine loaded; calls return suggestions.

use std::sync::Arc;

use anyhow::anyhow;
use serde::Deserialize;
use serde_json::{Value, json};
use tracing::warn;

use eri_tab::model_store;
use eri_tab::{
    DEFAULT_MODEL_FILE, DEFAULT_MODEL_ID, DEFAULT_MODEL_REPO, DEFAULT_N_CTX, LlamaTabEngine,
    TabError, TabRequest,
};

use crate::DispatchError;
use crate::services::Services;

/// RPC error code: model download in progress.
pub const DOWNLOADING_CODE: i32 = -32100;
const DEFAULT_MAX_TOKENS: usize = 64;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompleteParams {
    #[allow(dead_code)]
    file_path: Option<String>,
    prefix: String,
    suffix: String,
    #[serde(default)]
    language: Option<String>,
    #[serde(default)]
    max_tokens: Option<usize>,
    #[serde(default)]
    model: Option<String>,
    /// Accepted but ignored — Ollama is no longer the backend. Logged once
    /// at warn level so old callers stay quiet.
    #[serde(default)]
    base_url: Option<String>,
    #[serde(default)]
    stop: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct HealthParams {
    model: Option<String>,
    #[allow(dead_code)]
    base_url: Option<String>,
}

fn resolve_model(explicit: Option<String>) -> String {
    explicit
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_MODEL_ID.to_string())
}

/// Map a model identifier (e.g. `qwen2.5-coder:1.5b`) to a Hugging Face
/// `(repo_id, filename)` pair. Unknown ids fall back to the default model.
fn resolve_repo(model_id: &str) -> (&'static str, &'static str) {
    // Today we ship a single model. Add cases here as more are bundled.
    let lower = model_id.to_ascii_lowercase();
    if lower.contains("qwen") || lower.is_empty() {
        (DEFAULT_MODEL_REPO, DEFAULT_MODEL_FILE)
    } else {
        // Unknown alias — log and use the default rather than fail. Users
        // can still wire other GGUFs in once we expose model registration.
        warn!(model = %model_id, "unknown tab model id; using default");
        (DEFAULT_MODEL_REPO, DEFAULT_MODEL_FILE)
    }
}

fn downloading_error(progress: f32) -> DispatchError {
    // We encode the JSON-RPC -32100 "downloading" signal as a structured
    // anyhow error message so the binary's outer error mapper can lift it
    // back into the wire RpcError shape. We keep it as a string the
    // extension can json.parse() — the dispatch layer doesn't know about
    // structured payload data on errors today.
    let body = json!({ "stage": "downloading", "progress": progress }).to_string();
    DispatchError::Other(anyhow!("__DOWNLOADING__{body}"))
}

fn map_tab_err(err: TabError) -> DispatchError {
    DispatchError::Other(anyhow!(err.to_string()))
}

/// Ensure the model file is on disk. If a download is needed, kick it off
/// in the background and return the current progress fraction.
///
/// Returns `Ok(Some(path))` once cached, `Ok(None)` if a download is in
/// flight, or `Err(_)` on permanent failure.
async fn ensure_model_ready(
    services: &Arc<Services>,
    repo: &'static str,
    filename: &'static str,
) -> Result<Option<std::path::PathBuf>, DispatchError> {
    if model_store::is_cached(repo, filename) {
        return Ok(Some(
            model_store::cached_path(repo, filename)
                .map_err(|e| DispatchError::Other(anyhow!(e.to_string())))?,
        ));
    }

    // Either start a download or report ongoing progress.
    let mut state = services.tab_download.write().await;
    if state.progress.is_none() {
        // Mark as starting; spawn the fetch.
        state.progress = Some(0.0);
        state.error = None;
        drop(state);

        let services_for_task = Arc::clone(services);
        tokio::spawn(async move {
            let services_inner = Arc::clone(&services_for_task);
            let services_for_progress = Arc::clone(&services_for_task);
            let progress_cb = move |frac: f32| {
                // Synchronous callback fired from inside the download
                // future — use try_write to avoid blocking it.
                if let Ok(mut s) = services_for_progress.tab_download.try_write() {
                    s.progress = Some(frac.clamp(0.0, 1.0));
                }
            };
            let result = model_store::ensure_model(repo, filename, progress_cb).await;
            let mut s = services_inner.tab_download.write().await;
            match result {
                Ok(_) => {
                    s.progress = None;
                    s.error = None;
                }
                Err(e) => {
                    s.progress = None;
                    s.error = Some(e.to_string());
                }
            }
        });
    }

    // Return current progress so the caller can map it to -32100.
    let state = services.tab_download.read().await;
    Ok(if state.progress.is_some() {
        None
    } else {
        Some(
            model_store::cached_path(repo, filename)
                .map_err(|e| DispatchError::Other(anyhow!(e.to_string())))?,
        )
    })
}

async fn engine_for(
    services: &Arc<Services>,
    model_id: &str,
) -> Result<Arc<LlamaTabEngine>, DispatchError> {
    let (repo, filename) = resolve_repo(model_id);
    let path = match ensure_model_ready(services, repo, filename).await? {
        Some(p) => p,
        None => {
            let progress = services.tab_download.read().await.progress.unwrap_or(0.0);
            return Err(downloading_error(progress));
        }
    };

    // Load lazily — once loaded, every caller shares the same Arc.
    let engine = services
        .tab_engine
        .get_or_try_init(|| async {
            let model_id = model_id.to_string();
            let path_for_load = path.clone();
            let engine = tokio::task::spawn_blocking(move || {
                LlamaTabEngine::load(&path_for_load, model_id, DEFAULT_N_CTX)
            })
            .await
            .map_err(|e| anyhow!("blocking task: {e}"))?
            .map_err(|e| anyhow!(e.to_string()))?;
            Ok::<_, anyhow::Error>(Arc::new(engine))
        })
        .await
        .map_err(DispatchError::Other)?;
    Ok(Arc::clone(engine))
}

pub async fn handle_complete(
    params: Value,
    services: &Arc<Services>,
) -> Result<Value, DispatchError> {
    let parsed: CompleteParams =
        serde_json::from_value(params).map_err(|e| DispatchError::BadParams(e.to_string()))?;

    if parsed.base_url.is_some() {
        warn!("eri/tab/complete: ignoring deprecated baseUrl param");
    }

    let model_id = resolve_model(parsed.model);
    let max_tokens = parsed.max_tokens.unwrap_or(DEFAULT_MAX_TOKENS);
    let stop = parsed.stop.unwrap_or_else(|| {
        vec![
            "\n\n".to_string(),
            "<|endoftext|>".to_string(),
            "<|fim_pad|>".to_string(),
        ]
    });

    let engine = engine_for(services, &model_id).await?;
    let req = TabRequest {
        prefix: parsed.prefix,
        suffix: parsed.suffix,
        language: parsed.language,
        max_tokens,
        stop,
        model: model_id.clone(),
    };

    let suggestion = engine.complete(req).await.map_err(map_tab_err)?;
    Ok(json!({
        "text": suggestion.text,
        "latencyMs": suggestion.latency_ms,
        "model": suggestion.model,
    }))
}

pub async fn handle_health(
    params: Value,
    services: &Arc<Services>,
) -> Result<Value, DispatchError> {
    let parsed: HealthParams = if params.is_null() {
        HealthParams::default()
    } else {
        serde_json::from_value(params).map_err(|e| DispatchError::BadParams(e.to_string()))?
    };
    let model_id = resolve_model(parsed.model);
    let (repo, filename) = resolve_repo(&model_id);
    let model_path = model_store::cached_path(repo, filename)
        .map_err(|e| DispatchError::Other(anyhow!(e.to_string())))?;
    let on_disk = model_path.exists();
    let loaded = services.tab_engine.get().is_some();
    let download = services.tab_download.read().await;

    Ok(json!({
        "ok": on_disk && download.error.is_none(),
        "model": model_id,
        "loaded": loaded,
        "modelPath": model_path.to_string_lossy(),
        "downloadProgress": download.progress,
        "downloadError": download.error,
    }))
}

/// `eri/tab/preload` — explicit trigger to kick off download + load. Returns
/// `{ stage: "downloading" | "loading" | "ready", progress }`.
pub async fn handle_preload(
    _params: Value,
    services: &Arc<Services>,
) -> Result<Value, DispatchError> {
    let (repo, filename) = resolve_repo(DEFAULT_MODEL_ID);
    match ensure_model_ready(services, repo, filename).await? {
        None => {
            let progress = services.tab_download.read().await.progress.unwrap_or(0.0);
            Ok(json!({ "stage": "downloading", "progress": progress }))
        }
        Some(path) => {
            if services.tab_engine.get().is_some() {
                return Ok(json!({ "stage": "ready", "modelPath": path.to_string_lossy() }));
            }
            // Best-effort warm load. Failures here are reported but
            // non-fatal — the next /complete call will retry.
            let services_for_load = Arc::clone(services);
            let path_for_load = path.clone();
            tokio::spawn(async move {
                let _ = services_for_load
                    .tab_engine
                    .get_or_try_init(|| async {
                        let load_path = path_for_load.clone();
                        let engine = tokio::task::spawn_blocking(move || {
                            LlamaTabEngine::load(&load_path, DEFAULT_MODEL_ID, DEFAULT_N_CTX)
                        })
                        .await
                        .map_err(|e| anyhow!("blocking task: {e}"))?
                        .map_err(|e| anyhow!(e.to_string()))?;
                        Ok::<_, anyhow::Error>(Arc::new(engine))
                    })
                    .await;
            });
            Ok(json!({ "stage": "loading", "modelPath": path.to_string_lossy() }))
        }
    }
}
