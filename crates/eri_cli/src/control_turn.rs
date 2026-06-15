//! The provider-agnostic model-turn seam for the computer-control loop.
//!
//! `control_agent`'s reasoning loop used to be welded to one engine: it called
//! [`crate::build_agent::signed_in_client`] and streamed Claude's
//! `/api/v1/inference/messages` directly, so [`crate::ModelChoice::Local`] could
//! never reach computer-use — and the loop itself was untestable (every run
//! needed a signed-in cloud client).
//!
//! [`ControlTurn`] is the seam that fixes both. It models exactly *one* turn of
//! model interaction — given the system blocks, the running message list, and
//! the tool specs, produce the assistant's text + the tool calls it wants. The
//! loop only ever sees this trait, so:
//!
//!   - [`ClaudeControlTurn`] lifts today's cloud path unchanged.
//!   - [`LocalControlTurn`] drives eri's on-device tool-capable model (Qwen2.5
//!     via the Ollama `/api/chat` tools API) — **$0, local-first**.
//!
//! Selection is **local-first per goal** ([`select_control_turn`]): if eri's
//! on-device model is configured it answers first, and the loop escalates to
//! Claude only when local can't. Everything that wraps a turn — the gate,
//! cancellation/feasibility prelude, the stuck-guard — is unchanged; they sit
//! *around* this seam.

use anyhow::{Result, anyhow};
use serde_json::{Value, json};

/// What one model turn produced for the control loop. Engine-agnostic: both the
/// Claude and the local adapter fill the same shape, so the loop never branches
/// on which engine answered.
/// Cloud token usage for one model turn (input + output). Local/on-device turns
/// are `$0`, so they leave this at the default zero — only cloud (Claude) turns
/// populate it. Summed across a control run so remote compute can be metered the
/// same as any other eri-token spend (review M4).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct TokenUsage {
    pub input: u64,
    pub output: u64,
}

impl std::ops::AddAssign for TokenUsage {
    fn add_assign(&mut self, rhs: Self) {
        self.input += rhs.input;
        self.output += rhs.output;
    }
}

#[derive(Clone, Debug, Default)]
pub struct TurnOutput {
    /// Raw assistant `content` block array, appended verbatim to the running
    /// message list (so the next turn sees a faithful transcript).
    pub assistant_content: Value,
    /// Assistant free text — the running summary + what gets narrated.
    pub text: String,
    /// Tool calls the model wants executed, as `(id, name, input)` — the exact
    /// tuple [`crate::control_agent::execute_tool_calls`] consumes.
    pub tool_calls: Vec<(String, String, Value)>,
    /// True when the model stopped to call tools (Anthropic `stop_reason ==
    /// "tool_use"`, or the local model emitted tool calls). False = it's done
    /// talking and the loop should return its text.
    pub wants_tools: bool,
    /// Cloud tokens this turn cost ($0 for local turns — left zero).
    pub usage: TokenUsage,
}

/// One turn of model interaction, abstracted over the engine behind it. The
/// control loop drives a `&dyn ControlTurn`; the concrete adapter owns its own
/// transport (cloud HTTP vs on-device) and any streaming side effects.
#[async_trait::async_trait]
pub trait ControlTurn: Send + Sync {
    /// Engine label for telemetry + the self-improvement log ("claude"/"local").
    fn engine(&self) -> &'static str;

    /// Run one turn against the given system blocks, running `messages`, and
    /// `tools` spec. Errors surface so the loop can escalate (local → cloud).
    async fn run(&self, system: &[Value], messages: &[Value], tools: &Value) -> Result<TurnOutput>;
}

/// Parse a local model's `/api/chat` tool-call array into the loop's
/// `(id, name, input)` tuples. Ollama returns
/// `message.tool_calls[].function.{name, arguments}` where `arguments` is an
/// object (already-parsed JSON). Tool-call ids are synthesised positionally
/// (`local-0`, …) since the local API doesn't assign them. Pure + tested so the
/// on-device tool-use contract can't silently drift.
pub fn parse_local_tool_calls(message: &Value) -> Vec<(String, String, Value)> {
    let Some(calls) = message.get("tool_calls").and_then(Value::as_array) else {
        return Vec::new();
    };
    calls
        .iter()
        .enumerate()
        .filter_map(|(i, call)| {
            let func = call.get("function")?;
            let name = func.get("name").and_then(Value::as_str)?.to_string();
            // `arguments` may arrive as an object or as a JSON string — accept both.
            let input = match func.get("arguments") {
                Some(Value::String(s)) => serde_json::from_str(s).unwrap_or_else(|_| json!({})),
                Some(obj) => obj.clone(),
                None => json!({}),
            };
            // Small models pick the right tool but often the wrong argument KEY;
            // normalise to the spec's canonical keys before the strict shared
            // parser sees them.
            let input = normalise_local_args(&name, &input);
            Some((format!("local-{i}"), name, input))
        })
        .collect()
}

