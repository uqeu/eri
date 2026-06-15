//! The provider-agnostic model-turn seam for the build/iterate loop.
//!
//! `build_agent`'s `drive_loop` used to be welded to one engine: it called
//! [`crate::build_agent::signed_in_client`] and streamed Claude's
//! `/api/v1/inference/messages` directly, so [`crate::ModelChoice::Local`] could
//! never reach the build loop — and the loop itself was untestable (every run
//! needed a signed-in cloud client).
//!
//! [`BuildTurn`] is the seam that fixes both, mirroring the control loop's
//! [`crate::control_turn::ControlTurn`]. It models exactly *one* turn of model
//! interaction — given the system blocks, the running messages, and the tool
//! specs, produce the assistant turn (content + tool calls + usage + stop
//! reason). The loop only ever sees this trait, so:
//!
//!   - [`ClaudeBuildTurn`] lifts today's cloud path byte-for-byte.
//!   - [`LocalBuildTurn`] drives eri's on-device tool-capable model (Qwen2.5 via
//!     the Ollama `/api/chat` tools API) — **$0, local-first**.
//!
//! Selection is **local-first** ([`select_build_turn`]): if eri's on-device
//! model is configured it answers first and the loop escalates to Claude only
//! when local can't. The build loop's machinery (tools, fs, hooks, subagents,
//! compaction) is unchanged; it sits *around* this seam.

use anyhow::{Result, anyhow};
use eri_agent::Turn;
use eri_agent::stream::ToolUse;
use serde_json::{Value, json};

use crate::build_agent::MAX_TOKENS;
use crate::control_turn::{parse_local_tool_calls, to_local_messages, to_local_tool_specs};

/// Outcome of asking an engine for one turn. `Halt` is a graceful, recoverable
/// stop (quota / capacity) — the loop returns a halted outcome preserving files
/// already written. `Hard` is a real failure — the loop escalates to the next
/// engine, or propagates if none remain.
#[derive(Debug)]
pub enum BuildTurnError {
    Halt(String),
    Hard(anyhow::Error),
}

impl std::fmt::Display for BuildTurnError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BuildTurnError::Halt(m) => write!(f, "{m}"),
            BuildTurnError::Hard(e) => write!(f, "{e}"),
        }
    }
}

/// One turn of model interaction for the build loop, abstracted over the engine.
/// Both adapters fill the same [`Turn`], so the loop never branches on which
/// engine answered.
#[async_trait::async_trait]
pub trait BuildTurn: Send + Sync {
    /// Engine label for telemetry / narration ("claude" / "local").
    fn engine(&self) -> &'static str;

    /// Run one turn. `Err(Halt)` = graceful stop, `Err(Hard)` = escalate/propagate.
    async fn run(
        &self,
        system: &[Value],
        messages: &[Value],
        tools: &Value,
    ) -> std::result::Result<Turn, BuildTurnError>;
}

// ---------------------------------------------------------------------------
// Claude adapter — lifts today's cloud path behind the seam, unchanged.
// ---------------------------------------------------------------------------

/// The cloud turn: streams Claude's `/api/v1/inference/messages` exactly as the
/// welded `drive_loop` used to (same request shaping, prompt-caching, graceful
/// quota halt). The default engine and the escalation target.
pub struct ClaudeBuildTurn {
    client: crate::client::Client,
    model: String,
    narrate: bool,
}

impl ClaudeBuildTurn {
    /// Build from signed-in credentials + a Claude model id. Errors if not
    /// signed in (same contract as the old loop).
    pub fn signed_in(model: impl Into<String>, narrate: bool) -> Result<Self> {
        Ok(Self {
            client: crate::build_agent::signed_in_client()?,
            model: model.into(),
            narrate,
        })
    }
}

