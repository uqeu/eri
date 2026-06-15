//! Shared OpenAI chat-completions translation for eri's hosted brain adapter.
//!
//! `EriBrainBuildTurn` / `EriBrainControlTurn` (the `eri-brain` engine, Phase 2
//! of the hosted-brain plan) speak the OpenAI `/v1/chat/completions` protocol to
//! a *model-agnostic* vLLM endpoint (`ERI_BRAIN_URL`). The leading deployed model
//! is dense Qwen3-32B, but **no model name is hard-coded** — the endpoint is a
//! deploy/config choice, so swapping the served model is never a code change.
//!
//! Why a shared module rather than per-adapter code: the build loop and the
//! control loop both hand the engine the *same* engine-agnostic shapes (system
//! blocks, an Anthropic-style message list, and Anthropic-style tool specs), and
//! both need the *same* OpenAI request body and the *same* response decoding
//! (text + `tool_calls` + `usage`). Only the final container differs — the build
//! loop wants a [`eri_agent::Turn`], the control loop wants a
//! [`crate::control_turn::TurnOutput`]. So everything up to that last mapping is
//! identical; centralising it here keeps the OpenAI wire knowledge in one tested
//! place and lets the two adapters stay thin.
//!
//! Identity (persona + memory) is assembled *above* this layer and arrives in the
//! `system`/`messages`; this module is a dumb executor that forwards them and
//! decodes the reply. It never injects persona or memory.

use serde_json::{Value, json};

use crate::control_turn::{join_block_text_pub, tool_result_text_pub};

/// Default OpenAI chat-completions path appended to `ERI_BRAIN_URL`. The env var
/// holds the *base* URL (e.g. `https://brain.eri.dev`); we append the standard
/// OpenAI route so the same config points at any OpenAI-compatible server.
pub const OPENAI_CHAT_PATH: &str = "/v1/chat/completions";

/// Convert eri's Anthropic-style tool specs (`{name, description, input_schema}`)
/// into the OpenAI function-tool shape
/// (`{type:"function", function:{name, description, parameters}}`).
///
/// Why: the loop carries tools in the Anthropic envelope (that's what Claude and
/// the on-device Ollama path consume); OpenAI servers want the function-tool
/// envelope. The JSON Schema body is identical — only the wrapper differs, so we
/// rename `input_schema` → `parameters` and nest under `function`. Pure + tested
/// so the contract can't silently drift. Returns `[]` for a non-array input.
pub fn to_openai_tool_specs(anthropic_tools: &Value) -> Value {
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

/// Lower eri's Anthropic transcript (system blocks + message list) into the flat
/// OpenAI `messages` array.
///
/// Mapping (mirrors the on-device lowering, but in OpenAI's wire shape):
///   - system blocks → one leading `{role:"system"}` message;
///   - assistant `tool_use` blocks → an assistant message with `tool_calls`
///     where each call's `function.arguments` is a JSON **string** (OpenAI wire
///     requirement) and a synthesised `id` so the matching `tool` message can
///     reference it via `tool_call_id`;
///   - user `tool_result` blocks → `{role:"tool", tool_call_id, content}`.
///
/// Pure + tested so the request contract is verifiable without a live endpoint.
pub fn to_openai_messages(system: &[Value], messages: &[Value]) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    let system_text = join_block_text_pub(system);
    if !system_text.trim().is_empty() {
        out.push(json!({ "role": "system", "content": system_text }));
    }
    for msg in messages {
        let role = msg.get("role").and_then(Value::as_str).unwrap_or("user");
        match msg.get("content") {
            Some(Value::String(s)) => out.push(json!({ "role": role, "content": s })),
            Some(Value::Array(blocks)) => lower_blocks_openai(role, blocks, &mut out),
            _ => {}
        }
    }
    out
}