/// Per-tool alias map: the spec's canonical key, and the keys small models tend
/// to emit instead. Order = preference; first present alias wins.
fn local_arg_aliases(tool: &str) -> &'static [(&'static str, &'static [&'static str])] {
    match tool {
        "open_app" | "quit_app" => &[(
            "name",
            &["app_name", "application", "app", "appname", "app_name"],
        )],
        "type" => &[("text", &["string", "value", "content", "input", "txt"])],
        "key" => &[(
            "combo",
            &["key", "keys", "shortcut", "combination", "hotkey"],
        )],
        "click" => &[("element", &["id", "target", "element_id", "elementid"])],
        "wait" => &[("ms", &["milliseconds", "duration", "time", "millis"])],
        _ => &[],
    }
}

/// Rewrite a local tool call's arguments to the spec's canonical keys. This is
/// the seam that absorbs small-model sloppiness (`{"app_name":"Safari"}` →
/// `{"name":"Safari"}`) so the strict, cloud-shared [`crate::control_agent::parse_action`]
/// stays strict. Pure + table-driven: only renames a canonical key that's
/// MISSING, taking the first alias present; everything else passes through.
pub fn normalise_local_args(tool: &str, input: &Value) -> Value {
    let Some(obj) = input.as_object() else {
        return input.clone();
    };
    let mut out = obj.clone();
    for (canonical, alts) in local_arg_aliases(tool) {
        if out.contains_key(*canonical) {
            continue;
        }
        for alias in *alts {
            if let Some(v) = out.remove(*alias) {
                out.insert((*canonical).to_string(), v);
                break;
            }
        }
    }
    Value::Object(out)
}

/// Translate eri's Anthropic-style tool specs ([`crate::control_agent::tool_specs`])
/// into the Ollama `/api/chat` `tools` shape: `{type:"function", function:{name,
/// description, parameters}}`. The schemas are identical (`input_schema` →
/// `parameters`); only the envelope differs. Pure + tested.
pub fn to_local_tool_specs(anthropic_tools: &Value) -> Value {
    let Some(arr) = anthropic_tools.as_array() else {
        return json!([]);
    };
    let mapped: Vec<Value> = arr
        .iter()
        .filter_map(|t| {
            let name = t.get("name")?;
            let description = t.get("description").cloned().unwrap_or(json!(""));
            let parameters = t
                .get("input_schema")
                .cloned()
                .unwrap_or_else(|| json!({ "type": "object", "properties": {} }));
            Some(json!({
                "type": "function",
                "function": { "name": name, "description": description, "parameters": parameters },
            }))
        })
        .collect();
    json!(mapped)
}

/// Build the assistant `content` block array for a local turn so the running
/// transcript stays faithful (text first, then one `tool_use` block per call —
/// the same shape Claude emits, so [`crate::control_agent`] needs no special
/// case downstream).
pub fn local_assistant_content(text: &str, tool_calls: &[(String, String, Value)]) -> Value {
    let mut blocks: Vec<Value> = Vec::new();
    if !text.trim().is_empty() {
        blocks.push(json!({ "type": "text", "text": text }));
    }
    for (id, name, input) in tool_calls {
        blocks.push(json!({
            "type": "tool_use", "id": id, "name": name, "input": input,
        }));
    }
    json!(blocks)
}

/// Error helper: the local engine produced an unusable turn (unreachable, or no
/// text and no tool calls). The loop treats this as the signal to escalate.
pub(crate) fn empty_local_turn() -> anyhow::Error {
    anyhow!("local engine produced no usable turn")
}

// ---------------------------------------------------------------------------
// Claude adapter — lifts today's cloud path behind the seam, unchanged.
// ---------------------------------------------------------------------------

/// The cloud turn: streams Claude's `/api/v1/inference/messages` exactly as the
/// welded loop used to. This is the default engine and the escalation target.
pub struct ClaudeControlTurn {
    client: crate::client::Client,
    model: String,
}

