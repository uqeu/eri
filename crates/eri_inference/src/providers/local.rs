//! Local-engine provider — eri's on-device small model.
//!
//! [`LocalProvider`] is a normal [`LlmProvider`] (same seam as the cloud
//! providers), but the *transport* behind it is a swappable [`LocalTransport`]:
//!
//!   - [`OllamaTransport`] — the **bootstrap** backend, an Ollama-compatible
//!     HTTP server over `ureq` (sync, matching the trait) at `/api/chat`.
//!   - candle **in-process** (no separate install, the SOTA path) lands next as
//!     a second `LocalTransport` impl — a *new adapter at this seam*, not a
//!     rewrite of the provider.
//!
//! The router and callers only ever see [`crate::ModelChoice::Local`], never
//! which transport answered. Cost is always **$0** — the model runs on the
//! user's machine. This is the engine eri uses *first* for whatever it can do
//! locally; Claude is the escalation when the local model isn't capable enough.

use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::InferenceError;
use crate::llm_provider::{LlmProvider, LlmResponse};

/// Local model server (Ollama API). Override with `ERI_LOCAL_URL`.
const DEFAULT_LOCAL_URL: &str = "http://localhost:11434";

/// Default RAM ceiling (GB) eri's local engine may use. Free tier. Paying tiers
/// raise it ("consolidate 3/4/5/6 GB to eri") to unlock larger local models;
/// the per-tier map lives in tiers.json. The candle transport enforces this when
/// selecting a model/quant — eri never hogs the machine.
const DEFAULT_RAM_BUDGET_GB: f64 = 1.5;

/// The RAM budget (GB) the local engine is allowed, from `ERI_LOCAL_RAM_BUDGET`
/// (clamped to a sane floor). The paid-tier lever sets this; the transport picks
/// the best model/quant that fits.
pub fn ram_budget_gb() -> f64 {
    std::env::var("ERI_LOCAL_RAM_BUDGET")
        .ok()
        .and_then(|v| v.trim().parse::<f64>().ok())
        .filter(|v| v.is_finite() && *v > 0.0)
        .unwrap_or(DEFAULT_RAM_BUDGET_GB)
        .max(0.5)
}

/// A reply from a local transport. Token counts feed usage telemetry; cost is
/// always $0 (on-device), so it isn't carried here.
pub struct LocalReply {
    pub text: String,
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
}

/// The transport behind eri's local engine. Implementations own their I/O
/// (HTTP today, in-process candle next). This is the seam that keeps
/// Ollama/candle swappable without touching [`LocalProvider`] or any caller.
pub trait LocalTransport: Send + Sync {
    fn chat(&self, system: &str, user: &str, max_tokens: u32)
    -> Result<LocalReply, InferenceError>;
}

/// Ollama-compatible HTTP transport — the bootstrap backend.
pub struct OllamaTransport {
    base_url: String,
    model: String,
}

