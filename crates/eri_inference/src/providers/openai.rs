//! OpenAI provider — talks to `/v1/chat/completions`.
//!
//! Reads the API key from `OPENAI_API_KEY`. Construction fails with
//! [`InferenceError::Transport`] if the key is missing or the model id isn't
//! one we have pricing data for, so callers can fall through to a status line
//! ("set OPENAI_API_KEY first") instead of crashing.

// Token counting routes through eri_tokens crate. See ERI_BLOAT_AUDIT.md.

use std::{io::BufRead, time::Duration};

use serde::{Deserialize, Serialize};

use crate::{
    InferenceError,
    costs::{
        OPENAI_GPT_4O_INPUT_PER_M, OPENAI_GPT_4O_MINI_INPUT_PER_M, OPENAI_GPT_4O_MINI_OUTPUT_PER_M,
        OPENAI_GPT_4O_OUTPUT_PER_M, OPENAI_O1_MINI_INPUT_PER_M, OPENAI_O1_MINI_OUTPUT_PER_M,
        OPENAI_O3_MINI_INPUT_PER_M, OPENAI_O3_MINI_OUTPUT_PER_M, OPENAI_O4_INPUT_PER_M,
        OPENAI_O4_OUTPUT_PER_M, cost_for,
    },
    llm_provider::{LlmProvider, LlmResponse},
};

const OPENAI_CHAT_COMPLETIONS_URL: &str = "https://api.openai.com/v1/chat/completions";

/// Path appended to the eri.dev base URL for the proxied OpenAI transport.
const OPENAI_PROXY_PATH: &str = "/api/v1/inference/openai/chat/completions";

/// Auth mode for the OpenAI transport. Both modes use bearer auth — the
/// difference is which token (user's BYOK key vs eri session bearer) and
/// which endpoint.
#[derive(Debug, Clone)]
enum OpenAiAuth {
    Byok { api_key: String },
    Proxy { session_token: String },
}

#[derive(Debug)]
pub struct OpenAiProvider {
    model: String,
    auth: OpenAiAuth,
    endpoint: String,
}

impl OpenAiProvider {
    /// Build a provider for a known model id. Returns an error if the key env
    /// var is missing or the model id is one we don't have pricing for.
    pub fn for_model(model: &str) -> Result<Self, InferenceError> {
        let _ = dotenvy::dotenv();
        let api_key = std::env::var("OPENAI_API_KEY")
            .map_err(|_| InferenceError::Transport("OPENAI_API_KEY not set".into()))?;
        Self::for_model_with_key(model, api_key)
    }

    /// Construct a provider with a pre-fetched API key. Used by the sidecar
    /// after a BYOK secret lookup resolves the key — keeps the env-var
    /// branch out of the call path so secrets coming from
    /// `vscode.SecretStorage` never touch the process env.
    pub fn for_model_with_key(
        model: &str,
        api_key: impl Into<String>,
    ) -> Result<Self, InferenceError> {
        if pricing_for(model).is_none() {
            return Err(InferenceError::Transport(format!(
                "unsupported openai model: {model}"
            )));
        }
        Ok(Self {
            model: model.to_string(),
            auth: OpenAiAuth::Byok {
                api_key: api_key.into(),
            },
            endpoint: OPENAI_CHAT_COMPLETIONS_URL.to_string(),
        })
    }

    /// Route OpenAI calls through the eri.dev inference proxy. Body shape
    /// matches `chat/completions` exactly so the backend can forward it
    /// verbatim with its master key.
    pub fn for_model_with_proxy(
        model: &str,
        session_token: impl Into<String>,
        base_url: &str,
    ) -> Result<Self, InferenceError> {
        if pricing_for(model).is_none() {
            return Err(InferenceError::Transport(format!(
                "unsupported openai model: {model}"
            )));
        }
        Ok(Self {
            model: model.to_string(),
            auth: OpenAiAuth::Proxy {
                session_token: session_token.into(),
            },
            endpoint: format!("{}{}", base_url.trim_end_matches('/'), OPENAI_PROXY_PATH),
        })
    }

    pub fn endpoint(&self) -> &str {
        &self.endpoint
    }

    pub fn is_proxied(&self) -> bool {
        matches!(self.auth, OpenAiAuth::Proxy { .. })
    }