impl ClaudeControlTurn {
    /// Build from the signed-in credentials + a Claude model id. Errors if the
    /// user isn't signed in (same contract as the old loop).
    pub fn signed_in(model: impl Into<String>) -> Result<Self> {
        Ok(Self {
            client: crate::build_agent::signed_in_client()?,
            model: model.into(),
        })
    }
}

#[async_trait::async_trait]
impl ControlTurn for ClaudeControlTurn {
    fn engine(&self) -> &'static str {
        "claude"
    }

    async fn run(&self, system: &[Value], messages: &[Value], tools: &Value) -> Result<TurnOutput> {
        // Identical request shaping + prompt-caching to the original loop, so
        // the cloud behaviour is byte-for-byte preserved.
        let cached = eri_agent::request::with_conversation_cache(messages);
        let body = eri_agent::request::messages_body(
            &self.model,
            crate::build_agent::MAX_TOKENS,
            system,
            tools,
            &cached,
        );
        let response = self
            .client
            .post_stream("/api/v1/inference/messages", &body)
            .await
            .map_err(crate::build_agent::friendly_proxy_error)?;
        let mut stdout = std::io::stdout();
        let turn = crate::build_agent::consume_turn(response, &mut stdout, true).await?;
        let text = eri_agent::stream::assistant_text(&turn.content);
        Ok(TurnOutput {
            assistant_content: json!(turn.content),
            tool_calls: turn
                .tool_uses
                .iter()
                .map(|t| (t.id.clone(), t.name.clone(), t.input.clone()))
                .collect(),
            wants_tools: turn.stop_reason.as_deref() == Some("tool_use"),
            text,
            usage: TokenUsage {
                input: turn.usage_in,
                output: turn.usage_out,
            },
        })
    }
}

// ---------------------------------------------------------------------------
// Local adapter — eri's on-device tool-capable model (Qwen2.5 via Ollama chat).
// ---------------------------------------------------------------------------

/// Default on-device engine endpoint (Ollama-compatible). Override with
/// `ERI_LOCAL_URL`; mirrors [`crate`]'s local provider so both transports agree.
const DEFAULT_LOCAL_URL: &str = "http://localhost:11434";

/// The on-device turn: drives a tool-capable small model through the Ollama
/// `/api/chat` tools API — **$0, local-first**. Qwen2.5 supports function
/// calling, so it can request the same control tools Claude does; the loop can't
/// tell the difference. CandleTransport (in-process GGUF) will later swap in
/// behind this same adapter without the loop changing.
pub struct LocalControlTurn {
    base_url: String,
    model: String,
    max_tokens: u32,
    client: reqwest::Client,
}

impl LocalControlTurn {
    /// Build for `model` over `ERI_LOCAL_URL` (default localhost:11434). `None`
    /// for an empty model id — connectivity is checked lazily on first `run`.
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
            max_tokens: crate::build_agent::MAX_TOKENS,
            client: reqwest::Client::new(),
        })
    }

    fn endpoint(&self) -> String {
        format!("{}/api/chat", self.base_url.trim_end_matches('/'))
    }
}

#[async_trait::async_trait]
impl ControlTurn for LocalControlTurn {
    fn engine(&self) -> &'static str {
        "local"
    }

    async fn run(&self, system: &[Value], messages: &[Value], tools: &Value) -> Result<TurnOutput> {
        let body = json!({
            "model": self.model,
            "messages": to_local_messages(system, messages),
            "tools": to_local_tool_specs(tools),
            "stream": false,
            "options": { "num_predict": self.max_tokens },
        });
        let resp = self
            .client
            .post(self.endpoint())
            .json(&body)
            .send()
            .await
            .map_err(|e| {
                anyhow!(
                    "local engine unreachable at {} ({e}); is the on-device model running?",
                    self.base_url
                )
            })?;
        let v: Value = resp
            .json()
            .await
            .map_err(|e| anyhow!("local engine sent invalid JSON: {e}"))?;
        let message = v.get("message").cloned().unwrap_or_else(|| json!({}));
        let text = message
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let tool_calls = parse_local_tool_calls(&message);
        // A turn with neither text nor tool calls is unusable — signal escalation.
        if text.trim().is_empty() && tool_calls.is_empty() {
            return Err(empty_local_turn());
        }
        Ok(TurnOutput {
            assistant_content: local_assistant_content(&text, &tool_calls),
            wants_tools: !tool_calls.is_empty(),
            tool_calls,
            text,
            // On-device turns are $0 — no cloud tokens to meter.
            usage: TokenUsage::default(),
        })
    }
}

