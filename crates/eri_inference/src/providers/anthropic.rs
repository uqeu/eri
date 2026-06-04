//! Anthropic provider — talks to `/v1/messages`.
//!
//! Reads `ANTHROPIC_API_KEY`. Wire format differs from OpenAI in two
//! important ways:
//! * `system` is a top-level field, not a role in `messages`.
//! * Auth uses `x-api-key` + `anthropic-version` headers, not `Bearer`.
//! * Streaming uses Anthropic-flavored SSE (`event: content_block_delta`).

// Token counting routes through eri_tokens crate. See ERI_BLOAT_AUDIT.md.

use std::{io::BufRead, time::Duration};

use serde::{Deserialize, Serialize};

use crate::{
    InferenceError,
    costs::{
        CLAUDE_HAIKU_4_5_INPUT_PER_M, CLAUDE_HAIKU_4_5_OUTPUT_PER_M, CLAUDE_OPUS_4_5_INPUT_PER_M,
        CLAUDE_OPUS_4_5_OUTPUT_PER_M, CLAUDE_SONNET_4_5_INPUT_PER_M,
        CLAUDE_SONNET_4_5_OUTPUT_PER_M, cost_for,
    },
    llm_provider::{LlmProvider, LlmResponse},
};

const ANTHROPIC_MESSAGES_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_API_VERSION: &str = "2023-06-01";

/// Path appended to the eri.dev base URL for the proxied Anthropic
/// transport. The backend forwards the body unchanged and bills against the
/// user's tier.
const ANTHROPIC_PROXY_PATH: &str = "/api/v1/inference/anthropic/messages";

/// Authentication mode for the Anthropic transport. BYOK puts the user's
/// key in `x-api-key`; Proxy puts the eri.dev session bearer in
/// `Authorization` and rewrites the URL to the eri.dev proxy endpoint.
#[derive(Debug, Clone)]
enum AnthropicAuth {
    Byok { api_key: String },
    Proxy { session_token: String },
}

#[derive(Debug)]
pub struct AnthropicProvider {
    model: String,
    auth: AnthropicAuth,
    endpoint: String,
}

impl AnthropicProvider {
    pub fn for_model(model: &str) -> Result<Self, InferenceError> {
        let _ = dotenvy::dotenv();
        let api_key = std::env::var("ANTHROPIC_API_KEY")
            .map_err(|_| InferenceError::Transport("ANTHROPIC_API_KEY not set".into()))?;
        Self::for_model_with_key(model, api_key)
    }

    /// Construct a provider with a pre-fetched API key. Used by the sidecar
    /// after a BYOK secret lookup resolves the key from
    /// `vscode.SecretStorage` (with env-var fallback) — the caller already
    /// knows whether the key is present, so this constructor does not touch
    /// any env vars itself.
    pub fn for_model_with_key(
        model: &str,
        api_key: impl Into<String>,
    ) -> Result<Self, InferenceError> {
        if pricing_for(model).is_none() {
            return Err(InferenceError::Transport(format!(
                "unsupported anthropic model: {model}"
            )));
        }
        Ok(Self {
            model: model.to_string(),
            auth: AnthropicAuth::Byok {
                api_key: api_key.into(),
            },
            endpoint: ANTHROPIC_MESSAGES_URL.to_string(),
        })
    }

    /// Construct a provider that routes through the eri.dev inference proxy.
    /// The request body stays Anthropic-shaped — the backend forwards it to
    /// `api.anthropic.com` with its master key and tracks the spend against
    /// the user's tier. Auth is the user's session bearer.
    pub fn for_model_with_proxy(
        model: &str,
        session_token: impl Into<String>,
        base_url: &str,
    ) -> Result<Self, InferenceError> {
        if pricing_for(model).is_none() {
            return Err(InferenceError::Transport(format!(
                "unsupported anthropic model: {model}"
            )));
        }
        Ok(Self {
            model: model.to_string(),
            auth: AnthropicAuth::Proxy {
                session_token: session_token.into(),
            },
            endpoint: format!("{}{}", base_url.trim_end_matches('/'), ANTHROPIC_PROXY_PATH),
        })
    }

    /// Reveal the active endpoint for the audit log and tests.
    pub fn endpoint(&self) -> &str {
        &self.endpoint
    }

    /// True when this provider routes through the eri.dev proxy.
    pub fn is_proxied(&self) -> bool {
        matches!(self.auth, AnthropicAuth::Proxy { .. })
    }

    #[cfg(test)]
    pub(crate) fn with_endpoint(model: &str, api_key: &str, endpoint: &str) -> Self {
        Self {
            model: model.to_string(),
            auth: AnthropicAuth::Byok {
                api_key: api_key.to_string(),
            },
            endpoint: endpoint.to_string(),
        }
    }

    pub(crate) fn build_request_body(
        &self,
        system: &str,
        user: &str,
        max_tokens: u32,
        stream: bool,
    ) -> Result<String, InferenceError> {
        let payload = AnthropicMessagesRequest {
            model: &self.model,
            system,
            messages: vec![AnthropicMessage {
                role: "user",
                content: user,
            }],
            max_tokens,
            stream,
        };
        serde_json::to_string(&payload).map_err(InferenceError::Json)
    }
}

