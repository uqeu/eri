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

#[pymodule]
fn eri_agent_py(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(estimate_tokens, m)?)?;
    m.add_function(wrap_pyfunction!(shape_context, m)?)?;
    m.add_function(wrap_pyfunction!(permission_allows_writes, m)?)?;
    m.add_function(wrap_pyfunction!(permission_allows_shell, m)?)?;
    m.add_function(wrap_pyfunction!(style_directive, m)?)?;
    m.add_function(wrap_pyfunction!(messages_body, m)?)?;
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
