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
        "theme" => handle_theme(&p.workspace, &p.args),
        "new" => handle_new(&p.args),
        "preference" => handle_preference(&p.workspace, &p.args),
        "recall" | "remember" | "forget" | "learn" | "cost" | "quota" => SlashResult {
            ok: false,
            error: Some("not_implemented".to_string()),
            phase: Some("8".to_string()),
            message: Some(format!(
                "/{} lands with the memory layer (Phase 8). Coming soon.",
                p.command
            )),
            persona: None,
        },
        // Commands the IDE handles client-side directly via the existing
        // JSON-RPC methods. The sidecar arm exists for uniformity but
        // returns a "dispatch_client" hint so the registry knows.
        "ship" | "plan" | "execute" | "test" | "refactor" | "explain" | "voice" | "sketch" => {
            SlashResult {
                ok: false,
                error: Some("dispatch_client".to_string()),
                message: Some(format!(
                    "Dispatch /{} client-side via the registry — no server work needed.",
                    p.command
                )),
                persona: None,
                phase: None,
            }
        }
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
        Some((u, q)) if !u.is_empty() && !q.trim().is_empty() => {
            (u.to_string(), q.trim().to_string())
        }
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

/// `/theme [<slug>]` — empty args lists the catalog client-side;
/// non-empty args set the active theme by writing
/// `<workspace>/.eri/theme.json`.
fn handle_theme(workspace: &std::path::Path, args: &str) -> SlashResult {
    let slug = args.trim();
    if slug.is_empty() {
        return SlashResult {
            ok: false,
            error: Some("dispatch_client".to_string()),
            message: Some(
                "Open the theme picker — /theme list shows the 80-theme catalog. /theme <slug> sets the active one."
                    .into(),
            ),
            persona: None,
            phase: None,
        };
    }
    if slug == "list" {
        return SlashResult {
            ok: false,
            error: Some("dispatch_client".to_string()),
            message: Some("Open the theme picker.".into()),
            persona: None,
            phase: None,
        };
    }
    // Validate the slug exists in the catalog before writing.
    if super::themes::resolve_theme(slug).is_none() {
        return SlashResult {
            ok: false,
            error: Some("unknown_theme".to_string()),
            message: Some(format!("Unknown theme: {slug}. Try /theme list.")),
            persona: None,
            phase: None,
        };
    }
    let path = workspace.join(".eri").join("theme.json");
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Err(err) = std::fs::write(&path, format!("{{\n  \"active\": \"{slug}\"\n}}\n")) {
        return SlashResult {
            ok: false,
            error: Some("write_failed".to_string()),
            message: Some(format!("Failed to write .eri/theme.json: {err}")),
            persona: None,
            phase: None,
        };
    }
    SlashResult {
        ok: true,
        error: None,
        message: Some(format!("Theme set to {slug}.")),
        persona: None,
        phase: None,
    }
}

/// `/new [<slug>]` — empty opens the picker; with a slug, dispatches
/// the IDE to scaffold the matching template into the empty workspace.
fn handle_new(args: &str) -> SlashResult {
    let slug = args.trim();
    if slug.is_empty() {
        return SlashResult {
            ok: false,
            error: Some("dispatch_client".to_string()),
            message: Some("Open the template picker.".into()),
            persona: None,
            phase: None,
        };
    }
    let known: bool = super::templates::builtin_templates()
        .iter()
        .any(|t| t.slug == slug);
    if !known {
        return SlashResult {
            ok: false,
            error: Some("unknown_template".to_string()),
            message: Some(format!("Unknown template: {slug}. Try /new without args.")),
            persona: None,
            phase: None,
        };
    }
    SlashResult {
        ok: false,
        error: Some("dispatch_client".to_string()),
        message: Some(format!("Scaffold {slug} into the workspace.")),
        persona: None,
        phase: None,
    }
}

