//! `eri/tab/*` JSON-RPC handlers.
//!
//! Thin adapter from the IDE-facing camelCase params to the `eri_tab`
//! crate. Defaults track the small Qwen2.5-Coder build that ships well on
//! local hardware. The base URL prefers an explicit param, then the
//! `OLLAMA_HOST` env var, then localhost.

use anyhow::anyhow;
use serde::Deserialize;
use serde_json::Value;

use eri_tab::{TabClient, TabError, TabRequest, DEFAULT_BASE_URL};

use crate::services::Services;
use crate::DispatchError;

const DEFAULT_MODEL: &str = "qwen2.5-coder:1.5b";
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
    #[serde(default)]
    base_url: Option<String>,
    #[serde(default)]
    stop: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct HealthParams {
    model: Option<String>,
    base_url: Option<String>,
}

fn resolve_base_url(explicit: Option<String>) -> String {
    if let Some(url) = explicit.filter(|s| !s.trim().is_empty()) {
        return url;
    }
    std::env::var("OLLAMA_HOST").ok().unwrap_or_else(|| DEFAULT_BASE_URL.to_string())
}

fn resolve_model(explicit: Option<String>) -> String {
    explicit
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_MODEL.to_string())
}

fn map_err(err: TabError, base_url: &str) -> DispatchError {
    match err {
        TabError::NotReachable { .. } => DispatchError::Other(anyhow!(
            "Ollama not reachable at {base_url} — see docs"
        )),
        other => DispatchError::Other(anyhow!(other.to_string())),
    }
}

pub async fn handle_complete(params: Value, _services: &Services) -> Result<Value, DispatchError> {
    let parsed: CompleteParams =
        serde_json::from_value(params).map_err(|e| DispatchError::BadParams(e.to_string()))?;

    let base_url = resolve_base_url(parsed.base_url);
    let model = resolve_model(parsed.model);
    let max_tokens = parsed.max_tokens.unwrap_or(DEFAULT_MAX_TOKENS);
    let stop = parsed.stop.unwrap_or_else(|| {
        vec![
            "\n\n".to_string(),
            "<|endoftext|>".to_string(),
            "<|fim_pad|>".to_string(),
        ]
    });

    let req = TabRequest {
        prefix: parsed.prefix,
        suffix: parsed.suffix,
        language: parsed.language,
        max_tokens,
        stop,
    };

    let client = TabClient::new(base_url.clone(), model);
    let suggestion = client
        .complete(&req)
        .await
        .map_err(|e| map_err(e, &base_url))?;

    Ok(serde_json::json!({
        "text": suggestion.text,
        "latencyMs": suggestion.latency_ms,
        "model": suggestion.model,
    }))
}

pub async fn handle_health(params: Value, _services: &Services) -> Result<Value, DispatchError> {
    let parsed: HealthParams = if params.is_null() {
        HealthParams::default()
    } else {
        serde_json::from_value(params).map_err(|e| DispatchError::BadParams(e.to_string()))?
    };
    let base_url = resolve_base_url(parsed.base_url);
    let model = resolve_model(parsed.model);
    let client = TabClient::new(base_url.clone(), model);
    let health = client.health().await;
    Ok(serde_json::json!({
        "ok": health.ok,
        "model": health.model,
        "baseUrl": health.base_url,
    }))
}
