//! Plugins -- the fourth extensibility mechanism (after skills, MCP, and hooks).
//!
//! A plugin is a directory that bundles several extension kinds under one name,
//! so a team can ship "the eri-acme pack" as one folder instead of scattering
//! files. Layout (every part optional):
//!
//! ```text
//! .eri/plugins/<name>/
//!   commands/<cmd>.md        -> custom slash commands (commands.rs)
//!   skills/<skill>/SKILL.md  -> skills (skills.rs)
//!   hooks.json               -> lifecycle hooks (eri_hooks)
//!   mcp.json                 -> MCP servers (eri_mcp)
//!   plugin.toml              -> optional metadata (description)
//! ```
//!
//! Plugins live under `<workspace>/.eri/plugins/` (project) and
//! `~/.config/eri/plugins/` (global). All four kinds are active:
//!   - commands + skills: this module exposes the per-kind directories so the
//!     `commands` / `skills` loaders fold plugin entries into their search.
//!   - hooks + mcp: the owning crates (`eri_hooks`, `eri_mcp`) scan
//!     `.eri/plugins/<name>/{hooks.json,mcp.json}` directly when they load, so
//!     plugin-bundled hooks and MCP servers are picked up by the loop too.
//! In every case a project-level file wins over a plugin's on a name collision.

use std::path::{Path, PathBuf};

/// One discovered plugin.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Plugin {
    pub name: String,
    pub dir: PathBuf,
    /// "project" or "global".
    pub scope: &'static str,
    pub description: Option<String>,
    pub has_commands: bool,
    pub has_skills: bool,
    pub has_hooks: bool,
    pub has_mcp: bool,
}

impl Plugin {
    /// The plugin's `commands/` dir, if it has one.
    pub fn commands_dir(&self) -> Option<PathBuf> {
        self.has_commands.then(|| self.dir.join("commands"))
    }
    /// The plugin's `skills/` dir, if it has one.
    pub fn skills_dir(&self) -> Option<PathBuf> {
        self.has_skills.then(|| self.dir.join("skills"))
    }

    /// Short one-line capability summary for listings.
    fn parts(&self) -> String {
        let mut p = Vec::new();
        if self.has_commands {
            p.push("commands");
        }
        if self.has_skills {
            p.push("skills");
        }
        if self.has_hooks {
            p.push("hooks");
        }
        if self.has_mcp {
            p.push("mcp");
        }
        if p.is_empty() {
            "(empty)".to_string()
        } else {
            p.join(", ")
        }
    }
}

fn project_plugins_dir(workspace: &Path) -> PathBuf {
    workspace.join(".eri").join("plugins")
}

fn global_plugins_dir() -> Option<PathBuf> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()?;
    Some(
        PathBuf::from(home)
            .join(".config")
            .join("eri")
            .join("plugins"),
    )
}

/// Read an optional `description = "..."` from a plugin's `plugin.toml`.
fn read_description(dir: &Path) -> Option<String> {
    let body = std::fs::read_to_string(dir.join("plugin.toml")).ok()?;
    for raw in body.lines() {
        let line = raw.split('#').next().unwrap_or("").trim();
        // Require `description` then `=` (allowing whitespace between), so a key
        // like `description_x` doesn't false-match.
        if let Some(rest) = line.strip_prefix("description")
            && let Some(val) = rest.trim_start().strip_prefix('=')
        {
            let val = val.trim().trim_matches('"').trim_matches('\'').trim();
            if !val.is_empty() {
                return Some(val.to_string());
            }
        }
    }
    None
}

