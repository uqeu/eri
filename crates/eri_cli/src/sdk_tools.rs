//! eri's filesystem tools as `eri_agent::Tool` implementations -- the bridge
//! that lets the SDK loop driver (`eri_agent::driver::run`) drive *real* eri
//! tooling, not just mocks. This proves the SDK and the CLI share one tool
//! model: a `ToolBox` built here runs identically under the SDK driver and is
//! what a third party would use to embed eri's tools in their own agent.
//!
//! These are the path-jailed, workspace-rooted file tools (read/write/list).
//! The CLI's richer `build_agent` loop adds hooks / MCP / background / sandbox
//! on top; this module is the minimal, portable core.
//!
//! These are reference `Tool` implementations + the `filesystem_toolbox`
//! bridge, exercised by the integration test below (the SDK driver runs them
//! against a real temp workspace) and available for embedders; they aren't on
//! the CLI's own production path (which uses `build_agent`), hence `dead_code`.
#![allow(dead_code)]

use std::path::{Component, Path, PathBuf};

use async_trait::async_trait;
use eri_agent::{Tool, ToolOutcome};
use serde_json::{Value, json};

/// Resolve a workspace-relative path, refusing absolute paths and `..` escapes.
fn resolve(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let p = Path::new(rel);
    if p.is_absolute() || p.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(format!("path '{rel}' rejected: must be workspace-relative"));
    }
    Ok(root.join(p))
}

/// `write_file` -- create/overwrite a workspace file.
pub struct WriteFile {
    pub root: PathBuf,
}
#[async_trait]
impl Tool for WriteFile {
    fn name(&self) -> &str {
        "write_file"
    }
    fn description(&self) -> &str {
        "Create or overwrite a workspace-relative file with the given content."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string" },
                "content": { "type": "string" }
            },
            "required": ["path", "content"]
        })
    }
    async fn call(&self, input: &Value) -> ToolOutcome {
        let path = input.get("path").and_then(Value::as_str).unwrap_or("");
        let content = input.get("content").and_then(Value::as_str).unwrap_or("");
        let target = match resolve(&self.root, path) {
            Ok(p) => p,
            Err(e) => return ToolOutcome::error(e),
        };
        if let Some(parent) = target.parent()
            && let Err(e) = std::fs::create_dir_all(parent)
        {
            return ToolOutcome::error(format!("write_file: {e}"));
        }
        match std::fs::write(&target, content) {
            Ok(()) => ToolOutcome::ok(format!("wrote {path} ({} bytes)", content.len())),
            Err(e) => ToolOutcome::error(format!("write_file: {e}")),
        }
    }
}

/// `read_file` -- read a workspace file's text.
pub struct ReadFile {
    pub root: PathBuf,
}
#[async_trait]
impl Tool for ReadFile {
    fn name(&self) -> &str {
        "read_file"
    }
    fn description(&self) -> &str {
        "Read the full text of a workspace-relative file."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": { "path": { "type": "string" } },
            "required": ["path"]
        })
    }
    async fn call(&self, input: &Value) -> ToolOutcome {
        let path = input.get("path").and_then(Value::as_str).unwrap_or("");
        let target = match resolve(&self.root, path) {
            Ok(p) => p,
            Err(e) => return ToolOutcome::error(e),
        };
        match std::fs::read_to_string(&target) {
            Ok(s) => ToolOutcome::ok(s),
            Err(e) => ToolOutcome::error(format!("read_file: {e}")),
        }
    }
}

/// `list_dir` -- list a workspace directory.
pub struct ListDir {
    pub root: PathBuf,
}
#[async_trait]
impl Tool for ListDir {
    fn name(&self) -> &str {
        "list_dir"
    }
    fn description(&self) -> &str {
        "List files and subdirectories at a workspace-relative path."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": { "path": { "type": "string" } }
        })
    }
    async fn call(&self, input: &Value) -> ToolOutcome {
        let rel = input.get("path").and_then(Value::as_str).unwrap_or(".");
        let dir = match resolve(&self.root, rel) {
            Ok(p) => p,
            Err(e) => return ToolOutcome::error(e),
        };
        match std::fs::read_dir(&dir) {
            Ok(rd) => {
                let mut entries: Vec<String> = rd
                    .filter_map(std::result::Result::ok)
                    .map(|e| {
                        let n = e.file_name().to_string_lossy().to_string();
                        if e.path().is_dir() {
                            format!("{n}/")
                        } else {
                            n
                        }
                    })
                    .collect();
                entries.sort();
                ToolOutcome::ok(if entries.is_empty() {
                    "(empty)".to_string()
                } else {
                    entries.join("\n")
                })
            }
            Err(e) => ToolOutcome::error(format!("list_dir: {e}")),
        }
    }
}

