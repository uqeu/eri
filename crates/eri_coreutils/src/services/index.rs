//! `eri/index/*` JSON-RPC handlers.
//!
//! `Index` is stateful — opening it touches a SQLite file and lazily warms an
//! embedder backend. We keep one handle per workspace in `Services` so
//! repeated calls reuse the connection.

use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::Mutex;

use eri_index::{ChunkKind, Index};

use crate::services::Services;
use crate::DispatchError;

const DEFAULT_TOP_K: usize = 10;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceOnly {
    workspace: PathBuf,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchParams {
    workspace: PathBuf,
    query: String,
    #[serde(default)]
    top_k: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncResult {
    files_added: usize,
    files_modified: usize,
    files_removed: usize,
    chunks_total: usize,
    duration_ms: u128,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchHit {
    path: String,
    line_start: usize,
    line_end: usize,
    kind: &'static str,
    content: String,
    score: f32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchResultOut {
    results: Vec<SearchHit>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StatsOut {
    files: usize,
    chunks: usize,
    bytes_indexed: u64,
}

pub async fn sync(params: Value, services: &Services) -> Result<Value, DispatchError> {
    let p: WorkspaceOnly =
        serde_json::from_value(params).map_err(|e| DispatchError::BadParams(e.to_string()))?;
    let handle = get_or_open(services, &p.workspace).await?;
    let report = {
        let mut guard = handle.lock().await;
        guard
            .sync()
            .map_err(|e| DispatchError::Other(anyhow::anyhow!(e.to_string())))?
    };
    serde_json::to_value(SyncResult {
        files_added: report.files_added,
        files_modified: report.files_modified,
        files_removed: report.files_removed,
        chunks_total: report.chunks_total,
        duration_ms: report.duration_ms,
    })
        .map_err(|e| DispatchError::Other(e.into()))
}

pub async fn search(params: Value, services: &Services) -> Result<Value, DispatchError> {
    let p: SearchParams =
        serde_json::from_value(params).map_err(|e| DispatchError::BadParams(e.to_string()))?;
    let top_k = p.top_k.unwrap_or(DEFAULT_TOP_K);
    let handle = get_or_open(services, &p.workspace).await?;
    let raw = {
        let guard = handle.lock().await;
        guard
            .search(&p.query, top_k)
            .map_err(|e| DispatchError::Other(anyhow::anyhow!(e.to_string())))?
    };
    let results: Vec<SearchHit> = raw
        .into_iter()
        .map(|r| SearchHit {
            path: r.chunk.path,
            line_start: r.chunk.line_start,
            line_end: r.chunk.line_end,
            kind: kind_str(r.chunk.kind),
            content: r.chunk.content,
            score: r.score,
        })
        .collect();
    serde_json::to_value(SearchResultOut { results })
        .map_err(|e| DispatchError::Other(e.into()))
}

pub async fn stats(params: Value, services: &Services) -> Result<Value, DispatchError> {
    let p: WorkspaceOnly =
        serde_json::from_value(params).map_err(|e| DispatchError::BadParams(e.to_string()))?;
    let handle = get_or_open(services, &p.workspace).await?;
    let stats = {
        let guard = handle.lock().await;
        guard.stats()
    };
    serde_json::to_value(StatsOut {
        files: stats.files,
        chunks: stats.chunks,
        bytes_indexed: stats.bytes_indexed,
    })
        .map_err(|e| DispatchError::Other(e.into()))
}

async fn get_or_open(
    services: &Services,
    workspace: &PathBuf,
) -> Result<Arc<Mutex<Index>>, DispatchError> {
    let mut map = services.indexes.lock().await;
    if let Some(existing) = map.get(workspace) {
        return Ok(existing.clone());
    }
    let index = Index::open(workspace)
        .map_err(|e| DispatchError::Other(anyhow::anyhow!(e.to_string())))?;
    let arc = Arc::new(Mutex::new(index));
    map.insert(workspace.clone(), arc.clone());
    Ok(arc)
}

fn kind_str(kind: ChunkKind) -> &'static str {
    match kind {
        ChunkKind::Function => "function",
        ChunkKind::Class => "class",
        ChunkKind::Module => "module",
        ChunkKind::RecursiveFallback => "recursiveFallback",
    }
}
