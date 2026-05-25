//! `eri/memory/*` JSON-RPC arms — recall / remember / forget / patterns.
//!
//! Backed by `eri_inference::memory::MemoryStore`. v1 is JSON-on-disk so
//! the sidecar can boot without SQLite IO and the cloud-sync route only
//! sees opaque encrypted blobs. v2 swaps the impl for SQLite + embeddings;
//! the JSON-RPC shape stays identical so the IDE keeps working.

use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use eri_inference::memory::{
    collectors, format_learned_block, MemoryStore, Observation, RetentionWindow,
};

use crate::services::Services;
use crate::{DispatchError, SharedTierState};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommonParams {
    workspace: PathBuf,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecallParams {
    workspace: PathBuf,
    #[serde(default)]
    query: String,
    #[serde(default = "default_limit")]
    limit: usize,
}

fn default_limit() -> usize {
    20
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RememberParams {
    workspace: PathBuf,
    text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ForgetParams {
    /// Accepted but unused in v1 (memory store is global, not per-workspace).
    /// Kept for API symmetry; v2 SQLite store partitions by workspace and
    /// will start consulting this field.
    #[allow(dead_code)]
    #[serde(default)]
    workspace: Option<PathBuf>,
    /// Observation id, or the literal "all" to wipe everything.
    target: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ObservationWire {
    id: String,
    ts_ms: u64,
    kind: String,
    body: String,
}

impl From<&Observation> for ObservationWire {
    fn from(o: &Observation) -> Self {
        ObservationWire {
            id: o.id.clone(),
            ts_ms: o.ts_ms,
            kind: o.kind.clone(),
            body: o.body.clone(),
        }
    }
}

pub async fn recall(
    params: Value,
    _tier_state: &SharedTierState,
    _services: &Arc<Services>,
) -> Result<Value, DispatchError> {
    let p: RecallParams = serde_json::from_value(params)
        .map_err(|e| DispatchError::BadParams(format!("eri/memory/recall: {e}")))?;
    let store = MemoryStore::open()
        .map_err(|e| DispatchError::Other(anyhow::anyhow!("memory open: {e}")))?;
    let hits: Vec<ObservationWire> = store
        .recall(&p.query, &p.workspace, p.limit)
        .iter()
        .map(ObservationWire::from)
        .collect();
    Ok(serde_json::json!({ "results": hits }))
}

pub async fn remember(
    params: Value,
    _tier_state: &SharedTierState,
    _services: &Arc<Services>,
) -> Result<Value, DispatchError> {
    let p: RememberParams = serde_json::from_value(params)
        .map_err(|e| DispatchError::BadParams(format!("eri/memory/remember: {e}")))?;
    let mut store = MemoryStore::open()
        .map_err(|e| DispatchError::Other(anyhow::anyhow!("memory open: {e}")))?;
    let pinned = collectors::remember_fact(&mut store, &p.workspace, &p.text)
        .map_err(|e| DispatchError::Other(anyhow::anyhow!("memory write: {e}")))?;
    Ok(serde_json::json!({
        "ok": true,
        "id": pinned.id,
    }))
}

pub async fn forget(
    params: Value,
    _tier_state: &SharedTierState,
    _services: &Arc<Services>,
) -> Result<Value, DispatchError> {
    let p: ForgetParams = serde_json::from_value(params)
        .map_err(|e| DispatchError::BadParams(format!("eri/memory/forget: {e}")))?;
    let mut store = MemoryStore::open()
        .map_err(|e| DispatchError::Other(anyhow::anyhow!("memory open: {e}")))?;
    let removed = store
        .forget(&p.target)
        .map_err(|e| DispatchError::Other(anyhow::anyhow!("memory forget: {e}")))?;
    Ok(serde_json::json!({ "ok": true, "removed": removed }))
}

pub async fn patterns(
    params: Value,
    _tier_state: &SharedTierState,
    _services: &Arc<Services>,
) -> Result<Value, DispatchError> {
    let p: CommonParams = serde_json::from_value(params)
        .map_err(|e| DispatchError::BadParams(format!("eri/memory/patterns: {e}")))?;
    let store = MemoryStore::open()
        .map_err(|e| DispatchError::Other(anyhow::anyhow!("memory open: {e}")))?;
    let hits = store.top_patterns(&p.workspace, 20);
    let formatted = format_learned_block(&hits);
    let wire: Vec<ObservationWire> = hits.iter().map(ObservationWire::from).collect();
    Ok(serde_json::json!({
        "patterns": wire,
        "formatted": formatted,
    }))
}

/// Tier-gated nightly prune. The dispatcher hooks this on sidecar startup
/// + every 6 hours via `tokio::time::interval`. Not exposed as RPC; this
/// is a helper that callers (the scheduler) use directly.
pub fn prune_for_tier(tier: &str) -> std::io::Result<usize> {
    let window = RetentionWindow::from_tier(tier);
    let mut store = MemoryStore::open()?;
    store.prune(window)
}
