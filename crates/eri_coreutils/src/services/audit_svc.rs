//! JSON-RPC handlers for the audit log:
//!
//!   * `eri/audit/status`  → `{ enabled, path, sizeBytes, rotations, dropped }`
//!   * `eri/audit/enable`  → `{ ok: true }`
//!   * `eri/audit/disable` → `{ ok: true }`
//!   * `eri/audit/recent`  → `{ entries: [...] }`
//!
//! All four are free-tier (no `require_feature` gate): audit is a privacy
//! primitive, not a paid feature.

use serde::Deserialize;
use serde_json::Value;

use crate::DispatchError;
use crate::audit::RECENT_LIMIT_MAX;
use crate::services::Services;

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct RecentParams {
    limit: Option<usize>,
}

pub async fn status(_params: Value, services: &Services) -> Result<Value, DispatchError> {
    let report = services.audit.status_report();
    serde_json::to_value(report).map_err(|e| DispatchError::Other(e.into()))
}

pub async fn enable(_params: Value, services: &Services) -> Result<Value, DispatchError> {
    services.audit.set_enabled(true);
    tracing::info!("audit log enabled via eri/audit/enable");
    Ok(serde_json::json!({ "ok": true }))
}

pub async fn disable(_params: Value, services: &Services) -> Result<Value, DispatchError> {
    services.audit.set_enabled(false);
    tracing::info!("audit log disabled via eri/audit/disable");
    Ok(serde_json::json!({ "ok": true }))
}

pub async fn recent(params: Value, services: &Services) -> Result<Value, DispatchError> {
    let parsed: RecentParams =
        serde_json::from_value(params).map_err(|e| DispatchError::BadParams(e.to_string()))?;
    let limit = parsed.limit.unwrap_or(50).min(RECENT_LIMIT_MAX);
    let entries = services
        .audit
        .read_recent(limit)
        .map_err(DispatchError::Other)?;
    Ok(serde_json::json!({ "entries": entries }))
}
