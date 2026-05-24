//! `eri/graph/*` JSON-RPC handlers — the agent-memory knowledge graph.
//!
//! `Graph` is stateful: opening it touches a SQLite file. We keep one handle
//! per workspace in `Services::graphs` so concurrent calls reuse the same
//! connection.

use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::Mutex;

use eri_graph::{Direction, Edge, Graph, Node, Subgraph};

use crate::DispatchError;
use crate::services::Services;

const DEFAULT_SEARCH_LIMIT: usize = 25;
const DEFAULT_KIND_LIMIT: usize = 50;
const DEFAULT_TRAVERSE_DEPTH: u8 = 3;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceOnly {
    workspace: PathBuf,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InsertNodeParams {
    workspace: PathBuf,
    kind: String,
    #[serde(default)]
    body: Value,
    #[serde(default)]
    tags: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InsertEdgeParams {
    workspace: PathBuf,
    src: String,
    dst: String,
    kind: String,
    #[serde(default)]
    weight: Option<f32>,
    #[serde(default)]
    metadata: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GetParams {
    workspace: PathBuf,
    id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NeighborsParams {
    workspace: PathBuf,
    id: String,
    #[serde(default)]
    edge_kind: Option<String>,
    #[serde(default)]
    direction: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TraverseParams {
    workspace: PathBuf,
    root: String,
    #[serde(default)]
    max_depth: Option<u8>,
    #[serde(default)]
    edge_kinds: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KindQueryParams {
    workspace: PathBuf,
    kind: String,
    #[serde(default)]
    limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchParams {
    workspace: PathBuf,
    q: String,
    #[serde(default)]
    limit: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct IdOut {
    id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NodeOut {
    node: Option<Node>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NeighborItem {
    edge: Edge,
    node: Node,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NeighborsOut {
    items: Vec<NeighborItem>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SubgraphOut {
    nodes: Vec<Node>,
    edges: Vec<Edge>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NodesOut {
    nodes: Vec<Node>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StatsOut {
    nodes: usize,
    edges: usize,
    sessions: usize,
    last_activity_ms: u64,
}

pub async fn insert_node(params: Value, services: &Services) -> Result<Value, DispatchError> {
    let p: InsertNodeParams =
        serde_json::from_value(params).map_err(|e| DispatchError::BadParams(e.to_string()))?;
    let handle = get_or_open(services, &p.workspace).await?;
    let id = {
        let guard = handle.lock().await;
        let node = Node::new(p.kind, p.body).with_tags(p.tags.unwrap_or_default());
        guard
            .insert_node(node)
            .map_err(|e| DispatchError::Other(anyhow::anyhow!(e.to_string())))?
    };
    serde_json::to_value(IdOut { id }).map_err(|e| DispatchError::Other(e.into()))
}

pub async fn insert_edge(params: Value, services: &Services) -> Result<Value, DispatchError> {
    let p: InsertEdgeParams =
        serde_json::from_value(params).map_err(|e| DispatchError::BadParams(e.to_string()))?;
    let handle = get_or_open(services, &p.workspace).await?;
    let id = {
        let guard = handle.lock().await;
        let mut edge = Edge::new(p.src, p.dst, p.kind);
        if let Some(weight) = p.weight {
            edge = edge.with_weight(weight);
        }
        if let Some(metadata) = p.metadata {
            edge = edge.with_metadata(metadata);
        }
        guard
            .insert_edge(edge)
            .map_err(|e| DispatchError::Other(anyhow::anyhow!(e.to_string())))?
    };
    serde_json::to_value(IdOut { id }).map_err(|e| DispatchError::Other(e.into()))
}

pub async fn get(params: Value, services: &Services) -> Result<Value, DispatchError> {
    let p: GetParams =
        serde_json::from_value(params).map_err(|e| DispatchError::BadParams(e.to_string()))?;
    let handle = get_or_open(services, &p.workspace).await?;
    let node = {
        let guard = handle.lock().await;
        guard
            .get_node(&p.id)
            .map_err(|e| DispatchError::Other(anyhow::anyhow!(e.to_string())))?
    };
    serde_json::to_value(NodeOut { node }).map_err(|e| DispatchError::Other(e.into()))
}

pub async fn neighbors(params: Value, services: &Services) -> Result<Value, DispatchError> {
    let p: NeighborsParams =
        serde_json::from_value(params).map_err(|e| DispatchError::BadParams(e.to_string()))?;
    let direction = parse_direction(p.direction.as_deref());
    let edge_filter = p.edge_kind.as_deref();
    let handle = get_or_open(services, &p.workspace).await?;
    let raw = {
        let guard = handle.lock().await;
        guard
            .neighbors(&p.id, edge_filter, direction)
            .map_err(|e| DispatchError::Other(anyhow::anyhow!(e.to_string())))?
    };
    let items = raw
        .into_iter()
        .map(|(edge, node)| NeighborItem { edge, node })
        .collect();
    serde_json::to_value(NeighborsOut { items }).map_err(|e| DispatchError::Other(e.into()))
}

pub async fn traverse(params: Value, services: &Services) -> Result<Value, DispatchError> {
    let p: TraverseParams =
        serde_json::from_value(params).map_err(|e| DispatchError::BadParams(e.to_string()))?;
    let depth = p.max_depth.unwrap_or(DEFAULT_TRAVERSE_DEPTH);
    let owned_kinds: Vec<String> = p.edge_kinds.unwrap_or_default();
    let handle = get_or_open(services, &p.workspace).await?;
    let sub: Subgraph = {
        let guard = handle.lock().await;
        let refs: Vec<&str> = owned_kinds.iter().map(String::as_str).collect();
        guard
            .traverse(&p.root, depth, &refs)
            .map_err(|e| DispatchError::Other(anyhow::anyhow!(e.to_string())))?
    };
    serde_json::to_value(SubgraphOut {
        nodes: sub.nodes,
        edges: sub.edges,
    })
    .map_err(|e| DispatchError::Other(e.into()))
}

pub async fn query_kind(params: Value, services: &Services) -> Result<Value, DispatchError> {
    let p: KindQueryParams =
        serde_json::from_value(params).map_err(|e| DispatchError::BadParams(e.to_string()))?;
    let limit = p.limit.unwrap_or(DEFAULT_KIND_LIMIT);
    let handle = get_or_open(services, &p.workspace).await?;
    let nodes = {
        let guard = handle.lock().await;
        guard
            .query_by_kind(&p.kind, limit)
            .map_err(|e| DispatchError::Other(anyhow::anyhow!(e.to_string())))?
    };
    serde_json::to_value(NodesOut { nodes }).map_err(|e| DispatchError::Other(e.into()))
}

pub async fn search(params: Value, services: &Services) -> Result<Value, DispatchError> {
    let p: SearchParams =
        serde_json::from_value(params).map_err(|e| DispatchError::BadParams(e.to_string()))?;
    let limit = p.limit.unwrap_or(DEFAULT_SEARCH_LIMIT);
    let handle = get_or_open(services, &p.workspace).await?;
    let nodes = {
        let guard = handle.lock().await;
        guard
            .search_body(&p.q, limit)
            .map_err(|e| DispatchError::Other(anyhow::anyhow!(e.to_string())))?
    };
    serde_json::to_value(NodesOut { nodes }).map_err(|e| DispatchError::Other(e.into()))
}

pub async fn stats(params: Value, services: &Services) -> Result<Value, DispatchError> {
    let p: WorkspaceOnly =
        serde_json::from_value(params).map_err(|e| DispatchError::BadParams(e.to_string()))?;
    let handle = get_or_open(services, &p.workspace).await?;
    let stats = {
        let guard = handle.lock().await;
        guard
            .stats()
            .map_err(|e| DispatchError::Other(anyhow::anyhow!(e.to_string())))?
    };
    serde_json::to_value(StatsOut {
        nodes: stats.nodes,
        edges: stats.edges,
        sessions: stats.sessions,
        last_activity_ms: stats.last_activity_ms,
    })
    .map_err(|e| DispatchError::Other(e.into()))
}

pub async fn export(params: Value, services: &Services) -> Result<Value, DispatchError> {
    let p: WorkspaceOnly =
        serde_json::from_value(params).map_err(|e| DispatchError::BadParams(e.to_string()))?;
    let handle = get_or_open(services, &p.workspace).await?;
    let dest = export_path(&p.workspace);
    {
        let guard = handle.lock().await;
        guard
            .export_jsonl(&dest)
            .map_err(|e| DispatchError::Other(anyhow::anyhow!(e.to_string())))?;
    }
    Ok(serde_json::json!({ "path": dest.to_string_lossy() }))
}

async fn get_or_open(
    services: &Services,
    workspace: &PathBuf,
) -> Result<Arc<Mutex<Graph>>, DispatchError> {
    let mut map = services.graphs.lock().await;
    if let Some(existing) = map.get(workspace) {
        return Ok(existing.clone());
    }
    let graph =
        Graph::open(workspace).map_err(|e| DispatchError::Other(anyhow::anyhow!(e.to_string())))?;
    let arc = Arc::new(Mutex::new(graph));
    map.insert(workspace.clone(), arc.clone());
    Ok(arc)
}

fn parse_direction(input: Option<&str>) -> Direction {
    match input.map(str::to_ascii_lowercase).as_deref() {
        Some("in") => Direction::In,
        Some("both") => Direction::Both,
        _ => Direction::Out,
    }
}

fn export_path(workspace: &std::path::Path) -> PathBuf {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    workspace
        .join(".eri")
        .join(format!("graph-export-{now_secs}.jsonl"))
}
