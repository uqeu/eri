//! Thin auto-instrumentation helpers for recording common eri events into the
//! graph without callers writing SQL or constructing `Node`/`Edge` literals.
//!
//! These wrap `Graph::insert_node` / `insert_edge` with canonical bodies for
//! each event kind. They are intentionally side-effect-free apart from the
//! graph write so callers can layer their own telemetry on top.
//!
//! NOTE: These helpers are NOT wired into `eri_inference` yet — that's a
//! follow-up. They sit here ready to be called from wherever the events
//! actually originate.

use serde_json::json;

use crate::types::{Edge, Node, NodeId, edge_kind, node_kind};
use crate::{Graph, GraphError};

/// Record a user-typed (or voice-transcribed) prompt.
pub fn record_prompt(graph: &Graph, body: &str) -> Result<NodeId, GraphError> {
    let node = Node::new(
        node_kind::PROMPT,
        json!({
            "text": body,
            "len": body.chars().count(),
        }),
    );
    graph.insert_node(node)
}

/// Record a raw voice transcript (before intent classification). Returns the
/// new node id; pair with `record_prompt` via `caused_by` if you want both.
pub fn record_voice_transcript(
    graph: &Graph,
    transcript: &str,
    confidence: Option<f32>,
) -> Result<NodeId, GraphError> {
    let mut body = json!({ "text": transcript });
    if let (Some(obj), Some(c)) = (body.as_object_mut(), confidence) {
        obj.insert("confidence".into(), json!(c));
    }
    graph.insert_node(Node::new(node_kind::VOICE_TRANSCRIPT, body))
}

/// Record a classified intent. Adds a `caused_by` edge from `intent -> prompt`.
pub fn record_intent(
    graph: &Graph,
    prompt_id: &NodeId,
    intent: &str,
) -> Result<NodeId, GraphError> {
    let intent_id = graph.insert_node(Node::new(node_kind::INTENT, json!({ "label": intent })))?;
    graph.insert_edge(Edge::new(
        intent_id.clone(),
        prompt_id.clone(),
        edge_kind::CAUSED_BY,
    ))?;
    Ok(intent_id)
}

/// Record an outbound model call. Adds a `caused_by` edge from
/// `model_call -> intent`.
pub fn record_model_call(
    graph: &Graph,
    intent_id: &NodeId,
    provider: &str,
    model: &str,
    tokens_in: u32,
    tokens_out: u32,
    latency_ms: u64,
) -> Result<NodeId, GraphError> {
    let id = graph.insert_node(Node::new(
        node_kind::MODEL_CALL,
        json!({
            "provider": provider,
            "model": model,
            "tokens_in": tokens_in,
            "tokens_out": tokens_out,
            "latency_ms": latency_ms,
        }),
    ))?;
    graph.insert_edge(Edge::new(
        id.clone(),
        intent_id.clone(),
        edge_kind::CAUSED_BY,
    ))?;
    Ok(id)
}

/// Record a model response. Adds a `caused_by` edge from
/// `model_response -> model_call`.
pub fn record_model_response(
    graph: &Graph,
    model_call_id: &NodeId,
    text: &str,
    finish_reason: &str,
) -> Result<NodeId, GraphError> {
    let id = graph.insert_node(Node::new(
        node_kind::MODEL_RESPONSE,
        json!({
            "text": text,
            "finish_reason": finish_reason,
            "len": text.chars().count(),
        }),
    ))?;
    graph.insert_edge(Edge::new(
        id.clone(),
        model_call_id.clone(),
        edge_kind::CAUSED_BY,
    ))?;
    Ok(id)
}

/// Record an edit that was proposed (search/replace block emitted by model).
pub fn record_edit_proposed(
    graph: &Graph,
    model_response_id: &NodeId,
    path: &str,
    summary: &str,
) -> Result<NodeId, GraphError> {
    let id = graph.insert_node(Node::new(
        node_kind::EDIT_PROPOSED,
        json!({
            "path": path,
            "summary": summary,
        }),
    ))?;
    graph.insert_edge(Edge::new(
        id.clone(),
        model_response_id.clone(),
        edge_kind::CAUSED_BY,
    ))?;
    Ok(id)
}

