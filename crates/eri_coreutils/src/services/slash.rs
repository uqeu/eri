//! `eri/slash/run` — server-side dispatch for agent-intent slash commands.
//!
//! Most slash commands (`/ship`, `/plan`, `/test`, `/refactor`, `/explain`,
//! `/sketch`, `/voice`) are thin shims that the extension's TS registry
//! can dispatch directly to existing JSON-RPC methods — going through this
//! arm would only add latency. This module owns the slash commands that
//! genuinely need server-side state:
//!
//! - `/agent <name>` — persona switcher; writes `<workspace>/.eri/persona`.
//! - `/recall`, `/remember`, `/forget`, `/learn` — memory operations
//!   (Phase 8); stubbed here so the IDE registry can dispatch uniformly
//!   even before the memory store lands.
//!
//! Reply shape: `{ ok, message?, persona? }` for `/agent`,
//! `{ ok: false, error: "not_implemented", phase: "8" }` for memory stubs.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use eri_inference::personas;

use crate::services::Services;
use crate::{DispatchError, SharedTierState};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SlashParams {
    command: String,
    #[serde(default)]
    args: String,
    workspace: PathBuf,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SlashResult {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    persona: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    phase: Option<String>,
}

pub async fn run(
    params: Value,
    _tier_state: &SharedTierState,
    _services: &std::sync::Arc<Services>,
) -> Result<Value, DispatchError> {
    let p: SlashParams = serde_json::from_value(params)
        .map_err(|e| DispatchError::BadParams(format!("eri/slash/run: {e}")))?;

    let result = match p.command.as_str() {
        "agent" => handle_agent(&p.workspace, &p.args),
        "recall" | "remember" | "forget" | "learn" | "cost" | "quota" => {
            SlashResult {
                ok: false,
                error: Some("not_implemented".to_string()),
                phase: Some("8".to_string()),
                message: Some(format!(
                    "/{} lands with the memory layer (Phase 8). Coming soon.",
                    p.command
                )),
                persona: None,
            }
        }
        // Commands the IDE handles client-side directly via the existing
        // JSON-RPC methods. The sidecar arm exists for uniformity but
        // returns a "dispatch_client" hint so the registry knows.
        "ship" | "plan" | "execute" | "test" | "refactor" | "explain"
        | "voice" | "sketch" => SlashResult {
            ok: false,
            error: Some("dispatch_client".to_string()),
            message: Some(format!(
                "Dispatch /{} client-side via the registry — no server work needed.",
                p.command
            )),
            persona: None,
            phase: None,
        },
        other => SlashResult {
            ok: false,
            error: Some("unknown_command".to_string()),
            message: Some(format!("Unknown slash command: /{other}")),
            persona: None,
            phase: None,
        },
    };

    Ok(serde_json::to_value(result).unwrap_or(Value::Null))
}

fn handle_agent(workspace: &std::path::Path, args: &str) -> SlashResult {
    let name = args.trim();
    if name.is_empty() {
        let active = personas::read_active(workspace);
        return SlashResult {
            ok: true,
            persona: Some(active.clone()),
            message: Some(format!("Active persona: {active}")),
            error: None,
            phase: None,
        };
    }
    // Confirm the persona exists either as a built-in or a user file.
    let resolved = personas::resolve(workspace, name);
    if resolved.name != name {
        return SlashResult {
            ok: false,
            error: Some("unknown_persona".to_string()),
            message: Some(format!(
                "No persona named '{name}'. Add .eri/agents/{name}.md or pick a built-in."
            )),
            persona: None,
            phase: None,
        };
    }
    match personas::write_active(workspace, name) {
        Ok(()) => SlashResult {
            ok: true,
            persona: Some(name.to_string()),
            message: Some(format!("Switched persona → {name}")),
            error: None,
            phase: None,
        },
        Err(err) => SlashResult {
            ok: false,
            error: Some("write_failed".to_string()),
            message: Some(format!("Failed to write .eri/persona: {err}")),
            persona: None,
            phase: None,
        },
    }
}
