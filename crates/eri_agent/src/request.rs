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
}