/// Record that an edit was applied. Adds a `caused_by` edge from
/// `edit_applied -> model_call` (the originating call) so the agent can
/// trace any applied diff back to the request that spawned it.
pub fn record_edit_applied(
    graph: &Graph,
    model_call_id: &NodeId,
    path: &str,
    before_bytes: usize,
    after_bytes: usize,
) -> Result<NodeId, GraphError> {
    let id = graph.insert_node(Node::new(
        node_kind::EDIT_APPLIED,
        json!({
            "path": path,
            "before_bytes": before_bytes,
            "after_bytes": after_bytes,
            "delta_bytes": after_bytes as i64 - before_bytes as i64,
        }),
    ))?;
    graph.insert_edge(Edge::new(
        id.clone(),
        model_call_id.clone(),
        edge_kind::CAUSED_BY,
    ))?;
    Ok(id)
}

/// Record a rejected edit proposal.
pub fn record_edit_rejected(
    graph: &Graph,
    edit_proposed_id: &NodeId,
    reason: Option<&str>,
) -> Result<NodeId, GraphError> {
    let id = graph.insert_node(Node::new(
        node_kind::EDIT_REJECTED,
        json!({
            "reason": reason.unwrap_or("(unspecified)"),
        }),
    ))?;
    graph.insert_edge(Edge::new(
        id.clone(),
        edit_proposed_id.clone(),
        edge_kind::CAUSED_BY,
    ))?;
    Ok(id)
}

/// Record a file touched (read, edited, or referenced). Caller links it to
/// the originating node via `Graph::insert_edge` if desired.
pub fn record_file_touched(graph: &Graph, path: &str) -> Result<NodeId, GraphError> {
    graph.insert_node(Node::new(node_kind::FILE_TOUCHED, json!({ "path": path })))
}

/// Record a symbol reference (function, class, type).
pub fn record_symbol(graph: &Graph, name: &str, file: Option<&str>) -> Result<NodeId, GraphError> {
    let mut body = json!({ "name": name });
    if let (Some(obj), Some(f)) = (body.as_object_mut(), file) {
        obj.insert("file".into(), json!(f));
    }
    graph.insert_node(Node::new(node_kind::SYMBOL, body))
}

/// Record a git checkpoint. `parent_checkpoint` is an optional previous
/// checkpoint to link via `derived_from`.
pub fn record_checkpoint(
    graph: &Graph,
    sha: &str,
    message: &str,
    parent_checkpoint: Option<&NodeId>,
) -> Result<NodeId, GraphError> {
    let id = graph.insert_node(Node::new(
        node_kind::CHECKPOINT,
        json!({
            "sha": sha,
            "message": message,
        }),
    ))?;
    if let Some(parent) = parent_checkpoint {
        graph.insert_edge(Edge::new(
            id.clone(),
            parent.clone(),
            edge_kind::DERIVED_FROM,
        ))?;
    }
    Ok(id)
}

/// Record a runtime/build/test error. `context_id` is an optional source node
/// (e.g. the `edit_applied` that triggered it) linked via `caused_by`.
pub fn record_error(
    graph: &Graph,
    context_id: Option<&NodeId>,
    message: &str,
) -> Result<NodeId, GraphError> {
    let id = graph.insert_node(Node::new(node_kind::ERROR, json!({ "message": message })))?;
    if let Some(ctx) = context_id {
        graph.insert_edge(Edge::new(id.clone(), ctx.clone(), edge_kind::CAUSED_BY))?;
    }
    Ok(id)
}

/// Record a manual user note ("remember this").
pub fn record_note(graph: &Graph, body: &str, tags: Vec<String>) -> Result<NodeId, GraphError> {
    graph.insert_node(Node::new(node_kind::NOTE, json!({ "text": body })).with_tags(tags))
}