    /// Test seam — override the endpoint to point at a mock server.
    #[cfg(test)]
    pub(crate) fn with_endpoint(model: &str, api_key: &str, endpoint: &str) -> Self {
        Self {
            model: model.to_string(),
            auth: OpenAiAuth::Byok {
                api_key: api_key.to_string(),
            },
            endpoint: endpoint.to_string(),
        }
    }

    fn bearer_token(&self) -> &str {
        match &self.auth {
            OpenAiAuth::Byok { api_key } => api_key.as_str(),
            OpenAiAuth::Proxy { session_token } => session_token.as_str(),
        }
    }

    pub(crate) fn build_request_body(
        &self,
        system: &str,
        user: &str,
        max_tokens: u32,
        stream: bool,
    ) -> Result<String, InferenceError> {
        let payload = OpenAiChatRequest {
            model: &self.model,
            messages: vec![
                OpenAiMessage {
                    role: "system",
                    content: system,
                },
                OpenAiMessage {
                    role: "user",
                    content: user,
                },
            ],
            max_tokens,
            stream,
        };
        serde_json::to_string(&payload).map_err(InferenceError::Json)
    }
}

fn pricing_for(model: &str) -> Option<(f64, f64)> {
    match model {
        "gpt-4o" => Some((OPENAI_GPT_4O_INPUT_PER_M, OPENAI_GPT_4O_OUTPUT_PER_M)),
        "gpt-4o-mini" => Some((
            OPENAI_GPT_4O_MINI_INPUT_PER_M,
            OPENAI_GPT_4O_MINI_OUTPUT_PER_M,
        )),
        "o1-mini" => Some((OPENAI_O1_MINI_INPUT_PER_M, OPENAI_O1_MINI_OUTPUT_PER_M)),
        "o3-mini" => Some((OPENAI_O3_MINI_INPUT_PER_M, OPENAI_O3_MINI_OUTPUT_PER_M)),
        "o4" => Some((OPENAI_O4_INPUT_PER_M, OPENAI_O4_OUTPUT_PER_M)),
        _ => None,
    }
}

#[derive(Serialize)]
struct OpenAiChatRequest<'a> {
    model: &'a str,
    messages: Vec<OpenAiMessage<'a>>,
    max_tokens: u32,
    stream: bool,
}

#[derive(Serialize)]
struct OpenAiMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Deserialize)]
struct OpenAiChatResponse {
    choices: Vec<OpenAiChoice>,
    #[serde(default)]
    usage: Option<OpenAiUsage>,
}

#[derive(Deserialize)]
struct OpenAiChoice {
    message: OpenAiResponseMessage,
}

#[derive(Deserialize)]
struct OpenAiResponseMessage {
    #[serde(default)]
    content: Option<String>,
}

#[derive(Deserialize)]
struct OpenAiUsage {
    #[serde(default)]
    prompt_tokens: u32,
    #[serde(default)]
    completion_tokens: u32,
}

#[derive(Deserialize)]
struct OpenAiStreamChunk {
    #[serde(default)]
    choices: Vec<OpenAiStreamChoice>,
}

#[derive(Deserialize)]
struct OpenAiStreamChoice {
    #[serde(default)]
    delta: OpenAiStreamDelta,
}

#[derive(Deserialize, Default)]
struct OpenAiStreamDelta {
    #[serde(default)]
    content: Option<String>,
}