#[async_trait::async_trait]
impl BuildTurn for ClaudeBuildTurn {
    fn engine(&self) -> &'static str {
        "claude"
    }

    async fn run(
        &self,
        system: &[Value],
        messages: &[Value],
        tools: &Value,
    ) -> std::result::Result<Turn, BuildTurnError> {
        // Identical request shaping + conversation cache to the original loop, so
        // the cloud behaviour is byte-for-byte preserved.
        let cached = eri_agent::request::with_conversation_cache(messages);
        let body =
            eri_agent::request::messages_body(&self.model, MAX_TOKENS, system, tools, &cached);
        let response = match self
            .client
            .post_stream("/api/v1/inference/messages", &body)
            .await
        {
            Ok(r) => r,
            Err(e) => {
                // A quota / capacity stop mid-build is recoverable: tools
                // materialise incrementally, so files already written are safe.
                if let Some(msg) = crate::build_agent::graceful_halt_message(&e) {
                    return Err(BuildTurnError::Halt(msg));
                }
                return Err(BuildTurnError::Hard(
                    crate::build_agent::friendly_proxy_error(e),
                ));
            }
        };
        let mut stdout = std::io::stdout();
        crate::build_agent::consume_turn(response, &mut stdout, self.narrate)
            .await
            .map_err(BuildTurnError::Hard)
    }
}

// ---------------------------------------------------------------------------
// Local adapter — eri's on-device tool-capable model (Qwen2.5 via Ollama chat).
// ---------------------------------------------------------------------------

/// Default on-device engine endpoint (Ollama-compatible). Override with
/// `ERI_LOCAL_URL`; mirrors the control adapter so both transports agree.
const DEFAULT_LOCAL_URL: &str = "http://localhost:11434";

/// The on-device build turn — drives a tool-capable small model through the
/// Ollama `/api/chat` tools API. **$0, local-first.** CandleTransport (in-process
/// GGUF) will later swap in behind this adapter without the loop changing.
pub struct LocalBuildTurn {
    base_url: String,
    model: String,
    client: reqwest::Client,
}

impl LocalBuildTurn {
    /// Build for `model` over `ERI_LOCAL_URL` (default localhost:11434). `None`
    /// for an empty model id; connectivity is checked lazily on first `run`.
    pub fn new(model: impl Into<String>) -> Option<Self> {
        let model = model.into();
        if model.trim().is_empty() {
            return None;
        }
        let base_url =
            std::env::var("ERI_LOCAL_URL").unwrap_or_else(|_| DEFAULT_LOCAL_URL.to_string());
        Some(Self {
            base_url,
            model,
            client: reqwest::Client::new(),
        })
    }

    fn endpoint(&self) -> String {
        format!("{}/api/chat", self.base_url.trim_end_matches('/'))
    }
}

#[async_trait::async_trait]
impl BuildTurn for LocalBuildTurn {
    fn engine(&self) -> &'static str {
        "local"
    }

    async fn run(
        &self,
        system: &[Value],
        messages: &[Value],
        tools: &Value,
    ) -> std::result::Result<Turn, BuildTurnError> {
        let body = json!({
            "model": self.model,
            "messages": to_local_messages(system, messages),
            "tools": to_local_tool_specs(tools),
            "stream": false,
            "options": { "num_predict": MAX_TOKENS },
        });
        let resp = self
            .client
            .post(self.endpoint())
            .json(&body)
            .send()
            .await
            .map_err(|e| {
                BuildTurnError::Hard(anyhow!(
                    "local engine unreachable at {} ({e}); is the on-device model running?",
                    self.base_url
                ))
            })?;
        let v: Value = resp
            .json()
            .await
            .map_err(|e| BuildTurnError::Hard(anyhow!("local engine sent invalid JSON: {e}")))?;
        let turn = build_local_turn(&v);
        // A turn with neither text nor tool calls is unusable — escalate.
        if turn.content.is_empty() {
            return Err(BuildTurnError::Hard(anyhow!(
                "local engine produced no usable turn"
            )));
        }
        Ok(turn)
    }
}

