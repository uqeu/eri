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
