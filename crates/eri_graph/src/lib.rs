//! `eri_graph` — the eri agent-memory knowledge graph.
//!
//! Every prompt, voice transcript, classified intent, model call, edit
//! proposal, checkpoint, and error becomes a node in a persistent SQLite-backed
//! graph. Edges encode causal/structural relationships (`caused_by`,
//! `references`, `follows`, `belongs_to_session`, `derived_from`, `undid`,
//! `related_to`). The agent queries this graph at recall time so it can answer
//! "did we already try this?", "which file was edited in the last session?",
//! "what error came up after that refactor?" without re-reading every chat
//! transcript.
//!
//! Storage lives at `<workspace>/.eri/graph.sqlite`, kept separate from
//! `index.sqlite` so the two databases evolve independently.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;
use ulid::Ulid;

pub mod auto;
mod error;
mod storage;
mod types;
pub mod world;

pub use error::GraphError;
pub use types::{
    Direction, Edge, EdgeId, GraphStats, Node, NodeId, Subgraph, edge_kind, node_kind,
};

use storage::Store;

/// 60 minutes — sessions auto-rotate after this much wall-clock idle time.
const SESSION_IDLE_MS: u64 = 60 * 60 * 1000;

/// Public handle for the agent-memory knowledge graph. One per workspace.
/// Cheap to construct (one SQLite connection); not Clone — wrap in `Arc`
/// if you need shared access.
pub struct Graph {
    workspace_root: PathBuf,
    inner: Mutex<Inner>,
}

struct Inner {
    store: Store,
}

impl Graph {
    /// Open (or create) the graph database for `workspace_root`. The file
    /// lives at `<workspace_root>/.eri/graph.sqlite`.
    pub fn open(workspace_root: &Path) -> Result<Self, GraphError> {
        let db_path = workspace_root.join(".eri").join("graph.sqlite");
        let store = Store::open(&db_path)?;
        Ok(Self {
            workspace_root: workspace_root.to_path_buf(),
            inner: Mutex::new(Inner { store }),
        })
    }

    /// Open an in-memory graph. Used by tests.
    pub fn open_in_memory() -> Result<Self, GraphError> {
        let store = Store::open_in_memory()?;
        Ok(Self {
            workspace_root: PathBuf::new(),
            inner: Mutex::new(Inner { store }),
        })
    }

    /// Open (or create) a graph at an explicit database file `path`, instead of
    /// the `<workspace_root>/.eri/graph.sqlite` convention of [`open`](Self::open).
    /// For stores that aren't workspace-scoped — e.g. the user-global world model,
    /// which sits beside the per-user memory store. Parent dirs are created lazily.
    pub fn open_at(path: &Path) -> Result<Self, GraphError> {
        let store = Store::open(path)?;
        let workspace_root = path.parent().map(Path::to_path_buf).unwrap_or_default();
        Ok(Self {
            workspace_root,
            inner: Mutex::new(Inner { store }),
        })
    }

    /// Path the graph is bound to.
    pub fn workspace_root(&self) -> &Path {
        &self.workspace_root
    }

    /// Insert a node. The caller-provided `id` and `created_at_ms` are
    /// overwritten with a fresh ULID and the current wall clock so external
    /// callers can't accidentally collide ids.
    pub fn insert_node(&self, mut node: Node) -> Result<NodeId, GraphError> {
        if node.kind.trim().is_empty() {
            return Err(GraphError::Invalid("node kind must not be empty".into()));
        }
        let now = now_ms()?;
        node.id = new_id();
        node.created_at_ms = now;
        let id = node.id.clone();
        {
            let inner = self.lock_inner()?;
            inner.store.insert_node(&node)?;
        }
        // Auto-bind to the active session unless we're inserting the session
        // node itself (which would otherwise cause a self-reference).
        if node.kind != node_kind::SESSION {
            self.attach_to_session(&id)?;
        }
        Ok(id)
    }