/// Lower one Anthropic content-block array into OpenAI message(s).
fn lower_blocks_openai(role: &str, blocks: &[Value], out: &mut Vec<Value>) {
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
                let id = b.get("id").and_then(Value::as_str).unwrap_or("");
                let name = b.get("name").and_then(Value::as_str).unwrap_or("");
                let input = b.get("input").cloned().unwrap_or_else(|| json!({}));
                // OpenAI requires `arguments` as a JSON *string*, not an object.
                let arguments = serde_json::to_string(&input).unwrap_or_else(|_| "{}".to_string());
                tool_calls.push(json!({
                    "id": id,
                    "type": "function",
                    "function": { "name": name, "arguments": arguments },
                }));
            }
            Some("tool_result") => {
                // A `tool` message must reference the call it answers.
                let id = b.get("tool_use_id").and_then(Value::as_str).unwrap_or("");
                out.push(json!({
                    "role": "tool",
                    "tool_call_id": id,
                    "content": tool_result_text_pub(b),
                }));
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

/// The decoded result of one OpenAI chat-completions reply, in eri's engine-
/// agnostic vocabulary: assistant text, the tool calls it requested as
/// `(id, name, input)`, and token usage. The two adapters map this into their
/// respective containers.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct OpenAiTurn {
    pub text: String,
    /// `(id, name, input)` — `input` is the parsed-from-string arguments object.
    pub tool_calls: Vec<(String, String, Value)>,
    pub usage_in: u64,
    pub usage_out: u64,
}

impl OpenAiTurn {
    /// True when the model asked to call at least one tool.
    pub fn wants_tools(&self) -> bool {
        !self.tool_calls.is_empty()
    }
}

