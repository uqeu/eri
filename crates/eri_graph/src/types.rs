//! Core node/edge value types for the eri agent-memory knowledge graph.
//!
//! Every prompt, voice transcript, edit, model call, checkpoint, and error
//! becomes a node; relationships between them are edges. The graph is the
//! "memory" layer the agent queries when it needs to recall past context.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// ULID-encoded identifier. Sortable by creation time and globally unique
/// without coordination.
pub type NodeId = String;
pub type EdgeId = String;

/// Direction filter for neighbor lookups.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Direction {
    /// Out-edges: edges where `src == node`.
    Out,
    /// In-edges: edges where `dst == node`.
    In,
    /// Both directions, deduplicated by edge id.
    Both,
}

/// Canonical node kinds. These are strings on the wire (and in SQLite) so the
/// taxonomy can evolve without a schema migration; the constants below catch
/// typos at the call site.
pub mod node_kind {
    pub const PROMPT: &str = "prompt";
    pub const VOICE_TRANSCRIPT: &str = "voice_transcript";
    pub const INTENT: &str = "intent";
    pub const MODEL_CALL: &str = "model_call";
    pub const MODEL_RESPONSE: &str = "model_response";
    pub const EDIT_PROPOSED: &str = "edit_proposed";
    pub const EDIT_APPLIED: &str = "edit_applied";
    pub const EDIT_REJECTED: &str = "edit_rejected";
    pub const FILE_TOUCHED: &str = "file_touched";
    pub const SYMBOL: &str = "symbol";
    pub const CHECKPOINT: &str = "checkpoint";
    pub const ERROR: &str = "error";
    pub const NOTE: &str = "note";
    pub const SESSION: &str = "session";
}

/// Canonical edge kinds.
pub mod edge_kind {
    pub const CAUSED_BY: &str = "caused_by";
    pub const REFERENCES: &str = "references";
    pub const FOLLOWS: &str = "follows";
    pub const BELONGS_TO_SESSION: &str = "belongs_to_session";
    pub const DERIVED_FROM: &str = "derived_from";
    pub const UNDID: &str = "undid";
    pub const RELATED_TO: &str = "related_to";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Node {
    pub id: NodeId,
    pub kind: String,
    pub created_at_ms: u64,
    pub body: Value,
    pub tags: Vec<String>,
}

impl Node {
    /// Helper: minimal node with `kind` and a JSON body. ID and timestamp are
    /// assigned by the caller (typically `Graph::insert_node`).
    pub fn new(kind: impl Into<String>, body: Value) -> Self {
        Self {
            id: String::new(),
            kind: kind.into(),
            created_at_ms: 0,
            body,
            tags: Vec::new(),
        }
    }

    pub fn with_tags(mut self, tags: Vec<String>) -> Self {
        self.tags = tags;
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Edge {
    pub id: EdgeId,
    pub src: NodeId,
    pub dst: NodeId,
    pub kind: String,
    pub weight: f32,
    pub created_at_ms: u64,
    pub metadata: Value,
}

impl Edge {
    pub fn new(src: NodeId, dst: NodeId, kind: impl Into<String>) -> Self {
        Self {
            id: String::new(),
            src,
            dst,
            kind: kind.into(),
            weight: 1.0,
            created_at_ms: 0,
            metadata: Value::Null,
        }
    }

    pub fn with_weight(mut self, weight: f32) -> Self {
        self.weight = weight;
        self
    }

    pub fn with_metadata(mut self, metadata: Value) -> Self {
        self.metadata = metadata;
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subgraph {
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct GraphStats {
    pub nodes: usize,
    pub edges: usize,
    pub sessions: usize,
    pub last_activity_ms: u64,
}