/// `/preference key.path=value` — sets a single dotted-path preference
/// in `<workspace>/.eri/preferences.json`. Values are parsed as JSON
/// when possible; raw strings fall back to a plain string value.
fn handle_preference(workspace: &std::path::Path, args: &str) -> SlashResult {
    let trimmed = args.trim();
    let Some(eq) = trimmed.find('=') else {
        return SlashResult {
            ok: false,
            error: Some("bad_args".to_string()),
            message: Some(
                "Usage: /preference codeStyle.semicolons=false or /preference packageManager=pnpm"
                    .into(),
            ),
            persona: None,
            phase: None,
        };
    };
    let path_part = trimmed[..eq].trim();
    let value_part = trimmed[eq + 1..].trim();
    if path_part.is_empty() || value_part.is_empty() {
        return SlashResult {
            ok: false,
            error: Some("bad_args".to_string()),
            message: Some("Key and value must both be non-empty.".into()),
            persona: None,
            phase: None,
        };
    }
    let parsed_value = serde_json::from_str::<serde_json::Value>(value_part)
        .unwrap_or_else(|_| serde_json::Value::String(value_part.to_string()));
    let path = workspace.join(".eri").join("preferences.json");
    let mut current: serde_json::Value = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::Value::Object(serde_json::Map::new()));
    if !current.is_object() {
        current = serde_json::Value::Object(serde_json::Map::new());
    }
    set_dotted_path(&mut current, path_part, parsed_value);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let serialized = serde_json::to_string_pretty(&current).unwrap_or_default();
    if let Err(err) = std::fs::write(&path, format!("{serialized}\n")) {
        return SlashResult {
            ok: false,
            error: Some("write_failed".to_string()),
            message: Some(format!("Failed to write .eri/preferences.json: {err}")),
            persona: None,
            phase: None,
        };
    }
    SlashResult {
        ok: true,
        error: None,
        message: Some(format!("Set {path_part}.")),
        persona: None,
        phase: None,
    }
}

fn set_dotted_path(root: &mut serde_json::Value, path: &str, value: serde_json::Value) {
    let parts: Vec<&str> = path.split('.').collect();
    let mut cursor = root;
    for (i, key) in parts.iter().enumerate() {
        let last = i == parts.len() - 1;
        if !cursor.is_object() {
            *cursor = serde_json::Value::Object(serde_json::Map::new());
        }
        let obj = cursor.as_object_mut().expect("just made it an object");
        if last {
            obj.insert((*key).to_string(), value);
            return;
        }
        let entry = obj
            .entry((*key).to_string())
            .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()));
        if !entry.is_object() {
            *entry = serde_json::Value::Object(serde_json::Map::new());
        }
        cursor = entry;
    }
}

fn looks_like_repo_url(url: &str) -> bool {
    url.starts_with("https://github.com/")
        || url.starts_with("https://gitlab.com/")
        || url.starts_with("https://bitbucket.org/")
        || url.starts_with("git@github.com:")
        || url.starts_with("https://codeberg.org/")
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

    #[test]
    fn theme_rejects_unknown_slug() {
        let dir = tempfile::TempDir::new().unwrap();
        let r = handle_theme(dir.path(), "does-not-exist");
        assert!(!r.ok);
        assert_eq!(r.error.as_deref(), Some("unknown_theme"));
    }

    #[test]
    fn theme_persists_known_slug_to_workspace_file() {
        let dir = tempfile::TempDir::new().unwrap();
        let r = handle_theme(dir.path(), "linear");
        assert!(r.ok);
        let written = std::fs::read_to_string(dir.path().join(".eri").join("theme.json"))
            .expect("theme file written");
        assert!(written.contains("linear"));
    }

    #[test]
    fn new_dispatches_known_template() {
        let r = handle_new("saas-next");
        assert_eq!(r.error.as_deref(), Some("dispatch_client"));
    }

    #[test]
    fn new_rejects_unknown_template() {
        let r = handle_new("not-a-template");
        assert!(!r.ok);
        assert_eq!(r.error.as_deref(), Some("unknown_template"));
    }

    #[test]
    fn preference_writes_dotted_path() {
        let dir = tempfile::TempDir::new().unwrap();
        let r = handle_preference(dir.path(), "codeStyle.semicolons=false");
        assert!(r.ok, "expected ok, got {r:?}");
        let raw = std::fs::read_to_string(dir.path().join(".eri").join("preferences.json"))
            .expect("prefs file written");
        let json: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(
            json.pointer("/codeStyle/semicolons"),
            Some(&serde_json::Value::Bool(false))
        );
    }

    #[test]
    fn preference_falls_back_to_string_value() {
        let dir = tempfile::TempDir::new().unwrap();
        let r = handle_preference(dir.path(), "packageManager=pnpm");
        assert!(r.ok);
        let raw =
            std::fs::read_to_string(dir.path().join(".eri").join("preferences.json")).unwrap();
        let json: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(
            json.pointer("/packageManager"),
            Some(&serde_json::Value::String("pnpm".to_string()))
        );
    }

    #[test]
    fn preference_rejects_missing_equals() {
        let dir = tempfile::TempDir::new().unwrap();
        let r = handle_preference(dir.path(), "no equals here");
        assert!(!r.ok);
        assert_eq!(r.error.as_deref(), Some("bad_args"));
    }
}