/// Shape an Ollama `/api/chat` response into the loop's [`Turn`]. Pure + tested
/// so the on-device build contract is verifiable without a running model: text +
/// tool_use blocks become `content`, tool calls become `tool_uses`, `stop_reason`
/// is `tool_use` when the model called tools (so the loop keeps iterating) else
/// `end_turn`, and token counts map from Ollama's eval counters.
pub fn build_local_turn(v: &Value) -> Turn {
    let message = v.get("message").cloned().unwrap_or_else(|| json!({}));
    let text = message
        .get("content")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let calls = parse_local_tool_calls(&message);

    let mut content: Vec<Value> = Vec::new();
    if !text.trim().is_empty() {
        content.push(json!({ "type": "text", "text": text }));
    }
    let tool_uses: Vec<ToolUse> = calls
        .into_iter()
        .map(|(id, name, input)| {
            // Borrow into the block so id/name/input stay owned for the ToolUse.
            content.push(json!({ "type": "tool_use", "id": &id, "name": &name, "input": &input }));
            ToolUse { id, name, input }
        })
        .collect();

    let stop_reason = Some(
        if tool_uses.is_empty() {
            "end_turn"
        } else {
            "tool_use"
        }
        .to_string(),
    );
    Turn {
        content,
        tool_uses,
        stop_reason,
        usage_in: v
            .get("prompt_eval_count")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        usage_out: v.get("eval_count").and_then(Value::as_u64).unwrap_or(0),
    }
}

// ---------------------------------------------------------------------------
// eri-brain adapter — eri's hosted, model-agnostic OpenAI-compatible engine.
// ---------------------------------------------------------------------------

/// Env var holding the *base* URL of eri's hosted brain (a vLLM OpenAI-compatible
/// server). When set, the eri-brain engine answers first and Claude is the
/// escalation. Model-agnostic: the URL is the only thing that points at a model.
pub const ERI_BRAIN_URL_ENV: &str = "ERI_BRAIN_URL";

/// Optional bearer token for the hosted brain (`vLLM --api-key`). Omitted when
/// the endpoint is unauthenticated (e.g. a private network or the eri.dev proxy
/// adds auth upstream).
pub const ERI_BRAIN_KEY_ENV: &str = "ERI_BRAIN_KEY";

/// Optional model id sent to the OpenAI endpoint. The served model is a deploy
/// choice; vLLM ignores/validates this, so a default keeps config minimal.
pub const ERI_BRAIN_MODEL_ENV: &str = "ERI_BRAIN_MODEL";

/// Default model label when `ERI_BRAIN_MODEL` is unset — purely a wire label, not
/// a code dependency on any particular model (the endpoint decides what's served).
const DEFAULT_ERI_BRAIN_MODEL: &str = "eri-brain";

/// eri's hosted brain as a build engine: speaks OpenAI `/v1/chat/completions` to
/// `ERI_BRAIN_URL`. The cheap first engine — handles most build turns at 0 Claude
/// tokens and surfaces a `Hard` error (so the loop escalates to Claude) when the
/// endpoint is unreachable or empty. A dumb executor: persona/memory arrive in
/// `system`/`messages` from the layer above.
pub struct EriBrainBuildTurn {
    endpoint: String,
    api_key: Option<String>,
    model: String,
    client: reqwest::Client,
}

impl EriBrainBuildTurn {
    /// Build from `ERI_BRAIN_URL` (+ optional `ERI_BRAIN_KEY`/`ERI_BRAIN_MODEL`).
    /// `None` when the URL is unset/blank, so selection cleanly falls back to the
    /// existing engines.
    pub fn from_env() -> Option<Self> {
        let url = std::env::var(ERI_BRAIN_URL_ENV).ok()?;
        let key = std::env::var(ERI_BRAIN_KEY_ENV).ok();
        let model = std::env::var(ERI_BRAIN_MODEL_ENV).ok();
        Self::new(&url, key.as_deref(), model.as_deref())
    }

    /// Env-free constructor — testable. `None` for a blank base URL.
    pub fn new(base_url: &str, api_key: Option<&str>, model: Option<&str>) -> Option<Self> {
        let base = base_url.trim();
        if base.is_empty() {
            return None;
        }
        let endpoint = format!(
            "{}{}",
            base.trim_end_matches('/'),
            crate::openai_turn::OPENAI_CHAT_PATH
        );
        let api_key = api_key
            .map(str::trim)
            .filter(|k| !k.is_empty())
            .map(str::to_string);
        let model = model
            .map(str::trim)
            .filter(|m| !m.is_empty())
            .unwrap_or(DEFAULT_ERI_BRAIN_MODEL)
            .to_string();
        Some(Self {
            endpoint,
            api_key,
            model,
            client: reqwest::Client::new(),
        })
    }
}

