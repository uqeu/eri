//! Optional Ollama HTTP backend, kept behind the `ollama` feature for
//! hosts where llama.cpp can't build (no C++ toolchain, exotic ARM, etc).
//!
//! Not wired into the default sidecar dispatch — it exists so power users
//! can `cargo build -p eri_tab --features ollama` and call this module
//! directly. The new in-process [`crate::LlamaTabEngine`] is the supported
//! Tab path.

use std::time::Instant;

use serde::{Deserialize, Serialize};

use crate::{TabError, TabRequest, TabSuggestion, build_fim_prompt, clean_completion};

/// Default Ollama base URL when nothing else is configured.
pub const DEFAULT_BASE_URL: &str = "http://localhost:11434";

#[derive(Debug, Clone, Serialize)]
pub struct OllamaHealth {
    pub ok: bool,
    pub model: String,
    pub base_url: String,
}

#[derive(Debug, Clone)]
pub struct OllamaClient {
    base_url: String,
    model: String,
    http: reqwest::Client,
}

impl OllamaClient {
    pub fn new(base_url: impl Into<String>, model: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into(),
            model: model.into(),
            http: reqwest::Client::new(),
        }
    }

    pub async fn health(&self) -> OllamaHealth {
        let url = format!("{}/api/tags", self.base_url.trim_end_matches('/'));
        let ok = match self.http.get(&url).send().await {
            Ok(resp) => resp.status().is_success(),
            Err(_) => false,
        };
        OllamaHealth {
            ok,
            model: self.model.clone(),
            base_url: self.base_url.clone(),
        }
    }

    pub async fn complete(&self, req: &TabRequest) -> Result<TabSuggestion, TabError> {
        let started = Instant::now();
        let prompt = build_fim_prompt(&self.model, &req.prefix, &req.suffix);
        let body = serde_json::json!({
            "model": self.model,
            "prompt": prompt,
            "stream": false,
            "options": {
                "num_predict": req.max_tokens,
                "stop": req.stop,
            }
        });
        let url = format!("{}/api/generate", self.base_url.trim_end_matches('/'));
        let resp = self
            .http
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| TabError::Other(format!("ollama network: {e}")))?;
        if !resp.status().is_success() {
            return Err(TabError::Other(format!(
                "ollama status {}",
                resp.status().as_u16()
            )));
        }
        let raw = resp
            .text()
            .await
            .map_err(|e| TabError::Other(format!("ollama body: {e}")))?;
        let chunk: GenerateChunk = serde_json::from_str(raw.trim())?;
        let cleaned = clean_completion(&chunk.response, &req.stop);
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
    #[allow(dead_code)]
    done: bool,
}
