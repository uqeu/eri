//! `eri memory recall` / `eri memory remember` / `eri memory forget`.
//!
//! Local-first: reads and writes the SAME on-device `MemoryStore` the agentic
//! loop uses (`~/.eri/users/<user>/memory.json`), scoped per signed-in user.
//! No network call — your memory never leaves the machine. (The cloud `/sync`
//! endpoint is a separate, opt-in mirror; recall/remember/forget are local.)

use anyhow::{Context, Result};
use eri_inference::memory::{MemoryStore, Observation};

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
    // Additive (ADR-0007): mirror the fact into the user's world model so it
    // becomes queryable as people/projects. Best-effort — never fails remember.
    let user_id = config::load().ok().and_then(|c| c.user_id);
    let _ = eri_inference::memory::world_recall::model_observation(user_id.as_deref(), &o);
    println!("Remembered ({}).", o.id);
    Ok(())
}

/// `eri memory who <project>` — "who do I work with on X?", answered from the
/// world model (the entity graph populated as you `remember`). NO fabrication:
/// an unknown project, or one with no recorded collaborators, says so.
pub fn who(project: &str) -> Result<()> {
    let project = project.trim();
    if project.is_empty() {
        anyhow::bail!("usage: eri memory who <project>");
    }
    let user_id = config::load().ok().and_then(|c| c.user_id);
    let graph = eri_inference::memory::world_recall::open_world_graph(user_id.as_deref())
        .context("open world model")?;
    let people = eri_inference::memory::world_recall::who_collaborates_on(&graph, project)
        .context("query world model")?;
    if people.is_empty() {
        println!("No one on record working with you on `{project}`.");
    } else {
        println!("You work with {} on `{project}`.", people.join(", "));
    }
    Ok(())
}

/// `eri memory reflect [--limit N]` — run one cold-path reflection flush: the
/// base engine reads your recent observations and writes the entities/relations
/// it infers into the world model (provenance-tagged, ADR-0007 §3). A manual
/// batch flush — an automatic cadence is a later refinement. User-scoped.
pub async fn reflect(limit: usize) -> Result<()> {
    let user_id = config::load().ok().and_then(|c| c.user_id);
    let written = crate::reflection::run_reflection(
        &crate::reflection::ProxyReflectionClient,
        user_id.as_deref(),
        limit,
    )
    .await
    .context("reflection flush")?;
    println!(
        "Reflected over your recent observations — updated {written} entit{} in your world model.",
        if written == 1 { "y" } else { "ies" }
    );
    Ok(())
}

/// `eri memory ingest` — backfill the world model from the episodic store: extract
/// the people/projects/relations in everything you've remembered into the world
/// graph. Additive (memories untouched) + idempotent (skips what's already modelled,
/// by source observation id). The prerequisite that gives `reflect` something to read
/// and the recall projection something to surface. User-scoped.
pub fn ingest() -> Result<()> {
    let user_id = config::load().ok().and_then(|c| c.user_id);
    let report = eri_inference::memory::world_recall::ingest_store(user_id.as_deref())
        .context("world-model ingest")?;
    println!(
        "Ingested {} observation{} ({} already modelled) — {} entit{} in your world model.",
        report.ingested,
        if report.ingested == 1 { "" } else { "s" },
        report.skipped,
        report.entities,
        if report.entities == 1 { "y" } else { "ies" }
    );
    Ok(())
}

/// `eri brief` — a daily "here's your day" recap from what eri actually
/// remembers. NO fabrication: it only reports real observations on record.
/// Calendar + email join this once the user connects those (honest note).
pub fn brief() -> Result<()> {
    let store = open_store()?;
    let ws = workspace();
    let ws_label = ws
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("this workspace")
        .to_string();
    let patterns = store.top_patterns(&ws, 12);
    print!("{}", format_brief(&patterns, &ws_label));
    Ok(())
}

/// First non-empty line of an observation body, trimmed + length-capped, for a
/// scannable one-liner. Pure so `brief` formatting is unit-testable.
fn first_line(body: &str) -> String {
    let line = body
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("");
    if line.chars().count() > 100 {
        let cut: String = line.chars().take(99).collect();
        format!("{cut}…")
    } else {
        line.to_string()
    }
}

/// Render the brief from real observations only. Splits user-pinned facts from
/// observed behavior; an empty store yields an honest "nothing yet" message —
/// never invented activity.
fn format_brief(patterns: &[Observation], ws_label: &str) -> String {
    if patterns.is_empty() {
        return concat!(
            "I don't have anything remembered yet, so there's nothing to brief you on.\n",
            "As you work, I learn your habits and what you're building. Pin something now with:\n",
            "  eri remember \"...\"\n",
        )
        .to_string();
    }

    let (facts, observed): (Vec<&Observation>, Vec<&Observation>) =
        patterns.iter().partition(|o| o.kind == "fact");

    let mut out = String::from("Here's what I know going into your day:\n\n");
    if !facts.is_empty() {
        out.push_str("What you've told me:\n");
        for o in &facts {
            out.push_str(&format!("  · {}\n", first_line(&o.body)));
        }
        out.push('\n');
    }
    if !observed.is_empty() {
        out.push_str(&format!("What I've noticed in {ws_label}:\n"));
        for o in &observed {
            out.push_str(&format!("  · [{}] {}\n", o.kind, first_line(&o.body)));
        }
        out.push('\n');
    }
    out.push_str(&format!(
        "{} memory item{} on record. Your calendar and email join this once you \
         connect them — try `eri calendar` and `eri email`.\n",
        patterns.len(),
        if patterns.len() == 1 { "" } else { "s" },
    ));
    out
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

#[cfg(test)]
mod tests {
    use super::*;
    use eri_inference::memory::Visibility;

    fn obs(kind: &str, body: &str) -> Observation {
        Observation {
            id: "id".into(),
            ts_ms: 0,
            kind: kind.into(),
            workspace_hash: "h".into(),
            body: body.into(),
            embedding: Vec::new(),
            valid_from: None,
            visibility: Visibility::Active,
            ..Default::default()
        }
    }

    #[test]
    fn brief_empty_is_honest_not_fabricated() {
        let out = format_brief(&[], "eri");
        assert!(out.contains("nothing to brief"));
        assert!(out.contains("eri remember"));
        // Crucially: an empty store must never invent a day.
        let low = out.to_lowercase();
        assert!(!low.contains("meeting"));
        assert!(!low.contains("email"));
    }

    #[test]
    fn brief_reports_only_real_facts_and_observations() {
        let items = vec![
            obs("fact", "I prefer tabs over spaces"),
            obs("edit_accepted", "Edited Header.tsx"),
        ];
        let out = format_brief(&items, "eri");
        assert!(out.contains("What you've told me"));
        assert!(out.contains("prefer tabs"));
        assert!(out.contains("What I've noticed in eri"));
        assert!(out.contains("[edit_accepted]"));
        assert!(out.contains("2 memory items"));
    }

    #[test]
    fn first_line_caps_length_and_skips_blanks() {
        assert_eq!(first_line("\n\n  hello \nworld"), "hello");
        let long = "a".repeat(200);
        let fl = first_line(&long);
        assert!(fl.ends_with('…'));
        assert!(fl.chars().count() <= 100);
    }
}
