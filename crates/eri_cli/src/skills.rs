//! Skills -- load and run `SKILL.md` skills, including Claude Code's.
//!
//! A skill is a `SKILL.md` with YAML frontmatter (`name`, `description`) and a
//! markdown body of instructions. eri discovers them from several roots so it
//! can use skills you already have for Claude Code and other agent CLIs:
//!
//!   project:  ./.eri/skills/<name>/SKILL.md
//!             ./.claude/skills/<name>/SKILL.md   (Claude Code)
//!             ./.agents/skills/<name>/SKILL.md   (eri repo convention)
//!   global:   ~/.claude/skills/<name>/SKILL.md   (Claude Code, global)
//!             ~/.config/eri/skills/<name>/SKILL.md
//!
//! Running a skill (`/skill <name> [task]`) injects its body as authoritative
//! guidance for the turn, so eri follows the skill's directives -- the same
//! "use a skill to do a big thing" model Claude Code has.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// A discovered skill.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Skill {
    pub name: String,
    pub description: String,
    pub body: String,
    /// Where it came from, for listings (e.g. "project:.claude").
    pub source: String,
}

/// Skill roots relative to a workspace, with a short source label.
fn project_roots(workspace: &Path) -> Vec<(PathBuf, &'static str)> {
    vec![
        (workspace.join(".eri").join("skills"), "project:.eri"),
        (workspace.join(".claude").join("skills"), "project:.claude"),
        (workspace.join(".agents").join("skills"), "project:.agents"),
    ]
}

fn global_roots() -> Vec<(PathBuf, &'static str)> {
    let home = match std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")) {
        Ok(h) => PathBuf::from(h),
        Err(_) => return Vec::new(),
    };
    vec![
        (home.join(".claude").join("skills"), "global:.claude"),
        (
            home.join(".config").join("eri").join("skills"),
            "global:eri",
        ),
    ]
}

/// Split YAML-ish frontmatter (`name`, `description`) from the body. Tolerant:
/// a file with no frontmatter is all body.
fn parse(text: &str, fallback_name: &str) -> (String, String, String) {
    let mut name = fallback_name.to_string();
    let mut description = String::new();
    let trimmed = text.trim_start_matches('\u{feff}');
    if let Some(rest) = trimmed.strip_prefix("---") {
        if let Some(end) = rest.find("\n---") {
            let front = &rest[..end];
            let body_start = end + "\n---".len();
            let body = rest[body_start..].trim_start_matches('\n').to_string();
            for line in front.lines() {
                if let Some(v) = line.strip_prefix("name:") {
                    let v = v.trim().trim_matches('"').trim_matches('\'');
                    if !v.is_empty() {
                        name = v.to_string();
                    }
                } else if let Some(v) = line.strip_prefix("description:") {
                    description = v.trim().trim_matches('"').trim_matches('\'').to_string();
                }
            }
            return (name, description, body);
        }
    }
    (name, description, text.trim().to_string())
}

fn load_root(dir: &Path, source: &str, out: &mut BTreeMap<String, Skill>) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in rd.filter_map(std::result::Result::ok) {
        let path = entry.path();
        // Each skill is a subdir containing SKILL.md, or a flat <name>.md.
        let (file, dir_name): (PathBuf, String) = if path.is_dir() {
            (
                path.join("SKILL.md"),
                path.file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default(),
            )
        } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
            let stem = path
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            // Skip common doc files that aren't skills.
            const NON_SKILL: &[&str] = &[
                "readme",
                "changelog",
                "catalog",
                "license",
                "contributing",
                "index",
            ];
            if NON_SKILL.contains(&stem.to_lowercase().as_str()) {
                continue;
            }
            (path.clone(), stem)
        } else {
            continue;
        };
        let Ok(text) = std::fs::read_to_string(&file) else {
            continue;
        };
        if text.trim().is_empty() {
            continue;
        }
        let (name, description, body) = parse(&text, &dir_name);
        let key = name.trim().to_lowercase();
        if key.is_empty() || body.trim().is_empty() {
            continue;
        }
        // First writer wins -> project roots (loaded first) override global.
        out.entry(key).or_insert(Skill {
            name,
            description,
            body,
            source: source.to_string(),
        });
    }
}