impl OllamaTransport {
    pub fn new(base_url: impl Into<String>, model: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into(),
            model: model.into(),
        }
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

impl LocalTransport for OllamaTransport {
    fn chat(
        &self,
        system: &str,
        user: &str,
        max_tokens: u32,
    ) -> Result<LocalReply, InferenceError> {
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
        Ok(LocalReply {
            text: parsed.message.map(|m| m.content).unwrap_or_default(),
            prompt_tokens: parsed.prompt_eval_count,
            completion_tokens: parsed.eval_count,
        })
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

/// eri's on-device engine, exposed through the uniform provider seam.
pub struct LocalProvider {
    model: String,
    transport: Box<dyn LocalTransport>,
}

impl LocalProvider {
    /// Construct a local provider for `model` over the default Ollama transport
    /// (`ERI_LOCAL_URL`, default localhost:11434). Returns `None` only for an
    /// empty model id — connectivity is checked lazily so construction never
    /// blocks.
    pub fn new(model: impl Into<String>) -> Option<Self> {
        let model = model.into();
        if model.trim().is_empty() {
            return None;
        }
        let base_url =
            std::env::var("ERI_LOCAL_URL").unwrap_or_else(|_| DEFAULT_LOCAL_URL.to_string());
        let transport = Box::new(OllamaTransport::new(base_url, model.clone()));
        Some(Self { model, transport })
    }

    /// Construct with an explicit transport — the seam the candle in-process
    /// engine (and tests) plug into. Same `LlmProvider` surface either way.
    pub fn with_transport(
        model: impl Into<String>,
        transport: Box<dyn LocalTransport>,
    ) -> Option<Self> {
        let model = model.into();
        if model.trim().is_empty() {
            return None;
        }
        Some(Self { model, transport })
    }
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
        let reply = self.transport.chat(system, user, max_tokens)?;
        Ok(LlmResponse {
            text: reply.text,
            prompt_tokens: reply.prompt_tokens,
            completion_tokens: reply.completion_tokens,
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
        // Bootstrap transport returns the whole reply at once; emit it as one
        // chunk. The candle transport will stream token-by-token through this
        // same method (it owns its own LocalTransport that yields deltas).
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

    /// A transport double — proves `LocalProvider` is transport-agnostic (the
    /// seam candle will plug into).
    struct StubTransport;
    impl LocalTransport for StubTransport {
        fn chat(&self, _s: &str, _u: &str, _m: u32) -> Result<LocalReply, InferenceError> {
            Ok(LocalReply {
                text: "hi from local".to_string(),
                prompt_tokens: 3,
                completion_tokens: 4,
            })
        }
    }

    #[test]
    fn rejects_empty_model_id() {
        assert!(LocalProvider::new("").is_none());
        assert!(LocalProvider::new("   ").is_none());
        assert!(LocalProvider::with_transport("", Box::new(StubTransport)).is_none());
    }

    #[test]
    fn provider_is_local_at_zero_cost_through_any_transport() {
        let p = LocalProvider::with_transport("qwen2.5:1.5b", Box::new(StubTransport))
            .expect("model id");
        assert_eq!(p.name(), "local");
        assert_eq!(p.model(), "qwen2.5:1.5b");
        let r = p.complete("sys", "user", 64).expect("stub never fails");
        assert_eq!(r.text, "hi from local");
        assert_eq!(r.completion_tokens, 4);
        assert_eq!(r.cost_usd, 0.0, "on-device is always free");
    }

    /// A transport that always fails — models the "local-first is on but the
    /// on-device model isn't running" failure mode (/diagnose loop).
    struct FailingTransport;
    impl LocalTransport for FailingTransport {
        fn chat(&self, _s: &str, _u: &str, _m: u32) -> Result<LocalReply, InferenceError> {
            Err(InferenceError::Transport("engine unreachable".into()))
        }
    }

    #[test]
    fn local_failure_surfaces_an_error_not_a_silent_empty_reply() {
        // /diagnose finding (captured): when the local engine is unreachable,
        // complete() returns an Err — it does NOT silently yield empty text.
        // NOTE: there is no runtime local->cloud fallback at THIS layer; the
        // escalation seam is the ControlTurn design (Candidate A). This test
        // locks in honest failure (no silent success) until that lands.
        let p = LocalProvider::with_transport("qwen2.5:1.5b", Box::new(FailingTransport))
            .expect("model id");
        let err = p
            .complete("sys", "user", 64)
            .expect_err("must surface the failure");
        assert!(matches!(err, InferenceError::Transport(_)));
    }

    #[test]
    fn ollama_transport_builds_a_chat_request() {
        let t = OllamaTransport::new("http://localhost:11434", "qwen2.5:1.5b");
        assert!(t.endpoint().ends_with("/api/chat"));
        let body = t.request_body("you are eri", "hi", 64);
        assert!(body.contains("\"model\":\"qwen2.5:1.5b\""));
        assert!(body.contains("you are eri"));
        assert!(body.contains("\"num_predict\":64"));
    }

    #[test]
    fn ram_budget_has_a_sane_floor_default() {
        assert!(ram_budget_gb() >= 0.5);
    }
}