fn load_from(dir: &Path, scope: &'static str, out: &mut Vec<Plugin>) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in rd.filter_map(std::result::Result::ok) {
        let pdir = entry.path();
        if !pdir.is_dir() {
            continue;
        }
        let Some(name) = pdir.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if name.starts_with('.') {
            continue;
        }
        // Skip a plugin name already seen at a higher-priority scope.
        if out.iter().any(|p| p.name == name) {
            continue;
        }
        out.push(Plugin {
            name: name.to_string(),
            scope,
            description: read_description(&pdir),
            has_commands: pdir.join("commands").is_dir(),
            has_skills: pdir.join("skills").is_dir(),
            has_hooks: pdir.join("hooks.json").is_file(),
            has_mcp: pdir.join("mcp.json").is_file(),
            dir: pdir,
        });
    }
}

/// Discover all plugins, project scope before global so a project plugin shadows
/// a global one of the same name. Sorted by name for stable listings.
pub fn discover(workspace: &Path) -> Vec<Plugin> {
    let mut out = Vec::new();
    load_from(&project_plugins_dir(workspace), "project", &mut out);
    if let Some(g) = global_plugins_dir() {
        load_from(&g, "global", &mut out);
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// Every plugin-provided `commands/` directory, for `commands::discover` to fold
/// into its search (project-shadow order preserved).
pub fn command_dirs(workspace: &Path) -> Vec<PathBuf> {
    discover(workspace)
        .iter()
        .filter_map(Plugin::commands_dir)
        .collect()
}

/// Every plugin-provided `skills/` directory, for `skills::discover`.
pub fn skill_dirs(workspace: &Path) -> Vec<PathBuf> {
    discover(workspace)
        .iter()
        .filter_map(Plugin::skills_dir)
        .collect()
}

/// Print a plugin listing for `eri plugin list`.
pub fn print_list(plugins: &[Plugin]) {
    if plugins.is_empty() {
        println!(
            "[eri] no plugins. Add one under .eri/plugins/<name>/ (commands/, \
skills/, hooks.json, mcp.json) or ~/.config/eri/plugins/<name>/."
        );
        return;
    }
    println!("plugins:");
    for p in plugins {
        let desc = p
            .description
            .as_deref()
            .map(|d| format!(" -- {d}"))
            .unwrap_or_default();
        println!("  {} [{}] ({}){desc}", p.name, p.scope, p.parts());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn write(path: &Path, body: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, body).unwrap();
    }

    #[test]
    fn discovers_plugin_parts_and_dirs() {
        let ws = TempDir::new().unwrap();
        let base = ws.path().join(".eri/plugins/acme");
        write(&base.join("commands/deploy.md"), "Deploy $ARGUMENTS");
        write(
            &base.join("skills/lint/SKILL.md"),
            "---\nname: lint\n---\nlint it",
        );
        write(&base.join("hooks.json"), "{}");
        write(&base.join("plugin.toml"), "description = \"Acme pack\"\n");

        let found = discover(ws.path());
        assert_eq!(found.len(), 1);
        let p = &found[0];
        assert_eq!(p.name, "acme");
        assert_eq!(p.scope, "project");
        assert_eq!(p.description.as_deref(), Some("Acme pack"));
        assert!(p.has_commands && p.has_skills && p.has_hooks);
        assert!(!p.has_mcp);
        assert_eq!(p.parts(), "commands, skills, hooks");

        // The per-kind dir helpers point at the right subdirs.
        assert_eq!(command_dirs(ws.path()), vec![base.join("commands")]);
        assert_eq!(skill_dirs(ws.path()), vec![base.join("skills")]);
    }

    #[test]
    fn empty_when_no_plugins_dir() {
        let ws = TempDir::new().unwrap();
        assert!(discover(ws.path()).is_empty());
        assert!(command_dirs(ws.path()).is_empty());
    }

    #[test]
    fn ignores_files_and_dotdirs() {
        let ws = TempDir::new().unwrap();
        let plugins = ws.path().join(".eri/plugins");
        fs::create_dir_all(&plugins).unwrap();
        fs::write(plugins.join("not-a-plugin.txt"), "x").unwrap();
        fs::create_dir_all(plugins.join(".hidden")).unwrap();
        assert!(discover(ws.path()).is_empty());
    }
}