/// Convert eri's Anthropic-style transcript (system blocks + message list) into
/// the flat Ollama `/api/chat` message array: a leading `system` message, then
/// each turn as `{role, content}` with assistant `tool_calls` and `tool_result`
/// blocks lowered to `role:"tool"` messages. Pure + tested so the on-device
/// contract is verifiable without a running model.
pub fn to_local_messages(system: &[Value], messages: &[Value]) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    let system_text = join_block_text(system);
    if !system_text.trim().is_empty() {
        out.push(json!({ "role": "system", "content": system_text }));
    }
    for msg in messages {
        let role = msg.get("role").and_then(Value::as_str).unwrap_or("user");
        match msg.get("content") {
            Some(Value::String(s)) => out.push(json!({ "role": role, "content": s })),
            Some(Value::Array(blocks)) => lower_blocks(role, blocks, &mut out),
            _ => {}
        }
    }
    out
}

/// Lower one Anthropic content-block array into Ollama messages.
fn lower_blocks(role: &str, blocks: &[Value], out: &mut Vec<Value>) {
    let mut text = String::new();
    let mut tool_calls: Vec<Value> = Vec::new();
    for b in blocks {
        match b.get("type").and_then(Value::as_str) {
            Some("text") => {
                if let Some(t) = b.get("text").and_then(Value::as_str) {
                    if !text.is_empty() {
                        text.push('\n');
                    }
                    text.push_str(t);
                }
            }
            Some("tool_use") => {
                let name = b.get("name").and_then(Value::as_str).unwrap_or("");
                let input = b.get("input").cloned().unwrap_or_else(|| json!({}));
                tool_calls.push(json!({ "function": { "name": name, "arguments": input } }));
            }
            // A user tool_result block becomes a `tool` message carrying the
            // result text, so the local model sees what each action returned.
            Some("tool_result") => {
                out.push(json!({ "role": "tool", "content": tool_result_text(b) }));
            }
            _ => {}
        }
    }
    if !text.is_empty() || !tool_calls.is_empty() {
        let mut m = json!({ "role": role, "content": text });
        if !tool_calls.is_empty() {
            m["tool_calls"] = json!(tool_calls);
        }
        out.push(m);
    }
}

