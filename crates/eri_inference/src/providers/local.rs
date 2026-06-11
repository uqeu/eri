//! Local-engine provider — eri's on-device small model.
//!
//! This is the **bootstrap backend**: it talks to a local Ollama-compatible
//! server over `ureq` (sync, matching the [`LlmProvider`] trait) at `/api/chat`.
//! The candle **in-process** engine (no separate install, the SOTA path) lands
//! next and slots in behind this same `LocalProvider` seam — the router and
//! callers only ever see [`crate::ModelChoice::Local`], never which backend
//! answered, so swapping Ollama → candle changes nothing upstream.
//!
//! Cost is always **$0**: the model runs on the user's machine. This is the
//! engine eri uses *first* for whatever it can do locally; Claude is the
//! escalation when the local model isn't capable enough.

use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::InferenceError;
use crate::llm_provider::{LlmProvider, LlmResponse};

/// Local model server (Ollama API). Override with `ERI_LOCAL_URL`.
const DEFAULT_LOCAL_URL: &str = "http://localhost:11434";

/// Default RAM ceiling (GB) eri's local engine may use. Free tier. Paying tiers
/// raise it ("consolidate 3/4/5/6 GB to eri") to unlock larger local models;
/// the per-tier map lives in tiers.json. The candle engine enforces this when
/// selecting a model/quant — eri never hogs the machine.
const DEFAULT_RAM_BUDGET_GB: f64 = 1.5;

/// The RAM budget (GB) the local engine is allowed, from `ERI_LOCAL_RAM_BUDGET`
/// (clamped to a sane floor). The paid-tier lever sets this; the engine picks
/// the best model/quant that fits.
pub fn ram_budget_gb() -> f64 {
    std::env::var("ERI_LOCAL_RAM_BUDGET")
        .ok()
        .and_then(|v| v.trim().parse::<f64>().ok())
        .filter(|v| v.is_finite() && *v > 0.0)
        .unwrap_or(DEFAULT_RAM_BUDGET_GB)
        .max(0.5)
}

/// eri's on-device engine, exposed through the uniform provider seam.
pub struct LocalProvider {
    base_url: String,
    model: String,
}

impl LocalProvider {
    /// Construct a local provider for `model`. Server URL from `ERI_LOCAL_URL`
    /// (default localhost:11434). Returns `None` only for an empty model id —
    /// connectivity is checked lazily on first call so construction never blocks.
    pub fn new(model: impl Into<String>) -> Option<Self> {
        let model = model.into();
        if model.trim().is_empty() {
            return None;
        }
        let base_url =
            std::env::var("ERI_LOCAL_URL").unwrap_or_else(|_| DEFAULT_LOCAL_URL.to_string());
        Some(Self { base_url, model })
    }

    fn endpoint(&self) -> String {
        format!("{}/api/chat", self.base_url.trim_end_matches('/'))
    }

    fn request_body(&self, system: &str, user: &str, max_tokens: u32) -> String {
        let req = ChatRequest {
            model: &self.model,
            messages: vec![
                Msg {
                    role: "system",
                    content: system,
                },
                Msg {
                    role: "user",
                    content: user,
                },
            ],
            stream: false,
            options: Options {
                num_predict: max_tokens,
            },
        };
        serde_json::to_string(&req).unwrap_or_default()
    }
}

#[derive(Serialize)]
struct ChatRequest<'a> {
    model: &'a str,
    messages: Vec<Msg<'a>>,
    stream: bool,
    options: Options,
}
#[derive(Serialize)]
struct Msg<'a> {
    role: &'a str,
    content: &'a str,
}
#[derive(Serialize)]
struct Options {
    num_predict: u32,
}

#[derive(Deserialize)]
struct ChatResponse {
    message: Option<RespMsg>,
    #[serde(default)]
    prompt_eval_count: u32,
    #[serde(default)]
    eval_count: u32,
}
#[derive(Deserialize)]
struct RespMsg {
    #[serde(default)]
    content: String,
}

impl LlmProvider for LocalProvider {
    fn name(&self) -> &'static str {
        "local"
    }

    fn model(&self) -> &str {
        &self.model
    }

    fn complete(
        &self,
        system: &str,
        user: &str,
        max_tokens: u32,
    ) -> Result<LlmResponse, InferenceError> {
        let body = self.request_body(system, user, max_tokens);
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(3))
            .timeout(Duration::from_secs(120))
            .build();
        let response = match agent
            .post(&self.endpoint())
            .set("content-type", "application/json")
            .send_string(&body)
        {
            Ok(r) => r,
            Err(ureq::Error::Status(status, r)) => {
                let b = r.into_string().unwrap_or_default();
                return Err(InferenceError::Transport(format!(
                    "local engine returned {status}: {b}"
                )));
            }
            Err(other) => {
                return Err(InferenceError::Transport(format!(
                    "local engine unreachable at {} ({other}); is the on-device model running?",
                    self.base_url
                )));
            }
        };
        let text = response
            .into_string()
            .map_err(|err| InferenceError::Transport(err.to_string()))?;
        let parsed: ChatResponse = serde_json::from_str(&text)?;
        let assistant = parsed.message.map(|m| m.content).unwrap_or_default();
        Ok(LlmResponse {
            text: assistant,
            prompt_tokens: parsed.prompt_eval_count,
            completion_tokens: parsed.eval_count,
            cost_usd: 0.0, // on-device — free
        })
    }

    fn stream(
        &self,
        system: &str,
        user: &str,
        max_tokens: u32,
        on_token: &mut dyn FnMut(&str),
    ) -> Result<LlmResponse, InferenceError> {
        // Bootstrap backend: complete once, emit the whole text. The candle
        // engine will stream token-by-token through this same method.
        let resp = self.complete(system, user, max_tokens)?;
        if !resp.text.is_empty() {
            on_token(&resp.text);
        }
        Ok(resp)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_model_id() {
        assert!(LocalProvider::new("").is_none());
        assert!(LocalProvider::new("   ").is_none());
    }

    #[test]
    fn builds_and_reports_local_identity_at_zero_cost_intent() {
        let p = LocalProvider::new("qwen2.5:1.5b").expect("model id");
        assert_eq!(p.name(), "local");
        assert_eq!(p.model(), "qwen2.5:1.5b");
        assert!(p.endpoint().ends_with("/api/chat"));
        // The request carries the system+user as chat messages.
        let body = p.request_body("you are eri", "hi", 64);
        assert!(body.contains("\"model\":\"qwen2.5:1.5b\""));
        assert!(body.contains("you are eri"));
        assert!(body.contains("\"num_predict\":64"));
    }

    #[test]
    fn ram_budget_has_a_sane_floor_default() {
        // Default applies when unset/invalid; never below the floor.
        assert!(ram_budget_gb() >= 0.5);
    }
}
