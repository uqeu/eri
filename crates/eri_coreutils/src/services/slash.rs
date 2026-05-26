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
        "tracer" => handle_tracer(&p.args),
        "document" => handle_document(&p.args),
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

/// `/tracer <github-url> <query>` — Nia parity (Phase 21a). Validates
/// the input and returns a `dispatch_client` hint so the IDE-side
/// runner can clone the repo into `~/.eri/sandboxes/<sha>/`, index it,
/// answer the query, and tear the sandbox down. The actual clone
/// happens client-side because it needs network IO + filesystem
/// scratch the sidecar doesn't currently own.
fn handle_tracer(args: &str) -> SlashResult {
    let trimmed = args.trim();
    if trimmed.is_empty() {
        return SlashResult {
            ok: false,
            error: Some("bad_args".to_string()),
            message: Some(
                "Usage: /tracer <github-url> <query>. Example: /tracer https://github.com/anthropics/anthropic-sdk-python what is the streaming API?"
                    .to_string(),
            ),
            persona: None,
            phase: None,
        };
    }
    let (url, query) = match trimmed.split_once(char::is_whitespace) {
        Some((u, q)) if !u.is_empty() && !q.trim().is_empty() => (u.to_string(), q.trim().to_string()),
        _ => {
            return SlashResult {
                ok: false,
                error: Some("bad_args".to_string()),
                message: Some(
                    "Provide both a repo URL and a query. Example: /tracer https://github.com/foo/bar where is auth?"
                        .into(),
                ),
                persona: None,
                phase: None,
            };
        }
    };
    if !looks_like_repo_url(&url) {
        return SlashResult {
            ok: false,
            error: Some("bad_args".to_string()),
            message: Some(format!("Not a recognised git URL: {url}")),
            persona: None,
            phase: None,
        };
    }
    SlashResult {
        ok: false,
        error: Some("dispatch_client".to_string()),
        message: Some(format!(
            "Tracer ready for {url}. Query: {query}. IDE runs the sandboxed clone + index."
        )),
        persona: None,
        phase: None,
    }
}

/// `/document <path-or-url>` — Nia parity (Phase 21b). The actual
/// multimodal extraction runs upstream in the proxy after the IDE
/// uploads the file; we just validate the input here and return a
/// `dispatch_client` hint with the resolved target.
fn handle_document(args: &str) -> SlashResult {
    let target = args.trim();
    if target.is_empty() {
        return SlashResult {
            ok: false,
            error: Some("bad_args".to_string()),
            message: Some(
                "Usage: /document <path-or-url>. Example: /document ./RFC-1234.pdf or /document https://arxiv.org/abs/2306.12345"
                    .to_string(),
            ),
            persona: None,
            phase: None,
        };
    }
    SlashResult {
        ok: false,
        error: Some("dispatch_client".to_string()),
        message: Some(format!(
            "Document ready: {target}. IDE will upload + extract with Sonnet."
        )),
        persona: None,
        phase: None,
    }
}

fn looks_like_repo_url(url: &str) -> bool {
    url.starts_with("https://github.com/")
        || url.starts_with("https://gitlab.com/")
        || url.starts_with("https://bitbucket.org/")
        || url.starts_with("git@github.com:")
        || url.starts_with("https://codeberg.org/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tracer_rejects_empty_args() {
        let r = handle_tracer("");
        assert!(!r.ok);
        assert_eq!(r.error.as_deref(), Some("bad_args"));
    }

    #[test]
    fn tracer_rejects_missing_query() {
        let r = handle_tracer("https://github.com/foo/bar");
        assert!(!r.ok);
        assert_eq!(r.error.as_deref(), Some("bad_args"));
    }

    #[test]
    fn tracer_rejects_non_repo_url() {
        let r = handle_tracer("https://example.com/foo what is x?");
        assert!(!r.ok);
        assert_eq!(r.error.as_deref(), Some("bad_args"));
    }

    #[test]
    fn tracer_accepts_well_formed_input_and_dispatches_client() {
        let r =
            handle_tracer("https://github.com/anthropics/anthropic-sdk-python what is streaming?");
        assert_eq!(r.error.as_deref(), Some("dispatch_client"));
        assert!(r.message.as_deref().unwrap_or("").contains("Tracer ready"));
    }

    #[test]
    fn document_rejects_empty_target() {
        let r = handle_document("");
        assert!(!r.ok);
        assert_eq!(r.error.as_deref(), Some("bad_args"));
    }

    #[test]
    fn document_accepts_path_and_url_targets() {
        let r1 = handle_document("./paper.pdf");
        let r2 = handle_document("https://arxiv.org/abs/2306.12345");
        assert_eq!(r1.error.as_deref(), Some("dispatch_client"));
        assert_eq!(r2.error.as_deref(), Some("dispatch_client"));
    }
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
