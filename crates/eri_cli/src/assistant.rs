//! `eri email` / `eri calendar` — assistant surfaces built on the MCP servers
//! you connect (Gmail, Google Calendar, …). eri does NOT hand-roll IMAP/CalDAV;
//! it speaks to whatever email/calendar MCP server you configure in
//! `~/.eri/mcp.json`. When nothing is connected it tells you exactly how to
//! connect one — it never invents an inbox or a schedule.

use anyhow::Result;
use eri_mcp::{Mcp, ToolHandle};

fn workspace() -> std::path::PathBuf {
    std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."))
}

/// Does a tool/server name look like it belongs to this category?
fn matches_category(name: &str, keywords: &[&str]) -> bool {
    let n = name.to_lowercase();
    keywords.iter().any(|k| n.contains(k))
}

pub async fn email(action: &str) -> Result<()> {
    run_category(
        "email",
        &["mail", "email", "gmail", "inbox", "imap"],
        action,
        "{\n  \"mcpServers\": {\n    \"gmail\": { \"command\": \"npx\", \"args\": [\"-y\", \"<a-gmail-mcp-server>\"] }\n  }\n}",
    )
    .await
}

pub async fn calendar(action: &str) -> Result<()> {
    run_category(
        "calendar",
        &["calendar", "event", "schedule", "gcal", "meeting"],
        action,
        "{\n  \"mcpServers\": {\n    \"calendar\": { \"command\": \"npx\", \"args\": [\"-y\", \"<a-calendar-mcp-server>\"] }\n  }\n}",
    )
    .await
}

async fn run_category(label: &str, keywords: &[&str], action: &str, example: &str) -> Result<()> {
    let ws = workspace();
    let tools: Vec<ToolHandle> = match Mcp::load_with_vars(&ws, &crate::build_agent::mcp_vars()).await {
        Ok(mcp) => mcp.tools().await,
        Err(e) => {
            println!("[eri] couldn't load MCP config: {e}");
            Vec::new()
        }
    };
    let matched: Vec<&ToolHandle> = tools
        .iter()
        .filter(|t| matches_category(&t.name, keywords) || matches_category(&t.server, keywords))
        .collect();

    if matched.is_empty() {
        println!(
            "No {label} server is connected, so I can't read or send anything yet — and I \
             won't make up {label} data.\n\n\
             Connect one in ~/.eri/mcp.json, for example:\n\n{example}\n\n\
             Once it's connected I can summarize, draft, and triage your real {label}."
        );
        return Ok(());
    }

    println!("Connected {label} via MCP. Tools I can use:");
    for t in &matched {
        let desc = t.description.lines().next().unwrap_or("").trim();
        println!("  · {} — {desc}", t.name);
    }
    let action = action.trim();
    if action.is_empty() {
        println!("\nTell me what to do, e.g. `eri {label} summarize`.");
    } else {
        println!(
            "\n(\"{action}\" — running {label} actions from the CLI lands next; this confirms the \
             connection works. Drive it from the assistant pad for now.)"
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn category_match_is_case_insensitive_and_substring() {
        assert!(matches_category("Gmail", &["gmail"]));
        assert!(matches_category("list_messages", &["message", "mail"]));
        assert!(matches_category("google-calendar", &["calendar"]));
        assert!(!matches_category("filesystem", &["mail", "calendar"]));
    }
}
