//! Google Gemini provider — talks to
//! `/v1beta/models/<model>:streamGenerateContent`.
//!
//! Reads `GEMINI_API_KEY`. The Gemini wire format is fundamentally different
//! from OpenAI / Anthropic:
//! * Auth is via the `?key=` query parameter, not a header.
//! * The body has `contents: [{role, parts: [{text}]}]` instead of `messages`.
//! * System instruction goes in a top-level `systemInstruction` object.
//! * Streaming concatenates JSON arrays rather than SSE `data:` lines.

// Token counting routes through eri_tokens crate. See ERI_BLOAT_AUDIT.md.

use std::{io::Read, time::Duration};

use serde::{Deserialize, Serialize};

use crate::{
    InferenceError,
    costs::{
        GEMINI_FLASH_2_INPUT_PER_M, GEMINI_FLASH_2_OUTPUT_PER_M,
        GEMINI_FLASH_2_THINKING_INPUT_PER_M, GEMINI_FLASH_2_THINKING_OUTPUT_PER_M, cost_for,
    },
    llm_provider::{LlmProvider, LlmResponse},
};

const GEMINI_BASE_URL: &str = "https://generativelanguage.googleapis.com/v1beta/models";

/// Path under the eri.dev proxy base. The proxy mirrors Google's URL shape
/// (`/v1beta/models/<model>:<action>`) but is rooted at
/// `/api/v1/inference/google` so the backend can disambiguate routes.
const GEMINI_PROXY_PREFIX: &str = "/api/v1/inference/google/v1beta/models";

/// Auth mode for the Gemini transport. BYOK appends `?key=<api_key>` to the
/// upstream URL (Google's pattern); Proxy uses a bearer header against the
/// eri.dev URL.
#[derive(Debug, Clone)]
enum GeminiAuth {
    Byok { api_key: String },
    Proxy { session_token: String },
}

#[derive(Debug)]
pub struct GeminiProvider {
    model: String,
    auth: GeminiAuth,
    base_url: String,
    /// True when `base_url` is the eri.dev proxy prefix. Drives whether
    /// auth is a bearer header or a `?key=` query parameter.
    proxied: bool,
}

impl GeminiProvider {
    pub fn for_model(model: &str) -> Result<Self, InferenceError> {
        let _ = dotenvy::dotenv();
        // Accept either `GOOGLE_API_KEY` (matches the BYOK provider id used
        // by the extension's SecretStorage) or the legacy `GEMINI_API_KEY`.
        let api_key = std::env::var("GOOGLE_API_KEY")
            .or_else(|_| std::env::var("GEMINI_API_KEY"))
            .map_err(|_| InferenceError::Transport("GOOGLE_API_KEY not set".into()))?;
        Self::for_model_with_key(model, api_key)
    }

    /// Construct a Gemini provider with a pre-fetched API key. The sidecar
    /// uses this after a `settings/getSecret` round-trip so the key never
    /// has to live in the process env.
    pub fn for_model_with_key(
        model: &str,
        api_key: impl Into<String>,
    ) -> Result<Self, InferenceError> {
        if pricing_for(model).is_none() {
            return Err(InferenceError::Transport(format!(
                "unsupported gemini model: {model}"
            )));
        }
        Ok(Self {
            model: model.to_string(),
            auth: GeminiAuth::Byok {
                api_key: api_key.into(),
            },
            base_url: GEMINI_BASE_URL.to_string(),
            proxied: false,
        })
    }

    /// Route Gemini calls through the eri.dev inference proxy. The wire
    /// shape under the proxy mirrors Google's URL structure so the backend
    /// only has to rewrite host + auth.
    pub fn for_model_with_proxy(
        model: &str,
        session_token: impl Into<String>,
        base_url: &str,
    ) -> Result<Self, InferenceError> {
        if pricing_for(model).is_none() {
            return Err(InferenceError::Transport(format!(
                "unsupported gemini model: {model}"
            )));
        }
        Ok(Self {
            model: model.to_string(),
            auth: GeminiAuth::Proxy {
                session_token: session_token.into(),
            },
            base_url: format!("{}{}", base_url.trim_end_matches('/'), GEMINI_PROXY_PREFIX),
            proxied: true,
        })
    }