/// Parse a (non-streaming) OpenAI chat-completions response body into an
/// [`OpenAiTurn`].
///
/// Wire facts decoded (OpenAI `/v1/chat/completions`):
///   - text = `choices[0].message.content`;
///   - tool calls = `choices[0].message.tool_calls[]`, each with
///     `id` + `function.{name, arguments}` where **`arguments` is a JSON string**
///     (we parse it; on parse failure we keep an empty object so a malformed
///     argument can't crash the loop);
///   - usage = `usage.{prompt_tokens, completion_tokens}` → `usage_in/out`.
///
/// Pure + tested so the response contract is verifiable without a live endpoint
/// or GPU. Tool-call ids fall back to a positional `eri-brain-{i}` when the
/// server omits them, so downstream `tool_result` matching always has an id.
pub fn parse_openai_response(v: &Value) -> OpenAiTurn {
    let message = v
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|c| c.first())
        .and_then(|c| c.get("message"))
        .cloned()
        .unwrap_or_else(|| json!({}));

    let text = message
        .get("content")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    let tool_calls = message
        .get("tool_calls")
        .and_then(Value::as_array)
        .map(|calls| {
            calls
                .iter()
                .enumerate()
                .filter_map(|(i, call)| parse_openai_tool_call(i, call))
                .collect()
        })
        .unwrap_or_default();

    let usage = v.get("usage");
    let usage_in = usage
        .and_then(|u| u.get("prompt_tokens"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let usage_out = usage
        .and_then(|u| u.get("completion_tokens"))
        .and_then(Value::as_u64)
        .unwrap_or(0);

    OpenAiTurn {
        text,
        tool_calls,
        usage_in,
        usage_out,
    }
}

/// Decode one OpenAI `tool_calls[]` entry into `(id, name, input)`. `arguments`
/// is a JSON string per the OpenAI wire format — parse it; an empty/blank string
/// or a parse failure yields an empty object rather than dropping the call.
fn parse_openai_tool_call(index: usize, call: &Value) -> Option<(String, String, Value)> {
    let func = call.get("function")?;
    let name = func.get("name").and_then(Value::as_str)?.to_string();
    let id = call
        .get("id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("eri-brain-{index}"));
    let input = match func.get("arguments") {
        Some(Value::String(s)) if !s.trim().is_empty() => {
            serde_json::from_str(s).unwrap_or_else(|_| json!({}))
        }
        // Some servers send an already-parsed object; accept that too.
        Some(Value::Object(_)) => func.get("arguments").cloned().unwrap_or_else(|| json!({})),
        _ => json!({}),
    };
    Some((id, name, input))
}

/// Build the OpenAI chat-completions request body. `stream` is requested so the
/// transport can read incrementally, matching the cloud/local adapters' shape;
/// the response decoder ([`parse_openai_response`]) works on the assembled body.
pub fn build_request_body(
    model: &str,
    system: &[Value],
    messages: &[Value],
    tools: &Value,
    max_tokens: u32,
    stream: bool,
) -> Value {
    json!({
        "model": model,
        "messages": to_openai_messages(system, messages),
        "tools": to_openai_tool_specs(tools),
        "max_tokens": max_tokens,
        "stream": stream,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_anthropic_tool_specs_to_the_openai_function_shape() {
        let anthropic = json!([
            { "name": "open_app", "description": "Open an app",
              "input_schema": { "type": "object", "properties": { "name": { "type": "string" } } } }
        ]);
        let openai = to_openai_tool_specs(&anthropic);
        let arr = openai.as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["type"], "function");
        assert_eq!(arr[0]["function"]["name"], "open_app");
        assert_eq!(arr[0]["function"]["description"], "Open an app");
        // input_schema is carried over verbatim as `parameters`.
        assert_eq!(
            arr[0]["function"]["parameters"]["properties"]["name"]["type"],
            "string"
        );
    }

    #[test]
    fn tool_spec_without_schema_gets_an_empty_object_schema() {
        let anthropic = json!([{ "name": "now" }]);
        let openai = to_openai_tool_specs(&anthropic);
        let arr = openai.as_array().unwrap();
        assert_eq!(arr[0]["function"]["parameters"]["type"], "object");
        assert_eq!(arr[0]["function"]["description"], "");
    }

    #[test]
    fn non_array_tools_yields_empty_array() {
        assert_eq!(to_openai_tool_specs(&json!({})), json!([]));
        assert_eq!(to_openai_tool_specs(&json!(null)), json!([]));
    }

    #[test]
    fn parses_a_text_only_response_with_usage() {
        let v = json!({
            "choices": [ { "message": { "role": "assistant", "content": "all done" } } ],
            "usage": { "prompt_tokens": 40, "completion_tokens": 9 }
        });
        let turn = parse_openai_response(&v);
        assert_eq!(turn.text, "all done");
        assert!(turn.tool_calls.is_empty());
        assert!(!turn.wants_tools());
        assert_eq!(turn.usage_in, 40);
        assert_eq!(turn.usage_out, 9);
    }

    #[test]
    fn parses_a_tool_call_with_stringified_arguments_and_usage() {
        // OpenAI sends `arguments` as a JSON string — parse it into an object.
        let v = json!({
            "choices": [ {
                "message": {
                    "role": "assistant",
                    "content": "writing the file",
                    "tool_calls": [ {
                        "id": "call_abc",
                        "type": "function",
                        "function": { "name": "write_file", "arguments": "{\"path\":\"a.ts\",\"content\":\"x\"}" }
                    } ]
                }
            } ],
            "usage": { "prompt_tokens": 12, "completion_tokens": 5 }
        });
        let turn = parse_openai_response(&v);
        assert_eq!(turn.text, "writing the file");
        assert!(turn.wants_tools());
        assert_eq!(turn.tool_calls.len(), 1);
        let (id, name, input) = &turn.tool_calls[0];
        assert_eq!(id, "call_abc");
        assert_eq!(name, "write_file");
        // The JSON-string arguments are parsed back into a real object.
        assert_eq!(input, &json!({ "path": "a.ts", "content": "x" }));
        assert_eq!(turn.usage_in, 12);
        assert_eq!(turn.usage_out, 5);
    }

    #[test]
    fn tool_call_without_id_gets_a_positional_id() {
        let v = json!({
            "choices": [ {
                "message": {
                    "tool_calls": [
                        { "function": { "name": "a", "arguments": "{}" } },
                        { "function": { "name": "b", "arguments": "{}" } }
                    ]
                }
            } ]
        });
        let turn = parse_openai_response(&v);
        assert_eq!(turn.tool_calls[0].0, "eri-brain-0");
        assert_eq!(turn.tool_calls[1].0, "eri-brain-1");
    }

    #[test]
    fn malformed_tool_arguments_fall_back_to_empty_object() {
        let v = json!({
            "choices": [ {
                "message": {
                    "tool_calls": [
                        { "id": "x", "function": { "name": "a", "arguments": "not json" } }
                    ]
                }
            } ]
        });
        let turn = parse_openai_response(&v);
        // A bad argument string must not crash the loop — empty object instead.
        assert_eq!(turn.tool_calls[0].2, json!({}));
    }

    #[test]
    fn object_arguments_are_accepted_too() {
        // A lenient server may send arguments already-parsed as an object.
        let v = json!({
            "choices": [ {
                "message": {
                    "tool_calls": [
                        { "id": "x", "function": { "name": "a", "arguments": { "k": 1 } } }
                    ]
                }
            } ]
        });
        let turn = parse_openai_response(&v);
        assert_eq!(turn.tool_calls[0].2, json!({ "k": 1 }));
    }

    #[test]
    fn missing_usage_defaults_to_zero() {
        let v = json!({ "choices": [ { "message": { "content": "hi" } } ] });
        let turn = parse_openai_response(&v);
        assert_eq!(turn.usage_in, 0);
        assert_eq!(turn.usage_out, 0);
    }

    #[test]
    fn empty_choices_yields_empty_turn() {
        let turn = parse_openai_response(&json!({ "choices": [] }));
        assert_eq!(turn.text, "");
        assert!(turn.tool_calls.is_empty());
    }

    #[test]
    fn lowers_anthropic_transcript_to_openai_messages() {
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
        let m = to_openai_messages(&system, &messages);
        // system block first, joined.
        assert_eq!(m[0]["role"], "system");
        assert!(m[0]["content"].as_str().unwrap().contains("you are eri"));
        assert!(m[0]["content"].as_str().unwrap().contains("be frugal"));
        // user text passes through.
        assert_eq!(m[1], json!({ "role": "user", "content": "open Safari" }));
        // assistant text + tool_calls, arguments as a STRING.
        assert_eq!(m[2]["role"], "assistant");
        assert_eq!(m[2]["content"], "on it");
        assert_eq!(m[2]["tool_calls"][0]["id"], "t1");
        assert_eq!(m[2]["tool_calls"][0]["type"], "function");
        assert_eq!(m[2]["tool_calls"][0]["function"]["name"], "open_app");
        let args = m[2]["tool_calls"][0]["function"]["arguments"]
            .as_str()
            .unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(args).unwrap(),
            json!({ "name": "Safari" })
        );
        // tool_result lowered to a `tool` message referencing the call id.
        assert_eq!(m[3]["role"], "tool");
        assert_eq!(m[3]["tool_call_id"], "t1");
        assert_eq!(m[3]["content"], "opened Safari");
    }

    #[test]
    fn request_body_has_model_messages_tools_and_flags() {
        let tools = json!([
            { "name": "now", "input_schema": { "type": "object", "properties": {} } }
        ]);
        let body = build_request_body(
            "any-model",
            &[json!({ "type": "text", "text": "be eri" })],
            &[json!({ "role": "user", "content": "hi" })],
            &tools,
            256,
            true,
        );
        assert_eq!(body["model"], "any-model");
        assert_eq!(body["max_tokens"], 256);
        assert_eq!(body["stream"], true);
        assert_eq!(body["messages"][0]["role"], "system");
        assert_eq!(body["messages"][1]["role"], "user");
        assert_eq!(body["tools"][0]["type"], "function");
        assert_eq!(body["tools"][0]["function"]["name"], "now");
    }
}
