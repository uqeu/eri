//! `eri agent list` and `eri agent set <name>` — persona switcher
//! mirroring the IDE's `/agent` slash command.

use std::fs;
use std::path::PathBuf;

use anyhow::Result;

pub struct BuiltinPersona {
    pub name: &'static str,
    pub description: &'static str,
    pub focus: &'static str,
}

pub const BUILTIN_PERSONAS: &[BuiltinPersona] = &[
    BuiltinPersona {
        name: "eri",
        description: "default balanced agent",
        focus: "general coding, product thinking, and repo navigation",
    },
    BuiltinPersona {
        name: "builder",
        description: "first working versions",
        focus: "turn an idea into a runnable app or artifact",
    },
    BuiltinPersona {
        name: "coder",
        description: "focused implementation",
        focus: "write and edit code with tight scope",
    },
    BuiltinPersona {
        name: "architect",
        description: "plans and system design",
        focus: "break down systems, risks, APIs, and rollout plans",
    },
    BuiltinPersona {
        name: "debugger",
        description: "failure diagnosis",
        focus: "trace errors, isolate causes, and propose fixes",
    },
    BuiltinPersona {
        name: "tester",
        description: "tests and verification",
        focus: "write tests, run checks, and guard regressions",
    },
    BuiltinPersona {
        name: "reviewer",
        description: "risk review",
        focus: "inspect diffs, security risks, and missing coverage",
    },
    BuiltinPersona {
        name: "browser",
        description: "preview and UI inspection",
        focus: "check pages, screenshots, responsive states, and flows",
    },
    BuiltinPersona {
        name: "shipper",
        description: "release and deploy",
        focus: "prepare branches, commits, PRs, deploys, and summaries",
    },
];

pub fn list() -> Result<()> {
    println!("Built-in personas:");
    for persona in BUILTIN_PERSONAS {
        println!(
            "  {:<10} - {:<24} {}",
            persona.name, persona.description, persona.focus
        );
    }
    println!();
    println!("User personas live at <workspace>/.eri/agents/*.md.");
    let cwd = std::env::current_dir()?;
    let user_dir = cwd.join(".eri").join("agents");
    if user_dir.exists() {
        let entries = fs::read_dir(&user_dir)?;
        let mut found = false;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().is_some_and(|e| e == "md") {
                let name = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("(unnamed)");
                if !found {
                    println!();
                    println!("Workspace personas:");
                    found = true;
                }
                println!("  {name}");
            }
        }
    }
    let active = read_active()?;
    println!();
    println!("Active: {}", display_persona(&active));
    Ok(())
}

pub fn set(name: &str) -> Result<()> {
    let name = name.trim();
    if name.is_empty() {
        anyhow::bail!("agent set needs a persona name");
    }
    let cwd = std::env::current_dir()?;
    let path = cwd.join(".eri").join("persona");
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&path, format!("{name}\n"))?;
    println!("Active persona: {name}");
    Ok(())
}

fn read_active() -> Result<String> {
    let cwd = std::env::current_dir()?;
    let path: PathBuf = cwd.join(".eri").join("persona");
    match fs::read_to_string(&path) {
        Ok(s) => Ok(s.trim().to_string()),
        Err(_) => Ok("eri".to_string()),
    }
}

fn display_persona(name: &str) -> &str {
    if name == "mercury" { "builder" } else { name }
}

pub fn active_persona() -> Result<String> {
    Ok(display_persona(&read_active()?).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_personas_cover_agentic_roles() {
        let names: std::collections::HashSet<&str> =
            BUILTIN_PERSONAS.iter().map(|p| p.name).collect();
        for needed in [
            "eri",
            "builder",
            "coder",
            "architect",
            "debugger",
            "tester",
            "reviewer",
            "browser",
            "shipper",
        ] {
            assert!(names.contains(needed), "missing persona {needed}");
        }
    }
}
