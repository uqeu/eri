//! Tab inline-completion engine.
//!
//! Embeds `llama.cpp` (via the `llama-cpp-2` Rust FFI crate) directly in the
//! sidecar process. A single `LlamaTabEngine` keeps the model + context
//! warm so subsequent completions skip the multi-second load cost.
//!
//! ### Lifecycle
//! 1. Resolve the GGUF model path via [`model_store::ensure_model`]. If the
//!    file isn't cached, download it from Hugging Face.
//! 2. Construct a [`LlamaTabEngine`] with [`LlamaTabEngine::load`] — this is
//!    synchronous, ~2-5s on first call. Callers should wrap it in
//!    `tokio::task::spawn_blocking`.
//! 3. Reuse the engine for every request. Generation happens inside
//!    `spawn_blocking` so the async runtime stays responsive.
//!
//! The Fill-In-the-Middle prompt template is chosen by model name substring
//! match (qwen / deepseek / fallback) — same as the previous Ollama
//! implementation.

#![allow(clippy::result_large_err)]

use std::path::{Path, PathBuf};
#[cfg(feature = "llama")]
use std::sync::Arc;
#[cfg(feature = "llama")]
use std::time::Instant;

use serde::Serialize;
use thiserror::Error;

pub mod model_store;

#[cfg(feature = "ollama")]
pub mod ollama;

#[cfg(feature = "llama")]
mod inference;

/// Default Hugging Face repository for the bundled Tab model.
pub const DEFAULT_MODEL_REPO: &str = "Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF";
/// Default GGUF filename inside [`DEFAULT_MODEL_REPO`].
pub const DEFAULT_MODEL_FILE: &str = "qwen2.5-coder-1.5b-instruct-q4_k_m.gguf";
/// Stable model identifier surfaced to the IDE.
pub const DEFAULT_MODEL_ID: &str = "qwen2.5-coder:1.5b";
/// Default llama context window. 4k is plenty for FIM completion windows.
pub const DEFAULT_N_CTX: u32 = 4096;

/// Errors from the tab engine.
#[derive(Debug, Error)]
pub enum TabError {
    #[error("model not loaded; call LlamaTabEngine::load first")]
    NotLoaded,
    #[error("model file not found at {0}")]
    ModelMissing(PathBuf),
    #[error("llama.cpp error: {0}")]
    Llama(String),
    #[error("model download failed: {0}")]
    Download(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("eri_tab built without the `llama` feature; rebuild with --features llama")]
    FeatureDisabled,
    #[error("{0}")]
    Other(String),
}

/// Inbound request from the dispatcher / IDE.
#[derive(Debug, Clone)]
pub struct TabRequest {
    pub prefix: String,
    pub suffix: String,
    pub language: Option<String>,
    pub max_tokens: usize,
    pub stop: Vec<String>,
    /// Model id used purely for FIM template selection + reporting.
    pub model: String,
}

/// Suggestion + timing info returned to the IDE.
#[derive(Debug, Clone, Serialize)]
pub struct TabSuggestion {
    pub text: String,
    pub latency_ms: u64,
    pub model: String,
}

/// Health probe result.
#[derive(Debug, Clone, Serialize)]
pub struct TabHealth {
    pub ok: bool,
    pub model: String,
    pub loaded: bool,
    pub model_path: Option<PathBuf>,
    /// `Some(0.0..=1.0)` if a download is in flight; `None` otherwise.
    pub download_progress: Option<f32>,
}

/// In-process llama.cpp engine. Construction is synchronous and expensive
/// (the model is mmap'd and the context allocated); reuse the same engine
/// for every completion to amortise that cost.
///
/// When the `llama` feature is disabled (e.g. host toolchain can't build
/// `llama-cpp-sys-2`), the engine still compiles — `load` succeeds if the
/// file exists, but `complete` returns [`TabError::FeatureDisabled`].
/// Callers should check `cfg!(feature = "llama")` or just handle the
/// error.
pub struct LlamaTabEngine {
    #[cfg(feature = "llama")]
    inner: Arc<inference::Engine>,
    model_id: String,
    model_path: PathBuf,
}

impl LlamaTabEngine {
    /// Load a GGUF model from disk. Synchronous, ~2-5s on first call —
    /// wrap in `tokio::task::spawn_blocking` from async contexts.
    #[cfg(feature = "llama")]
    pub fn load(
        model_path: &Path,
        model_id: impl Into<String>,
        n_ctx: u32,
    ) -> Result<Self, TabError> {
        if !model_path.exists() {
            return Err(TabError::ModelMissing(model_path.to_path_buf()));
        }
        let inner = inference::Engine::load(model_path, n_ctx)?;
        Ok(Self {
            inner: Arc::new(inner),
            model_id: model_id.into(),
            model_path: model_path.to_path_buf(),
        })
    }

    /// Stub-mode constructor used when the `llama` feature is disabled.
    /// The engine is structurally valid but every `complete` call errors
    /// with `TabError::FeatureDisabled`. This exists so the surrounding
    /// dispatch code can compile workspace-wide while the host toolchain
    /// catches up to llama-cpp-sys-2's `cc ^1.2.61` requirement.
    #[cfg(not(feature = "llama"))]
    pub fn load(
        model_path: &Path,
        model_id: impl Into<String>,
        _n_ctx: u32,
    ) -> Result<Self, TabError> {
        if !model_path.exists() {
            return Err(TabError::ModelMissing(model_path.to_path_buf()));
        }
        Ok(Self {
            model_id: model_id.into(),
            model_path: model_path.to_path_buf(),
        })
    }

