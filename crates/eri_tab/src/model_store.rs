//! GGUF model cache + Hugging Face downloader.
//!
//! Models are stored under `$XDG_CACHE_HOME/eri/models` (falling back to
//! `~/.cache/eri/models`). The on-disk layout mirrors the source repo's
//! filename so multiple models can coexist:
//!
//! ```text
//! ~/.cache/eri/models/
//!   qwen2.5-coder-1.5b-instruct-q4_k_m.gguf
//!   deepseek-coder-6.7b-base-q4_k_m.gguf
//! ```
//!
//! Downloads run via `hf-hub` with a streaming progress callback so the
//! sidecar can emit `eri/tab/download/progress` notifications.

use std::path::{Path, PathBuf};

use hf_hub::api::tokio::ApiBuilder;

use crate::TabError;

/// Returns `~/.cache/eri/models`, creating it if absent.
pub fn default_cache_dir() -> Result<PathBuf, TabError> {
    let base = if let Some(xdg) = std::env::var_os("XDG_CACHE_HOME") {
        PathBuf::from(xdg)
    } else if let Some(home) = std::env::var_os("HOME") {
        PathBuf::from(home).join(".cache")
    } else {
        return Err(TabError::Other(
            "neither XDG_CACHE_HOME nor HOME is set".into(),
        ));
    };
    let dir = base.join("eri").join("models");
    if !dir.exists() {
        std::fs::create_dir_all(&dir)?;
    }
    Ok(dir)
}

/// Resolve the on-disk path for `(repo_id, filename)`. Doesn't check
/// existence — see [`is_cached`].
pub fn cached_path(repo_id: &str, filename: &str) -> Result<PathBuf, TabError> {
    let dir = default_cache_dir()?;
    // We don't namespace by repo because GGUF filenames are unique enough
    // in practice, and flat layout keeps `ensure_model` cheap. If two repos
    // ever ship the same filename we'll add a prefix.
    let _ = repo_id;
    Ok(dir.join(filename))
}

/// True if the model file already exists on disk.
pub fn is_cached(repo_id: &str, filename: &str) -> bool {
    cached_path(repo_id, filename)
        .map(|p| p.exists())
        .unwrap_or(false)
}

/// Ensure the model is on disk. Downloads from Hugging Face if absent.
///
/// `on_progress` is invoked with a fraction in `0.0..=1.0` whenever the
/// downloader reports progress. It may be called from a background task.
pub async fn ensure_model<F>(
    repo_id: &str,
    filename: &str,
    on_progress: F,
) -> Result<PathBuf, TabError>
where
    F: Fn(f32) + Send + Sync + 'static,
{
    let dest = cached_path(repo_id, filename)?;
    if dest.exists() {
        on_progress(1.0);
        return Ok(dest);
    }

    let cache_dir = default_cache_dir()?;
    let api = ApiBuilder::new()
        .with_cache_dir(cache_dir.clone())
        .build()
        .map_err(|e| TabError::Download(format!("hf-hub api: {e}")))?;

    // `hf-hub` 0.5 doesn't expose a stable progress callback on the tokio
    // API — we report 0.0 at start and 1.0 on completion. A finer-grained
    // progress would need a custom HTTP client; this is enough to drive
    // status-bar UX in the IDE.
    on_progress(0.0);
    let downloaded = api
        .model(repo_id.to_string())
        .get(filename)
        .await
        .map_err(|e| TabError::Download(format!("download {filename}: {e}")))?;
    on_progress(1.0);

    // The hf-hub cache lives under its own layout — copy into our flat
    // cache so consumers don't need to traverse blob symlinks.
    if downloaded != dest {
        // hf-hub returns a symlink target; copy preserves a stable path
        // even if the cache is later pruned.
        std::fs::copy(&downloaded, &dest)?;
    }
    Ok(dest)
}

/// Convenience: ensure the default Qwen2.5-Coder model.
pub async fn ensure_default<F>(on_progress: F) -> Result<PathBuf, TabError>
where
    F: Fn(f32) + Send + Sync + 'static,
{
    ensure_model(
        crate::DEFAULT_MODEL_REPO,
        crate::DEFAULT_MODEL_FILE,
        on_progress,
    )
    .await
}

/// Read-only helper used by tests: returns `Some(path)` if cached.
pub fn lookup(repo_id: &str, filename: &str) -> Option<PathBuf> {
    let path = cached_path(repo_id, filename).ok()?;
    if path.exists() { Some(path) } else { None }
}

/// Internal: resolve the directory a cache check would write into. Used in tests.
pub fn cache_dir_override(custom: &Path) -> PathBuf {
    custom.join("eri").join("models")
}
