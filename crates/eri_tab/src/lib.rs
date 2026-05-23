//! Tab inline-completion client.
//!
//! Talks to a local Ollama server (`/api/generate`) to produce next-edit
//! suggestions for the IDE's inline completion provider. The Ollama wire
//! contract is JSON in / JSON-lines out with `{"response": "...", "done": bool}`.
//!
//! Model-specific Fill-In-the-Middle (FIM) prompt templates are chosen by
//! substring match on the model name. Unknown models fall back to a plain
//! prefix prompt — Ollama will still produce a continuation, just without
//! suffix-aware context.

use std::time::Instant;

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Default Ollama base URL when the environment doesn't override it.
pub const DEFAULT_BASE_URL: &str = "http://localhost:11434";

/// Errors from the tab client.
#[derive(Debug, Error)]
pub enum TabError {
    #[error("Ollama not reachable at {base_url}")]
    NotReachable { base_url: String },
    #[error("Ollama returned non-success status: {status}")]
    BadStatus { status: u16 },
    #[error("invalid response payload: {0}")]
    BadPayload(String),
    #[error("network error: {0}")]
    Network(#[from] reqwest::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

/// Inbound request from the dispatcher / IDE.
#[derive(Debug, Clone)]
pub struct TabRequest {
    pub prefix: String,
    pub suffix: String,
    pub language: Option<String>,
    pub max_tokens: usize,
    pub stop: Vec<String>,
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
    pub base_url: String,
}

/// Client for a single Ollama endpoint + model pair.
#[derive(Debug, Clone)]
pub struct TabClient {
    base_url: String,
    model: String,
    http: reqwest::Client,
}

impl TabClient {
    /// Build a new client with the default `reqwest::Client`.
    pub fn new(base_url: impl Into<String>, model: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into(),
            model: model.into(),
            http: reqwest::Client::new(),
        }
    }

    /// Override the HTTP client (used by tests with custom timeouts).
    pub fn with_http(
        base_url: impl Into<String>,
        model: impl Into<String>,
        http: reqwest::Client,
    ) -> Self {
        Self {
            base_url: base_url.into(),
            model: model.into(),
            http,
        }
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub fn model(&self) -> &str {
        &self.model
    }

    /// Compose the FIM prompt for the configured model family.
    pub fn build_prompt(&self, req: &TabRequest) -> String {
        build_fim_prompt(&self.model, &req.prefix, &req.suffix)
    }

    /// Probe `/api/tags` and report reachability. Never fails — returns
    /// `ok: false` on any network error.
    pub async fn health(&self) -> TabHealth {
        let url = format!("{}/api/tags", self.base_url.trim_end_matches('/'));
        let ok = match self.http.get(&url).send().await {
            Ok(resp) => resp.status().is_success(),
            Err(_) => false,
        };
        TabHealth {
            ok,
            model: self.model.clone(),
            base_url: self.base_url.clone(),
        }
    }

    /// Single-shot completion. Returns the cleaned suggestion text + latency.
    pub async fn complete(&self, req: &TabRequest) -> Result<TabSuggestion, TabError> {
        let started = Instant::now();
        let prompt = self.build_prompt(req);
        let body = build_payload(&self.model, &prompt, req, false);
        let url = format!("{}/api/generate", self.base_url.trim_end_matches('/'));

        let resp = self.http.post(&url).json(&body).send().await.map_err(|e| {
            if e.is_connect() || e.is_timeout() {
                TabError::NotReachable {
                    base_url: self.base_url.clone(),
                }
            } else {
                TabError::Network(e)
            }
        })?;

        if !resp.status().is_success() {
            return Err(TabError::BadStatus {
                status: resp.status().as_u16(),
            });
        }

        let raw = resp.text().await.map_err(TabError::Network)?;
        let text = parse_generate_response(&raw)?;
        let cleaned = clean_completion(&text, &req.stop);

        Ok(TabSuggestion {
            text: cleaned,
            latency_ms: started.elapsed().as_millis() as u64,
            model: self.model.clone(),
        })
    }

    /// Streaming completion. Each token chunk is delivered to `on_token`.
    pub async fn complete_stream<F>(
        &self,
        req: &TabRequest,
        mut on_token: F,
    ) -> Result<TabSuggestion, TabError>
    where
        F: FnMut(&str),
    {
        let started = Instant::now();
        let prompt = self.build_prompt(req);
        let body = build_payload(&self.model, &prompt, req, true);
        let url = format!("{}/api/generate", self.base_url.trim_end_matches('/'));

        let resp = self.http.post(&url).json(&body).send().await.map_err(|e| {
            if e.is_connect() || e.is_timeout() {
                TabError::NotReachable {
                    base_url: self.base_url.clone(),
                }
            } else {
                TabError::Network(e)
            }
        })?;
        if !resp.status().is_success() {
            return Err(TabError::BadStatus {
                status: resp.status().as_u16(),
            });
        }

        // Ollama streams newline-delimited JSON. We buffer text on the wire
        // and split on '\n' — each frame is one JSON object.
        let raw = resp.text().await.map_err(TabError::Network)?;
        let mut accumulated = String::new();
        for line in raw.split('\n') {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let chunk: GenerateChunk = serde_json::from_str(trimmed)?;
            on_token(&chunk.response);
            accumulated.push_str(&chunk.response);
            if chunk.done {
                break;
            }
        }

        let cleaned = clean_completion(&accumulated, &req.stop);
        Ok(TabSuggestion {
            text: cleaned,
            latency_ms: started.elapsed().as_millis() as u64,
            model: self.model.clone(),
        })
    }
}

#[derive(Debug, Deserialize)]
struct GenerateChunk {
    response: String,
    #[serde(default)]
    done: bool,
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
        format!("<\u{ff5c}fim\u{2581}begin\u{ff5c}>{prefix}<\u{ff5c}fim\u{2581}hole\u{ff5c}>{suffix}<\u{ff5c}fim\u{2581}end\u{ff5c}>")
    } else {
        prefix.to_string()
    }
}

fn build_payload(
    model: &str,
    prompt: &str,
    req: &TabRequest,
    stream: bool,
) -> serde_json::Value {
    serde_json::json!({
        "model": model,
        "prompt": prompt,
        "stream": stream,
        "options": {
            "num_predict": req.max_tokens,
            "stop": req.stop,
        }
    })
}

fn parse_generate_response(raw: &str) -> Result<String, TabError> {
    // Non-streaming responses are a single JSON object; some servers still
    // emit a trailing newline.
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(TabError::BadPayload("empty response".into()));
    }
    // If the server returned NDJSON anyway (stream=true ignored), concat.
    if trimmed.contains('\n') {
        let mut out = String::new();
        for line in trimmed.split('\n') {
            let l = line.trim();
            if l.is_empty() {
                continue;
            }
            let chunk: GenerateChunk = serde_json::from_str(l)?;
            out.push_str(&chunk.response);
        }
        return Ok(out);
    }
    let chunk: GenerateChunk = serde_json::from_str(trimmed)?;
    Ok(chunk.response)
}

/// Truncate the completion at the first stop sequence and drop the FIM
/// terminator if the model echoed it.
pub fn clean_completion(text: &str, stop: &[String]) -> String {
    let mut s = text.to_string();
    // Strip well-known terminators that some models append.
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

/// Parse `/api/tags` JSON to check the server is healthy and (optionally)
/// confirm a model name is installed.
pub fn parse_tags_response(raw: &str) -> Result<Vec<String>, TabError> {
    #[derive(Deserialize)]
    struct Tag {
        name: String,
    }
    #[derive(Deserialize)]
    struct Tags {
        #[serde(default)]
        models: Vec<Tag>,
    }
    let parsed: Tags = serde_json::from_str(raw)?;
    Ok(parsed.models.into_iter().map(|t| t.name).collect())
}