/// Best-effort plain text out of a `tool_result` block (string or block array).
fn tool_result_text(block: &Value) -> String {
    match block.get("content") {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|p| p.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

/// Public re-export of [`join_block_text`] for the OpenAI adapter, which lowers
/// the same system blocks into an OpenAI `system` message. Keeps one definition.
pub fn join_block_text_pub(blocks: &[Value]) -> String {
    join_block_text(blocks)
}

/// Public re-export of [`tool_result_text`] for the OpenAI adapter, which lowers
/// `tool_result` blocks into OpenAI `tool` messages with the same flattening.
pub fn tool_result_text_pub(block: &Value) -> String {
    tool_result_text(block)
}

/// Concatenate the `text` of a block array (used for system blocks).
fn join_block_text(blocks: &[Value]) -> String {
    blocks
        .iter()
        .filter_map(|b| b.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("\n\n")
}

// ---------------------------------------------------------------------------
// eri-brain adapter — eri's hosted, model-agnostic OpenAI-compatible engine.
// ---------------------------------------------------------------------------

/// eri's hosted brain as a control engine: speaks OpenAI `/v1/chat/completions`
/// to `ERI_BRAIN_URL`. The cheap first engine for the control loop — handles most
/// goals at 0 Claude tokens and errors (so the loop escalates to Claude) when the
/// endpoint is unreachable or empty. A dumb executor: persona/memory arrive in
/// `system`/`messages` from the layer above. Env vars are shared with the build
/// adapter ([`crate::build_turn::ERI_BRAIN_URL_ENV`] etc.) so one config drives
/// both loops.
pub struct EriBrainControlTurn {
    endpoint: String,
    api_key: Option<String>,
    model: String,
    max_tokens: u32,
    client: reqwest::Client,
}

impl EriBrainControlTurn {
    /// Build from `ERI_BRAIN_URL` (+ optional `ERI_BRAIN_KEY`/`ERI_BRAIN_MODEL`).
    /// `None` when the URL is unset/blank, so selection falls back cleanly.
    pub fn from_env() -> Option<Self> {
        let url = std::env::var(crate::build_turn::ERI_BRAIN_URL_ENV).ok()?;
        let key = std::env::var(crate::build_turn::ERI_BRAIN_KEY_ENV).ok();
        let model = std::env::var(crate::build_turn::ERI_BRAIN_MODEL_ENV).ok();
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
            .unwrap_or("eri-brain")
            .to_string();
        Some(Self {
            endpoint,
            api_key,
            model,
            max_tokens: crate::build_agent::MAX_TOKENS,
            client: reqwest::Client::new(),
        })
    }
}

#[async_trait::async_trait]
impl ControlTurn for EriBrainControlTurn {
    fn engine(&self) -> &'static str {
        "eri-brain"
    }

    async fn run(&self, system: &[Value], messages: &[Value], tools: &Value) -> Result<TurnOutput> {
        let body = crate::openai_turn::build_request_body(
            &self.model,
            system,
            messages,
            tools,
            self.max_tokens,
            false,
        );
        let mut req = self.client.post(&self.endpoint).json(&body);
        if let Some(key) = &self.api_key {
            req = req.bearer_auth(key);
        }
        let resp = req
            .send()
            .await
            .map_err(|e| anyhow!("eri-brain unreachable at {} ({e})", self.endpoint))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let detail = resp.text().await.unwrap_or_default();
            return Err(anyhow!("eri-brain returned {status}: {detail}"));
        }
        let v: Value = resp
            .json()
            .await
            .map_err(|e| anyhow!("eri-brain sent invalid JSON: {e}"))?;
        let parsed = crate::openai_turn::parse_openai_response(&v);
        // A turn with neither text nor tool calls is unusable — signal escalation.
        if parsed.text.trim().is_empty() && parsed.tool_calls.is_empty() {
            return Err(empty_local_turn());
        }
        Ok(TurnOutput {
            assistant_content: local_assistant_content(&parsed.text, &parsed.tool_calls),
            wants_tools: parsed.wants_tools(),
            tool_calls: parsed.tool_calls,
            text: parsed.text,
            usage: TokenUsage {
                input: parsed.usage_in,
                output: parsed.usage_out,
            },
        })
    }
}

// ---------------------------------------------------------------------------
// Local-first selection.
// ---------------------------------------------------------------------------

/// Choose the control engines for a goal in escalation order. When eri's hosted
/// brain is configured (`ERI_BRAIN_URL`) it answers **first** (the cheap engine);
/// the on-device model (`ERI_LOCAL_MODEL`) follows if set; Claude is always the
/// final escalation. With nothing extra configured, behaviour is unchanged
/// (Claude alone). Errors only if *no* engine can be built.
pub fn select_control_turn(model: &str) -> Result<Vec<Box<dyn ControlTurn>>> {
    let local = std::env::var("ERI_LOCAL_MODEL")
        .ok()
        .map(|m| m.trim().to_string())
        .filter(|m| !m.is_empty());
    select_control_turn_with(EriBrainControlTurn::from_env(), local.as_deref(), model)
}

/// Env-free core of [`select_control_turn`] — testable without touching global
/// state. Engine order: eri-brain (if any) → local (if any) → Claude (fallback).
pub fn select_control_turn_with(
    eri_brain: Option<EriBrainControlTurn>,
    local_model: Option<&str>,
    model: &str,
) -> Result<Vec<Box<dyn ControlTurn>>> {
    let mut engines: Vec<Box<dyn ControlTurn>> = Vec::new();
    // eri-brain is the cheap first engine when configured.
    if let Some(brain) = eri_brain {
        engines.push(Box::new(brain));
    }
    if let Some(m) = local_model.filter(|m| !m.trim().is_empty())
        && let Some(lt) = LocalControlTurn::new(m)
    {
        engines.push(Box::new(lt));
    }
    // Claude is the escalation/default. If sign-in fails but we already have a
    // earlier engine, that's fine; only error when nothing is left.
    match ClaudeControlTurn::signed_in(model) {
        Ok(ct) => engines.push(Box::new(ct)),
        Err(e) if engines.is_empty() => return Err(e),
        Err(_) => {}
    }
    if engines.is_empty() {
        return Err(anyhow!(
            "no control engine available — sign in (`eri auth login`), set ERI_BRAIN_URL, or set ERI_LOCAL_MODEL"
        ));
    }
    Ok(engines)
}

// ---------------------------------------------------------------------------
// Self-improvement instrumentation — every control turn is recorded.
// ---------------------------------------------------------------------------

/// A structured record of one control turn for eri's self-improvement log:
/// which engine ran, on what goal, and what it did. Lets the routing later learn
/// where local was enough vs. where it had to escalate (Candidate B).
#[derive(Clone, Debug, PartialEq)]
pub struct ControlTurnLog {
    pub engine: String,
    pub goal: String,
    pub tool_names: Vec<String>,
    pub wants_tools: bool,
}

impl ControlTurnLog {
    /// One-line summary persisted to the learn-do store.
    pub fn summary(&self) -> String {
        let goal = truncate(&self.goal, 80);
        if self.tool_names.is_empty() {
            format!("control[{}] {goal:?} -> answered (no tools)", self.engine)
        } else {
            format!(
                "control[{}] {goal:?} -> {}",
                self.engine,
                self.tool_names.join(",")
            )
        }
    }
}

/// Build the (pure) log record for a control turn.
pub fn control_turn_log(engine: &str, goal: &str, out: &TurnOutput) -> ControlTurnLog {
    ControlTurnLog {
        engine: engine.to_string(),
        goal: goal.trim().to_string(),
        tool_names: out.tool_calls.iter().map(|(_, n, _)| n.clone()).collect(),
        wants_tools: out.wants_tools,
    }
}

/// Where control-turn records go. A real seam (not a `cfg!(test)` branch): prod
/// uses [`MemorySink`]; tests use a recording double and assert the sequence. So
/// "did the loop log the right thing on the right turn?" — including across an
/// escalation — is verifiable, which it wasn't when the sink no-op'd under test.
pub trait ControlTurnSink: Send + Sync {
    fn record(&self, log: ControlTurnLog);
}

/// Production sink: appends each turn to the local learn-do memory so the
/// routing can later learn where local was enough vs. where it escalated. Best
/// effort — never blocks the loop. The richer `eri_graph` causal log is the
/// future target (Candidate B); this is the same seam it plugs into.
pub struct MemorySink;

impl ControlTurnSink for MemorySink {
    fn record(&self, log: ControlTurnLog) {
        let workspace = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
        if let Ok(mut store) = eri_inference::memory::MemoryStore::open() {
            let _ = store.insert("control_turn", &workspace, &log.summary());
        }
    }
}

/// Truncate a string to `max` chars with an ellipsis (display only).
fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let head: String = s.chars().take(max.saturating_sub(1)).collect();
    format!("{head}…")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ollama_tool_calls_with_object_arguments() {
        let msg = json!({
            "role": "assistant",
            "content": "",
            "tool_calls": [
                { "function": { "name": "open_app", "arguments": { "name": "Safari" } } },
                { "function": { "name": "type", "arguments": { "text": "lofi" } } }
            ]
        });
        let calls = parse_local_tool_calls(&msg);
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].1, "open_app");
        assert_eq!(calls[0].2, json!({ "name": "Safari" }));
        // Ids are synthesised positionally + unique.
        assert_eq!(calls[0].0, "local-0");
        assert_eq!(calls[1].0, "local-1");
    }

    #[test]
    fn parses_ollama_tool_calls_with_stringified_arguments() {
        // Some builds emit `arguments` as a JSON string — accept that too.
        let msg = json!({
            "tool_calls": [
                { "function": { "name": "open_app", "arguments": "{\"name\":\"Spotify\"}" } }
            ]
        });
        let calls = parse_local_tool_calls(&msg);
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].2, json!({ "name": "Spotify" }));
    }

    #[test]
    fn no_tool_calls_is_an_empty_vec_not_an_error() {
        let msg = json!({ "role": "assistant", "content": "all done" });
        assert!(parse_local_tool_calls(&msg).is_empty());
    }

    #[test]
    fn normalises_wrong_arg_keys_qwen_actually_emits() {
        // Live-observed: qwen2.5:1.5b returns `app_name` for open_app. Normalise
        // it to the spec's `name` so the strict shared parser accepts it.
        assert_eq!(
            normalise_local_args("open_app", &json!({ "app_name": "Safari" })),
            json!({ "name": "Safari" })
        );
        assert_eq!(
            normalise_local_args("quit_app", &json!({ "application": "Cursor" })),
            json!({ "name": "Cursor" })
        );
        assert_eq!(
            normalise_local_args("type", &json!({ "string": "lofi" })),
            json!({ "text": "lofi" })
        );
        assert_eq!(
            normalise_local_args("key", &json!({ "shortcut": "cmd+l" })),
            json!({ "combo": "cmd+l" })
        );
        assert_eq!(
            normalise_local_args("click", &json!({ "id": "e1" })),
            json!({ "element": "e1" })
        );
    }

    #[test]
    fn normalise_leaves_correct_keys_and_unknown_tools_untouched() {
        // Canonical key already present → no change (don't clobber).
        assert_eq!(
            normalise_local_args("open_app", &json!({ "name": "Safari", "extra": 1 })),
            json!({ "name": "Safari", "extra": 1 })
        );
        // click by coordinates passes through (x/y aren't aliased).
        assert_eq!(
            normalise_local_args("click", &json!({ "x": 4.0, "y": 8.0 })),
            json!({ "x": 4.0, "y": 8.0 })
        );
        // Unknown tool → identity.
        assert_eq!(
            normalise_local_args("screen_observe", &json!({})),
            json!({})
        );
    }

    #[test]
    fn parse_local_tool_calls_normalises_inline() {
        // End-to-end through the local parse: wrong key in, canonical key out.
        let msg = json!({
            "tool_calls": [
                { "function": { "name": "open_app", "arguments": { "app_name": "Safari" } } }
            ]
        });
        let calls = parse_local_tool_calls(&msg);
        assert_eq!(calls[0].2, json!({ "name": "Safari" }));
    }

    #[test]
    fn maps_anthropic_tool_specs_to_the_ollama_shape() {
        let anthropic = json!([
            { "name": "open_app", "description": "Open an app",
              "input_schema": { "type": "object", "properties": { "name": { "type": "string" } } } }
        ]);
        let local = to_local_tool_specs(&anthropic);
        let arr = local.as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["type"], "function");
        assert_eq!(arr[0]["function"]["name"], "open_app");
        // input_schema is carried over verbatim as `parameters`.
        assert_eq!(
            arr[0]["function"]["parameters"]["properties"]["name"]["type"],
            "string"
        );
    }

    #[test]
    fn local_assistant_content_mirrors_claude_block_shape() {
        let calls = vec![(
            "local-0".to_string(),
            "open_app".to_string(),
            json!({ "name": "Safari" }),
        )];
        let content = local_assistant_content("opening it", &calls);
        let blocks = content.as_array().unwrap();
        assert_eq!(blocks[0]["type"], "text");
        assert_eq!(blocks[1]["type"], "tool_use");
        assert_eq!(blocks[1]["name"], "open_app");
        assert_eq!(blocks[1]["id"], "local-0");
    }

    #[test]
    fn empty_text_yields_only_tool_use_blocks() {
        let calls = vec![("local-0".to_string(), "wait".to_string(), json!({}))];
        let content = local_assistant_content("   ", &calls);
        let blocks = content.as_array().unwrap();
        assert_eq!(blocks.len(), 1, "blank text contributes no text block");
        assert_eq!(blocks[0]["type"], "tool_use");
    }

    #[test]
    fn lowers_anthropic_transcript_to_ollama_messages() {
        let system = vec![
            json!({ "type": "text", "text": "you are eri" }),
            json!({ "type": "text", "text": "be frugal" }),
        ];
        let messages = vec![
            json!({ "role": "user", "content": "open Safari" }),
            json!({ "role": "assistant", "content": [
                { "type": "text", "text": "on it" },
                { "type": "tool_use", "id": "t1", "name": "open_app", "input": { "name": "Safari" } }
            ]}),
            json!({ "role": "user", "content": [
                { "type": "tool_result", "tool_use_id": "t1", "content": "opened Safari" }
            ]}),
        ];
        let local = to_local_messages(&system, &messages);
        // system block first, joined.
        assert_eq!(local[0]["role"], "system");
        assert!(
            local[0]["content"]
                .as_str()
                .unwrap()
                .contains("you are eri")
        );
        assert!(local[0]["content"].as_str().unwrap().contains("be frugal"));
        // user text passes through.
        assert_eq!(
            local[1],
            json!({ "role": "user", "content": "open Safari" })
        );
        // assistant text + tool_calls.
        assert_eq!(local[2]["role"], "assistant");
        assert_eq!(local[2]["content"], "on it");
        assert_eq!(local[2]["tool_calls"][0]["function"]["name"], "open_app");
        // tool_result lowered to a `tool` message.
        assert_eq!(local[3]["role"], "tool");
        assert_eq!(local[3]["content"], "opened Safari");
    }

    #[test]
    fn local_system_message_carries_the_brand_guardrail() {
        // The on-device model must get the same confidentiality guardrail as the
        // cloud path (it must never reveal which model it is). control_agent puts
        // brand::GUARDRAIL into the shared system blocks; lock that it survives
        // the lowering into the Ollama system message so a refactor can't drop it.
        let system = vec![
            json!({ "type": "text", "text": "you are eri" }),
            json!({ "type": "text", "text": eri_inference::brand::GUARDRAIL }),
        ];
        let local = to_local_messages(&system, &[]);
        assert_eq!(local[0]["role"], "system");
        let sys = local[0]["content"].as_str().unwrap();
        assert!(
            sys.contains(eri_inference::brand::GUARDRAIL),
            "the local system message dropped the confidentiality guardrail"
        );
    }

    #[test]
    fn tool_result_block_array_content_is_flattened() {
        let messages = vec![json!({ "role": "user", "content": [
            { "type": "tool_result", "tool_use_id": "t1", "content": [ { "type": "text", "text": "clicked" } ] }
        ]})];
        let local = to_local_messages(&[], &messages);
        assert_eq!(local[0]["role"], "tool");
        assert_eq!(local[0]["content"], "clicked");
    }

    #[test]
    fn control_turn_log_captures_engine_goal_and_tools() {
        let out = TurnOutput {
            assistant_content: json!([]),
            text: String::new(),
            tool_calls: vec![
                ("a".into(), "open_app".into(), json!({})),
                ("b".into(), "type".into(), json!({})),
            ],
            wants_tools: true,
            usage: TokenUsage::default(),
        };
        let log = control_turn_log("local", "  open Safari  ", &out);
        assert_eq!(log.engine, "local");
        assert_eq!(log.goal, "open Safari");
        assert_eq!(log.tool_names, vec!["open_app", "type"]);
        assert!(log.summary().contains("control[local]"));
        assert!(log.summary().contains("open_app,type"));
    }

    #[test]
    fn control_turn_log_notes_a_no_tool_answer() {
        let out = TurnOutput {
            assistant_content: json!([]),
            text: "done".into(),
            tool_calls: vec![],
            wants_tools: false,
            usage: TokenUsage::default(),
        };
        let log = control_turn_log("claude", "summarize my screen", &out);
        assert!(log.summary().contains("answered (no tools)"));
    }

    #[test]
    fn selection_is_local_first_when_an_on_device_model_is_set() {
        // With a local model (and no eri-brain), the on-device engine is tried
        // first. Claude may or may not append (depends on sign-in) — local leads.
        let engines = select_control_turn_with(None, Some("qwen2.5:1.5b"), "claude-sonnet-4-6")
            .expect("a local engine is always buildable");
        assert_eq!(engines[0].engine(), "local");
    }

    #[test]
    fn blank_local_model_does_not_create_a_local_engine() {
        // A blank ERI_LOCAL_MODEL must not produce a (broken) local engine; with
        // no sign-in either, selection errors rather than returning junk.
        let result = select_control_turn_with(None, Some("   "), "claude-sonnet-4-6");
        // Either Claude signed in (Ok, first engine is claude) or not (Err) — but
        // never a local engine from a blank id.
        if let Ok(engines) = result {
            assert_eq!(engines[0].engine(), "claude");
        }
    }

    #[test]
    fn eri_brain_is_first_when_configured() {
        // When ERI_BRAIN_URL is set, the hosted brain leads the escalation order.
        let brain = EriBrainControlTurn::new("https://brain.eri.dev", None, None);
        assert!(brain.is_some());
        let engines = select_control_turn_with(brain, None, "claude-sonnet-4-6")
            .expect("eri-brain is always buildable");
        assert_eq!(engines[0].engine(), "eri-brain");
    }

    #[test]
    fn eri_brain_precedes_local_when_both_configured() {
        // Both Local and eri-brain configured → eri-brain goes first, local next.
        let brain = EriBrainControlTurn::new("https://brain.eri.dev", Some("key"), Some("qwen3"));
        let engines = select_control_turn_with(brain, Some("qwen2.5:1.5b"), "claude-sonnet-4-6")
            .expect("buildable");
        assert_eq!(engines[0].engine(), "eri-brain");
        assert_eq!(engines[1].engine(), "local");
    }

    #[test]
    fn blank_eri_brain_url_yields_no_engine() {
        // A blank base URL must not produce a (broken) eri-brain engine.
        assert!(EriBrainControlTurn::new("   ", None, None).is_none());
        assert!(EriBrainControlTurn::new("", Some("k"), Some("m")).is_none());
    }

    #[test]
    fn eri_brain_endpoint_appends_openai_chat_path() {
        // The env var holds the base URL; the OpenAI route is appended once,
        // trimming any trailing slash so config is forgiving.
        let brain = EriBrainControlTurn::new("https://brain.eri.dev/", None, None).unwrap();
        assert_eq!(brain.endpoint, "https://brain.eri.dev/v1/chat/completions");
    }
}
