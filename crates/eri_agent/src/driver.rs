//! The agent loop as a library -- ties [`transport`](crate::transport),
//! [`tool`](crate::tool), [`request`](crate::request), and
//! [`compaction`](crate::compaction) into one driver, generic over the
//! transport + tool set. This is the minimal, host-agnostic core; richer hosts
//! (the CLI) layer hooks / MCP / background tasks on top, but the turn loop --
//! shape context, build request, stream a turn, dispatch tools, append results,
//! repeat until a non-tool turn -- lives here and is fully mock-testable.

use serde_json::{Value, json};

use crate::tool::{ToolBox, ToolOutcome};
use crate::transport::{self, Transport};

/// Tunables for one [`run`] call.
pub struct LoopConfig {
    pub model: String,
    pub max_turns: usize,
    pub max_tokens: u32,
    /// Token target the context pipeline shapes toward before each call.
    pub context_target: usize,
}

impl Default for LoopConfig {
    fn default() -> Self {
        Self {
            model: "claude-sonnet-4-6".to_string(),
            max_turns: 24,
            max_tokens: 32_000,
            context_target: 150_000,
        }
    }
}

/// Why the loop stopped.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Stop {
    /// The model ended its turn without calling a tool.
    Done,
    /// The turn cap was hit before completion.
    TurnCap,
    /// A transport error stopped the run (message included).
    Transport(String),
}

/// Outcome of a loop run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoopResult {
    pub turns: usize,
    pub tokens_in: u64,
    pub tokens_out: u64,
    pub final_text: String,
    pub stop: Stop,
}

