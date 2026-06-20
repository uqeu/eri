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
    MemoryStore, Observation, RetentionWindow, collectors, format_learned_block, world_recall,
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
    /// Phase 20 — when true, recall ranks observations by cosine
    /// similarity between the query and per-observation embeddings.
    /// Falls back to the keyword path when false / absent so older
    /// IDE builds keep working.
    #[serde(default)]
    semantic: bool,
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
    services: &Arc<Services>,
) -> Result<Value, DispatchError> {
    let p: RecallParams = serde_json::from_value(params)
        .map_err(|e| DispatchError::BadParams(format!("eri/memory/recall: {e}")))?;
    let user_id = services.current_user_id().await;
    let mut store = MemoryStore::open_for(user_id.as_deref())
        .map_err(|e| DispatchError::Other(anyhow::anyhow!("memory open: {e}")))?;
    if p.semantic && !p.query.is_empty() {
        let scored = store
            .recall_semantic(&p.query, &p.workspace, p.limit)
            .map_err(|e| DispatchError::Other(anyhow::anyhow!("memory recall: {e}")))?;
        let hits: Vec<serde_json::Value> = scored
            .iter()
            .map(|(o, score)| {
                let wire = ObservationWire::from(o);
                serde_json::json!({
                    "id": wire.id,
                    "ts_ms": wire.ts_ms,
                    "kind": wire.kind,
                    "body": wire.body,
                    "score": score,
                })
            })
            .collect();
        return Ok(serde_json::json!({ "results": hits, "mode": "semantic" }));
    }
    let hits: Vec<ObservationWire> = store
        .recall(&p.query, &p.workspace, p.limit)
        .iter()
        .map(ObservationWire::from)
        .collect();
    Ok(serde_json::json!({ "results": hits, "mode": "keyword" }))
}

pub async fn remember(
    params: Value,
    _tier_state: &SharedTierState,
    services: &Arc<Services>,
) -> Result<Value, DispatchError> {
    let p: RememberParams = serde_json::from_value(params)
        .map_err(|e| DispatchError::BadParams(format!("eri/memory/remember: {e}")))?;
    let user_id = services.current_user_id().await;
    let mut store = MemoryStore::open_for(user_id.as_deref())
        .map_err(|e| DispatchError::Other(anyhow::anyhow!("memory open: {e}")))?;
    let pinned = collectors::remember_fact(&mut store, &p.workspace, &p.text)
        .map_err(|e| DispatchError::Other(anyhow::anyhow!("memory write: {e}")))?;
    // Additive (ADR-0007): also populate the user's world model so the same fact
    // becomes queryable as people/projects. Best-effort — a world-model failure
    // must never fail the remember the user asked for.
    if let Err(e) = world_recall::model_observation(user_id.as_deref(), &pinned) {
        tracing::debug!("world-model ingest skipped: {e}");
    }
    Ok(serde_json::json!({
        "ok": true,
        "id": pinned.id,
    }))
}

pub async fn forget(
    params: Value,
    _tier_state: &SharedTierState,
    services: &Arc<Services>,
) -> Result<Value, DispatchError> {
    let p: ForgetParams = serde_json::from_value(params)
        .map_err(|e| DispatchError::BadParams(format!("eri/memory/forget: {e}")))?;
    let user_id = services.current_user_id().await;
    let mut store = MemoryStore::open_for(user_id.as_deref())
        .map_err(|e| DispatchError::Other(anyhow::anyhow!("memory open: {e}")))?;
    let removed = store
        .forget(&p.target)
        .map_err(|e| DispatchError::Other(anyhow::anyhow!("memory forget: {e}")))?;
    Ok(serde_json::json!({ "ok": true, "removed": removed }))
}

pub async fn patterns(
    params: Value,
    _tier_state: &SharedTierState,
    services: &Arc<Services>,
) -> Result<Value, DispatchError> {
    let p: CommonParams = serde_json::from_value(params)
        .map_err(|e| DispatchError::BadParams(format!("eri/memory/patterns: {e}")))?;
    let user_id = services.current_user_id().await;
    let store = MemoryStore::open_for(user_id.as_deref())
        .map_err(|e| DispatchError::Other(anyhow::anyhow!("memory open: {e}")))?;
    let hits = store.top_patterns(&p.workspace, 20);
    let learned = format_learned_block(&hits);
    // Blend in the Tier-A world block (Key People / Active Projects) so the prompt
    // carries the entity-level model alongside the learned patterns.
    let world = world_recall::world_block_for(user_id.as_deref(), 10);
    let formatted = join_blocks(&learned, &world);
    let wire: Vec<ObservationWire> = hits.iter().map(ObservationWire::from).collect();
    Ok(serde_json::json!({
        "patterns": wire,
        "formatted": formatted,
    }))
}

/// Join two system-prompt blocks with a blank line, dropping any that are empty,
/// so a missing world model (or no learned patterns yet) leaves no stray
/// whitespace in the prompt.
fn join_blocks(a: &str, b: &str) -> String {
    match (a.trim().is_empty(), b.trim().is_empty()) {
        (true, true) => String::new(),
        (false, true) => a.trim().to_string(),
        (true, false) => b.trim().to_string(),
        (false, false) => format!("{}\n\n{}", a.trim(), b.trim()),
    }
}

/// Tier-gated nightly prune. The dispatcher hooks this on sidecar startup
/// and every 6 hours via `tokio::time::interval`. Not exposed as RPC; this
/// is a helper that callers (the scheduler) use directly.
///
/// `user_id` partitions the prune to the signed-in user's store. Pass
/// `None` to prune the anonymous local-only file.
pub fn prune_for_tier(tier: &str, user_id: Option<&str>) -> std::io::Result<usize> {
    let window = RetentionWindow::from_tier(tier);
    let mut store = MemoryStore::open_for(user_id)?;
    store.prune(window)
}

#[cfg(test)]
mod tests {
    use super::join_blocks;

    #[test]
    fn join_blocks_drops_empties_and_separates_present_blocks() {
        assert_eq!(join_blocks("", ""), "");
        assert_eq!(join_blocks("## Learned\n· a", ""), "## Learned\n· a");
        assert_eq!(
            join_blocks("", "## Key People\nPeople: Alice"),
            "## Key People\nPeople: Alice"
        );
        assert_eq!(
            join_blocks("## Learned", "## Key People"),
            "## Learned\n\n## Key People"
        );
    }
}
