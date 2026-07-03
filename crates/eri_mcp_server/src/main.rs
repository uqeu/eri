//! `eri-mcp-server` — MCP-protocol server exposing eri's brain to any
//! MCP-aware client (Claude Code, Cursor, Cline, ChatGPT desktop, etc.).
//!
//! This is the **backdoor distribution play** in Phase 22b: even users
//! who don't install the full eri.app desktop can drop a snippet into
//! their existing client's `mcp.json` and call `eri.search`,
//! `eri.recall`, `eri.remember`, `eri.tracer`, `eri.document` like any
//! other tool. We expect this to pull power users upmarket toward the
//! native experience once they trust the brain.
//!
//! Protocol: MCP over stdio (JSON-RPC 2.0, line-buffered, Content-Length
//! framing optional). We implement the minimum: `initialize`, `tools/list`,
//! `tools/call`, `ping`. Resources / prompts / sampling are stubbed for now.

use std::io::Write as _;

use anyhow::Context;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

mod tools;

const PROTOCOL_VERSION: &str = "2024-11-05";
const SERVER_NAME: &str = "eri";
const SERVER_VERSION: &str = "0.1.0";

#[derive(Debug, Deserialize)]
struct JsonRpcRequest {
    #[allow(dead_code)]
    jsonrpc: String,
    id: Option<Value>,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Debug, Serialize)]
struct JsonRpcResponse {
    jsonrpc: &'static str,
    id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<JsonRpcError>,
}

#[derive(Debug, Serialize)]
struct JsonRpcError {
    code: i32,
    message: String,
}

const PARSE_ERROR: i32 = -32700;
const METHOD_NOT_FOUND: i32 = -32601;
const INVALID_PARAMS: i32 = -32602;
const INTERNAL_ERROR: i32 = -32603;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber_init();

    let stdin = tokio::io::stdin();
    let mut reader = BufReader::new(stdin).lines();
    let mut stdout = tokio::io::stdout();

    while let Some(line) = reader.next_line().await.context("read stdin")? {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let response = match serde_json::from_str::<JsonRpcRequest>(trimmed) {
            Ok(req) => handle_request(req).await,
            Err(err) => Some(error_response(
                Value::Null,
                PARSE_ERROR,
                format!("parse error: {err}"),
            )),
        };
        if let Some(resp) = response {
            let body = serde_json::to_string(&resp).context("serialize response")?;
            stdout.write_all(body.as_bytes()).await?;
            stdout.write_all(b"\n").await?;
            stdout.flush().await?;
        }
    }
    Ok(())
}

fn tracing_subscriber_init() {
    // MCP servers log to stderr only — stdout is reserved for JSON-RPC.
    let _ = std::io::stderr().write_all(
        format!(
            "[{}] eri-mcp-server starting (protocol {PROTOCOL_VERSION})\n",
            std::process::id()
        )
        .as_bytes(),
    );
}

async fn handle_request(req: JsonRpcRequest) -> Option<JsonRpcResponse> {
    let id = req.id.clone();
    match req.method.as_str() {
        "initialize" => Some(success(id.unwrap_or(Value::Null), initialize_result())),
        // The client signals it's done initialising via this notification;
        // we don't reply to notifications (id is None).
        "notifications/initialized" => None,
        "ping" => Some(success(id.unwrap_or(Value::Null), serde_json::json!({}))),
        "tools/list" => Some(success(
            id.unwrap_or(Value::Null),
            serde_json::json!({ "tools": tools::manifest() }),
        )),
        "tools/call" => Some(handle_tool_call(id.unwrap_or(Value::Null), req.params).await),
        "resources/list" => Some(success(
            id.unwrap_or(Value::Null),
            serde_json::json!({ "resources": [] }),
        )),
        "prompts/list" => Some(success(
            id.unwrap_or(Value::Null),
            serde_json::json!({ "prompts": [] }),
        )),
        other if other.starts_with("notifications/") => None,
        other => Some(error_response(
            id.unwrap_or(Value::Null),
            METHOD_NOT_FOUND,
            format!("method not found: {other}"),
        )),
    }
}

fn initialize_result() -> Value {
    serde_json::json!({
        "protocolVersion": PROTOCOL_VERSION,
        "serverInfo": {
            "name": SERVER_NAME,
            "version": SERVER_VERSION,
        },
        "capabilities": {
            "tools": { "listChanged": false },
            "resources": {},
            "prompts": {},
        },
        "instructions": "eri's brain over MCP. Call `eri.search` to query the user's local indexed codebase, `eri.recall` / `eri.remember` for personal context, `eri.tracer` for ephemeral GitHub repo Q&A, and `eri.document` to extract from PDFs."
    })
}

async fn handle_tool_call(id: Value, params: Value) -> JsonRpcResponse {
    #[derive(Deserialize)]
    struct ToolCallParams {
        name: String,
        #[serde(default)]
        arguments: Value,
    }
    let p: ToolCallParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(err) => {
            return error_response(id, INVALID_PARAMS, format!("tools/call params: {err}"));
        }
    };
    match tools::dispatch(&p.name, p.arguments).await {
        Ok(text) => success(
            id,
            serde_json::json!({
                "content": [{ "type": "text", "text": text }],
                "isError": false,
            }),
        ),
        Err(err) => success(
            id,
            serde_json::json!({
                "content": [{ "type": "text", "text": format!("error: {err}") }],
                "isError": true,
            }),
        ),
    }
}

fn success(id: Value, result: Value) -> JsonRpcResponse {
    JsonRpcResponse {
        jsonrpc: "2.0",
        id,
        result: Some(result),
        error: None,
    }
}

fn error_response(id: Value, code: i32, message: String) -> JsonRpcResponse {
    JsonRpcResponse {
        jsonrpc: "2.0",
        id,
        result: None,
        error: Some(JsonRpcError { code, message }),
    }
}

#[allow(dead_code)]
fn internal_error(id: Value, err: anyhow::Error) -> JsonRpcResponse {
    error_response(id, INTERNAL_ERROR, err.to_string())
}