/// Run the agent loop to completion (or the turn cap). `messages` is mutated in
/// place (the growing conversation); `on_text` receives streamed text fragments
/// for live narration. All inference goes through `transport`; all tool calls
/// through `tools`.
pub async fn run<T: Transport>(
    transport: &T,
    tools: &ToolBox,
    system: &[Value],
    messages: &mut Vec<Value>,
    cfg: &LoopConfig,
    mut on_text: impl FnMut(&str),
) -> LoopResult {
    let specs = tools.specs();
    let mut tokens_in = 0u64;
    let mut tokens_out = 0u64;
    let mut final_text = String::new();

    for turn in 0..cfg.max_turns {
        // Shape the growing context before the call (cheapest reductions first).
        crate::compaction::shape_context(messages, cfg.context_target);

        let body =
            crate::request::messages_body(&cfg.model, cfg.max_tokens, system, &specs, messages);
        let mut stream = match transport.open(body).await {
            Ok(s) => s,
            Err(e) => {
                return LoopResult {
                    turns: turn,
                    tokens_in,
                    tokens_out,
                    final_text,
                    stop: Stop::Transport(e),
                };
            }
        };
        let result = match transport::run_turn(stream.as_mut(), &mut on_text).await {
            Ok(t) => t,
            Err(e) => {
                return LoopResult {
                    turns: turn,
                    tokens_in,
                    tokens_out,
                    final_text,
                    stop: Stop::Transport(e),
                };
            }
        };
        tokens_in += result.usage_in;
        tokens_out += result.usage_out;
        let turn_text = crate::stream::assistant_text(&result.content);
        if !turn_text.trim().is_empty() {
            final_text = turn_text;
        }

        // Append the assistant turn verbatim so the conversation continues.
        messages.push(json!({ "role": "assistant", "content": result.content }));

        if result.stop_reason.as_deref() != Some("tool_use") {
            return LoopResult {
                turns: turn + 1,
                tokens_in,
                tokens_out,
                final_text,
                stop: Stop::Done,
            };
        }

        // Execute each tool call -> one tool_result each (required by the API).
        let mut results: Vec<Value> = Vec::new();
        for tu in &result.tool_uses {
            let outcome = tools
                .dispatch(&tu.name, &tu.input)
                .await
                .unwrap_or_else(|| ToolOutcome::error(format!("unknown tool '{}'", tu.name)));
            results.push(json!({
                "type": "tool_result",
                "tool_use_id": tu.id,
                "content": outcome.content,
                "is_error": outcome.is_error,
            }));
        }
        messages.push(json!({ "role": "user", "content": results }));
    }

    LoopResult {
        turns: cfg.max_turns,
        tokens_in,
        tokens_out,
        final_text,
        stop: Stop::TurnCap,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tool::Tool;
    use crate::transport::ByteStream;
    use async_trait::async_trait;
    use std::sync::Mutex;

    /// Turn one canned turn into SSE bytes.
    fn sse_turn(text: &str, tool: Option<(&str, &str, Value)>) -> String {
        let mut s = String::from(
            "data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":1}}}\n",
        );
        s.push_str("data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\"}}\n");
        s.push_str(&format!(
            "data: {{\"type\":\"content_block_delta\",\"index\":0,\"delta\":{{\"type\":\"text_delta\",\"text\":{}}}}}\n",
            serde_json::to_string(text).unwrap()
        ));
        let stop = if let Some((id, name, input)) = tool {
            s.push_str(&format!(
                "data: {{\"type\":\"content_block_start\",\"index\":1,\"content_block\":{{\"type\":\"tool_use\",\"id\":{},\"name\":{}}}}}\n",
                serde_json::to_string(id).unwrap(),
                serde_json::to_string(name).unwrap()
            ));
            let frag = serde_json::to_string(&input.to_string()).unwrap();
            s.push_str(&format!(
                "data: {{\"type\":\"content_block_delta\",\"index\":1,\"delta\":{{\"type\":\"input_json_delta\",\"partial_json\":{frag}}}}}\n"
            ));
            "tool_use"
        } else {
            "end_turn"
        };
        s.push_str(&format!(
            "data: {{\"type\":\"message_delta\",\"delta\":{{\"stop_reason\":\"{stop}\"}},\"usage\":{{\"output_tokens\":2}}}}\n"
        ));
        s
    }

    struct VecStream {
        bytes: Vec<u8>,
        done: bool,
    }
    #[async_trait]
    impl ByteStream for VecStream {
        async fn next_chunk(&mut self) -> Result<Option<Vec<u8>>, String> {
            if self.done {
                Ok(None)
            } else {
                self.done = true;
                Ok(Some(std::mem::take(&mut self.bytes)))
            }
        }
    }

    /// Hands back queued canned turns, one per `open` call.
    struct MockTransport {
        queue: Mutex<Vec<String>>,
        opens: Mutex<usize>,
    }
    #[async_trait]
    impl Transport for MockTransport {
        async fn open(&self, _body: Value) -> Result<Box<dyn ByteStream>, String> {
            *self.opens.lock().unwrap() += 1;
            let next = self.queue.lock().unwrap().remove(0);
            Ok(Box::new(VecStream {
                bytes: next.into_bytes(),
                done: false,
            }))
        }
    }

    struct WriteFile;
    #[async_trait]
    impl Tool for WriteFile {
        fn name(&self) -> &str {
            "write_file"
        }
        fn description(&self) -> &str {
            "write"
        }
        fn input_schema(&self) -> Value {
            json!({ "type": "object" })
        }
        async fn call(&self, input: &Value) -> ToolOutcome {
            ToolOutcome::ok(format!(
                "wrote {}",
                input.get("path").and_then(Value::as_str).unwrap_or("?")
            ))
        }
    }

    #[tokio::test]
    async fn full_loop_dispatches_tool_then_finishes() {
        // Turn 1: model calls write_file. Turn 2: model ends.
        let transport = MockTransport {
            queue: Mutex::new(vec![
                sse_turn(
                    "let me write it",
                    Some(("t1", "write_file", json!({ "path": "a.txt" }))),
                ),
                sse_turn("all done", None),
            ]),
            opens: Mutex::new(0),
        };
        let mut tools = ToolBox::new();
        tools.register(Box::new(WriteFile));

        let mut messages = vec![json!({ "role": "user", "content": "make a.txt" })];
        let mut narrated = String::new();
        let result = run(
            &transport,
            &tools,
            &[],
            &mut messages,
            &LoopConfig::default(),
            |t| narrated.push_str(t),
        )
        .await;

        assert_eq!(result.stop, Stop::Done);
        assert_eq!(result.turns, 2);
        assert_eq!(result.final_text, "all done");
        assert_eq!(*transport.opens.lock().unwrap(), 2);
        assert!(narrated.contains("let me write it") && narrated.contains("all done"));
        // Conversation: user, assistant(tool_use), user(tool_result), assistant(text).
        assert_eq!(messages.len(), 4);
        let tool_result = &messages[2]["content"][0];
        assert_eq!(tool_result["type"], "tool_result");
        assert_eq!(tool_result["content"], "wrote a.txt");
        assert_eq!(tool_result["is_error"], false);
    }

    #[tokio::test]
    async fn unknown_tool_becomes_error_result_not_a_crash() {
        let transport = MockTransport {
            queue: Mutex::new(vec![
                sse_turn("calling", Some(("t1", "nonexistent", json!({})))),
                sse_turn("ok", None),
            ]),
            opens: Mutex::new(0),
        };
        let tools = ToolBox::new(); // empty
        let mut messages = vec![json!({ "role": "user", "content": "go" })];
        let result = run(
            &transport,
            &tools,
            &[],
            &mut messages,
            &LoopConfig::default(),
            |_| {},
        )
        .await;
        assert_eq!(result.stop, Stop::Done);
        let tr = &messages[2]["content"][0];
        assert_eq!(tr["is_error"], true);
        assert!(tr["content"].as_str().unwrap().contains("unknown tool"));
    }

    #[tokio::test]
    async fn transport_error_stops_gracefully() {
        struct Failing;
        #[async_trait]
        impl Transport for Failing {
            async fn open(&self, _body: Value) -> Result<Box<dyn ByteStream>, String> {
                Err("at capacity".to_string())
            }
        }
        let tools = ToolBox::new();
        let mut messages = vec![json!({ "role": "user", "content": "go" })];
        let result = run(
            &Failing,
            &tools,
            &[],
            &mut messages,
            &LoopConfig::default(),
            |_| {},
        )
        .await;
        assert_eq!(result.stop, Stop::Transport("at capacity".to_string()));
        assert_eq!(result.turns, 0);
    }
}
