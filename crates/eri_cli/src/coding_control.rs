//! Coding-environment control — the tool layer that lets eri *drive a code
//! editor the way a human does*: open files, run command-palette commands, steer
//! the editor's AI chat, accept/reject the AI's proposed edits, and save. This is
//! the headline "eri runs your coding agents" surface.
//!
//! It sits ON TOP of the computer-control loop ([`crate::control_agent`]): each
//! coding intent is a small typed [`CodingAction`] that **lowers** to a sequence
//! of existing primitive [`ControlAction`]s (OpenApp / Key / Type). There is NO
//! new actuation backend — the lowered primitives flow through the very same
//! [`ControlBridge`] and, crucially, the very same [`ControlGate`]. So a
//! command-palette command that types something destructive ("rm -rf", "DROP
//! TABLE") still trips the existing content-aware risk gate; nothing here can
//! bypass safety.
//!
//! The keyboard shortcuts are **Cursor / VS Code defaults** (they share the same
//! bindings). They live in named constants so a future per-IDE retarget (JetBrains,
//! Zed, …) is a one-line change rather than a hunt through the lowering logic.

use anyhow::{Result, anyhow};
use serde_json::{Value, json};

use crate::control_agent::ControlAction;

// ─────────────────────── Cursor / VS Code default shortcuts ───────────────────────
//
// These are the stock Cursor / VS Code keybindings (macOS). Cursor inherits the
// VS Code command palette + quick-open, and adds the AI chat pane on ⌘L. Kept as
// constants so retargeting to another editor is a single edit here, with the
// lowering logic untouched.

/// Quick Open (file picker). VS Code / Cursor: ⌘P.
const KEY_QUICK_OPEN: &str = "cmd+p";
/// Command Palette. VS Code / Cursor: ⌘⇧P.
const KEY_COMMAND_PALETTE: &str = "cmd+shift+p";
/// Open the AI chat pane. Cursor: ⌘L (VS Code Copilot Chat also maps here when
/// installed). This is where eri *steers the coding agent*.
const KEY_AI_CHAT: &str = "cmd+l";
/// Accept the AI's proposed inline edit. Cursor: ⌘↵.
const KEY_ACCEPT_SUGGESTION: &str = "cmd+enter";
/// Dismiss / reject the AI's proposed edit. Editor-universal: Esc.
const KEY_REJECT_SUGGESTION: &str = "esc";
/// Save the active file. VS Code / Cursor: ⌘S.
const KEY_SAVE: &str = "cmd+s";
/// Commit the typed entry in a palette/quick-open/chat field.
const KEY_SUBMIT: &str = "enter";

/// One coding intent the model can request. Each variant is the editor-level
/// action a human performs; [`Self::lower`] turns it into the primitive
/// keystroke/typing sequence that actually drives the editor.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CodingAction {
    /// Open a file by path via Quick Open (⌘P, type path, ↵).
    OpenFile { path: String },
    /// Run an editor command by its Command Palette name (⌘⇧P, type name, ↵) —
    /// covers "Run Tests", "Format Document", "Go to Definition", etc.
    Command { command: String },
    /// Open the AI chat pane (⌘L), type a prompt, and submit (↵) — eri
    /// orchestrating the editor's own coding agent.
    SteerAgent { prompt: String },
    /// Accept the AI's proposed inline edit (⌘↵).
    AcceptSuggestion,
    /// Reject / dismiss the AI's proposed inline edit (Esc).
    RejectSuggestion,
    /// Save the active file (⌘S).
    Save,
}

impl CodingAction {
    /// Lower this coding intent to the primitive [`ControlAction`] sequence that
    /// performs it. The ordering is load-bearing: e.g. open-file emits the
    /// quick-open shortcut, THEN the path, THEN submit. Each primitive is run
    /// through the gate by the executor, so the typed `command`/`prompt` still
    /// passes the content-aware risk check.
    pub fn lower(&self) -> Vec<ControlAction> {
        match self {
            CodingAction::OpenFile { path } => vec![
                ControlAction::Key(KEY_QUICK_OPEN.into()),
                ControlAction::Type(path.clone()),
                ControlAction::Key(KEY_SUBMIT.into()),
            ],
            CodingAction::Command { command } => vec![
                ControlAction::Key(KEY_COMMAND_PALETTE.into()),
                ControlAction::Type(command.clone()),
                ControlAction::Key(KEY_SUBMIT.into()),
            ],
            CodingAction::SteerAgent { prompt } => vec![
                ControlAction::Key(KEY_AI_CHAT.into()),
                ControlAction::Type(prompt.clone()),
                ControlAction::Key(KEY_SUBMIT.into()),
            ],
            CodingAction::AcceptSuggestion => {
                vec![ControlAction::Key(KEY_ACCEPT_SUGGESTION.into())]
            }
            CodingAction::RejectSuggestion => {
                vec![ControlAction::Key(KEY_REJECT_SUGGESTION.into())]
            }
            CodingAction::Save => vec![ControlAction::Key(KEY_SAVE.into())],
        }
    }

