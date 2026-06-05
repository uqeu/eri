//! The Anthropic Messages **streaming protocol handler** -- a pure state machine
//! that accumulates a single assistant turn from parsed SSE events, with no
//! network or I/O. The host reads the byte stream and parses `data:` frames into
//! JSON; this turns those events into a finished [`Turn`].
//!
//! Wire facts encoded here (from Anthropic's public streaming docs):
//!   - `message_start` carries input usage (incl. cache read / creation).
//!   - `content_block_start` opens a `text` or `tool_use` block at an `index`.
//!   - `content_block_delta` streams `text_delta` (narratable) or
//!     `input_json_delta` fragments (concatenate per index, parse at the end).
//!   - `message_delta` carries `stop_reason` + output usage.

use std::collections::BTreeMap;

use serde_json::{Value, json};

/// One tool call extracted from an assistant turn.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolUse {
    pub id: String,
    pub name: String,
    pub input: Value,
}

/// The assembled result of one streamed assistant turn.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Turn {
    /// Assistant content array, verbatim, for re-sending in `messages`.
    pub content: Vec<Value>,
    /// The tool calls to execute (subset of `content`).
    pub tool_uses: Vec<ToolUse>,
    pub stop_reason: Option<String>,
    pub usage_in: u64,
    pub usage_out: u64,
}

/// A per-index streaming block accumulator.
enum Acc {
    Text(String),
    Tool { id: String, name: String, json: String },
}

/// Accumulates SSE events into a [`Turn`]. Feed each parsed event to
/// [`push_event`](Self::push_event); call [`finish`](Self::finish) at stream end.
#[derive(Default)]
pub struct TurnAccumulator {
    blocks: BTreeMap<usize, Acc>,
    stop_reason: Option<String>,
    usage_in: u64,
    usage_out: u64,
}

impl TurnAccumulator {
    pub fn new() -> Self {
        Self::default()
    }

    /// Feed one parsed SSE event (a JSON object with a `type`). Returns the text
    /// fragment for a `text_delta` event so the host can narrate it live; `None`
    /// for every other event kind.
    pub fn push_event(&mut self, ev: &Value) -> Option<String> {
        match ev.get("type").and_then(Value::as_str) {
            Some("message_start") => {
                self.usage_in += u64_at(ev, "/message/usage/input_tokens");
                self.usage_in += u64_at(ev, "/message/usage/cache_read_input_tokens");
                self.usage_in += u64_at(ev, "/message/usage/cache_creation_input_tokens");
                None
            }
            Some("content_block_start") => {
                let i = ev.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
                let cb = ev.get("content_block");
                let kind = cb
                    .and_then(|c| c.get("type"))
                    .and_then(Value::as_str)
                    .unwrap_or("text");
                if kind == "tool_use" {
                    self.blocks.insert(
                        i,
                        Acc::Tool {
                            id: str_at(cb, "id"),
                            name: str_at(cb, "name"),
                            json: String::new(),
                        },
                    );
                } else {
                    self.blocks.insert(i, Acc::Text(String::new()));
                }
                None
            }
            Some("content_block_delta") => {
                let i = ev.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
                let delta = ev.get("delta");
                match delta.and_then(|d| d.get("type")).and_then(Value::as_str) {
                    Some("text_delta") => {
                        let t = delta.and_then(|d| d.get("text")).and_then(Value::as_str)?;
                        if let Some(Acc::Text(s)) = self.blocks.get_mut(&i) {
                            s.push_str(t);
                        }
                        Some(t.to_string())
                    }
                    Some("input_json_delta") => {
                        if let Some(p) = delta
                            .and_then(|d| d.get("partial_json"))
                            .and_then(Value::as_str)
                            && let Some(Acc::Tool { json, .. }) = self.blocks.get_mut(&i)
                        {
                            json.push_str(p);
                        }
                        None
                    }
                    _ => None,
                }
            }
            Some("message_delta") => {
                if let Some(sr) = ev.pointer("/delta/stop_reason").and_then(Value::as_str) {
                    self.stop_reason = Some(sr.to_string());
                }
                self.usage_out += u64_at(ev, "/usage/output_tokens");
                None
            }
            // content_block_stop, message_stop, ping, error: nothing to do.
            _ => None,
        }
    }

