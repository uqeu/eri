//! `eri memory recall` / `eri memory remember` / `eri memory forget`.
//!
//! Local-first: reads and writes the SAME on-device `MemoryStore` the agentic
//! loop uses (`~/.eri/users/<user>/memory.json`), scoped per signed-in user.
//! No network call — your memory never leaves the machine. (The cloud `/sync`
//! endpoint is a separate, opt-in mirror; recall/remember/forget are local.)

use anyhow::{Context, Result};
use eri_inference::memory::MemoryStore;

use crate::config;

/// Open the per-user local store. Falls back to the anonymous store when not
/// signed in, so memory works offline / pre-auth.
fn open_store() -> Result<MemoryStore> {
    let user_id = config::load().ok().and_then(|c| c.user_id);
    MemoryStore::open_for(user_id.as_deref()).context("open local memory store")
}

fn workspace() -> std::path::PathBuf {
    std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."))
}

pub fn recall(query: &str, limit: usize) -> Result<()> {
    let mut store = open_store()?;
    let ws = workspace();
    let hits = store
        .recall_hybrid(query, &ws, limit.clamp(1, 100))
        .context("recall")?;
    if hits.is_empty() {
        println!("No observations match `{query}`.");
        return Ok(());
    }
    println!(
        "{} observation{}:",
        hits.len(),
        if hits.len() == 1 { "" } else { "s" }
    );
    for (o, _score) in hits {
        let body = o.body.lines().next().unwrap_or("");
        println!("- [{}] {body}  ({})", o.kind, o.id);
    }
    Ok(())
}

pub fn remember(text: &str) -> Result<()> {
    let text = text.trim();
    if text.is_empty() {
        anyhow::bail!("remember text must be non-empty");
    }
    let mut store = open_store()?;
    let ws = workspace();
    // kind "fact" = user-pinned and cross-workspace, matching the loop's recall
    // scope rule (facts surface everywhere; other kinds stay workspace-scoped).
    let o = store.insert("fact", &ws, text).context("remember")?;
    println!("Remembered ({}).", o.id);
    Ok(())
}

pub fn forget(target: &str) -> Result<()> {
    let target = target.trim();
    if target.is_empty() {
        anyhow::bail!("forget needs an observation id or `all`");
    }
    let mut store = open_store()?;
    let removed = store.forget(target).context("forget")?;
    if removed == 0 {
        println!("Nothing matched `{target}`.");
    } else {
        println!(
            "Forgot {removed} observation{}.",
            if removed == 1 { "" } else { "s" }
        );
    }
    Ok(())
}
