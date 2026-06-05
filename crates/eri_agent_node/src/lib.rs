//! Node / TypeScript bindings over the `eri_agent` SDK core (napi-rs).
//!
//! Exposes the transport-agnostic building blocks to JavaScript/TypeScript:
//! context compaction, the permission model, output styles, and request
//! shaping. Interop is over JSON strings (the Anthropic Messages wire shape).

use napi::bindgen_prelude::*;
use napi_derive::napi;
use serde_json::Value;

use eri_agent::{PermissionMode, SystemStyle};

fn parse_messages(json: &str) -> Result<Vec<Value>> {
    let v: Value = serde_json::from_str(json)
        .map_err(|e| Error::from_reason(format!("invalid JSON: {e}")))?;
    match v {
        Value::Array(a) => Ok(a),
        _ => Err(Error::from_reason("expected a JSON array of messages")),
    }
}

/// Estimate the token footprint of a JSON messages array (chars/4 heuristic).
#[napi]
pub fn estimate_tokens(messages_json: String) -> Result<u32> {
    Ok(eri_agent::compaction::estimate_tokens(&parse_messages(&messages_json)?) as u32)
}

/// Result of `shape_context`.
#[napi(object)]
pub struct ShapeResult {
    pub shaped: String,
    pub tokens_after: u32,
}

/// Shape a messages array under `target_tokens` (the layered compaction
/// pipeline). Returns the shaped JSON + the post-shape token estimate.
#[napi]
pub fn shape_context(messages_json: String, target_tokens: u32) -> Result<ShapeResult> {
    let mut messages = parse_messages(&messages_json)?;
    let report = eri_agent::compaction::shape_context(&mut messages, target_tokens as usize);
    let shaped = serde_json::to_string(&messages)
        .map_err(|e| Error::from_reason(format!("serialize: {e}")))?;
    Ok(ShapeResult {
        shaped,
        tokens_after: report.tokens_after as u32,
    })
}

fn parse_mode(s: &str) -> PermissionMode {
    PermissionMode::from_legacy_flags(s == "plan", s == "workspace-write" || s == "bypass")
}

/// Whether a permission mode (`plan|accept-edits|workspace-write|bypass`) allows
/// file writes.
#[napi]
pub fn permission_allows_writes(mode: String) -> bool {
    parse_mode(&mode).allows_writes()
}

/// Whether a permission mode allows the shell tool.
#[napi]
pub fn permission_allows_shell(mode: String) -> bool {
    parse_mode(&mode).allows_shell()
}

/// The output-style directive for a style name (`reviewer|explainer|concise`),
/// or null for the default `builder`.
#[napi]
pub fn style_directive(style: String) -> Option<String> {
    SystemStyle::parse(&style).directive().map(str::to_string)
}

/// Result of `runAgent`.
#[napi(object)]
pub struct AgentResult {
    pub final_text: String,
    pub turns: u32,
    pub tokens_in: i64,
    pub tokens_out: i64,
    pub stop: String,
    pub messages: String,
}

