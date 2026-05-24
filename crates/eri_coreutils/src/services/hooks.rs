//! `eri/hooks/*` JSON-RPC handlers.
//!
//! `eri/hooks/list` returns the workspace's compiled hook table for UI
//! display. `eri/hooks/fire` manually triggers an event (used by tests and
//! by the extension's "Run Hook" command).

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use eri_hooks::{HookEvent, Hooks};

use crate::DispatchError;
use crate::services::Services;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListParams {
    workspace: PathBuf,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HookSummary {
    event: String,
    matcher: Option<String>,
    command: String,
    background: bool,
    timeout_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ListResult {
    hooks: Vec<HookSummary>,
}

pub async fn list(params: Value, _services: &Services) -> Result<Value, DispatchError> {
    let p: ListParams = parse_params(params)?;
    let hooks = Hooks::load(&p.workspace).map_err(DispatchError::Other)?;
    let summaries: Vec<HookSummary> = hooks
        .list()
        .into_iter()
        .map(|(event, hook)| HookSummary {
            event: event.to_string(),
            matcher: hook.matcher.as_ref().map(|r| r.as_str().to_string()),
            command: hook.command.clone(),
            background: hook.background,
            timeout_ms: hook.timeout.as_millis() as u64,
        })
        .collect();
    serde_json::to_value(ListResult { hooks: summaries })
        .map_err(|e| DispatchError::Other(e.into()))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FireParams {
    workspace: PathBuf,
    event: String,
    #[serde(default)]
    method: Option<String>,
    #[serde(default)]
    params: Option<Value>,
    #[serde(default)]
    result: Option<Value>,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    source: Option<String>,
    #[serde(default)]
    prompt: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OutcomeSummary {
    event: String,
    command_preview: String,
    stdout: String,
    stderr: String,
    exit_code: Option<i32>,
    duration_ms: u64,
    timed_out: bool,
    backgrounded: bool,
    spawn_error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FireResult {
    outcomes: Vec<OutcomeSummary>,
}

pub async fn fire(params: Value, _services: &Services) -> Result<Value, DispatchError> {
    let p: FireParams = parse_params(params)?;
    let hooks = Hooks::load(&p.workspace).map_err(DispatchError::Other)?;
    let event = match p.event.as_str() {
        "SessionStart" => HookEvent::SessionStart,
        "SessionEnd" => HookEvent::SessionEnd,
        "UserPromptSubmit" => HookEvent::UserPromptSubmit {
            source: p.source.unwrap_or_default(),
            prompt: p.prompt.unwrap_or_default(),
        },
        "PreToolUse" => HookEvent::PreToolUse {
            method: p.method.unwrap_or_default(),
            params: p.params.unwrap_or(Value::Null),
        },
        "PostToolUse" => HookEvent::PostToolUse {
            method: p.method.unwrap_or_default(),
            result: p.result.unwrap_or(Value::Null),
        },
        "PostToolError" => HookEvent::PostToolError {
            method: p.method.unwrap_or_default(),
            error: p.error.unwrap_or_default(),
        },
        other => {
            return Err(DispatchError::BadParams(format!("unknown event: {other}")));
        }
    };
    let outcomes = hooks.fire(event).await;
    let summaries: Vec<OutcomeSummary> = outcomes
        .into_iter()
        .map(|o| OutcomeSummary {
            event: o.event,
            command_preview: o.command_preview,
            stdout: o.stdout,
            stderr: o.stderr,
            exit_code: o.exit_code,
            duration_ms: o.duration_ms,
            timed_out: o.timed_out,
            backgrounded: o.backgrounded,
            spawn_error: o.spawn_error,
        })
        .collect();
    serde_json::to_value(FireResult {
        outcomes: summaries,
    })
    .map_err(|e| DispatchError::Other(e.into()))
}

fn parse_params<T: for<'de> Deserialize<'de>>(value: Value) -> Result<T, DispatchError> {
    serde_json::from_value(value).map_err(|e| DispatchError::BadParams(e.to_string()))
}