/// Discover all skills for `workspace`, project roots before global so project
/// skills win on name collision.
pub fn discover(workspace: &Path) -> Vec<Skill> {
    let mut map: BTreeMap<String, Skill> = BTreeMap::new();
    for (dir, src) in project_roots(workspace) {
        load_root(&dir, src, &mut map);
    }
    for (dir, src) in global_roots() {
        load_root(&dir, src, &mut map);
    }
    map.into_values().collect()
}

/// Print a skills listing (shared by `/skills` and `eri skills`).
pub fn print_list(skills: &[Skill]) {
    if skills.is_empty() {
        println!(
            "[eri] no skills found. Add SKILL.md under .eri/skills/<name>/, \
.claude/skills/<name>/, or ~/.claude/skills/<name>/."
        );
        return;
    }
    println!("available skills:");
    for s in skills {
        let mut desc = s.description.clone();
        if desc.chars().count() > 60 {
            desc = desc.chars().take(59).collect::<String>() + "…";
        }
        println!("  {:<24} {:<16} {}", s.name, s.source, desc);
    }
    println!("run one with: /skill <name> [task]   (in `eri chat`)");
}

/// Find one skill by name (case-insensitive).
pub fn find(workspace: &Path, name: &str) -> Option<Skill> {
    let target = name.trim().to_lowercase();
    discover(workspace)
        .into_iter()
        .find(|s| s.name.to_lowercase() == target)
}

/// Compose the prompt for running `skill` against `task`. The skill body is
/// fenced as authoritative guidance the agent must follow.
pub fn compose_prompt(skill: &Skill, task: &str) -> String {
    let task = task.trim();
    let task_line = if task.is_empty() {
        "Apply this skill to the current project.".to_string()
    } else {
        task.to_string()
    };
    format!(
        "You have been given a SKILL to apply. Follow its guidance precisely.\n\n\
# Skill: {}\n{}\n\n# Task\n{task_line}",
        skill.name, skill.body
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn parses_frontmatter_and_body() {
        let text =
            "---\nname: design-taste\ndescription: anti-slop UI\n---\nUse Geist. Avoid neon.";
        let (name, desc, body) = parse(text, "fallback");
        assert_eq!(name, "design-taste");
        assert_eq!(desc, "anti-slop UI");
        assert_eq!(body, "Use Geist. Avoid neon.");
    }

    #[test]
    fn no_frontmatter_is_all_body() {
        let (name, desc, body) = parse("just instructions", "myskill");
        assert_eq!(name, "myskill");
        assert!(desc.is_empty());
        assert_eq!(body, "just instructions");
    }

    #[test]
    fn discover_finds_claude_and_eri_skills() {
        // Isolate HOME so the dev machine's global skills don't leak in.
        let _g = crate::config::ENV_TEST_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let home = TempDir::new().unwrap();
        let prev = std::env::var("HOME").ok();
        unsafe {
            std::env::set_var("HOME", home.path());
        }

        let ws = TempDir::new().unwrap();
        // A Claude Code-style skill dir.
        let cdir = ws.path().join(".claude").join("skills").join("review");
        std::fs::create_dir_all(&cdir).unwrap();
        std::fs::write(
            cdir.join("SKILL.md"),
            "---\nname: review\ndescription: careful review\n---\nReview the diff.",
        )
        .unwrap();
        // A flat eri skill.
        let edir = ws.path().join(".eri").join("skills");
        std::fs::create_dir_all(&edir).unwrap();
        std::fs::write(edir.join("ship.md"), "Ship it carefully.").unwrap();

        let skills = discover(ws.path());
        let review = find(ws.path(), "REVIEW");

        unsafe {
            match prev.as_deref() {
                Some(v) => std::env::set_var("HOME", v),
                None => std::env::remove_var("HOME"),
            }
        }

        assert_eq!(skills.len(), 2);
        let review = review.unwrap();
        assert_eq!(review.description, "careful review");
        let prompt = compose_prompt(&review, "look at auth.rs");
        assert!(prompt.contains("# Skill: review"));
        assert!(prompt.contains("Review the diff."));
        assert!(prompt.contains("look at auth.rs"));
    }
}