/// Run a full agent loop driven by JS callbacks (synchronous; the host owns I/O).
///
/// - `transport(bodyJson)` returns the SSE response text for a request body.
/// - `tools` maps a tool name to `(inputJson) => { content, isError }`;
///   `toolSpecsJson` is the Anthropic tools array.
#[napi]
pub fn run_agent(
    env: Env,
    model: String,
    system_json: String,
    messages_json: String,
    transport: napi::JsFunction,
    tools: napi::JsObject,
    tool_specs_json: String,
    max_turns: u32,
) -> Result<AgentResult> {
    let system = match serde_json::from_str::<Value>(&system_json)
        .map_err(|e| Error::from_reason(format!("system: {e}")))?
    {
        Value::Array(a) => a,
        _ => return Err(Error::from_reason("system must be a JSON array")),
    };
    let specs: Value = serde_json::from_str(&tool_specs_json)
        .map_err(|e| Error::from_reason(format!("tool_specs: {e}")))?;
    let mut messages = parse_messages(&messages_json)?;

    let mut tokens_in = 0i64;
    let mut tokens_out = 0i64;
    let mut final_text = String::new();

    for turn in 0..max_turns {
        eri_agent::compaction::shape_context(&mut messages, 150_000);
        let body = eri_agent::request::messages_body(&model, 32_000, &system, &specs, &messages);
        // Call the JS transport synchronously with the body JSON string.
        let arg = env.create_string(&body.to_string())?;
        let sse: String = transport
            .call::<napi::JsString>(None, &[arg])?
            .coerce_to_string()?
            .into_utf8()?
            .as_str()?
            .to_string();

        let mut acc = eri_agent::TurnAccumulator::new();
        for line in sse.lines() {
            if let Some(payload) = line.strip_prefix("data:").map(str::trim) {
                if !payload.is_empty() {
                    if let Ok(ev) = serde_json::from_str::<Value>(payload) {
                        acc.push_event(&ev);
                    }
                }
            }
        }
        let result = acc.finish();
        tokens_in += result.usage_in as i64;
        tokens_out += result.usage_out as i64;
        let text = eri_agent::stream::assistant_text(&result.content);
        if !text.trim().is_empty() {
            final_text = text;
        }
        messages.push(serde_json::json!({ "role": "assistant", "content": result.content }));

        if result.stop_reason.as_deref() != Some("tool_use") {
            return Ok(AgentResult {
                final_text,
                turns: turn + 1,
                tokens_in,
                tokens_out,
                stop: "done".into(),
                messages: serde_json::to_string(&messages).unwrap_or_default(),
            });
        }

        let mut results: Vec<Value> = Vec::new();
        for tu in &result.tool_uses {
            let (content, is_error) = if tools.has_named_property(&tu.name)? {
                let f: napi::JsFunction = tools.get_named_property(&tu.name)?;
                let arg = env.create_string(&tu.input.to_string())?;
                let out: napi::JsObject = f.call(None, &[arg])?.coerce_to_object()?;
                let content: String = out
                    .get_named_property::<napi::JsString>("content")
                    .and_then(|s| s.into_utf8())
                    .and_then(|s| s.as_str().map(str::to_string))
                    .unwrap_or_default();
                let is_error: bool = out
                    .get_named_property::<napi::JsBoolean>("isError")
                    .and_then(|b| b.get_value())
                    .unwrap_or(false);
                (content, is_error)
            } else {
                (format!("unknown tool '{}'", tu.name), true)
            };
            results.push(serde_json::json!({
                "type": "tool_result",
                "tool_use_id": tu.id,
                "content": content,
                "is_error": is_error,
            }));
        }
        messages.push(serde_json::json!({ "role": "user", "content": results }));
    }

    Ok(AgentResult {
        final_text,
        turns: max_turns,
        tokens_in,
        tokens_out,
        stop: "turn_cap".into(),
        messages: serde_json::to_string(&messages).unwrap_or_default(),
    })
}

/// Build a streaming Messages request body. `system`/`tools`/`messages` are JSON
/// strings; returns the request body as a JSON string.
#[napi]
pub fn messages_body(
    model: String,
    max_tokens: u32,
    system_json: String,
    tools_json: String,
    messages_json: String,
) -> Result<String> {
    let parse = |j: &str| -> Result<Value> {
        serde_json::from_str(j).map_err(|e| Error::from_reason(format!("invalid JSON: {e}")))
    };
    let system = match parse(&system_json)? {
        Value::Array(a) => a,
        _ => return Err(Error::from_reason("system must be a JSON array")),
    };
    let tools = parse(&tools_json)?;
    let messages = parse_messages(&messages_json)?;
    let body = eri_agent::request::messages_body(&model, max_tokens, &system, &tools, &messages);
    serde_json::to_string(&body).map_err(|e| Error::from_reason(format!("serialize: {e}")))
}