fn pricing_for(model: &str) -> Option<(f64, f64)> {
    // Match by model family prefix so future point releases (4-5, 4-6, ...)
    // resolve without a code change. Rates are per the family's published
    // pricing; see docs/architecture/eri-architecture.html section 6b.
    if model.starts_with("claude-sonnet") {
        return Some((
            CLAUDE_SONNET_4_5_INPUT_PER_M,
            CLAUDE_SONNET_4_5_OUTPUT_PER_M,
        ));
    }
    if model.starts_with("claude-haiku") {
        return Some((CLAUDE_HAIKU_4_5_INPUT_PER_M, CLAUDE_HAIKU_4_5_OUTPUT_PER_M));
    }
    if model.starts_with("claude-opus") {
        return Some((CLAUDE_OPUS_4_5_INPUT_PER_M, CLAUDE_OPUS_4_5_OUTPUT_PER_M));
    }
    None
}

#[derive(Serialize)]
struct AnthropicMessagesRequest<'a> {
    model: &'a str,
    system: &'a str,
    messages: Vec<AnthropicMessage<'a>>,
    max_tokens: u32,
    stream: bool,
}

#[derive(Serialize)]
struct AnthropicMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Deserialize)]
struct AnthropicResponse {
    #[serde(default)]
    content: Vec<AnthropicContentBlock>,
    #[serde(default)]
    usage: Option<AnthropicUsage>,
}

#[derive(Deserialize)]
struct AnthropicContentBlock {
    #[serde(default, rename = "type")]
    block_type: String,
    #[serde(default)]
    text: Option<String>,
}

#[derive(Deserialize)]
struct AnthropicUsage {
    #[serde(default)]
    input_tokens: u32,
    #[serde(default)]
    output_tokens: u32,
}

#[derive(Deserialize)]
struct AnthropicStreamEvent {
    #[serde(default, rename = "type")]
    event_type: String,
    #[serde(default)]
    delta: Option<AnthropicStreamDelta>,
    #[serde(default)]
    usage: Option<AnthropicUsage>,
}

#[derive(Deserialize)]
struct AnthropicStreamDelta {
    #[serde(default, rename = "type")]
    delta_type: String,
    #[serde(default)]
    text: Option<String>,
}

impl LlmProvider for AnthropicProvider {
    fn name(&self) -> &'static str {
        "anthropic"
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
        let body = self.build_request_body(system, user, max_tokens, false)?;
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(5))
            .timeout(Duration::from_secs(300))
            .build();
        let request = agent
            .post(&self.endpoint)
            .set("content-type", "application/json")
            .set("anthropic-version", ANTHROPIC_API_VERSION);
        let request = match &self.auth {
            AnthropicAuth::Byok { api_key } => request.set("x-api-key", api_key),
            AnthropicAuth::Proxy { session_token } => {
                request.set("authorization", &format!("Bearer {session_token}"))
            }
        };
        let response = match request.send_string(&body) {
            Ok(response) => response,
            Err(ureq::Error::Status(status, response)) => {
                let body = response.into_string().unwrap_or_default();
                if status == 402 {
                    return Err(InferenceError::Transport(format!(
                        "eri engine quota exceeded: {body}"
                    )));
                }
                return Err(InferenceError::Transport(format!(
                    "anthropic returned {status}: {body}"
                )));
            }
            Err(other) => {
                return Err(InferenceError::Transport(format!(
                    "anthropic transport failure: {other}"
                )));
            }
        };
        let text = response
            .into_string()
            .map_err(|err| InferenceError::Transport(err.to_string()))?;
        let parsed: AnthropicResponse = serde_json::from_str(&text)?;
        let assistant_text: String = parsed
            .content
            .iter()
            .filter(|b| b.block_type == "text")
            .filter_map(|b| b.text.clone())
            .collect();
        let (prompt_tokens, completion_tokens) = match parsed.usage {
            Some(usage) => (usage.input_tokens, usage.output_tokens),
            None => estimate_tokens(system, user, &assistant_text),
        };
        let (input_per_m, output_per_m) = pricing_for(&self.model).unwrap_or((0.0, 0.0));
        Ok(LlmResponse {
            text: assistant_text,
            prompt_tokens,
            completion_tokens,
            cost_usd: cost_for(prompt_tokens, completion_tokens, input_per_m, output_per_m),
        })
    }

    fn stream(
        &self,
        system: &str,
        user: &str,
        max_tokens: u32,
        on_token: &mut dyn FnMut(&str),
    ) -> Result<LlmResponse, InferenceError> {
        let body = self.build_request_body(system, user, max_tokens, true)?;
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(5))
            .timeout(Duration::from_secs(300))
            .build();
        let request = agent
            .post(&self.endpoint)
            .set("content-type", "application/json")
            .set("accept", "text/event-stream")
            .set("anthropic-version", ANTHROPIC_API_VERSION);
        let request = match &self.auth {
            AnthropicAuth::Byok { api_key } => request.set("x-api-key", api_key),
            AnthropicAuth::Proxy { session_token } => {
                request.set("authorization", &format!("Bearer {session_token}"))
            }
        };
        let response = match request.send_string(&body) {
            Ok(response) => response,
            Err(ureq::Error::Status(status, response)) => {
                let body = response.into_string().unwrap_or_default();
                if status == 402 {
                    return Err(InferenceError::Transport(format!(
                        "eri engine quota exceeded: {body}"
                    )));
                }
                return Err(InferenceError::Transport(format!(
                    "anthropic returned {status}: {body}"
                )));
            }
            Err(other) => {
                return Err(InferenceError::Transport(format!(
                    "anthropic transport failure: {other}"
                )));
            }
        };
        let reader = std::io::BufReader::new(response.into_reader());
        let mut accumulated = String::new();
        let mut prompt_tokens = 0u32;
        let mut completion_tokens = 0u32;
        for line in reader.lines() {
            let line = line.map_err(|err| InferenceError::Transport(err.to_string()))?;
            let Some(payload) = line.strip_prefix("data: ") else {
                continue;
            };
            if payload == "[DONE]" {
                break;
            }
            let event: AnthropicStreamEvent = match serde_json::from_str(payload) {
                Ok(event) => event,
                Err(_) => continue,
            };
            match event.event_type.as_str() {
                "content_block_delta" => {
                    if let Some(delta) = event.delta
                        && delta.delta_type == "text_delta"
                        && let Some(text) = delta.text
                    {
                        accumulated.push_str(&text);
                        on_token(&text);
                    }
                }
                "message_delta" | "message_stop" => {
                    if let Some(usage) = event.usage {
                        prompt_tokens = usage.input_tokens;
                        completion_tokens = usage.output_tokens;
                    }
                }
                _ => {}
            }
        }
        if prompt_tokens == 0 && completion_tokens == 0 {
            let (p, c) = estimate_tokens(system, user, &accumulated);
            prompt_tokens = p;
            completion_tokens = c;
        }
        let (input_per_m, output_per_m) = pricing_for(&self.model).unwrap_or((0.0, 0.0));
        Ok(LlmResponse {
            text: accumulated,
            prompt_tokens,
            completion_tokens,
            cost_usd: cost_for(prompt_tokens, completion_tokens, input_per_m, output_per_m),
        })
    }
}

