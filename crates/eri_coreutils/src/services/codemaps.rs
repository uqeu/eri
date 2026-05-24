//! `eri/codemaps/*` JSON-RPC handlers.
//!
//! Codemaps live under `<workspace>/.eri/codemaps/`. Every method opens the
//! store on demand — there's no per-workspace handle to cache because the
//! store is stateless. Generation does reuse the `Index` handle held by
//! `Services` so we don't reopen the SQLite database for each call.

use std::path::PathBuf;
use std::sync::Arc;

use serde::Deserialize;
use serde_json::Value;
use tokio::sync::Mutex;

use eri_codemaps::{CodemapKind, CodemapStore};
use eri_index::Index;

use crate::DispatchError;
use crate::services::Services;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceOnly {
    workspace: PathBuf,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateParams {
    workspace: PathBuf,
    kind: String,
    #[serde(default)]
    root: Option<String>,
    #[serde(default)]
    depth: Option<u8>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NameParams {
    workspace: PathBuf,
    name: String,
}

pub async fn list(params: Value, _services: &Services) -> Result<Value, DispatchError> {
    let p: WorkspaceOnly = parse(params)?;
    let store = CodemapStore::open(&p.workspace).map_err(DispatchError::Other)?;
    let entries = store.list().map_err(DispatchError::Other)?;
    serde_json::to_value(serde_json::json!({ "codemaps": entries }))
        .map_err(|e| DispatchError::Other(e.into()))
}

pub async fn generate(params: Value, services: &Services) -> Result<Value, DispatchError> {
    let p: GenerateParams = parse(params)?;
    let kind = parse_kind(&p.kind, p.root.clone(), p.depth)?;
    let store = CodemapStore::open(&p.workspace).map_err(DispatchError::Other)?;
    let index_handle = get_or_open_index(services, &p.workspace).await?;
    let map = {
        let guard = index_handle.lock().await;
        store.generate(kind, &guard).map_err(DispatchError::Other)?
    };
    store.save(&map).map_err(DispatchError::Other)?;
    serde_json::to_value(serde_json::json!({
        "name": map.name,
        "nodes": map.nodes.len(),
        "edges": map.edges.len(),
        "generatedAtMs": map.generated_at_ms,
    }))
    .map_err(|e| DispatchError::Other(e.into()))
}

pub async fn load(params: Value, _services: &Services) -> Result<Value, DispatchError> {
    let p: NameParams = parse(params)?;
    let store = CodemapStore::open(&p.workspace).map_err(DispatchError::Other)?;
    let map = store.load(&p.name).map_err(DispatchError::Other)?;
    serde_json::to_value(map).map_err(|e| DispatchError::Other(e.into()))
}

pub async fn svg(params: Value, _services: &Services) -> Result<Value, DispatchError> {
    let p: NameParams = parse(params)?;
    let store = CodemapStore::open(&p.workspace).map_err(DispatchError::Other)?;
    let svg = store.svg(&p.name).map_err(DispatchError::Other)?;
    Ok(serde_json::json!({ "name": p.name, "svg": svg }))
}

fn parse_kind(
    kind: &str,
    root: Option<String>,
    depth: Option<u8>,
) -> Result<CodemapKind, DispatchError> {
    match kind {
        "module" => Ok(CodemapKind::Module),
        "hotspot" => Ok(CodemapKind::Hotspot),
        "data" => Ok(CodemapKind::Data),
        "function" => {
            let root = root.ok_or_else(|| {
                DispatchError::BadParams("function codemap requires 'root'".into())
            })?;
            Ok(CodemapKind::Function {
                root,
                depth: depth.unwrap_or(2),
            })
        }
        other => Err(DispatchError::BadParams(format!(
            "unknown codemap kind: {other}"
        ))),
    }
}

fn parse<T: for<'de> Deserialize<'de>>(value: Value) -> Result<T, DispatchError> {
    serde_json::from_value(value).map_err(|e| DispatchError::BadParams(e.to_string()))
}

async fn get_or_open_index(
    services: &Services,
    workspace: &PathBuf,
) -> Result<Arc<Mutex<Index>>, DispatchError> {
    let mut map = services.indexes.lock().await;
    if let Some(existing) = map.get(workspace) {
        return Ok(existing.clone());
    }
    let index =
        Index::open(workspace).map_err(|e| DispatchError::Other(anyhow::anyhow!(e.to_string())))?;
    let arc = Arc::new(Mutex::new(index));
    map.insert(workspace.clone(), arc.clone());
    Ok(arc)
}