/// A `ToolBox` of eri's portable filesystem tools, rooted at `root`. Usable
/// directly with `eri_agent::driver::run`.
pub fn filesystem_toolbox(root: &Path) -> eri_agent::ToolBox {
    let mut tb = eri_agent::ToolBox::new();
    tb.register(Box::new(WriteFile {
        root: root.to_path_buf(),
    }));
    tb.register(Box::new(ReadFile {
        root: root.to_path_buf(),
    }));
    tb.register(Box::new(ListDir {
        root: root.to_path_buf(),
    }));
    tb
}

#[cfg(test)]
mod tests {
    use super::*;
    use eri_agent::driver::{self, LoopConfig, Stop};
    use eri_agent::transport::{ByteStream, Transport};
    use std::sync::Mutex;
    use tempfile::TempDir;

    // --- a mock transport that replays canned SSE turns ---
    fn sse(text: &str, tool: Option<(&str, &str, Value)>) -> String {
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
                serde_json::to_string(id).unwrap(), serde_json::to_string(name).unwrap()
            ));
            s.push_str(&format!(
                "data: {{\"type\":\"content_block_delta\",\"index\":1,\"delta\":{{\"type\":\"input_json_delta\",\"partial_json\":{}}}}}\n",
                serde_json::to_string(&input.to_string()).unwrap()
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

    struct OneShot(Vec<u8>, bool);
    #[async_trait]
    impl ByteStream for OneShot {
        async fn next_chunk(&mut self) -> Result<Option<Vec<u8>>, String> {
            if self.1 {
                Ok(None)
            } else {
                self.1 = true;
                Ok(Some(std::mem::take(&mut self.0)))
            }
        }
    }
    struct MockTransport(Mutex<Vec<String>>);
    #[async_trait]
    impl Transport for MockTransport {
        async fn open(&self, _b: Value) -> Result<Box<dyn ByteStream>, String> {
            Ok(Box::new(OneShot(
                self.0.lock().unwrap().remove(0).into_bytes(),
                false,
            )))
        }
    }

    #[tokio::test]
    async fn sdk_driver_runs_real_eri_tools_writing_a_real_file() {
        let ws = TempDir::new().unwrap();
        let transport = MockTransport(Mutex::new(vec![
            sse("writing", Some(("t1", "write_file", json!({ "path": "out/a.txt", "content": "hi from eri" })))),
            sse("done", None),
        ]));
        let tools = filesystem_toolbox(ws.path());
        let mut messages = vec![json!({ "role": "user", "content": "make out/a.txt" })];

        let result = driver::run(
            &transport,
            &tools,
            &[],
            &mut messages,
            &LoopConfig::default(),
            |_| {},
        )
        .await;

        assert_eq!(result.stop, Stop::Done);
        // The REAL file was written by the real WriteFile tool, under the workspace.
        let written = std::fs::read_to_string(ws.path().join("out/a.txt")).unwrap();
        assert_eq!(written, "hi from eri");
        // The tool_result the model saw confirms the byte count.
        let tr = &messages[2]["content"][0];
        assert_eq!(tr["is_error"], false);
        assert!(tr["content"].as_str().unwrap().contains("wrote out/a.txt"));
    }

    #[tokio::test]
    async fn write_tool_rejects_escape() {
        let ws = TempDir::new().unwrap();
        let tools = filesystem_toolbox(ws.path());
        let out = tools
            .dispatch("write_file", &json!({ "path": "../evil.txt", "content": "x" }))
            .await
            .unwrap();
        assert!(out.is_error);
        assert!(!ws.path().parent().unwrap().join("evil.txt").exists());
    }
}