    /// Human-readable description for narration + the confirm prompt. eri voice,
    /// no internals (no shortcut names — that's plumbing the user never sees).
    pub fn describe(&self) -> String {
        match self {
            CodingAction::OpenFile { path } => format!("open {path} in the editor"),
            CodingAction::Command { command } => format!("run the editor command {command:?}"),
            CodingAction::SteerAgent { prompt } => format!("ask the editor's AI: {prompt:?}"),
            CodingAction::AcceptSuggestion => "accept the AI's suggested edit".into(),
            CodingAction::RejectSuggestion => "dismiss the AI's suggested edit".into(),
            CodingAction::Save => "save the file".into(),
        }
    }
}

/// Is `name` one of the coding-control tools? Lets the executor route it to
/// [`parse_coding_action`] + lowering instead of the primitive `parse_action`.
pub fn is_coding_tool(name: &str) -> bool {
    matches!(
        name,
        "editor_open_file"
            | "editor_command"
            | "editor_steer_agent"
            | "editor_accept_suggestion"
            | "editor_reject_suggestion"
            | "editor_save"
    )
}

/// Parse a model tool call `(name, input)` into a [`CodingAction`]. Strict: a
/// required string field that is missing OR blank is an error (we never drive the
/// editor with an empty path/command/prompt).
pub fn parse_coding_action(name: &str, input: &Value) -> Result<CodingAction> {
    match name {
        "editor_open_file" => Ok(CodingAction::OpenFile {
            path: required_str(input, "path", name)?,
        }),
        "editor_command" => Ok(CodingAction::Command {
            command: required_str(input, "command", name)?,
        }),
        "editor_steer_agent" => Ok(CodingAction::SteerAgent {
            prompt: required_str(input, "prompt", name)?,
        }),
        "editor_accept_suggestion" => Ok(CodingAction::AcceptSuggestion),
        "editor_reject_suggestion" => Ok(CodingAction::RejectSuggestion),
        "editor_save" => Ok(CodingAction::Save),
        other => Err(anyhow!("unknown coding tool: {other}")),
    }
}

/// Read a required, non-blank string field from a tool input.
fn required_str(input: &Value, key: &str, tool: &str) -> Result<String> {
    let v = input
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow!("{tool} needs a non-empty `{key}`"))?;
    Ok(v.to_string())
}