fn estimate_tokens(system: &str, user: &str, assistant: &str) -> (u32, u32) {
    let prompt = format!("{system}\n{user}");
    let prompt_tokens = eri_tokens::tokens_or_fallback(&prompt, "claude-3.5-sonnet");
    let completion_tokens = eri_tokens::tokens_or_fallback(assistant, "claude-3.5-sonnet");
    (prompt_tokens, completion_tokens)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proxy_constructor_rewrites_endpoint_and_marks_proxied() {
        let provider = AnthropicProvider::for_model_with_proxy(
            "claude-sonnet-4-6",
            "sess-tok",
            "https://eri.dev",
        )
        .expect("provider builds");
        assert!(provider.is_proxied());
        assert_eq!(
            provider.endpoint(),
            "https://eri.dev/api/v1/inference/anthropic/messages"
        );
    }

    #[test]
    fn byok_constructor_keeps_anthropic_endpoint() {
        let provider = AnthropicProvider::for_model_with_key("claude-sonnet-4-6", "sk-ant-byok")
            .expect("provider builds");
        assert!(!provider.is_proxied());
        assert_eq!(provider.endpoint(), ANTHROPIC_MESSAGES_URL);
    }

    #[test]
    fn proxy_constructor_trims_trailing_slash_on_base_url() {
        let provider = AnthropicProvider::for_model_with_proxy(
            "claude-haiku-4-5-20251001",
            "sess",
            "https://eri.dev/",
        )
        .expect("provider builds");
        assert_eq!(
            provider.endpoint(),
            "https://eri.dev/api/v1/inference/anthropic/messages"
        );
    }

    #[test]
    fn anthropic_request_body_uses_messages_format_and_system_at_top_level() {
        let provider =
            AnthropicProvider::with_endpoint("claude-sonnet-4-6", "test-key", "http://localhost/");
        let body = provider
            .build_request_body("you are helpful", "hello", 128, false)
            .expect("body");
        let parsed: serde_json::Value = serde_json::from_str(&body).expect("json");
        assert_eq!(parsed["model"], "claude-sonnet-4-6");
        // Anthropic puts `system` at the top level, NOT inside `messages`.
        assert_eq!(parsed["system"], "you are helpful");
        let messages = parsed["messages"].as_array().expect("messages");
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0]["role"], "user");
        assert_eq!(messages[0]["content"], "hello");
        // System role must NOT appear in messages.
        for msg in messages {
            assert_ne!(msg["role"], "system");
        }
        assert_eq!(parsed["max_tokens"], 128);
    }
}