    pub fn model_id(&self) -> &str {
        &self.model_id
    }

    pub fn model_path(&self) -> &Path {
        &self.model_path
    }

    /// Compose the FIM prompt for the configured model family.
    pub fn build_prompt(&self, req: &TabRequest) -> String {
        build_fim_prompt(&req.model, &req.prefix, &req.suffix)
    }

    /// Single-shot completion. Returns the cleaned suggestion text + latency.
    #[cfg(feature = "llama")]
    pub async fn complete(&self, req: TabRequest) -> Result<TabSuggestion, TabError> {
        let started = Instant::now();
        let prompt = self.build_prompt(&req);
        let stop = req.stop.clone();
        let max_tokens = req.max_tokens;
        let engine = Arc::clone(&self.inner);
        let model_id = self.model_id.clone();

        let raw = tokio::task::spawn_blocking(move || {
            engine.generate(&prompt, max_tokens, &stop, |_| {})
        })
        .await
        .map_err(|e| TabError::Other(format!("blocking task: {e}")))??;

        let cleaned = clean_completion(&raw, &req.stop);
        Ok(TabSuggestion {
            text: cleaned,
            latency_ms: started.elapsed().as_millis() as u64,
            model: model_id,
        })
    }

    /// Stub completion when the `llama` feature is off. See [`Self::load`].
    #[cfg(not(feature = "llama"))]
    pub async fn complete(&self, _req: TabRequest) -> Result<TabSuggestion, TabError> {
        // TODO(llama): once the workspace `cc` pin is lifted (tree-sitter
        // bump in eri_index), turn on the `llama` feature and remove this
        // stub. Until then, the IDE gets a clean error instead of a hang.
        Err(TabError::FeatureDisabled)
    }

    /// Streaming completion. `on_token` is invoked for every decoded token.
    ///
    /// The callback runs on the blocking thread that owns the llama context;
    /// it must not block the caller's tokio runtime if shared. For tokio
    /// integration, send tokens through an `mpsc::UnboundedSender`.
    #[cfg(feature = "llama")]
    pub async fn complete_stream<F>(
        &self,
        req: TabRequest,
        mut on_token: F,
    ) -> Result<TabSuggestion, TabError>
    where
        F: FnMut(&str) + Send + 'static,
    {
        let started = Instant::now();
        let prompt = self.build_prompt(&req);
        let stop = req.stop.clone();
        let max_tokens = req.max_tokens;
        let engine = Arc::clone(&self.inner);
        let model_id = self.model_id.clone();

        let raw = tokio::task::spawn_blocking(move || {
            engine.generate(&prompt, max_tokens, &stop, |tok| on_token(tok))
        })
        .await
        .map_err(|e| TabError::Other(format!("blocking task: {e}")))??;

        let cleaned = clean_completion(&raw, &req.stop);
        Ok(TabSuggestion {
            text: cleaned,
            latency_ms: started.elapsed().as_millis() as u64,
            model: model_id,
        })
    }

    /// Stub stream when the `llama` feature is off.
    #[cfg(not(feature = "llama"))]
    pub async fn complete_stream<F>(
        &self,
        _req: TabRequest,
        _on_token: F,
    ) -> Result<TabSuggestion, TabError>
    where
        F: FnMut(&str) + Send + 'static,
    {
        Err(TabError::FeatureDisabled)
    }

    /// Health snapshot. `loaded=true` because if you have an engine it's loaded.
    pub fn health(&self) -> TabHealth {
        TabHealth {
            ok: cfg!(feature = "llama"),
            model: self.model_id.clone(),
            loaded: cfg!(feature = "llama"),
            model_path: Some(self.model_path.clone()),
            download_progress: None,
        }
    }
}

/// Choose a FIM template based on the model name.
///
/// Recognised families:
/// - `qwen` / `qwen2.5-coder` → Qwen FIM tokens
/// - `deepseek` → DeepSeek-Coder FIM tokens
/// - fallback → plain `{prefix}` (no suffix-awareness)
pub fn build_fim_prompt(model: &str, prefix: &str, suffix: &str) -> String {
    let m = model.to_ascii_lowercase();
    if m.contains("qwen") {
        format!("<|fim_prefix|>{prefix}<|fim_suffix|>{suffix}<|fim_middle|>")
    } else if m.contains("deepseek") {
        format!(
            "<\u{ff5c}fim\u{2581}begin\u{ff5c}>{prefix}<\u{ff5c}fim\u{2581}hole\u{ff5c}>{suffix}<\u{ff5c}fim\u{2581}end\u{ff5c}>"
        )
    } else {
        prefix.to_string()
    }
}

/// Truncate the completion at the first stop sequence and drop the FIM
/// terminator if the model echoed it.
pub fn clean_completion(text: &str, stop: &[String]) -> String {
    let mut s = text.to_string();
    for term in [
        "<|endoftext|>",
        "<|fim_pad|>",
        "<|EOT|>",
        "<\u{ff5c}end\u{2581}of\u{2581}sentence\u{ff5c}>",
    ] {
        if let Some(idx) = s.find(term) {
            s.truncate(idx);
        }
    }
    for sep in stop {
        if sep.is_empty() {
            continue;
        }
        if let Some(idx) = s.find(sep.as_str()) {
            s.truncate(idx);
        }
    }
    s
}