/// The coding-control tool specs advertised to the model. Plain descriptions in
/// eri's voice — they describe *what the editor does*, never the shortcut or the
/// fact that eri is synthesising keystrokes. Appended to the computer-control
/// [`crate::control_agent::tool_specs`].
pub fn coding_tool_specs() -> Vec<Value> {
    vec![
        json!({
            "name": "editor_open_file",
            "description": "Open a file in the code editor (Cursor / VS Code) by its path. Use this to jump straight to a file instead of clicking through the file tree.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "File path or name to open, e.g. \"src/main.rs\"." }
                },
                "required": ["path"]
            }
        }),
        json!({
            "name": "editor_command",
            "description": "Run an editor command by name from the command palette — e.g. \"Run Tests\", \"Format Document\", \"Go to Definition\", \"Toggle Terminal\". Use the command's display name as you'd see it in the palette.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "command": { "type": "string", "description": "The command's display name, e.g. \"Format Document\"." }
                },
                "required": ["command"]
            }
        }),
        json!({
            "name": "editor_steer_agent",
            "description": "Send a prompt to the editor's built-in AI chat — this is how you direct the coding agent in Cursor / VS Code (e.g. \"add error handling to this function\", \"write a test for parse_action\"). Opens the AI pane, types your instruction, and sends it.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "prompt": { "type": "string", "description": "What to ask the editor's coding agent to do." }
                },
                "required": ["prompt"]
            }
        }),
        json!({
            "name": "editor_accept_suggestion",
            "description": "Accept the AI's proposed inline edit in the editor. Use after reviewing a suggestion you want to keep.",
            "input_schema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "editor_reject_suggestion",
            "description": "Dismiss the AI's proposed inline edit without applying it.",
            "input_schema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "editor_save",
            "description": "Save the file currently open in the editor.",
            "input_schema": { "type": "object", "properties": {} }
        }),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_file_lowers_to_quick_open_path_enter() {
        let a = CodingAction::OpenFile {
            path: "src/main.rs".into(),
        };
        assert_eq!(
            a.lower(),
            vec![
                ControlAction::Key("cmd+p".into()),
                ControlAction::Type("src/main.rs".into()),
                ControlAction::Key("enter".into()),
            ]
        );
    }

    #[test]
    fn command_lowers_to_palette_name_enter() {
        let a = CodingAction::Command {
            command: "Format Document".into(),
        };
        assert_eq!(
            a.lower(),
            vec![
                ControlAction::Key("cmd+shift+p".into()),
                ControlAction::Type("Format Document".into()),
                ControlAction::Key("enter".into()),
            ]
        );
    }

    #[test]
    fn steer_agent_lowers_to_chat_prompt_enter() {
        let a = CodingAction::SteerAgent {
            prompt: "add a test".into(),
        };
        assert_eq!(
            a.lower(),
            vec![
                ControlAction::Key("cmd+l".into()),
                ControlAction::Type("add a test".into()),
                ControlAction::Key("enter".into()),
            ]
        );
    }

    #[test]
    fn accept_reject_save_lower_to_single_keys() {
        assert_eq!(
            CodingAction::AcceptSuggestion.lower(),
            vec![ControlAction::Key("cmd+enter".into())]
        );
        assert_eq!(
            CodingAction::RejectSuggestion.lower(),
            vec![ControlAction::Key("esc".into())]
        );
        assert_eq!(
            CodingAction::Save.lower(),
            vec![ControlAction::Key("cmd+s".into())]
        );
    }

    #[test]
    fn parse_covers_every_coding_tool() {
        assert_eq!(
            parse_coding_action("editor_open_file", &json!({ "path": "a.rs" })).unwrap(),
            CodingAction::OpenFile {
                path: "a.rs".into()
            }
        );
        assert_eq!(
            parse_coding_action("editor_command", &json!({ "command": "Run Tests" })).unwrap(),
            CodingAction::Command {
                command: "Run Tests".into()
            }
        );
        assert_eq!(
            parse_coding_action("editor_steer_agent", &json!({ "prompt": "fix it" })).unwrap(),
            CodingAction::SteerAgent {
                prompt: "fix it".into()
            }
        );
        assert_eq!(
            parse_coding_action("editor_accept_suggestion", &json!({})).unwrap(),
            CodingAction::AcceptSuggestion
        );
        assert_eq!(
            parse_coding_action("editor_reject_suggestion", &json!({})).unwrap(),
            CodingAction::RejectSuggestion
        );
        assert_eq!(
            parse_coding_action("editor_save", &json!({})).unwrap(),
            CodingAction::Save
        );
    }

    #[test]
    fn parse_rejects_missing_or_blank_required_fields() {
        assert!(parse_coding_action("editor_open_file", &json!({})).is_err());
        assert!(parse_coding_action("editor_open_file", &json!({ "path": "" })).is_err());
        assert!(parse_coding_action("editor_open_file", &json!({ "path": "   " })).is_err());
        assert!(parse_coding_action("editor_command", &json!({})).is_err());
        assert!(parse_coding_action("editor_steer_agent", &json!({ "prompt": "" })).is_err());
        assert!(parse_coding_action("bogus_tool", &json!({})).is_err());
    }

    #[test]
    fn parse_trims_surrounding_whitespace() {
        assert_eq!(
            parse_coding_action("editor_open_file", &json!({ "path": "  a.rs  " })).unwrap(),
            CodingAction::OpenFile {
                path: "a.rs".into()
            }
        );
    }

    #[test]
    fn describe_is_plain_and_quotes_user_content() {
        assert_eq!(
            CodingAction::OpenFile {
                path: "a.rs".into()
            }
            .describe(),
            "open a.rs in the editor"
        );
        assert!(
            CodingAction::Command {
                command: "Run Tests".into()
            }
            .describe()
            .contains("Run Tests")
        );
        assert!(
            CodingAction::SteerAgent {
                prompt: "fix it".into()
            }
            .describe()
            .contains("fix it")
        );
        assert_eq!(CodingAction::Save.describe(), "save the file");
    }

    #[test]
    fn is_coding_tool_recognises_the_surface_only() {
        for n in [
            "editor_open_file",
            "editor_command",
            "editor_steer_agent",
            "editor_accept_suggestion",
            "editor_reject_suggestion",
            "editor_save",
        ] {
            assert!(is_coding_tool(n), "{n} should be a coding tool");
        }
        for n in ["click", "type", "open_app", "done", "screen_observe"] {
            assert!(!is_coding_tool(n), "{n} is not a coding tool");
        }
    }

    #[test]
    fn coding_tool_specs_are_well_formed_and_complete() {
        let specs = coding_tool_specs();
        assert_eq!(specs.len(), 6);
        for spec in &specs {
            let name = spec["name"].as_str().expect("spec has a name");
            assert!(
                is_coding_tool(name),
                "spec name {name} must be a coding tool"
            );
            assert!(
                spec["description"].as_str().is_some_and(|d| d.len() > 20),
                "{name} needs a real description"
            );
            assert!(
                spec["input_schema"].is_object(),
                "{name} needs an input schema"
            );
        }
    }
}
