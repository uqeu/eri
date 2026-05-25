//! Persona layer — the agent identity wrapper sitting above the model
//! registry.
//!
//! A persona is a `{ name, system_prompt, default_model_hint }` bundle.
//! The user picks a persona via `/agent <name>` (Phase 7b) or the persona
//! picker pill; the dispatch layer reads it on every call and prepends
//! `system_prompt` as the highest-priority `system:persona` part on the
//! prompt. The actual model choice still flows through the brain router,
//! but `default_model_hint` lets the persona nudge it (e.g. Mercury-only
//! persona forces diffusion regardless of intent).
//!
//! Three sources, layered:
//!   1. Built-in personas defined in this module (`Persona::builtins()`).
//!   2. User-defined personas in `<workspace>/.eri/agents/<name>.md`
//!      (YAML frontmatter + markdown body), loaded by [`load_dir`].
//!   3. Active persona name persisted in `<workspace>/.eri/persona`
//!      (single-line plaintext). Defaults to `"eri"`.

use std::fs;
use std::path::Path;

/// Hint passed through to the brain router. The router can ignore this
/// when the intent strongly disagrees (e.g. `Debug` always wants frontier)
/// but most personas leave the choice alone.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelHint {
    /// Use whatever the brain picks (the default).
    Auto,
    /// Force Mercury / diffusion engine. Mercury-only persona.
    MercuryOnly,
    /// Prefer a frontier model (Sonnet / GPT / Gemini).
    PreferFrontier,
}

#[derive(Debug, Clone)]
pub struct Persona {
    pub name: String,
    pub system_prompt: String,
    pub default_model_hint: ModelHint,
    /// Display label; defaults to `name` when None.
    pub label: Option<String>,
}

impl Persona {
    pub fn label(&self) -> &str {
        self.label.as_deref().unwrap_or(&self.name)
    }
}

mod coder;
mod architect;
mod debugger;
mod tester;
mod shipper;
mod mercury_only;
mod eri_default;

pub use architect::architect;
pub use coder::coder;
pub use debugger::debugger;
pub use eri_default::eri_default;
pub use mercury_only::mercury_only;
pub use shipper::shipper;
pub use tester::tester;

/// All built-in personas, in display order.
pub fn builtins() -> Vec<Persona> {
    vec![
        eri_default(),
        coder(),
        architect(),
        debugger(),
        tester(),
        shipper(),
        mercury_only(),
    ]
}

/// Resolve the currently-active persona name from `<workspace>/.eri/persona`.
/// Returns `"eri"` when the file is missing or unreadable.
pub fn read_active(workspace: &Path) -> String {
    let path = workspace.join(".eri").join("persona");
    fs::read_to_string(&path)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "eri".to_string())
}

/// Write the active persona name to `<workspace>/.eri/persona`. Creates
/// the parent directory if needed. Best-effort: errors propagate so the
/// caller can surface them in the UI.
pub fn write_active(workspace: &Path, name: &str) -> std::io::Result<()> {
    let dir = workspace.join(".eri");
    fs::create_dir_all(&dir)?;
    fs::write(dir.join("persona"), name.trim())
}

/// Resolve a persona by name. Searches user-defined personas (`.eri/agents/`)
/// first so a user can override a built-in by creating a file with the same
/// name. Falls back to built-ins. Returns the default `"eri"` persona when
/// no match is found.
pub fn resolve(workspace: &Path, name: &str) -> Persona {
    if let Some(user) = load_user_persona(workspace, name) {
        return user;
    }
    for p in builtins() {
        if p.name == name {
            return p;
        }
    }
    eri_default()
}

/// Load `<workspace>/.eri/agents/<name>.md` and parse YAML frontmatter +
/// markdown body. Format:
///
/// ```text
/// ---
/// name: my-persona
/// label: My Persona
/// model: auto | mercury | frontier
/// ---
/// You are…  (the system prompt body)
/// ```
fn load_user_persona(workspace: &Path, name: &str) -> Option<Persona> {
    let path = workspace
        .join(".eri")
        .join("agents")
        .join(format!("{name}.md"));
    let raw = fs::read_to_string(&path).ok()?;
    parse_persona_md(name, &raw)
}

