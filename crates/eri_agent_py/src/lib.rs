//! Python bindings over the `eri_agent` SDK core (PyO3).
//!
//! Exposes the transport-agnostic building blocks to Python so a Python host can
//! reuse eri's context-compaction, permission model, output styles, and request
//! shaping without reimplementing them. Interop is over JSON strings (the
//! Anthropic Messages wire shape), which keeps the surface tiny and stable.
//!
//! Build (from this directory):  `maturin develop`  (or `cargo build`).
//! Then in Python:
//! ```python
//! import eri_agent_py as e
//! e.permission_allows_shell("workspace-write")   # True
//! shaped, n = e.shape_context(messages_json, 150_000)
//! ```

use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use serde_json::Value;

use eri_agent::{PermissionMode, SystemStyle};

/// Parse a JSON array-of-messages string into `Vec<Value>`.
fn parse_messages(json: &str) -> PyResult<Vec<Value>> {
    let v: Value = serde_json::from_str(json)
        .map_err(|e| PyValueError::new_err(format!("invalid JSON: {e}")))?;
    match v {
        Value::Array(a) => Ok(a),
        _ => Err(PyValueError::new_err("expected a JSON array of messages")),
    }
}

/// Estimate the token footprint of a JSON messages array (chars/4 heuristic).
#[pyfunction]
fn estimate_tokens(messages_json: &str) -> PyResult<usize> {
    Ok(eri_agent::compaction::estimate_tokens(&parse_messages(
        messages_json,
    )?))
}

/// Shape a messages array under `target_tokens` (the layered compaction
/// pipeline). Returns `(shaped_json, tokens_after)`.
#[pyfunction]
fn shape_context(messages_json: &str, target_tokens: usize) -> PyResult<(String, usize)> {
    let mut messages = parse_messages(messages_json)?;
    let report = eri_agent::compaction::shape_context(&mut messages, target_tokens);
    let shaped = serde_json::to_string(&messages)
        .map_err(|e| PyValueError::new_err(format!("serialize: {e}")))?;
    Ok((shaped, report.tokens_after))
}

fn parse_mode(s: &str) -> PermissionMode {
    PermissionMode::from_legacy_flags(s == "plan", s == "workspace-write" || s == "bypass")
}

/// Whether a permission mode allows file writes. Mode is one of
/// `plan|accept-edits|workspace-write|bypass`.
#[pyfunction]
fn permission_allows_writes(mode: &str) -> bool {
    parse_mode(mode).allows_writes()
}

/// Whether a permission mode allows the shell tool.
#[pyfunction]
fn permission_allows_shell(mode: &str) -> bool {
    parse_mode(mode).allows_shell()
}

/// The output-style directive for a style name (`reviewer|explainer|concise`),
/// or `None` for the default `builder`.
#[pyfunction]
fn style_directive(style: &str) -> Option<String> {
    SystemStyle::parse(style).directive().map(str::to_string)
}

/// Build a streaming Messages request body. `system`/`tools`/`messages` are JSON
/// strings; returns the request body as a JSON string.
#[pyfunction]
fn messages_body(
    model: &str,
    max_tokens: u32,
    system_json: &str,
    tools_json: &str,
    messages_json: &str,
) -> PyResult<String> {
    let parse = |j: &str| -> PyResult<Value> {
        serde_json::from_str(j).map_err(|e| PyValueError::new_err(format!("invalid JSON: {e}")))
    };
    let system = match parse(system_json)? {
        Value::Array(a) => a,
        _ => return Err(PyValueError::new_err("system must be a JSON array")),
    };
    let tools = parse(tools_json)?;
    let messages = parse_messages(messages_json)?;
    let body = eri_agent::request::messages_body(model, max_tokens, &system, &tools, &messages);
    serde_json::to_string(&body).map_err(|e| PyValueError::new_err(format!("serialize: {e}")))
}