    pub fn is_proxied(&self) -> bool {
        self.proxied
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    #[cfg(test)]
    pub(crate) fn with_endpoint(model: &str, api_key: &str, base_url: &str) -> Self {
        Self {
            model: model.to_string(),
            auth: GeminiAuth::Byok {
                api_key: api_key.to_string(),
            },
            base_url: base_url.to_string(),
            proxied: false,
        }
    }

    pub(crate) fn build_request_body(
        &self,
        system: &str,
        user: &str,
        max_tokens: u32,
    ) -> Result<String, InferenceError> {
        let payload = GeminiRequest {
            system_instruction: GeminiContent {
                role: None,
                parts: vec![GeminiPart {
                    text: system.to_string(),
                }],
            },
            contents: vec![GeminiContent {
                role: Some("user".to_string()),
                parts: vec![GeminiPart {
                    text: user.to_string(),
                }],
            }],
            generation_config: GeminiGenerationConfig {
                max_output_tokens: max_tokens,
            },
        };
        serde_json::to_string(&payload).map_err(InferenceError::Json)
    }

    pub(crate) fn endpoint(&self, action: &str) -> String {
        match &self.auth {
            GeminiAuth::Byok { api_key } => format!(
                "{}/{}:{}?key={}",
                self.base_url.trim_end_matches('/'),
                self.model,
                action,
                api_key
            ),
            // Proxy: auth is in the Authorization header, NOT a query param.
            GeminiAuth::Proxy { .. } => format!(
                "{}/{}:{}",
                self.base_url.trim_end_matches('/'),
                self.model,
                action
            ),
        }
    }
}

fn pricing_for(model: &str) -> Option<(f64, f64)> {
    match model {
        "gemini-2.0-flash-exp" => Some((GEMINI_FLASH_2_INPUT_PER_M, GEMINI_FLASH_2_OUTPUT_PER_M)),
        "gemini-2.0-flash-thinking-exp" => Some((
            GEMINI_FLASH_2_THINKING_INPUT_PER_M,
            GEMINI_FLASH_2_THINKING_OUTPUT_PER_M,
        )),
        _ => None,
    }
}

#[derive(Serialize)]
struct GeminiRequest {
    #[serde(rename = "systemInstruction")]
    system_instruction: GeminiContent,
    contents: Vec<GeminiContent>,
    #[serde(rename = "generationConfig")]
    generation_config: GeminiGenerationConfig,
}

#[derive(Serialize, Deserialize)]
struct GeminiContent {
    #[serde(skip_serializing_if = "Option::is_none")]
    role: Option<String>,
    parts: Vec<GeminiPart>,
}

#[derive(Serialize, Deserialize)]
struct GeminiPart {
    text: String,
}

#[derive(Serialize)]
struct GeminiGenerationConfig {
    #[serde(rename = "maxOutputTokens")]
    max_output_tokens: u32,
}

#[derive(Deserialize)]
struct GeminiResponse {
    #[serde(default)]
    candidates: Vec<GeminiCandidate>,
    #[serde(default, rename = "usageMetadata")]
    usage_metadata: Option<GeminiUsage>,
}

#[derive(Deserialize)]
struct GeminiCandidate {
    #[serde(default)]
    content: Option<GeminiContent>,
}

#[derive(Deserialize)]
struct GeminiUsage {
    #[serde(default, rename = "promptTokenCount")]
    prompt_token_count: u32,
    #[serde(default, rename = "candidatesTokenCount")]
    candidates_token_count: u32,
}

impl LlmProvider for GeminiProvider {
    fn name(&self) -> &'static str {
        "google"
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
        let body = self.build_request_body(system, user, max_tokens)?;
        let endpoint = self.endpoint("generateContent");
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(5))
            .timeout(Duration::from_secs(300))
            .build();
        let request = agent
            .post(&endpoint)
            .set("content-type", "application/json");
        let request = match &self.auth {
            GeminiAuth::Byok { .. } => request,
            GeminiAuth::Proxy { session_token } => {
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
                    "gemini returned {status}: {body}"
                )));
            }
            Err(other) => {
                return Err(InferenceError::Transport(format!(
                    "gemini transport failure: {other}"
                )));
            }
        };
        let text = response
            .into_string()
            .map_err(|err| InferenceError::Transport(err.to_string()))?;
        let parsed: GeminiResponse = serde_json::from_str(&text)?;
        let assistant_text = collect_text(&parsed);
        let (prompt_tokens, completion_tokens) = match parsed.usage_metadata {
            Some(usage) => (usage.prompt_token_count, usage.candidates_token_count),
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
        let body = self.build_request_body(system, user, max_tokens)?;
        let endpoint = self.endpoint("streamGenerateContent");
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(5))
            .timeout(Duration::from_secs(300))
            .build();
        let request = agent
            .post(&endpoint)
            .set("content-type", "application/json");
        let request = match &self.auth {
            GeminiAuth::Byok { .. } => request,
            GeminiAuth::Proxy { session_token } => {
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
                    "gemini returned {status}: {body}"
                )));
            }
            Err(other) => {
                return Err(InferenceError::Transport(format!(
                    "gemini transport failure: {other}"
                )));
            }
        };
        // Gemini's stream endpoint returns a JSON array of response objects
        // (one per chunk). The simplest robust parse is: read the whole body
        // then deserialize as Vec<GeminiResponse>. The cost of buffering is
        // acceptable for our token budgets, and the alternative — incremental
        // JSON parsing — pulls in another dep.
        let mut buf = String::new();
        response
            .into_reader()
            .read_to_string(&mut buf)
            .map_err(|err| InferenceError::Transport(err.to_string()))?;
        let chunks: Vec<GeminiResponse> = serde_json::from_str(&buf)?;
        let mut accumulated = String::new();
        let mut prompt_tokens = 0u32;
        let mut completion_tokens = 0u32;
        for chunk in &chunks {
            let chunk_text = collect_text(chunk);
            if !chunk_text.is_empty() {
                accumulated.push_str(&chunk_text);
                on_token(&chunk_text);
            }
            if let Some(usage) = chunk.usage_metadata.as_ref() {
                prompt_tokens = usage.prompt_token_count;
                completion_tokens = usage.candidates_token_count;
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

fn collect_text(response: &GeminiResponse) -> String {
    let mut out = String::new();
    for candidate in &response.candidates {
        if let Some(content) = candidate.content.as_ref() {
            for part in &content.parts {
                out.push_str(&part.text);
            }
        }
    }
    out
}

fn estimate_tokens(system: &str, user: &str, assistant: &str) -> (u32, u32) {
    let prompt = format!("{system}\n{user}");
    let prompt_tokens = eri_tokens::tokens_or_fallback(&prompt, "gemini-2.0-flash");
    let completion_tokens = eri_tokens::tokens_or_fallback(assistant, "gemini-2.0-flash");
    (prompt_tokens, completion_tokens)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gemini_proxy_constructor_omits_query_key_and_marks_proxied() {
        let provider = GeminiProvider::for_model_with_proxy(
            "gemini-2.0-flash-exp",
            "sess-tok",
            "https://eri.dev",
        )
        .expect("provider builds");
        assert!(provider.is_proxied());
        let endpoint = provider.endpoint("streamGenerateContent");
        assert_eq!(
            endpoint,
            "https://eri.dev/api/v1/inference/google/v1beta/models/gemini-2.0-flash-exp:streamGenerateContent"
        );
        // The session bearer must NOT leak into the URL.
        assert!(!endpoint.contains("key="));
        assert!(!endpoint.contains("sess-tok"));
    }

    #[test]
    fn gemini_byok_constructor_uses_query_param_auth() {
        let provider =
            GeminiProvider::for_model_with_key("gemini-2.0-flash-exp", "key-123")
                .expect("provider builds");
        assert!(!provider.is_proxied());
        let endpoint = provider.endpoint("streamGenerateContent");
        assert!(endpoint.contains("?key=key-123"));
        assert!(endpoint.starts_with(GEMINI_BASE_URL));
    }

    #[test]
    fn gemini_request_body_has_contents_array() {
        let provider = GeminiProvider::with_endpoint(
            "gemini-2.0-flash-exp",
            "test-key",
            "http://localhost/v1beta/models",
        );
        let body = provider
            .build_request_body("be brief", "what is 2 plus 2", 64)
            .expect("body");
        let parsed: serde_json::Value = serde_json::from_str(&body).expect("json");
        // Gemini uses `contents` (array) + `systemInstruction` (object), not
        // `messages` or `system` at top level.
        let contents = parsed["contents"].as_array().expect("contents array");
        assert_eq!(contents.len(), 1);
        assert_eq!(contents[0]["role"], "user");
        let parts = contents[0]["parts"].as_array().expect("parts array");
        assert_eq!(parts.len(), 1);
        assert_eq!(parts[0]["text"], "what is 2 plus 2");
        // System instruction is at the top level under camelCase.
        let system_parts = parsed["systemInstruction"]["parts"]
            .as_array()
            .expect("systemInstruction parts");
        assert_eq!(system_parts[0]["text"], "be brief");
        assert_eq!(parsed["generationConfig"]["maxOutputTokens"], 64);
    }

    #[test]
    fn gemini_endpoint_includes_key_and_model() {
        let provider = GeminiProvider::with_endpoint(
            "gemini-2.0-flash-exp",
            "key-123",
            "http://localhost/v1beta/models",
        );
        let endpoint = provider.endpoint("streamGenerateContent");
        assert!(endpoint.contains("gemini-2.0-flash-exp"));
        assert!(endpoint.contains(":streamGenerateContent"));
        assert!(endpoint.contains("key=key-123"));
    }
}