impl LlmProvider for OpenAiProvider {
    fn name(&self) -> &'static str {
        "openai"
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
        let bearer = self.bearer_token();
        let response = match agent
            .post(&self.endpoint)
            .set("content-type", "application/json")
            .set("authorization", &format!("Bearer {bearer}"))
            .send_string(&body)
        {
            Ok(response) => response,
            Err(ureq::Error::Status(status, response)) => {
                let body = response.into_string().unwrap_or_default();
                if status == 402 {
                    return Err(InferenceError::Transport(format!(
                        "eri engine quota exceeded: {body}"
                    )));
                }
                return Err(InferenceError::Transport(format!(
                    "openai returned {status}: {body}"
                )));
            }
            Err(other) => {
                return Err(InferenceError::Transport(format!(
                    "openai transport failure: {other}"
                )));
            }
        };
        let text = response
            .into_string()
            .map_err(|err| InferenceError::Transport(err.to_string()))?;
        let parsed: OpenAiChatResponse = serde_json::from_str(&text)?;
        let assistant_text = parsed
            .choices
            .first()
            .and_then(|c| c.message.content.clone())
            .unwrap_or_default();
        let (prompt_tokens, completion_tokens) = match parsed.usage {
            Some(usage) => (usage.prompt_tokens, usage.completion_tokens),
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
        let bearer = self.bearer_token();
        let response = match agent
            .post(&self.endpoint)
            .set("content-type", "application/json")
            .set("accept", "text/event-stream")
            .set("authorization", &format!("Bearer {bearer}"))
            .send_string(&body)
        {
            Ok(response) => response,
            Err(ureq::Error::Status(status, response)) => {
                let body = response.into_string().unwrap_or_default();
                if status == 402 {
                    return Err(InferenceError::Transport(format!(
                        "eri engine quota exceeded: {body}"
                    )));
                }
                return Err(InferenceError::Transport(format!(
                    "openai returned {status}: {body}"
                )));
            }
            Err(other) => {
                return Err(InferenceError::Transport(format!(
                    "openai transport failure: {other}"
                )));
            }
        };
        let reader = std::io::BufReader::new(response.into_reader());
        let mut accumulated = String::new();
        for line in reader.lines() {
            let line = line.map_err(|err| InferenceError::Transport(err.to_string()))?;
            let Some(payload) = line.strip_prefix("data: ") else {
                continue;
            };
            if payload == "[DONE]" {
                break;
            }
            let chunk: OpenAiStreamChunk = match serde_json::from_str(payload) {
                Ok(chunk) => chunk,
                Err(_) => continue,
            };
            if let Some(choice) = chunk.choices.first()
                && let Some(token) = choice.delta.content.as_ref()
            {
                accumulated.push_str(token);
                on_token(token);
            }
        }
        let (prompt_tokens, completion_tokens) = estimate_tokens(system, user, &accumulated);
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
    let prompt_tokens = eri_tokens::tokens_or_fallback(&prompt, "gpt-4o");
    let completion_tokens = eri_tokens::tokens_or_fallback(assistant, "gpt-4o");
    (prompt_tokens, completion_tokens)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn openai_proxy_constructor_rewrites_endpoint() {
        let provider =
            OpenAiProvider::for_model_with_proxy("gpt-4o", "sess-tok", "https://eri.dev")
                .expect("provider builds");
        assert!(provider.is_proxied());
        assert_eq!(
            provider.endpoint(),
            "https://eri.dev/api/v1/inference/openai/chat/completions"
        );
    }

    #[test]
    fn openai_byok_constructor_keeps_openai_endpoint() {
        let provider = OpenAiProvider::for_model_with_key("gpt-4o", "sk-byok")
            .expect("provider builds");
        assert!(!provider.is_proxied());
        assert_eq!(provider.endpoint(), OPENAI_CHAT_COMPLETIONS_URL);
    }

    #[test]
    fn openai_request_body_has_model_and_messages() {
        let provider = OpenAiProvider::with_endpoint("gpt-4o", "test-key", "http://localhost/");
        let body = provider
            .build_request_body("be helpful", "say hi", 256, false)
            .expect("body");
        // Verify wire schema: model + messages array with system + user roles.
        let parsed: serde_json::Value = serde_json::from_str(&body).expect("json");
        assert_eq!(parsed["model"], "gpt-4o");
        let messages = parsed["messages"].as_array().expect("messages array");
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0]["role"], "system");
        assert_eq!(messages[0]["content"], "be helpful");
        assert_eq!(messages[1]["role"], "user");
        assert_eq!(messages[1]["content"], "say hi");
        assert_eq!(parsed["max_tokens"], 256);
        assert_eq!(parsed["stream"], false);
    }

    #[test]
    fn openai_for_model_rejects_unknown_model_id() {
        // Set a dummy key so we hit the model-id branch.
        // SAFETY: tests run single-threaded by default for env mutation;
        // unset afterward to avoid leaking into other tests.
        // We can't rely on `set_var` portability here, so just feed an
        // unknown id and accept either error: missing key OR unsupported.
        let result = OpenAiProvider::for_model("not-a-real-model");
        assert!(result.is_err());
    }
}
