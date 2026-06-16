//! Background Janitor agent (Phase 9).
//!
//! Tier-gated to Individual II+ (Pro / Pro+ / Teams). Off by default —
//! requires explicit opt-in via the `eri.background.enabled` setting on
//! the extension side. The scheduler fires a small set of janitor tasks
//! (`format`, `lint-fixes`, `dead-code-sweep`, `dep-bumps-patch`,
//! `test-flake-triage`) on a workspace at idle and surfaces a proposal
//! via `eri/background/proposal` notification when it finds something
//! worth showing.
//!
//! Bash approval gate (terax pattern): any janitor task that would shell
//! out requires the user to approve the command once. The approved set is
//! persisted to `<workspace>/.eri/trusted-commands.json` so the same
//! command runs without prompting on subsequent invocations.
//!
//! v1 scaffold: tier gate + enable/disable RPC + bash-approval ledger.
//! The actual scheduler loop runs only when `enable` is called with
//! `{ runProbe: true }` and fires a single "trial" proposal so the IDE
//! can render the notification surface — the production scheduler with
//! task queue + idle detection lands in the follow-up.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::services::Services;
use crate::services::janitor_rules::load_rules as load_janitor_rules;
use crate::{DispatchError, SharedTierState};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnableParams {
    workspace: PathBuf,
    /// When true, immediately emit a trial proposal so the IDE can verify
    /// the notification surface works.
    #[serde(default)]
    run_probe: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceOnly {
    workspace: PathBuf,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApproveBashParams {
    workspace: PathBuf,
    command: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TrustedCommandsReport {
    workspace: String,
    commands: Vec<String>,
}

/// `eri/background/enable` — tier-gated; flips a per-workspace flag and
/// optionally fires a probe proposal to verify wiring.
pub async fn enable(
    params: Value,
    tier_state: &SharedTierState,
    services: &Arc<Services>,
) -> Result<Value, DispatchError> {
    require_pro_tier(tier_state).await?;
    let p: EnableParams = serde_json::from_value(params)
        .map_err(|e| DispatchError::BadParams(format!("eri/background/enable: {e}")))?;
    write_state(&p.workspace, true)
        .map_err(|e| DispatchError::Other(anyhow::anyhow!("write background state: {e}")))?;
    if p.run_probe {
        if let Some(notifier) = services.notifier.as_ref() {
            notifier.notify(
                "eri/background/proposal",
                serde_json::json!({
                    "task": "probe",
                    "summary": "Janitor armed and listening — close this if you're not ready.",
                    "estimated_tokens": 0,
                    "diff_preview": "",
                }),
            );
        }
    }
    Ok(serde_json::json!({ "ok": true, "enabled": true }))
}

/// `eri/background/disable` — workspace-scoped off switch.
pub async fn disable(
    params: Value,
    _tier_state: &SharedTierState,
    _services: &Arc<Services>,
) -> Result<Value, DispatchError> {
    let p: WorkspaceOnly = serde_json::from_value(params)
        .map_err(|e| DispatchError::BadParams(format!("eri/background/disable: {e}")))?;
    write_state(&p.workspace, false)
        .map_err(|e| DispatchError::Other(anyhow::anyhow!("write background state: {e}")))?;
    Ok(serde_json::json!({ "ok": true, "enabled": false }))
}

/// `eri/background/approveBash` — add a command to the trusted list for
/// this workspace. Persisted to `<workspace>/.eri/trusted-commands.json`.
pub async fn approve_bash(
    params: Value,
    _tier_state: &SharedTierState,
    _services: &Arc<Services>,
) -> Result<Value, DispatchError> {
    let p: ApproveBashParams = serde_json::from_value(params)
        .map_err(|e| DispatchError::BadParams(format!("eri/background/approveBash: {e}")))?;
    let cmd = p.command.trim().to_string();
    if cmd.is_empty() {
        return Err(DispatchError::BadParams("empty command".into()));
    }
    let mut trusted = read_trusted(&p.workspace).unwrap_or_default();
    trusted.insert(cmd);
    write_trusted(&p.workspace, &trusted)
        .map_err(|e| DispatchError::Other(anyhow::anyhow!("write trusted-commands: {e}")))?;
    Ok(serde_json::json!({ "ok": true, "count": trusted.len() }))
}

/// `eri/background/trusted` — list the workspace's trusted bash commands.
pub async fn trusted(
    params: Value,
    _tier_state: &SharedTierState,
    _services: &Arc<Services>,
) -> Result<Value, DispatchError> {
    let p: WorkspaceOnly = serde_json::from_value(params)
        .map_err(|e| DispatchError::BadParams(format!("eri/background/trusted: {e}")))?;
    let set = read_trusted(&p.workspace).unwrap_or_default();
    let mut commands: Vec<String> = set.into_iter().collect();
    commands.sort();
    let report = TrustedCommandsReport {
        workspace: p.workspace.to_string_lossy().to_string(),
        commands,
    };
    serde_json::to_value(report).map_err(|e| DispatchError::Other(e.into()))
}

/// `eri/background/rules` — read `<workspace>/.eri/janitor.json` and return
/// the parsed rule set. Missing file → empty list (the IDE just stays
/// quiet); malformed JSON → BadParams so the user knows to fix it.
pub async fn rules(
    params: Value,
    _tier_state: &SharedTierState,
    _services: &Arc<Services>,
) -> Result<Value, DispatchError> {
    let p: WorkspaceOnly = serde_json::from_value(params)
        .map_err(|e| DispatchError::BadParams(format!("eri/background/rules: {e}")))?;
    let parsed = load_janitor_rules(&p.workspace).map_err(DispatchError::BadParams)?;
    serde_json::to_value(parsed).map_err(|e| DispatchError::Other(e.into()))
}

async fn require_pro_tier(tier_state: &SharedTierState) -> Result<(), DispatchError> {
    let guard = tier_state.lock().await;
    // Reuse the tier label from setTier — both "pro" and "pro_plus" pass.
    let label = guard.tier.to_lowercase();
    if matches!(label.as_str(), "pro" | "pro_plus" | "teams" | "enterprise") {
        Ok(())
    } else {
        Err(DispatchError::FeatureLocked("backgroundAgents"))
    }
}

fn state_path(workspace: &Path) -> PathBuf {
    workspace.join(".eri").join("background.enabled")
}

fn write_state(workspace: &Path, enabled: bool) -> std::io::Result<()> {
    let path = state_path(workspace);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, if enabled { "1" } else { "0" })
}

fn trusted_path(workspace: &Path) -> PathBuf {
    workspace.join(".eri").join("trusted-commands.json")
}

fn read_trusted(workspace: &Path) -> std::io::Result<HashSet<String>> {
    let path = trusted_path(workspace);
    let raw = fs::read_to_string(&path)?;
    let list: Vec<String> = serde_json::from_str(&raw).unwrap_or_default();
    Ok(list.into_iter().collect())
}

fn write_trusted(workspace: &Path, set: &HashSet<String>) -> std::io::Result<()> {
    let path = trusted_path(workspace);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut sorted: Vec<&String> = set.iter().collect();
    sorted.sort();
    let body = serde_json::to_string_pretty(&sorted).map_err(|e| {
        std::io::Error::new(std::io::ErrorKind::InvalidData, format!("serialize: {e}"))
    })?;
    fs::write(path, body)
}
