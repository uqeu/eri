//! Dynamic workflows -- declarative multi-step pipelines (Claude Code's
//! Workflow, eri-flavored). A workflow is a named sequence of steps; each step
//! is a prompt run as one agentic pass in the shared workspace, and a later
//! step can reference an earlier step's result with `{{stepname}}`.
//!
//! Layout: `<workspace>/.eri/workflows/<name>.json` (or `~/.config/eri/...`):
//!
//! ```json
//! {
//!   "description": "research then build",
//!   "steps": [
//!     { "name": "research", "prompt": "Investigate how auth works; summarize." },
//!     { "name": "build", "prompt": "Using these notes:\n{{research}}\n\nimplement X." }
//!   ]
//! }
//! ```
//!
//! Steps run sequentially (files persist across steps); each step's final text
//! becomes available to later steps. The parse / substitute / discovery logic is
//! pure + unit-tested here; the actual per-step agent run lives in `run`.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct Step {
    pub name: String,
    pub prompt: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct WorkflowSpec {
    #[serde(default)]
    pub description: Option<String>,
    pub steps: Vec<Step>,
}

/// Parse + validate a workflow JSON. Rejects empty / duplicate / empty-named
/// steps so a malformed file fails loudly rather than half-running.
pub fn parse(json: &str) -> Result<WorkflowSpec> {
    let spec: WorkflowSpec = serde_json::from_str(json).context("parse workflow JSON")?;
    if spec.steps.is_empty() {
        bail!("workflow has no steps");
    }
    let mut seen = std::collections::HashSet::new();
    for step in &spec.steps {
        let name = step.name.trim();
        if name.is_empty() {
            bail!("workflow step has an empty name");
        }
        if step.prompt.trim().is_empty() {
            bail!("workflow step '{name}' has an empty prompt");
        }
        if !seen.insert(name.to_string()) {
            bail!("workflow has a duplicate step name '{name}'");
        }
    }
    Ok(spec)
}

/// Replace every `{{name}}` in `prompt` with the matching prior step output.
/// Unknown placeholders are left untouched (so literal braces survive).
pub fn substitute(prompt: &str, outputs: &HashMap<String, String>) -> String {
    let mut out = prompt.to_string();
    for (name, value) in outputs {
        out = out.replace(&format!("{{{{{name}}}}}"), value);
    }
    out
}

fn project_dir(workspace: &Path) -> PathBuf {
    workspace.join(".eri").join("workflows")
}

fn global_dir() -> Option<PathBuf> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()?;
    Some(
        PathBuf::from(home)
            .join(".config")
            .join("eri")
            .join("workflows"),
    )
}

/// Names of available workflows (project shadows global), sorted.
pub fn discover(workspace: &Path) -> Vec<String> {
    let mut names = std::collections::BTreeSet::new();
    for dir in [Some(project_dir(workspace)), global_dir()]
        .into_iter()
        .flatten()
    {
        if let Ok(rd) = std::fs::read_dir(&dir) {
            for entry in rd.filter_map(std::result::Result::ok) {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) == Some("json")
                    && let Some(stem) = path.file_stem().and_then(|s| s.to_str())
                {
                    names.insert(stem.to_string());
                }
            }
        }
    }
    names.into_iter().collect()
}

/// Locate + parse a workflow by name (project dir first, then global).
pub fn load(workspace: &Path, name: &str) -> Result<WorkflowSpec> {
    let candidates = [
        Some(project_dir(workspace).join(format!("{name}.json"))),
        global_dir().map(|d| d.join(format!("{name}.json"))),
    ];
    for path in candidates.into_iter().flatten() {
        if path.is_file() {
            let body = std::fs::read_to_string(&path)
                .with_context(|| format!("read {}", path.display()))?;
            return parse(&body);
        }
    }
    bail!("no workflow '{name}' -- looked under .eri/workflows/ and ~/.config/eri/workflows/")
}

/// Print available workflows for `eri workflow list`.
pub fn print_list(workspace: &Path) {
    let names = discover(workspace);
    if names.is_empty() {
        println!(
            "[eri] no workflows. Add one at .eri/workflows/<name>.json (steps of name+prompt; \
later steps can use {{{{earlier_step}}}})."
        );
        return;
    }
    println!("workflows:");
    for n in names {
        match load(workspace, &n) {
            Ok(spec) => {
                let desc = spec.description.as_deref().unwrap_or("");
                println!("  {n}  ({} steps) {desc}", spec.steps.len());
            }
            Err(_) => println!("  {n}  (unreadable)"),
        }
    }
}

/// Run a workflow: each step is one agentic pass in `workspace`, sequentially,
/// with `{{prior}}` substitution. Step outputs are the agent's final text.
pub async fn run(workspace: &Path, name: &str, model: &str) -> Result<()> {
    let spec = load(workspace, name)?;
    println!(
        "[eri] running workflow '{name}' ({} steps) in {}",
        spec.steps.len(),
        workspace.display()
    );
    let mut outputs: HashMap<String, String> = HashMap::new();
    for (i, step) in spec.steps.iter().enumerate() {
        let prompt = substitute(&step.prompt, &outputs);
        println!("\n[eri] step {}/{}: {}", i + 1, spec.steps.len(), step.name);
        let outcome = crate::build_agent::run_build_agent(&prompt, workspace, model).await?;
        if let Some(halt) = &outcome.halted {
            println!("[eri] workflow halted at step '{}': {halt}", step.name);
            return Ok(());
        }
        outputs.insert(step.name.trim().to_string(), outcome.final_text);
    }
    println!(
        "\n[eri] workflow '{name}' complete ({} steps).",
        spec.steps.len()
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn parse_accepts_valid_and_rejects_malformed() {
        let ok = parse(
            r#"{ "steps": [ {"name":"a","prompt":"do a"}, {"name":"b","prompt":"use {{a}}"} ] }"#,
        )
        .unwrap();
        assert_eq!(ok.steps.len(), 2);
        assert_eq!(ok.steps[1].name, "b");

        assert!(parse(r#"{ "steps": [] }"#).is_err(), "no steps");
        assert!(
            parse(r#"{ "steps": [ {"name":"","prompt":"x"} ] }"#).is_err(),
            "empty name"
        );
        assert!(
            parse(r#"{ "steps": [ {"name":"a","prompt":"  "} ] }"#).is_err(),
            "empty prompt"
        );
        assert!(
            parse(r#"{ "steps": [ {"name":"a","prompt":"x"}, {"name":"a","prompt":"y"} ] }"#)
                .is_err(),
            "duplicate name"
        );
    }

    #[test]
    fn substitute_replaces_known_and_keeps_unknown() {
        let mut outputs = HashMap::new();
        outputs.insert("research".to_string(), "FINDINGS".to_string());
        let r = substitute("Build with {{research}} and {{missing}}", &outputs);
        assert_eq!(r, "Build with FINDINGS and {{missing}}");
    }

    #[test]
    fn discover_and_load_from_project_dir() {
        let ws = TempDir::new().unwrap();
        let dir = ws.path().join(".eri/workflows");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("ship.json"),
            r#"{ "description":"d", "steps":[{"name":"a","prompt":"p"}] }"#,
        )
        .unwrap();
        std::fs::write(dir.join("notes.txt"), "ignored").unwrap();

        assert_eq!(discover(ws.path()), vec!["ship".to_string()]);
        let spec = load(ws.path(), "ship").unwrap();
        assert_eq!(spec.description.as_deref(), Some("d"));
        assert!(load(ws.path(), "missing").is_err());
    }
}