    /// Insert an edge. The caller-provided `id` and `created_at_ms` are
    /// overwritten with a fresh ULID and the current wall clock.
    pub fn insert_edge(&self, mut edge: Edge) -> Result<EdgeId, GraphError> {
        if edge.kind.trim().is_empty() {
            return Err(GraphError::Invalid("edge kind must not be empty".into()));
        }
        if edge.src == edge.dst {
            return Err(GraphError::Invalid("edge src and dst must differ".into()));
        }
        let now = now_ms()?;
        edge.id = new_id();
        edge.created_at_ms = now;
        let id = edge.id.clone();
        let inner = self.lock_inner()?;
        inner.store.insert_edge(&edge)?;
        Ok(id)
    }

    /// Look up a node by id.
    pub fn get_node(&self, id: &NodeId) -> Result<Option<Node>, GraphError> {
        let inner = self.lock_inner()?;
        inner.store.get_node(id)
    }

    /// Replace an edge's metadata JSON (e.g. to stamp `valid_to` when a
    /// bi-temporal relation stops being true — invalidate, don't delete).
    pub fn update_edge_metadata(
        &self,
        edge_id: &EdgeId,
        metadata: &Value,
    ) -> Result<(), GraphError> {
        let inner = self.lock_inner()?;
        inner.store.update_edge_metadata(edge_id, metadata)
    }

    /// Replace a node's body JSON (e.g. to record a resolved name alias on an
    /// entity, or update an entity's attributes).
    pub fn update_node_body(&self, node_id: &NodeId, body: &Value) -> Result<(), GraphError> {
        let inner = self.lock_inner()?;
        inner.store.update_node_body(node_id, body)
    }

    /// Return `(edge, neighbor)` pairs for `id`. `direction` controls whether
    /// out-edges, in-edges, or both are returned.
    pub fn neighbors(
        &self,
        id: &NodeId,
        edge_kind_filter: Option<&str>,
        direction: Direction,
    ) -> Result<Vec<(Edge, Node)>, GraphError> {
        let inner = self.lock_inner()?;
        let mut edges: Vec<Edge> = Vec::new();
        match direction {
            Direction::Out => {
                edges.extend(inner.store.out_edges(id, edge_kind_filter)?);
            }
            Direction::In => {
                edges.extend(inner.store.in_edges(id, edge_kind_filter)?);
            }
            Direction::Both => {
                edges.extend(inner.store.out_edges(id, edge_kind_filter)?);
                edges.extend(inner.store.in_edges(id, edge_kind_filter)?);
            }
        }
        let mut out = Vec::with_capacity(edges.len());
        for edge in edges {
            let neighbor_id = if edge.src == *id {
                &edge.dst
            } else {
                &edge.src
            };
            if let Some(node) = inner.store.get_node(neighbor_id)? {
                out.push((edge, node));
            }
        }
        Ok(out)
    }

    /// Breadth-first traverse starting at `root`, following at most
    /// `max_depth` hops along edges whose kind appears in `edge_kinds`. An
    /// empty `edge_kinds` slice means "any kind". Cycles are guarded by a
    /// visited set.
    pub fn traverse(
        &self,
        root: &NodeId,
        max_depth: u8,
        edge_kinds: &[&str],
    ) -> Result<Subgraph, GraphError> {
        let inner = self.lock_inner()?;
        let mut nodes: Vec<Node> = Vec::new();
        let mut edges: Vec<Edge> = Vec::new();
        let mut visited: std::collections::HashSet<String> = std::collections::HashSet::new();
        let mut seen_edges: std::collections::HashSet<String> = std::collections::HashSet::new();
        let mut frontier: Vec<(String, u8)> = vec![(root.clone(), 0)];

        while let Some((current, depth)) = frontier.pop() {
            if !visited.insert(current.clone()) {
                continue;
            }
            if let Some(node) = inner.store.get_node(&current)? {
                nodes.push(node);
            } else {
                // Missing root or dangling neighbor: skip without erroring,
                // the caller can still see partial graph.
                continue;
            }
            if depth >= max_depth {
                continue;
            }
            let candidate_edges = collect_candidate_edges(&inner.store, &current, edge_kinds)?;
            for edge in candidate_edges {
                if !seen_edges.insert(edge.id.clone()) {
                    continue;
                }
                let other = if edge.src == current {
                    edge.dst.clone()
                } else {
                    edge.src.clone()
                };
                edges.push(edge);
                if !visited.contains(&other) {
                    frontier.push((other, depth + 1));
                }
            }
        }
        Ok(Subgraph { nodes, edges })
    }

