//! Custom slash commands -- the Claude Code `.claude/commands/*.md` parity.
//!
//! A markdown file at `.eri/commands/<name>.md` (project) or
//! `~/.config/eri/commands/<name>.md` (global) defines a `/<name>` command: its
//! body becomes the prompt sent to the agent. `$ARGUMENTS` in the body is
//! replaced with whatever the user typed after the command; if there's no
//! `$ARGUMENTS` placeholder and the user passed args, they're appended.
//!
//! Project commands win over global commands of the same name.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// A discovered custom command.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CustomCommand {
    pub name: String,
    pub body: String,
    /// "project" or "global" -- shown in `/help`.
    pub scope: &'static str,
}

const ARGS_PLACEHOLDER: &str = "$ARGUMENTS";

/// Project command dir for a workspace: `<workspace>/.eri/commands`.
fn project_dir(workspace: &Path) -> PathBuf {
    workspace.join(".eri").join("commands")
}

/// Global command dir: `~/.config/eri/commands`.
fn global_dir() -> Option<PathBuf> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()?;
    Some(
        PathBuf::from(home)
            .join(".config")
            .join("eri")
            .join("commands"),
    )
}

fn load_dir(dir: &Path, scope: &'static str, out: &mut BTreeMap<String, CustomCommand>) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in rd.filter_map(std::result::Result::ok) {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let name = stem.trim().to_lowercase();
        if name.is_empty() {
            continue;
        }
        let Ok(body) = std::fs::read_to_string(&path) else {
            continue;
        };
        if body.trim().is_empty() {
            continue;
        }
        out.insert(name.clone(), CustomCommand { name, body, scope });
    }
}

/// Discover all custom commands for `workspace`. Precedence (later overrides
/// earlier on a name collision): global, then plugins, then project -- so a
/// project command always wins, and project plugins shadow global ones (handled
/// by `plugins::command_dirs` ordering).
pub fn discover(workspace: &Path) -> Vec<CustomCommand> {
    let mut map: BTreeMap<String, CustomCommand> = BTreeMap::new();
    if let Some(g) = global_dir() {
        load_dir(&g, "global", &mut map);
    }
    for dir in crate::plugins::command_dirs(workspace) {
        load_dir(&dir, "plugin", &mut map);
    }
    load_dir(&project_dir(workspace), "project", &mut map);
    map.into_values().collect()
}

/// Look up one command by name (case-insensitive).
pub fn find(workspace: &Path, name: &str) -> Option<CustomCommand> {
    let target = name.trim().to_lowercase();
    discover(workspace).into_iter().find(|c| c.name == target)
}

/// Expand a command body with the user's arguments. Replaces every
/// `$ARGUMENTS`; if the body has no placeholder and args are non-empty, the
/// args are appended on a new line.
pub fn expand(body: &str, args: &str) -> String {
    let args = args.trim();
    if body.contains(ARGS_PLACEHOLDER) {
        return body.replace(ARGS_PLACEHOLDER, args);
    }
    if args.is_empty() {
        body.trim_end().to_string()
    } else {
        format!("{}\n\n{args}", body.trim_end())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn expand_substitutes_arguments() {
        assert_eq!(
            expand("Review $ARGUMENTS for bugs.", "src/main.rs"),
            "Review src/main.rs for bugs."
        );
    }

    #[test]
    fn expand_appends_when_no_placeholder() {
        assert_eq!(
            expand("Summarize the diff.", "HEAD~1"),
            "Summarize the diff.\n\nHEAD~1"
        );
        assert_eq!(expand("Summarize the diff.", ""), "Summarize the diff.");
    }

    #[test]
    fn discover_reads_project_md_and_overrides_global() {
        let ws = TempDir::new().unwrap();
        let dir = ws.path().join(".eri").join("commands");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("review.md"), "Review $ARGUMENTS").unwrap();
        std::fs::write(dir.join("empty.md"), "   ").unwrap();
        std::fs::write(dir.join("notes.txt"), "ignored").unwrap();

        let found = discover(ws.path());
        // empty.md skipped, notes.txt skipped -> only review.
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "review");
        assert_eq!(found[0].scope, "project");

        let one = find(ws.path(), "REVIEW").unwrap();
        assert_eq!(expand(&one.body, "x.rs"), "Review x.rs");
        assert!(find(ws.path(), "missing").is_none());
    }

    #[test]
    fn discover_includes_plugin_commands_with_project_override() {
        let ws = TempDir::new().unwrap();
        let pcmd = ws.path().join(".eri/plugins/acme/commands");
        std::fs::create_dir_all(&pcmd).unwrap();
        std::fs::write(pcmd.join("deploy.md"), "PLUGIN deploy").unwrap();
        std::fs::write(pcmd.join("rollback.md"), "Roll back").unwrap();
        // A project command of the same name must override the plugin's.
        let proj = ws.path().join(".eri/commands");
        std::fs::create_dir_all(&proj).unwrap();
        std::fs::write(proj.join("deploy.md"), "PROJECT deploy").unwrap();

        let deploy = find(ws.path(), "deploy").unwrap();
        assert_eq!(deploy.scope, "project", "project overrides plugin");
        assert!(deploy.body.contains("PROJECT"));
        // A plugin-only command is discoverable, tagged "plugin".
        let rb = find(ws.path(), "rollback").unwrap();
        assert_eq!(rb.scope, "plugin");
    }
}
