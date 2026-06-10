//! Natural-language voice intent router.
//!
//! Voice transcripts that don't match the extension's local fast-path
//! (Jaccard-based terminal matcher + regex view-intent classifier) get
//! routed here. We ask the active checker model — typically claude-haiku
//! via the eri proxy because it's cheap, one-shot, and good at JSON
//! classification — to map the utterance to either a structured IDE
//! command or a chat passthrough.
//!
//! Why not Mercury? Mercury is a diffusion code generator; one-shot
//! intent classification is the wrong use of the streaming-token-budget
//! shape. The user's headline question was "can Mercury control the
//! IDE?" — the answer is yes, but via the agent layer, where the
//! checker model handles classification and the builder model handles
//! anything that ends up generating code. This handler is the
//! classifier half of that split.
//!
//! Wire shape:
//!   request:  { transcript, context?: { mode, chatPosition, focus,
//!                                       terminals: [{id, name}], … } }
//!   response: { kind: "command", command, args }
//!           | { kind: "chat", reply }
//!           | { kind: "none", reason }

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::DispatchError;
use crate::services::Services;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RouteParams {
    transcript: String,
    /// Optional IDE state the model can use to disambiguate. Free-form
    /// JSON so the extension can grow the surface without a wire
    /// migration.
    #[serde(default)]
    context: Value,
    /// Optional model slug override. Defaults to the cheapest reliable
    /// classifier the user has access to.
    #[serde(default)]
    model: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RouteReport {
    #[serde(rename = "command")]
    Command {
        command: String,
        #[serde(skip_serializing_if = "Value::is_null")]
        args: Value,
    },
    #[serde(rename = "chat")]
    Chat { reply: String },
    #[serde(rename = "none")]
    None { reason: String },
}

pub async fn route(params: Value, services: &Arc<Services>) -> Result<Value, DispatchError> {
    let parsed: RouteParams = serde_json::from_value(params)
        .map_err(|e| DispatchError::BadParams(format!("eri/voice/route: {e}")))?;
    let transcript = parsed.transcript.trim().to_string();
    if transcript.is_empty() {
        return ok_report(&RouteReport::None {
            reason: "empty transcript".into(),
        });
    }

    let provider = match resolve_provider(services, parsed.model.as_deref()).await {
        Some(p) => p,
        None => {
            // No classifier model wired up (offline tier, no proxy session,
            // no BYOK). Tell the caller — it'll fall back to chat passthrough.
            return ok_report(&RouteReport::None {
                reason: "no classifier provider available".into(),
            });
        }
    };

    let user_block = build_user_block(&transcript, &parsed.context);
    let system_block = SYSTEM_PROMPT.to_string();

    let response = match provider.complete(&system_block, &user_block, 384) {
        Ok(r) => r,
        Err(e) => {
            return ok_report(&RouteReport::None {
                reason: format!("inference failed: {e}"),
            });
        }
    };

    let parsed_report = parse_router_response(&response.text);
    ok_report(&parsed_report)
}

async fn resolve_provider(
    services: &Services,
    explicit: Option<&str>,
) -> Option<Box<dyn eri_inference::llm_provider::LlmProvider>> {
    // Prefer the cheapest reliable classifier in order of availability.
    // The first slug that resolves wins. Mercury is intentionally not in
    // this list — it's diffusion-only and the wrong tool for one-shot
    // JSON classification. Each candidate goes through the shared
    // provider-acquisition seam, so BYOK + proxy keys are honored (not just env).
    let candidates: Vec<&str> = match explicit {
        Some(slug) => vec![slug],
        None => vec![
            "claude-haiku-4-5",
            "claude-sonnet-4-5",
            "gpt-4o-mini",
            "gpt-4o",
            "gemini-2.5-flash",
            "gemini-2.5-pro",
        ],
    };
    for slug in candidates {
        if let Ok(provider) = super::iterate::resolve_provider(services, slug).await {
            return Some(provider);
        }
    }
    None
}

fn build_user_block(transcript: &str, context: &Value) -> String {
    let mut out = String::with_capacity(transcript.len() + 256);
    out.push_str("Transcript:\n");
    out.push_str(transcript);
    out.push_str("\n\n");
    if !context.is_null() && !matches!(context, Value::Object(o) if o.is_empty()) {
        out.push_str("IDE context (JSON):\n");
        out.push_str(&serde_json::to_string(context).unwrap_or_default());
        out.push_str("\n\n");
    }
    out.push_str(
        "Respond with ONLY a single JSON object. No prose, no markdown, no \
         code fence. Choose exactly one of the shapes documented in the system prompt.",
    );
    out
}

/// Parse the model's response — tolerate accidental markdown fences and
/// trailing whitespace. Falls through to `RouteReport::Chat` with the raw
/// text when the JSON shape is unrecognised so the user still gets a
/// reply instead of silence.
pub fn parse_router_response(text: &str) -> RouteReport {
    let trimmed = strip_code_fence(text.trim());
    if trimmed.is_empty() {
        return RouteReport::None {
            reason: "model returned empty response".into(),
        };
    }
    let value: Value = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(_) => {
            return RouteReport::Chat {
                reply: trimmed.to_string(),
            };
        }
    };
    let kind = value
        .get("kind")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    match kind.as_str() {
        "command" => {
            let command = value
                .get("command")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if command.is_empty() || !is_allowlisted_command(&command) {
                return RouteReport::None {
                    reason: format!("command not allowlisted: {command}"),
                };
            }
            let args = value.get("args").cloned().unwrap_or(Value::Null);
            RouteReport::Command { command, args }
        }
        "chat" => RouteReport::Chat {
            reply: value
                .get("reply")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
        },
        "none" => RouteReport::None {
            reason: value
                .get("reason")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
        },
        _ => RouteReport::Chat {
            reply: trimmed.to_string(),
        },
    }
}

