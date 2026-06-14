//! eri AS an MCP server — exposes eri's local capabilities (memory: semantic
//! code search + remember/recall) over the Model Context Protocol so ANY MCP
//! client (Claude Desktop, Cursor, other agents) can use eri's brain.
//!
//! This is the inverse of `eri_mcp` (which is the *client* that consumes other
//! servers). Transport is newline-delimited JSON-RPC 2.0 over stdio — the
//! standard MCP stdio framing. The request→response dispatch
//! ([`handle_request`]) is PURE and unit-tested; [`serve`] is just the stdio
//! pump around it.
//!
//! Wire it into a client config, e.g. Claude Desktop:
//! ```json
//! { "mcpServers": { "eri": { "command": "eri", "args": ["mcp", "serve"] } } }
//! ```

use serde_json::{Value, json};

use crate::memory_tools::{self, MemoryCtx};

const PROTOCOL_VERSION: &str = "2024-11-05";
const JSONRPC: &str = "2.0";

/// Handle one parsed JSON-RPC message. Returns `Some(response)` for requests
/// (anything with an `id`) and `None` for notifications (no `id` → no reply).
/// Pure: no I/O, so it's fully unit-testable.
pub fn handle_request(ctx: &MemoryCtx, req: &Value) -> Option<Value> {
    let method = req.get("method").and_then(Value::as_str);
    let id = req.get("id").cloned();

    // Notifications (no id) get no response — including unknown ones.
    let id = id?;

    let method = match method {
        Some(m) => m,
        None => return Some(error(id, -32600, "invalid request: missing method")),
    };

    let result: Value = match method {
        "initialize" => json!({
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "eri", "version": env!("CARGO_PKG_VERSION") },
        }),
        "ping" => json!({}),
        "tools/list" => json!({ "tools": memory_tools::tool_specs() }),
        "tools/call" => {
            let params = req.get("params").cloned().unwrap_or_else(|| json!({}));
            let name = params.get("name").and_then(Value::as_str).unwrap_or("");
            let args = params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));
            if !memory_tools::owns(name) {
                // MCP convention: tool errors come back as a normal result with
                // isError, not a protocol error, so the model can react to them.
                json!({
                    "content": [{ "type": "text", "text": format!("unknown tool: {name}") }],
                    "isError": true,
                })
            } else {
                let exec = memory_tools::dispatch(ctx, name, &args);
                json!({
                    "content": [{ "type": "text", "text": exec.content }],
                    "isError": exec.is_error,
                })
            }
        }
        other => return Some(error(id, -32601, &format!("method not found: {other}"))),
    };

    Some(json!({ "jsonrpc": JSONRPC, "id": id, "result": result }))
}

fn error(id: Value, code: i64, message: &str) -> Value {
    json!({
        "jsonrpc": JSONRPC,
        "id": id,
        "error": { "code": code, "message": message },
    })
}

/// Run the MCP server over stdio (newline-delimited JSON-RPC). Blocks until
/// stdin closes. Best-effort per line: a malformed line is skipped, never fatal.
pub fn serve(ctx: &MemoryCtx) -> anyhow::Result<()> {
    use std::io::{BufRead, Write};
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let req: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if let Some(resp) = handle_request(ctx, &req) {
            writeln!(stdout, "{resp}")?;
            stdout.flush()?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn ctx() -> (TempDir, MemoryCtx) {
        let dir = TempDir::new().unwrap();
        // Isolated store file per test — never the real ~/.eri (which would race
        // sibling tests on shared global state, flaking remember→recall).
        let ctx = MemoryCtx::open_at(dir.path(), dir.path().join("memory.json"));
        (dir, ctx)
    }

    fn req(id: i64, method: &str, params: Value) -> Value {
        json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })
    }

    #[test]
    fn initialize_advertises_tools_capability() {
        let (_d, ctx) = ctx();
        let resp = handle_request(&ctx, &req(1, "initialize", json!({}))).unwrap();
        assert_eq!(resp["id"], json!(1));
        assert_eq!(resp["result"]["serverInfo"]["name"], "eri");
        assert!(resp["result"]["capabilities"]["tools"].is_object());
    }

    #[test]
    fn tools_list_returns_the_memory_tools() {
        let (_d, ctx) = ctx();
        let resp = handle_request(&ctx, &req(2, "tools/list", json!({}))).unwrap();
        let tools = resp["result"]["tools"].as_array().unwrap();
        let names: Vec<&str> = tools.iter().map(|t| t["name"].as_str().unwrap()).collect();
        assert!(names.contains(&"search_context"));
        assert!(names.contains(&"remember"));
        assert!(names.contains(&"recall"));
    }

    #[test]
    fn tools_call_remember_then_recall_round_trips() {
        let (_d, ctx) = ctx();
        let store = handle_request(
            &ctx,
            &req(
                3,
                "tools/call",
                json!({ "name": "remember", "arguments": { "fact": "deploys on vercel" } }),
            ),
        )
        .unwrap();
        assert_eq!(store["result"]["isError"], json!(false));

        let recall = handle_request(
            &ctx,
            &req(
                4,
                "tools/call",
                json!({ "name": "recall", "arguments": { "query": "where does it deploy" } }),
            ),
        )
        .unwrap();
        let text = recall["result"]["content"][0]["text"].as_str().unwrap();
        assert!(
            text.contains("vercel"),
            "expected recalled fact, got: {text}"
        );
    }

    #[test]
    fn unknown_tool_is_an_iserror_result_not_a_protocol_error() {
        let (_d, ctx) = ctx();
        let resp = handle_request(
            &ctx,
            &req(5, "tools/call", json!({ "name": "rm_rf", "arguments": {} })),
        )
        .unwrap();
        assert!(
            resp.get("error").is_none(),
            "should be a tool result, not a protocol error"
        );
        assert_eq!(resp["result"]["isError"], json!(true));
    }

    #[test]
    fn unknown_method_is_a_protocol_error() {
        let (_d, ctx) = ctx();
        let resp = handle_request(&ctx, &req(6, "nonsense/method", json!({}))).unwrap();
        assert_eq!(resp["error"]["code"], json!(-32601));
    }

    #[test]
    fn notifications_get_no_response() {
        let (_d, ctx) = ctx();
        // No `id` => notification => no reply (per JSON-RPC).
        let note = json!({ "jsonrpc": "2.0", "method": "notifications/initialized" });
        assert!(handle_request(&ctx, &note).is_none());
    }

    #[test]
    fn ping_responds_empty() {
        let (_d, ctx) = ctx();
        let resp = handle_request(&ctx, &req(7, "ping", json!({}))).unwrap();
        assert_eq!(resp["result"], json!({}));
    }
}