#[async_trait::async_trait]
impl BuildTurn for EriBrainBuildTurn {
    fn engine(&self) -> &'static str {
        "eri-brain"
    }

    async fn run(
        &self,
        system: &[Value],
        messages: &[Value],
        tools: &Value,
    ) -> std::result::Result<Turn, BuildTurnError> {
        // `stream:false` — the OpenAI decoder works on the assembled body, and the
        // build loop materialises tools per turn, so a single response is enough.
        let body = crate::openai_turn::build_request_body(
            &self.model,
            system,
            messages,
            tools,
            MAX_TOKENS,
            false,
        );
        let mut req = self.client.post(&self.endpoint).json(&body);
        if let Some(key) = &self.api_key {
            req = req.bearer_auth(key);
        }
        let resp = req.send().await.map_err(|e| {
            // Unreachable endpoint → Hard, so the loop escalates to Claude.
            BuildTurnError::Hard(anyhow!("eri-brain unreachable at {} ({e})", self.endpoint))
        })?;
        if !resp.status().is_success() {
            let status = resp.status();
            let detail = resp.text().await.unwrap_or_default();
            return Err(BuildTurnError::Hard(anyhow!(
                "eri-brain returned {status}: {detail}"
            )));
        }
        let v: Value = resp
            .json()
            .await
            .map_err(|e| BuildTurnError::Hard(anyhow!("eri-brain sent invalid JSON: {e}")))?;
        let turn = eri_brain_turn(&v);
        if turn.content.is_empty() {
            // No text and no tool calls is unusable — escalate to Claude.
            return Err(BuildTurnError::Hard(anyhow!(
                "eri-brain produced no usable turn"
            )));
        }
        Ok(turn)
    }
}

/// Shape a decoded OpenAI reply into the build loop's [`Turn`]. Pure + tested so
/// the eri-brain build contract is verifiable without a live endpoint: text +
/// tool_use blocks become `content`, tool calls become `tool_uses`, `stop_reason`
/// is `tool_use` when tools were called (so the loop iterates) else `end_turn`,
/// and usage maps from OpenAI's `prompt_tokens`/`completion_tokens`.
pub fn eri_brain_turn(v: &Value) -> Turn {
    let parsed = crate::openai_turn::parse_openai_response(v);
    let mut content: Vec<Value> = Vec::new();
    if !parsed.text.trim().is_empty() {
        content.push(json!({ "type": "text", "text": parsed.text }));
    }
    let tool_uses: Vec<ToolUse> = parsed
        .tool_calls
        .into_iter()
        .map(|(id, name, input)| {
            content.push(json!({ "type": "tool_use", "id": &id, "name": &name, "input": &input }));
            ToolUse { id, name, input }
        })
        .collect();
    let stop_reason = Some(
        if tool_uses.is_empty() {
            "end_turn"
        } else {
            "tool_use"
        }
        .to_string(),
    );
    Turn {
        content,
        tool_uses,
        stop_reason,
        usage_in: parsed.usage_in,
        usage_out: parsed.usage_out,
    }
}

// ---------------------------------------------------------------------------
// Local-first selection.
// ---------------------------------------------------------------------------

/// Choose the build engines in escalation order. When eri's hosted brain is
/// configured (`ERI_BRAIN_URL`) it answers **first** (the cheap engine); the
/// on-device model (`ERI_LOCAL_MODEL`) follows if set; Claude is always the final
/// escalation. With nothing extra configured, behaviour is unchanged (Claude
/// alone). Errors only when *no* engine can be built.
pub fn select_build_turn(model: &str, narrate: bool) -> Result<Vec<Box<dyn BuildTurn>>> {
    let local = std::env::var("ERI_LOCAL_MODEL")
        .ok()
        .map(|m| m.trim().to_string())
        .filter(|m| !m.is_empty());
    select_build_turn_with(
        EriBrainBuildTurn::from_env(),
        local.as_deref(),
        model,
        narrate,
    )
}