    /// Most-recent-first list of nodes matching `kind`, capped at `limit`.
    pub fn query_by_kind(&self, kind: &str, limit: usize) -> Result<Vec<Node>, GraphError> {
        if limit == 0 {
            return Ok(Vec::new());
        }
        let inner = self.lock_inner()?;
        inner.store.nodes_by_kind(kind, limit)
    }

    /// Inclusive time-range query over `created_at_ms`. Returns nodes in
    /// chronological order.
    pub fn query_by_time(&self, since_ms: u64, until_ms: u64) -> Result<Vec<Node>, GraphError> {
        if since_ms > until_ms {
            return Err(GraphError::Invalid("since_ms must be <= until_ms".into()));
        }
        let inner = self.lock_inner()?;
        inner.store.nodes_in_range(since_ms, until_ms)
    }

    /// Substring search across serialized JSON bodies. Uses SQLite `LIKE`,
    /// so v0 is fine for sub-100k-row graphs; we can swap in FTS5 later.
    pub fn search_body(&self, q: &str, limit: usize) -> Result<Vec<Node>, GraphError> {
        if q.is_empty() || limit == 0 {
            return Ok(Vec::new());
        }
        let inner = self.lock_inner()?;
        inner.store.search_body(q, limit)
    }

    /// Return the active session node, creating one if none exists or the
    /// last one's `last_activity_ms` is more than `SESSION_IDLE_MS` ago.
    pub fn current_session(&self) -> Result<NodeId, GraphError> {
        self.current_session_at(now_ms()?)
    }

    /// End the active session by stamping `ended_at_ms` on its body. A no-op
    /// when there is no active session.
    pub fn end_session(&self) -> Result<(), GraphError> {
        let inner = self.lock_inner()?;
        let session = match inner.store.most_recent_session()? {
            Some(s) => s,
            None => return Ok(()),
        };
        let mut body = session.body.clone();
        if let Some(obj) = body.as_object_mut() {
            obj.insert("ended_at_ms".into(), Value::from(now_ms()?));
        }
        inner.store.update_node_body(&session.id, &body)?;
        Ok(())
    }

    /// Aggregate counts useful for the IDE tree view.
    pub fn stats(&self) -> Result<GraphStats, GraphError> {
        let inner = self.lock_inner()?;
        Ok(GraphStats {
            nodes: inner.store.count_nodes()?,
            edges: inner.store.count_edges()?,
            sessions: inner.store.count_sessions()?,
            last_activity_ms: inner.store.last_activity_ms()?,
        })
    }

    /// Stream every node + edge to disk as JSON Lines (`<node>` per line then
    /// `<edge>` per line). The caller chooses the destination path so this
    /// can be wired up to a sidecar command that writes
    /// `<workspace>/.eri/graph-export-<date>.jsonl`.
    pub fn export_jsonl(&self, path: &Path) -> Result<(), GraphError> {
        if let Some(parent) = path.parent()
            && !parent.as_os_str().is_empty()
        {
            std::fs::create_dir_all(parent)?;
        }
        let inner = self.lock_inner()?;
        let mut buf = String::new();
        for node in inner.store.all_nodes()? {
            let line = serde_json::to_string(&serde_json::json!({
                "type": "node",
                "node": node,
            }))?;
            buf.push_str(&line);
            buf.push('\n');
        }
        for edge in inner.store.all_edges()? {
            let line = serde_json::to_string(&serde_json::json!({
                "type": "edge",
                "edge": edge,
            }))?;
            buf.push_str(&line);
            buf.push('\n');
        }
        std::fs::write(path, buf)?;
        Ok(())
    }

