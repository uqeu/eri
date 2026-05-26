//! `eri agent list` and `eri agent set <name>` — persona switcher
//! mirroring the IDE's `/agent` slash command.

use std::fs;
use std::path::PathBuf;

use anyhow::Result;

pub fn list() -> Result<()> {
    println!("Built-in personas:");
    println!("  eri        — default, balanced");
    println!("  coder      — focused on writing code");
    println!("  architect  — high-level plans, system design");
    println!("  debugger   — diagnose failures");
    println!("  tester     — write + run tests");
    println!("  shipper    — ship + deploy");
    println!("  mercury    — pin Mercury for one-shot HTML drafts");
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
    println!("Active: {active}");
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