/// Env-free core of [`select_build_turn`] — testable without global state.
/// Engine order: eri-brain (if any) → local (if any) → Claude (fallback).
pub fn select_build_turn_with(
    eri_brain: Option<EriBrainBuildTurn>,
    local_model: Option<&str>,
    model: &str,
    narrate: bool,
) -> Result<Vec<Box<dyn BuildTurn>>> {
    let mut engines: Vec<Box<dyn BuildTurn>> = Vec::new();
    // eri-brain is the cheap first engine when configured.
    if let Some(brain) = eri_brain {
        engines.push(Box::new(brain));
    }
    if let Some(m) = local_model.filter(|m| !m.trim().is_empty())
        && let Some(lt) = LocalBuildTurn::new(m)
    {
        engines.push(Box::new(lt));
    }
    match ClaudeBuildTurn::signed_in(model, narrate) {
        Ok(ct) => engines.push(Box::new(ct)),
        Err(e) if engines.is_empty() => return Err(e),
        Err(_) => {}
    }
    if engines.is_empty() {
        return Err(anyhow!(
            "no build engine available — sign in (`eri auth login`), set ERI_BRAIN_URL, or set ERI_LOCAL_MODEL"
        ));
    }
    Ok(engines)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_local_turn_maps_text_only_to_end_turn() {
        let v = json!({
            "message": { "role": "assistant", "content": "all done, 12 tests pass" },
            "prompt_eval_count": 40,
            "eval_count": 9,
        });
        let turn = build_local_turn(&v);
        assert_eq!(turn.stop_reason.as_deref(), Some("end_turn"));
        assert!(turn.tool_uses.is_empty());
        assert_eq!(turn.content.len(), 1);
        assert_eq!(turn.content[0]["type"], "text");
        assert_eq!(turn.usage_in, 40);
        assert_eq!(turn.usage_out, 9);
    }

    #[test]
    fn build_local_turn_maps_tool_calls_to_tool_use_stop() {
        let v = json!({
            "message": {
                "role": "assistant",
                "content": "writing the file",
                "tool_calls": [
                    { "function": { "name": "write_file", "arguments": { "path": "a.ts", "content": "x" } } }
                ]
            },
            "prompt_eval_count": 12,
            "eval_count": 5,
        });
        let turn = build_local_turn(&v);
        assert_eq!(turn.stop_reason.as_deref(), Some("tool_use"));
        assert_eq!(turn.tool_uses.len(), 1);
        assert_eq!(turn.tool_uses[0].name, "write_file");
        assert_eq!(turn.tool_uses[0].id, "local-0");
        // content carries the text block + the tool_use block.
        assert_eq!(turn.content.len(), 2);
        assert_eq!(turn.content[1]["type"], "tool_use");
    }

    #[test]
    fn build_local_turn_empty_message_yields_empty_content() {
        let turn = build_local_turn(&json!({ "message": { "content": "" } }));
        assert!(turn.content.is_empty());
        assert!(turn.tool_uses.is_empty());
    }

    /// A scripted stub engine — proves the seam is engine-agnostic + drives the
    /// loop's escalation tests (in build_agent) without a network.
    struct StubBuildTurn {
        label: &'static str,
        result: std::sync::Mutex<Option<std::result::Result<Turn, BuildTurnError>>>,
    }

    #[async_trait::async_trait]
    impl BuildTurn for StubBuildTurn {
        fn engine(&self) -> &'static str {
            self.label
        }
        async fn run(
            &self,
            _s: &[Value],
            _m: &[Value],
            _t: &Value,
        ) -> std::result::Result<Turn, BuildTurnError> {
            self.result
                .lock()
                .unwrap()
                .take()
                .unwrap_or_else(|| Err(BuildTurnError::Hard(anyhow!("stub exhausted"))))
        }
    }

    #[test]
    fn eri_brain_turn_maps_text_only_to_end_turn() {
        let v = json!({
            "choices": [ { "message": { "role": "assistant", "content": "all done, tests pass" } } ],
            "usage": { "prompt_tokens": 40, "completion_tokens": 9 }
        });
        let turn = eri_brain_turn(&v);
        assert_eq!(turn.stop_reason.as_deref(), Some("end_turn"));
        assert!(turn.tool_uses.is_empty());
        assert_eq!(turn.content.len(), 1);
        assert_eq!(turn.content[0]["type"], "text");
        assert_eq!(turn.usage_in, 40);
        assert_eq!(turn.usage_out, 9);
    }

    #[test]
    fn eri_brain_turn_maps_tool_calls_to_tool_use_stop() {
        let v = json!({
            "choices": [ {
                "message": {
                    "role": "assistant",
                    "content": "writing the file",
                    "tool_calls": [ {
                        "id": "call_1",
                        "type": "function",
                        "function": { "name": "write_file", "arguments": "{\"path\":\"a.ts\",\"content\":\"x\"}" }
                    } ]
                }
            } ],
            "usage": { "prompt_tokens": 12, "completion_tokens": 5 }
        });
        let turn = eri_brain_turn(&v);
        assert_eq!(turn.stop_reason.as_deref(), Some("tool_use"));
        assert_eq!(turn.tool_uses.len(), 1);
        assert_eq!(turn.tool_uses[0].name, "write_file");
        assert_eq!(turn.tool_uses[0].id, "call_1");
        assert_eq!(
            turn.tool_uses[0].input,
            json!({ "path": "a.ts", "content": "x" })
        );
        // content carries the text block + the tool_use block.
        assert_eq!(turn.content.len(), 2);
        assert_eq!(turn.content[1]["type"], "tool_use");
        assert_eq!(turn.usage_in, 12);
        assert_eq!(turn.usage_out, 5);
    }

    #[test]
    fn eri_brain_turn_empty_response_yields_empty_content() {
        let turn = eri_brain_turn(&json!({ "choices": [] }));
        assert!(turn.content.is_empty());
        assert!(turn.tool_uses.is_empty());
    }

    #[test]
    fn eri_brain_is_first_engine_when_configured() {
        // When ERI_BRAIN_URL is set, the hosted brain leads the escalation order.
        let brain = EriBrainBuildTurn::new("https://brain.eri.dev", None, None);
        assert!(brain.is_some());
        let engines = select_build_turn_with(brain, None, "claude-sonnet-4-6", false)
            .expect("eri-brain is always buildable");
        assert_eq!(engines[0].engine(), "eri-brain");
    }

    #[test]
    fn eri_brain_precedes_local_when_both_configured() {
        // Both Local and eri-brain configured → eri-brain first, local next.
        let brain = EriBrainBuildTurn::new("https://brain.eri.dev", Some("k"), Some("qwen3"));
        let engines =
            select_build_turn_with(brain, Some("qwen2.5:1.5b"), "claude-sonnet-4-6", false)
                .expect("buildable");
        assert_eq!(engines[0].engine(), "eri-brain");
        assert_eq!(engines[1].engine(), "local");
    }

    #[test]
    fn claude_only_when_nothing_extra_is_configured() {
        // No eri-brain, no local → behaviour is unchanged. Selection either
        // returns Claude (signed in) or errors (not signed in) — never a phantom
        // eri-brain/local engine.
        if let Ok(engines) = select_build_turn_with(None, None, "claude-sonnet-4-6", false) {
            assert_eq!(engines[0].engine(), "claude");
            assert_eq!(engines.len(), 1);
        }
    }

    #[test]
    fn blank_eri_brain_url_yields_no_engine() {
        assert!(EriBrainBuildTurn::new("   ", None, None).is_none());
        assert!(EriBrainBuildTurn::new("", Some("k"), Some("m")).is_none());
    }

    #[tokio::test]
    async fn stub_engine_satisfies_the_seam() {
        let stub = StubBuildTurn {
            label: "stub",
            result: std::sync::Mutex::new(Some(Ok(Turn {
                content: vec![json!({ "type": "text", "text": "hi" })],
                tool_uses: vec![],
                stop_reason: Some("end_turn".into()),
                usage_in: 1,
                usage_out: 1,
            }))),
        };
        assert_eq!(stub.engine(), "stub");
        let out = stub.run(&[], &[], &json!([])).await.expect("ok");
        assert_eq!(out.stop_reason.as_deref(), Some("end_turn"));
    }
}