/// Run a full agent loop driven by Python callbacks. Synchronous: the host owns
/// the I/O.
///
/// - `transport(body_json: str) -> sse_text: str` makes the model call and
///   returns the full SSE response text.
/// - `tools` maps a tool name to `fn(input_json: str) -> dict(content=str,
///   is_error=bool)`; `tool_specs_json` is the Anthropic `tools` array.
///
/// Returns a dict: `final_text`, `turns`, `tokens_in`, `tokens_out`, `stop`
/// ("done" | "turn_cap"), and `messages` (the final conversation as JSON).
#[pyfunction]
#[pyo3(signature = (model, system_json, messages_json, transport, tools, tool_specs_json, max_turns=24))]
#[allow(clippy::too_many_arguments)]
fn run_agent(
    py: Python<'_>,
    model: &str,
    system_json: &str,
    messages_json: &str,
    transport: PyObject,
    tools: &Bound<'_, pyo3::types::PyDict>,
    tool_specs_json: &str,
    max_turns: usize,
) -> PyResult<PyObject> {
    let system = match serde_json::from_str::<Value>(system_json)
        .map_err(|e| PyValueError::new_err(format!("system: {e}")))?
    {
        Value::Array(a) => a,
        _ => return Err(PyValueError::new_err("system must be a JSON array")),
    };
    let specs: Value = serde_json::from_str(tool_specs_json)
        .map_err(|e| PyValueError::new_err(format!("tool_specs: {e}")))?;
    let mut messages = parse_messages(messages_json)?;

    let mut tokens_in = 0u64;
    let mut tokens_out = 0u64;
    let mut final_text = String::new();

    for turn in 0..max_turns {
        eri_agent::compaction::shape_context(&mut messages, 150_000);
        let body = eri_agent::request::messages_body(model, 32_000, &system, &specs, &messages);
        // Call the Python transport synchronously; it returns the SSE text.
        let sse: String = transport
            .call1(py, (body.to_string(),))?
            .extract::<String>(py)?;

        // Parse the SSE via the SDK accumulator.
        let mut acc = eri_agent::TurnAccumulator::new();
        for line in sse.lines() {
            if let Some(payload) = line.strip_prefix("data:").map(str::trim) {
                if !payload.is_empty() {
                    if let Ok(ev) = serde_json::from_str::<Value>(payload) {
                        acc.push_event(&ev);
                    }
                }
            }
        }
        let result = acc.finish();
        tokens_in += result.usage_in;
        tokens_out += result.usage_out;
        let text = eri_agent::stream::assistant_text(&result.content);
        if !text.trim().is_empty() {
            final_text = text;
        }
        messages.push(serde_json::json!({ "role": "assistant", "content": result.content }));

        if result.stop_reason.as_deref() != Some("tool_use") {
            return finish_result(py, turn + 1, tokens_in, tokens_out, &final_text, "done", &messages);
        }

        // Dispatch each tool call through the Python tool callbacks.
        let mut results: Vec<Value> = Vec::new();
        for tu in &result.tool_uses {
            let (content, is_error) = match tools.get_item(&tu.name)? {
                Some(callable) => {
                    let out = callable.call1((tu.input.to_string(),))?;
                    let content: String = out
                        .get_item("content")
                        .ok()
                        .and_then(|v| v.extract::<String>().ok())
                        .unwrap_or_default();
                    let is_error: bool = out
                        .get_item("is_error")
                        .ok()
                        .and_then(|v| v.extract::<bool>().ok())
                        .unwrap_or(false);
                    (content, is_error)
                }
                None => (format!("unknown tool '{}'", tu.name), true),
            };
            results.push(serde_json::json!({
                "type": "tool_result",
                "tool_use_id": tu.id,
                "content": content,
                "is_error": is_error,
            }));
        }
        messages.push(serde_json::json!({ "role": "user", "content": results }));
    }

    finish_result(py, max_turns, tokens_in, tokens_out, &final_text, "turn_cap", &messages)
}

#[allow(clippy::too_many_arguments)]
fn finish_result(
    py: Python<'_>,
    turns: usize,
    tokens_in: u64,
    tokens_out: u64,
    final_text: &str,
    stop: &str,
    messages: &[Value],
) -> PyResult<PyObject> {
    let dict = pyo3::types::PyDict::new_bound(py);
    dict.set_item("turns", turns)?;
    dict.set_item("tokens_in", tokens_in)?;
    dict.set_item("tokens_out", tokens_out)?;
    dict.set_item("final_text", final_text)?;
    dict.set_item("stop", stop)?;
    dict.set_item(
        "messages",
        serde_json::to_string(messages)
            .map_err(|e| PyValueError::new_err(format!("serialize: {e}")))?,
    )?;
    Ok(dict.into())
}

#[pymodule]
fn eri_agent_py(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(estimate_tokens, m)?)?;
    m.add_function(wrap_pyfunction!(shape_context, m)?)?;
    m.add_function(wrap_pyfunction!(permission_allows_writes, m)?)?;
    m.add_function(wrap_pyfunction!(permission_allows_shell, m)?)?;
    m.add_function(wrap_pyfunction!(style_directive, m)?)?;
    m.add_function(wrap_pyfunction!(messages_body, m)?)?;
    m.add_function(wrap_pyfunction!(run_agent, m)?)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    // Pure conversion logic, testable as an rlib without a Python interpreter.
    use super::parse_mode;
    use eri_agent::PermissionMode;

    #[test]
    fn parse_mode_maps_strings() {
        assert_eq!(parse_mode("plan"), PermissionMode::Plan);
        assert_eq!(parse_mode("workspace-write"), PermissionMode::WorkspaceWrite);
        assert_eq!(parse_mode("bypass"), PermissionMode::WorkspaceWrite);
        assert_eq!(parse_mode("accept-edits"), PermissionMode::AcceptEdits);
        assert_eq!(parse_mode("whatever"), PermissionMode::AcceptEdits);
    }
}
