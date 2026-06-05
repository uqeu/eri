//! Request construction for the Anthropic Messages streaming API -- the
//! counterpart to [`crate::stream`]. Centralizes the request shape so the host
//! and the SDK agree on it (model, token ceiling, system blocks, tools,
//! messages). `system` blocks and `tools` are passed through verbatim; callers
//! attach `cache_control: ephemeral` breakpoints on the stable prefix (system +
//! tools) to get ~0.1x input pricing on every loop iteration.

use serde_json::{Value, json};

/// Build a streaming Messages request body.
pub fn messages_body(
    model: &str,
    max_tokens: u32,
    system: &[Value],
    tools: &Value,
    messages: &[Value],
) -> Value {
    json!({
        "model": model,
        "max_tokens": max_tokens,
        "stream": true,
        "system": system,
        "tools": tools,
        "messages": messages,
    })
}

/// Return a clone of `messages` with an `ephemeral` cache breakpoint on the LAST
/// message's last content block. This is the key multi-turn caching move: the
/// breakpoint caches the entire conversation prefix, so the *next* turn re-reads
/// all prior messages at ~0.1x input cost instead of full price. Without it,
/// only the small system+tools prefix is cached and the growing message history
/// is re-billed in full every turn (the classic agent-loop cost leak).
///
/// String content is promoted to a one-block text array so the breakpoint has a
/// block to attach to. A no-op for an empty conversation.
pub fn with_conversation_cache(messages: &[Value]) -> Vec<Value> {
    let mut out: Vec<Value> = messages.to_vec();
    let Some(last) = out.last_mut() else {
        return out;
    };
    match last.get_mut("content") {
        Some(Value::Array(blocks)) => {
            if let Some(block) = blocks.last_mut().and_then(Value::as_object_mut) {
                block.insert("cache_control".into(), json!({ "type": "ephemeral" }));
            }
        }
        Some(Value::String(s)) => {
            let text = s.clone();
            last["content"] = json!([{
                "type": "text",
                "text": text,
                "cache_control": { "type": "ephemeral" }
            }]);
        }
        _ => {}
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn body_has_the_expected_streaming_shape() {
        let system = vec![json!({ "type": "text", "text": "persona",
            "cache_control": { "type": "ephemeral" } })];
        let tools = json!([{ "name": "done" }]);
        let messages = vec![json!({ "role": "user", "content": "hi" })];
        let body = messages_body("claude-x", 32_000, &system, &tools, &messages);

        assert_eq!(body["model"], "claude-x");
        assert_eq!(body["max_tokens"], 32_000);
        assert_eq!(body["stream"], true);
        // System cache breakpoint survives verbatim.
        assert_eq!(body["system"][0]["cache_control"]["type"], "ephemeral");
        assert_eq!(body["tools"][0]["name"], "done");
        assert_eq!(body["messages"][0]["content"], "hi");
    }

    #[test]
    fn conversation_cache_marks_the_last_message() {
        // String content -> promoted to a text block carrying the breakpoint.
        let msgs = vec![
            json!({ "role": "user", "content": "first" }),
            json!({ "role": "user", "content": "latest" }),
        ];
        let cached = with_conversation_cache(&msgs);
        // Earlier messages untouched (still plain strings).
        assert_eq!(cached[0]["content"], "first");
        // Last message now a block array with a cache breakpoint.
        assert_eq!(cached[1]["content"][0]["text"], "latest");
        assert_eq!(cached[1]["content"][0]["cache_control"]["type"], "ephemeral");

        // Array content -> breakpoint goes on the last block.
        let arr = vec![json!({
            "role": "user",
            "content": [
                { "type": "tool_result", "tool_use_id": "a", "content": "x" },
                { "type": "tool_result", "tool_use_id": "b", "content": "y" }
            ]
        })];
        let cached = with_conversation_cache(&arr);
        assert!(cached[0]["content"][0].get("cache_control").is_none());
        assert_eq!(cached[0]["content"][1]["cache_control"]["type"], "ephemeral");

        // Empty -> no panic.
        assert!(with_conversation_cache(&[]).is_empty());
    }
}