    /// Assemble the verbatim content array + the extracted tool calls.
    pub fn finish(self) -> Turn {
        let mut content: Vec<Value> = Vec::new();
        let mut tool_uses: Vec<ToolUse> = Vec::new();
        for (_index, acc) in self.blocks {
            match acc {
                Acc::Text(s) => {
                    if !s.trim().is_empty() {
                        content.push(json!({ "type": "text", "text": s }));
                    }
                }
                Acc::Tool { id, name, json } => {
                    // Empty-input tools emit no deltas; default to {}.
                    let input: Value = if json.trim().is_empty() {
                        json!({})
                    } else {
                        serde_json::from_str(&json).unwrap_or_else(|_| json!({}))
                    };
                    content.push(json!({
                        "type": "tool_use",
                        "id": id.clone(),
                        "name": name.clone(),
                        "input": input.clone(),
                    }));
                    tool_uses.push(ToolUse { id, name, input });
                }
            }
        }
        Turn {
            content,
            tool_uses,
            stop_reason: self.stop_reason,
            usage_in: self.usage_in,
            usage_out: self.usage_out,
        }
    }
}

/// Concatenate the text blocks of an assistant `content` array.
pub fn assistant_text(content: &[Value]) -> String {
    content
        .iter()
        .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|b| b.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("")
}

fn u64_at(v: &Value, pointer: &str) -> u64 {
    v.pointer(pointer).and_then(Value::as_u64).unwrap_or(0)
}

fn str_at(v: Option<&Value>, key: &str) -> String {
    v.and_then(|c| c.get(key))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(acc: &mut TurnAccumulator, events: &[Value]) -> String {
        let mut narrated = String::new();
        for ev in events {
            if let Some(t) = acc.push_event(ev) {
                narrated.push_str(&t);
            }
        }
        narrated
    }

    #[test]
    fn accumulates_text_tool_usage_and_stop() {
        let mut acc = TurnAccumulator::new();
        let narrated = feed(
            &mut acc,
            &[
                json!({ "type": "message_start", "message": { "usage": {
                    "input_tokens": 10, "cache_read_input_tokens": 5,
                    "cache_creation_input_tokens": 2 } } }),
                // text block 0
                json!({ "type": "content_block_start", "index": 0,
                    "content_block": { "type": "text" } }),
                json!({ "type": "content_block_delta", "index": 0,
                    "delta": { "type": "text_delta", "text": "Hello " } }),
                json!({ "type": "content_block_delta", "index": 0,
                    "delta": { "type": "text_delta", "text": "world" } }),
                // tool block 1, input streamed in two fragments
                json!({ "type": "content_block_start", "index": 1,
                    "content_block": { "type": "tool_use", "id": "t1", "name": "write_file" } }),
                json!({ "type": "content_block_delta", "index": 1,
                    "delta": { "type": "input_json_delta", "partial_json": "{\"path\":" } }),
                json!({ "type": "content_block_delta", "index": 1,
                    "delta": { "type": "input_json_delta", "partial_json": "\"a.txt\"}" } }),
                json!({ "type": "message_delta", "delta": { "stop_reason": "tool_use" },
                    "usage": { "output_tokens": 42 } }),
            ],
        );
        // Text deltas are narrated; input_json deltas are not.
        assert_eq!(narrated, "Hello world");

        let turn = acc.finish();
        assert_eq!(turn.usage_in, 17); // 10 + 5 + 2
        assert_eq!(turn.usage_out, 42);
        assert_eq!(turn.stop_reason.as_deref(), Some("tool_use"));
        assert_eq!(assistant_text(&turn.content), "Hello world");
        assert_eq!(turn.tool_uses.len(), 1);
        let tu = &turn.tool_uses[0];
        assert_eq!(tu.id, "t1");
        assert_eq!(tu.name, "write_file");
        assert_eq!(tu.input, json!({ "path": "a.txt" }));
    }

    #[test]
    fn empty_input_tool_defaults_to_object() {
        let mut acc = TurnAccumulator::new();
        feed(
            &mut acc,
            &[json!({ "type": "content_block_start", "index": 0,
                "content_block": { "type": "tool_use", "id": "d", "name": "done" } })],
        );
        let turn = acc.finish();
        assert_eq!(turn.tool_uses[0].input, json!({}));
    }

    #[test]
    fn whitespace_only_text_block_is_dropped() {
        let mut acc = TurnAccumulator::new();
        feed(
            &mut acc,
            &[
                json!({ "type": "content_block_start", "index": 0,
                    "content_block": { "type": "text" } }),
                json!({ "type": "content_block_delta", "index": 0,
                    "delta": { "type": "text_delta", "text": "   " } }),
            ],
        );
        assert!(acc.finish().content.is_empty());
    }
}