/// Discover all user-defined personas in `<workspace>/.eri/agents/*.md`.
/// Used by the persona picker UI to surface custom personas alongside built-ins.
pub fn load_dir(workspace: &Path) -> Vec<Persona> {
    let dir = workspace.join(".eri").join("agents");
    let Ok(read) = fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in read.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let Ok(raw) = fs::read_to_string(&path) else {
            continue;
        };
        if let Some(persona) = parse_persona_md(stem, &raw) {
            out.push(persona);
        }
    }
    out
}

fn parse_persona_md(default_name: &str, raw: &str) -> Option<Persona> {
    let trimmed = raw.trim_start();
    let mut name = default_name.to_string();
    let mut label: Option<String> = None;
    let mut hint = ModelHint::Auto;

    let body = if let Some(rest) = trimmed.strip_prefix("---") {
        // Find the closing fence.
        let after_fence = rest.trim_start_matches('\n');
        if let Some(end_idx) = after_fence.find("\n---") {
            let frontmatter = &after_fence[..end_idx];
            let body_start = end_idx + "\n---".len();
            let body_rest = &after_fence[body_start..];
            let body_rest = body_rest.trim_start_matches('\n');
            for line in frontmatter.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }
                let Some((key, value)) = line.split_once(':') else {
                    continue;
                };
                let value = value.trim().trim_matches('"').trim_matches('\'');
                match key.trim() {
                    "name" if !value.is_empty() => name = value.to_string(),
                    "label" if !value.is_empty() => label = Some(value.to_string()),
                    "model" => match value {
                        "mercury" => hint = ModelHint::MercuryOnly,
                        "frontier" => hint = ModelHint::PreferFrontier,
                        "auto" | "" => hint = ModelHint::Auto,
                        _ => {}
                    },
                    _ => {}
                }
            }
            body_rest.to_string()
        } else {
            raw.to_string()
        }
    } else {
        raw.to_string()
    };

    let body = body.trim();
    if body.is_empty() {
        return None;
    }

    Some(Persona {
        name,
        label,
        system_prompt: body.to_string(),
        default_model_hint: hint,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn read_active_defaults_to_eri() {
        let tmp = TempDir::new().unwrap();
        assert_eq!(read_active(tmp.path()), "eri");
    }

    #[test]
    fn write_then_read_round_trips() {
        let tmp = TempDir::new().unwrap();
        write_active(tmp.path(), "architect").unwrap();
        assert_eq!(read_active(tmp.path()), "architect");
    }

    #[test]
    fn parses_persona_with_frontmatter() {
        let raw = "---\nname: pirate\nlabel: Capt. Eri\nmodel: mercury\n---\nYou speak in nautical metaphors.";
        let persona = parse_persona_md("default", raw).expect("parse");
        assert_eq!(persona.name, "pirate");
        assert_eq!(persona.label.as_deref(), Some("Capt. Eri"));
        assert_eq!(persona.default_model_hint, ModelHint::MercuryOnly);
        assert!(persona.system_prompt.contains("nautical"));
    }

    #[test]
    fn parses_persona_without_frontmatter() {
        let persona = parse_persona_md("plain", "Just be helpful.").expect("parse");
        assert_eq!(persona.name, "plain");
        assert_eq!(persona.default_model_hint, ModelHint::Auto);
        assert_eq!(persona.system_prompt, "Just be helpful.");
    }

    #[test]
    fn resolve_finds_builtin() {
        let tmp = TempDir::new().unwrap();
        let p = resolve(tmp.path(), "architect");
        assert_eq!(p.name, "architect");
    }

    #[test]
    fn resolve_falls_back_to_default() {
        let tmp = TempDir::new().unwrap();
        let p = resolve(tmp.path(), "nonexistent");
        assert_eq!(p.name, "eri");
    }
}
