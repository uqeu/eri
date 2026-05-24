//! `eri/checkpoints/*` JSON-RPC handlers.

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use eri_git::{ChangeKind, CheckpointStore, RestoreOptions};

use crate::DispatchError;
use crate::services::Services;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateParams {
    workspace: PathBuf,
    label: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceOnly {
    workspace: PathBuf,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShowParams {
    workspace: PathBuf,
    id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RestoreParams {
    workspace: PathBuf,
    id: String,
    #[serde(default)]
    force: bool,
    #[serde(default)]
    dry_run: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PruneParams {
    workspace: PathBuf,
    keep: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteParams {
    workspace: PathBuf,
    id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CheckpointOut {
    id: String,
    sha: String,
    created_at_ms: u128,
    label: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ListResult {
    checkpoints: Vec<CheckpointOut>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileChangeOut {
    path: String,
    kind: &'static str,
    from: Option<String>,
    added: usize,
    removed: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ShowResult {
    files_changed: Vec<FileChangeOut>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RestoreResult {
    files_restored: Vec<String>,
    files_skipped: Vec<SkippedOut>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SkippedOut {
    path: String,
    reason: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PruneResult {
    pruned: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OkResult {
    ok: bool,
}

pub async fn create(params: Value, _services: &Services) -> Result<Value, DispatchError> {
    let p: CreateParams =
        serde_json::from_value(params).map_err(|e| DispatchError::BadParams(e.to_string()))?;
    let store = CheckpointStore::open(&p.workspace)
        .map_err(|e| DispatchError::Other(anyhow::anyhow!(e.to_string())))?;
    let cp = store
        .create(&p.label)
        .map_err(|e| DispatchError::Other(anyhow::anyhow!(e.to_string())))?;
    serde_json::to_value(CheckpointOut {
        id: cp.id,
        sha: cp.sha,
        created_at_ms: ms_since_epoch(cp.created_at),
        label: cp.label,
    })
    .map_err(|e| DispatchError::Other(e.into()))
}

pub async fn list(params: Value, _services: &Services) -> Result<Value, DispatchError> {
    let p: WorkspaceOnly =
        serde_json::from_value(params).map_err(|e| DispatchError::BadParams(e.to_string()))?;
    let store = CheckpointStore::open(&p.workspace)
        .map_err(|e| DispatchError::Other(anyhow::anyhow!(e.to_string())))?;
    let all = store
        .list()
        .map_err(|e| DispatchError::Other(anyhow::anyhow!(e.to_string())))?;
    let out: Vec<CheckpointOut> = all
        .into_iter()
        .map(|cp| CheckpointOut {
            id: cp.id,
            sha: cp.sha,
            created_at_ms: ms_since_epoch(cp.created_at),
            label: cp.label,
        })
        .collect();
    serde_json::to_value(ListResult { checkpoints: out })
        .map_err(|e| DispatchError::Other(e.into()))
}

pub async fn show(params: Value, _services: &Services) -> Result<Value, DispatchError> {
    let p: ShowParams =
        serde_json::from_value(params).map_err(|e| DispatchError::BadParams(e.to_string()))?;
    let store = CheckpointStore::open(&p.workspace)
        .map_err(|e| DispatchError::Other(anyhow::anyhow!(e.to_string())))?;
    let diff = store
        .show(&p.id)
        .map_err(|e| DispatchError::Other(anyhow::anyhow!(e.to_string())))?;
    let files_changed: Vec<FileChangeOut> = diff
        .files_changed
        .into_iter()
        .map(|c| {
            let (kind, from) = change_kind_parts(&c.kind);
            FileChangeOut {
                path: c.path.to_string_lossy().into_owned(),
                kind,
                from,
                added: c.added,
                removed: c.removed,
            }
        })
        .collect();
    serde_json::to_value(ShowResult { files_changed }).map_err(|e| DispatchError::Other(e.into()))
}

pub async fn restore(params: Value, _services: &Services) -> Result<Value, DispatchError> {
    let p: RestoreParams =
        serde_json::from_value(params).map_err(|e| DispatchError::BadParams(e.to_string()))?;
    let store = CheckpointStore::open(&p.workspace)
        .map_err(|e| DispatchError::Other(anyhow::anyhow!(e.to_string())))?;
    let report = store
        .restore(
            &p.id,
            RestoreOptions {
                force: p.force,
                dry_run: p.dry_run,
            },
        )
        .map_err(|e| DispatchError::Other(anyhow::anyhow!(e.to_string())))?;
    let files_restored: Vec<String> = report
        .files_restored
        .into_iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
    let files_skipped: Vec<SkippedOut> = report
        .files_skipped
        .into_iter()
        .map(|(path, reason)| SkippedOut {
            path: path.to_string_lossy().into_owned(),
            reason,
        })
        .collect();
    serde_json::to_value(RestoreResult {
        files_restored,
        files_skipped,
    })
    .map_err(|e| DispatchError::Other(e.into()))
}

pub async fn prune(params: Value, _services: &Services) -> Result<Value, DispatchError> {
    let p: PruneParams =
        serde_json::from_value(params).map_err(|e| DispatchError::BadParams(e.to_string()))?;
    let store = CheckpointStore::open(&p.workspace)
        .map_err(|e| DispatchError::Other(anyhow::anyhow!(e.to_string())))?;
    let pruned = store
        .prune(p.keep)
        .map_err(|e| DispatchError::Other(anyhow::anyhow!(e.to_string())))?;
    serde_json::to_value(PruneResult { pruned }).map_err(|e| DispatchError::Other(e.into()))
}

pub async fn delete(params: Value, _services: &Services) -> Result<Value, DispatchError> {
    let p: DeleteParams =
        serde_json::from_value(params).map_err(|e| DispatchError::BadParams(e.to_string()))?;
    let store = CheckpointStore::open(&p.workspace)
        .map_err(|e| DispatchError::Other(anyhow::anyhow!(e.to_string())))?;
    store
        .delete(&p.id)
        .map_err(|e| DispatchError::Other(anyhow::anyhow!(e.to_string())))?;
    serde_json::to_value(OkResult { ok: true }).map_err(|e| DispatchError::Other(e.into()))
}

fn ms_since_epoch(t: SystemTime) -> u128 {
    t.duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn change_kind_parts(kind: &ChangeKind) -> (&'static str, Option<String>) {
    match kind {
        ChangeKind::Added => ("added", None),
        ChangeKind::Modified => ("modified", None),
        ChangeKind::Deleted => ("deleted", None),
        ChangeKind::Renamed { from } => ("renamed", Some(from.to_string_lossy().into_owned())),
    }
}
