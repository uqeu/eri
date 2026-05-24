//! `eri/rules/*` JSON-RPC handlers.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use eri_rules::{Mode, PromptContext, Rules};

use crate::DispatchError;
use crate::services::Services;

const BODY_PREVIEW_CHARS: usize = 160;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListParams {
    workspace: PathBuf,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct ActiveParams {
    workspace: PathBuf,
    open_files: Vec<PathBuf>,
    mentioned: Vec<String>,
    agent_requested: Vec<String>,
}

impl Default for ActiveParams {
    fn default() -> Self {
        Self {
            workspace: PathBuf::new(),
            open_files: Vec::new(),
            mentioned: Vec::new(),
            agent_requested: Vec::new(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuleSummary {
    name: String,
    mode: &'static str,
    priority: i64,
    description: Option<String>,
    body_preview: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ListResult {
    rules: Vec<RuleSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActiveRule {
    name: String,
    body: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActiveResult {
    active: Vec<ActiveRule>,
}

pub async fn list(params: Value, _services: &Services) -> Result<Value, DispatchError> {
    let p: ListParams = parse_params(params)?;
    let rules = Rules::load(&p.workspace).map_err(DispatchError::Other)?;
    let summaries: Vec<RuleSummary> = rules
        .all()
        .iter()
        .map(|r| RuleSummary {
            name: r.name().to_string(),
            mode: mode_str(r.mode()),
            priority: r.priority(),
            description: r.description().map(str::to_string),
            body_preview: preview(r.body()),
        })
        .collect();
    serde_json::to_value(ListResult { rules: summaries })
        .map_err(|e| DispatchError::Other(e.into()))
}

pub async fn active(params: Value, _services: &Services) -> Result<Value, DispatchError> {
    let p: ActiveParams = parse_params(params)?;
    if p.workspace.as_os_str().is_empty() {
        return Err(DispatchError::BadParams("workspace is required".into()));
    }
    let rules = Rules::load(&p.workspace).map_err(DispatchError::Other)?;
    let ctx = PromptContext::new()
        .with_open_files(p.open_files)
        .with_mentioned(p.mentioned)
        .with_agent_requested(p.agent_requested);
    let active: Vec<ActiveRule> = rules
        .active_for(&ctx)
        .into_iter()
        .map(|r| ActiveRule {
            name: r.name().to_string(),
            body: r.body().to_string(),
        })
        .collect();
    serde_json::to_value(ActiveResult { active }).map_err(|e| DispatchError::Other(e.into()))
}

fn parse_params<T: for<'de> Deserialize<'de>>(value: Value) -> Result<T, DispatchError> {
    serde_json::from_value(value).map_err(|e| DispatchError::BadParams(e.to_string()))
}

fn mode_str(mode: &Mode) -> &'static str {
    match mode {
        Mode::Always => "always",
        Mode::AutoAttached { .. } => "auto_attached",
        Mode::AgentRequested => "agent_requested",
        Mode::Manual => "manual",
    }
}

fn preview(body: &str) -> String {
    let trimmed = body.trim();
    if trimmed.chars().count() <= BODY_PREVIEW_CHARS {
        return trimmed.to_string();
    }
    let mut out: String = trimmed.chars().take(BODY_PREVIEW_CHARS).collect();
    out.push('…');
    out
}