    // --- internals -------------------------------------------------------

    fn current_session_at(&self, now: u64) -> Result<NodeId, GraphError> {
        {
            let inner = self.lock_inner()?;
            if let Some(session) = inner.store.most_recent_session()? {
                let last_activity = session
                    .body
                    .get("last_activity_ms")
                    .and_then(Value::as_u64)
                    .unwrap_or(session.created_at_ms);
                let ended = session.body.get("ended_at_ms").is_some();
                if !ended && now.saturating_sub(last_activity) <= SESSION_IDLE_MS {
                    return Ok(session.id);
                }
            }
        }
        // No active session — create one. We assign id/timestamp manually so
        // we don't recurse into `attach_to_session`.
        let id = new_id();
        let node = Node {
            id: id.clone(),
            kind: node_kind::SESSION.to_string(),
            created_at_ms: now,
            body: serde_json::json!({
                "started_at_ms": now,
                "last_activity_ms": now,
            }),
            tags: Vec::new(),
        };
        let inner = self.lock_inner()?;
        inner.store.insert_node(&node)?;
        Ok(id)
    }

    fn attach_to_session(&self, node_id: &str) -> Result<(), GraphError> {
        let session_id = self.current_session()?;
        // Update last_activity_ms on the session.
        let now = now_ms()?;
        {
            let inner = self.lock_inner()?;
            if let Some(session) = inner.store.get_node(&session_id)? {
                let mut body = session.body.clone();
                if let Some(obj) = body.as_object_mut() {
                    obj.insert("last_activity_ms".into(), Value::from(now));
                }
                inner.store.update_node_body(&session.id, &body)?;
            }
        }
        // Add the `belongs_to_session` edge.
        let edge = Edge {
            id: new_id(),
            src: node_id.to_string(),
            dst: session_id,
            kind: edge_kind::BELONGS_TO_SESSION.to_string(),
            weight: 1.0,
            created_at_ms: now,
            metadata: Value::Null,
        };
        let inner = self.lock_inner()?;
        inner.store.insert_edge(&edge)?;
        Ok(())
    }

    fn lock_inner(&self) -> Result<std::sync::MutexGuard<'_, Inner>, GraphError> {
        self.inner
            .lock()
            .map_err(|_| GraphError::Invalid("graph mutex poisoned".into()))
    }
}

fn collect_candidate_edges(
    store: &Store,
    node_id: &str,
    edge_kinds: &[&str],
) -> Result<Vec<Edge>, GraphError> {
    let mut out = Vec::new();
    if edge_kinds.is_empty() {
        out.extend(store.out_edges(node_id, None)?);
        out.extend(store.in_edges(node_id, None)?);
    } else {
        for kind in edge_kinds {
            out.extend(store.out_edges(node_id, Some(kind))?);
            out.extend(store.in_edges(node_id, Some(kind))?);
        }
    }
    Ok(out)
}

fn new_id() -> String {
    Ulid::new().to_string()
}

fn now_ms() -> Result<u64, GraphError> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| GraphError::Time(e.to_string()))?;
    Ok(now.as_millis() as u64)
}

// Internal test helper used by integration tests to exercise session rotation
// without sleeping for an hour. Not part of the stable public API.
#[doc(hidden)]
impl Graph {
    pub fn __test_current_session_at(&self, now: u64) -> Result<NodeId, GraphError> {
        self.current_session_at(now)
    }
}
