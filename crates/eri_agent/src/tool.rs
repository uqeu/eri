//! The custom-tool interface -- the defining extension point of the SDK. A
//! host (or a third party) implements [`Tool`] for each capability the agent
//! can call; a [`ToolBox`] collects them, renders the Anthropic `tools` specs,
//! and dispatches a `tool_use` by name. The loop never hard-codes a tool set.

use async_trait::async_trait;
use serde_json::{Value, json};

/// The result of invoking a tool. `is_error: true` is surfaced to the model as a
/// tool-level failure (it can adapt) rather than aborting the run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolOutcome {
    pub content: String,
    pub is_error: bool,
}

impl ToolOutcome {
    pub fn ok(content: impl Into<String>) -> Self {
        Self {
            content: content.into(),
            is_error: false,
        }
    }
    pub fn error(content: impl Into<String>) -> Self {
        Self {
            content: content.into(),
            is_error: true,
        }
    }
}

/// A capability the agent can call. Implement this to extend the agent.
#[async_trait]
pub trait Tool: Send + Sync {
    /// Unique tool name (what the model emits in a `tool_use`).
    fn name(&self) -> &str;
    /// One-line description shown to the model.
    fn description(&self) -> &str;
    /// JSON-Schema for the tool's input object.
    fn input_schema(&self) -> Value;
    /// Execute the call. `input` is the model-supplied argument object.
    async fn call(&self, input: &Value) -> ToolOutcome;

    /// The Anthropic tool spec assembled from `name`/`description`/`input_schema`.
    fn spec(&self) -> Value {
        json!({
            "name": self.name(),
            "description": self.description(),
            "input_schema": self.input_schema(),
        })
    }
}

/// A named collection of tools: renders the `tools` array and dispatches calls.
#[derive(Default)]
pub struct ToolBox {
    tools: Vec<Box<dyn Tool>>,
}

impl ToolBox {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a tool. A later registration with the same name shadows an
    /// earlier one (last-wins), so hosts can override built-ins.
    pub fn register(&mut self, tool: Box<dyn Tool>) -> &mut Self {
        let name = tool.name().to_string();
        self.tools.retain(|t| t.name() != name);
        self.tools.push(tool);
        self
    }

    /// The Anthropic `tools` array (one spec per registered tool).
    pub fn specs(&self) -> Value {
        Value::Array(self.tools.iter().map(|t| t.spec()).collect())
    }

    /// Registered tool names, in registration order.
    pub fn names(&self) -> Vec<&str> {
        self.tools.iter().map(|t| t.name()).collect()
    }

    /// Dispatch a `tool_use` by name. `None` if no tool owns that name (the host
    /// turns that into an error tool_result).
    pub async fn dispatch(&self, name: &str, input: &Value) -> Option<ToolOutcome> {
        let tool = self.tools.iter().find(|t| t.name() == name)?;
        Some(tool.call(input).await)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A tool that echoes its `text` input (or errors on empty).
    struct Echo;
    #[async_trait]
    impl Tool for Echo {
        fn name(&self) -> &str {
            "echo"
        }
        fn description(&self) -> &str {
            "Echo the text back."
        }
        fn input_schema(&self) -> Value {
            json!({ "type": "object", "properties": { "text": { "type": "string" } } })
        }
        async fn call(&self, input: &Value) -> ToolOutcome {
            match input.get("text").and_then(Value::as_str) {
                Some(t) if !t.is_empty() => ToolOutcome::ok(t),
                _ => ToolOutcome::error("echo: empty text"),
            }
        }
    }

    #[tokio::test]
    async fn toolbox_specs_dispatch_and_unknown() {
        let mut tb = ToolBox::new();
        tb.register(Box::new(Echo));
        assert_eq!(tb.names(), vec!["echo"]);

        let specs = tb.specs();
        assert_eq!(specs[0]["name"], "echo");
        assert_eq!(specs[0]["input_schema"]["type"], "object");

        let ok = tb.dispatch("echo", &json!({ "text": "hi" })).await.unwrap();
        assert_eq!(ok, ToolOutcome::ok("hi"));
        let err = tb.dispatch("echo", &json!({ "text": "" })).await.unwrap();
        assert!(err.is_error);
        // Unknown tool -> None.
        assert!(tb.dispatch("nope", &json!({})).await.is_none());
    }

    #[tokio::test]
    async fn register_last_wins_on_name_collision() {
        struct Echo2;
        #[async_trait]
        impl Tool for Echo2 {
            fn name(&self) -> &str {
                "echo"
            }
            fn description(&self) -> &str {
                "v2"
            }
            fn input_schema(&self) -> Value {
                json!({ "type": "object" })
            }
            async fn call(&self, _input: &Value) -> ToolOutcome {
                ToolOutcome::ok("v2")
            }
        }
        let mut tb = ToolBox::new();
        tb.register(Box::new(Echo));
        tb.register(Box::new(Echo2));
        assert_eq!(tb.names().len(), 1, "same name shadows");
        let out = tb.dispatch("echo", &json!({})).await.unwrap();
        assert_eq!(out, ToolOutcome::ok("v2"));
    }
}