fn strip_code_fence(text: &str) -> &str {
    let mut t = text;
    if let Some(stripped) = t.strip_prefix("```json") {
        t = stripped;
    } else if let Some(stripped) = t.strip_prefix("```") {
        t = stripped;
    }
    if let Some(stripped) = t.strip_suffix("```") {
        t = stripped;
    }
    t.trim()
}

/// Allowlist of IDE commands the voice router is allowed to emit. The
/// extension also validates this on receipt — defence in depth keeps
/// the LLM from invoking arbitrary `vscode.commands.executeCommand` IDs.
fn is_allowlisted_command(command: &str) -> bool {
    matches!(
        command,
        "eri.layout.toggleMode"
            | "eri.layout.setChatPosition"
            | "eri.layout.openSettings"
            | "eri.themes.openHub"
            | "eri.preview.zoom"
            | "eri.preview.scroll"
            | "eri.preview.reload"
            | "eri.openChat"
            | "eri.openComposer"
            | "eri.openPreview"
            | "eri.agents.switch"
            | "eri.ship.run"
            | "eri.acceptIteration"
            | "eri.rejectIteration"
            | "eri.stopGeneration"
            | "eri.mentions.openPicker"
            | "eri.checkpoints.create"
            | "eri.checkpoints.restore"
            | "eri.review.run"
            | "workbench.action.quickOpen"
            | "workbench.action.findInFiles"
            | "workbench.action.terminal.focus"
            | "workbench.action.toggleSidebarVisibility"
            | "editor.action.fontZoomIn"
            | "editor.action.fontZoomOut"
            | "editor.action.scrollPageDown"
            | "editor.action.scrollPageUp"
            | "editor.action.scrollLineDown"
            | "editor.action.scrollLineUp"
    )
}

fn ok_report(report: &RouteReport) -> Result<Value, DispatchError> {
    serde_json::to_value(report).map_err(|e| DispatchError::Other(e.into()))
}

const SYSTEM_PROMPT: &str = include_str!("voice_route_system.md");

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_command_response() {
        let r = parse_router_response(
            r#"{"kind":"command","command":"eri.layout.toggleMode","args":{}}"#,
        );
        match r {
            RouteReport::Command { command, .. } => {
                assert_eq!(command, "eri.layout.toggleMode")
            }
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn rejects_non_allowlisted_command() {
        let r = parse_router_response(
            r#"{"kind":"command","command":"workbench.action.deleteAllFiles","args":{}}"#,
        );
        assert!(matches!(r, RouteReport::None { .. }));
    }

    #[test]
    fn tolerates_markdown_fence() {
        let r = parse_router_response("```json\n{\"kind\":\"chat\",\"reply\":\"hello\"}\n```");
        match r {
            RouteReport::Chat { reply } => assert_eq!(reply, "hello"),
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn empty_transcript_is_none() {
        let r = parse_router_response("");
        assert!(matches!(r, RouteReport::None { .. }));
    }

    #[test]
    fn unknown_kind_falls_back_to_chat() {
        let r = parse_router_response(r#"{"kind":"explode","reply":"boom"}"#);
        assert!(matches!(r, RouteReport::Chat { .. }));
    }

    #[test]
    fn build_user_block_includes_transcript() {
        let block = build_user_block("switch to eri mode", &json!({ "mode": "coder" }));
        assert!(block.contains("switch to eri mode"));
        assert!(block.contains("\"mode\":\"coder\""));
    }
}
