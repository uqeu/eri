//! Interactive terminal session for `eri` with no subcommand.

use std::io::Write;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::{agent, agent_cmd, auth, config, memory, update};

#[derive(Debug, PartialEq, Eq)]
pub enum ReplAction {
    Empty,
    Exit,
    Help,
    Ask(String),
    Plan(String),
    Ship(String),
    Ui(String),
    AgentList,
    AgentSet(String),
    MemoryRecall { query: String, limit: usize },
    MemoryRemember(String),
    MemoryForget(String),
    Status,
    Tools,
    Sources,
    Mcp,
    Update,
    Doctor,
}

pub fn parse_line(line: &str) -> ReplAction {
    let line = line.trim();
    if line.is_empty() {
        return ReplAction::Empty;
    }
    if !line.starts_with('/') {
        return ReplAction::Ask(line.to_string());
    }

    let without_slash = line.trim_start_matches('/').trim();
    let (command, rest) = split_once_space(without_slash);
    match command {
        "exit" | "quit" | "q" => ReplAction::Exit,
        "help" | "?" => ReplAction::Help,
        "ask" => action_with_text(rest, ReplAction::Ask),
        "plan" => action_with_text(rest, ReplAction::Plan),
        "ship" => action_with_text(rest, ReplAction::Ship),
        "ui" | "genui" => action_with_text(rest, ReplAction::Ui),
        "status" => ReplAction::Status,
        "tools" => ReplAction::Tools,
        "sources" | "index" => ReplAction::Sources,
        "mcp" => ReplAction::Mcp,
        "update" => ReplAction::Update,
        "doctor" => ReplAction::Doctor,
        "agent" => parse_agent(rest),
        "memory" => parse_memory(rest),
        _ => ReplAction::Ask(line.to_string()),
    }
}

pub async fn run() -> Result<()> {
    print_banner();
    let stdin = BufReader::new(tokio::io::stdin());
    let mut lines = stdin.lines();

    loop {
        print!("eri> ");
        std::io::stdout().flush().context("flush prompt")?;
        let Some(line) = lines.next_line().await.context("read terminal input")? else {
            break;
        };
        match parse_line(&line) {
            ReplAction::Empty => {}
            ReplAction::Exit => break,
            ReplAction::Help => print_help(),
            ReplAction::Ask(prompt) => agent::ask(&prompt).await?,
            ReplAction::Plan(prompt) => {
                agent::plan_with_output(&prompt, agent::AgentOutputMode::Text).await?
            }
            ReplAction::Ship(prompt) => {
                agent::ship_with_output(&prompt, agent::AgentOutputMode::Text).await?
            }
            ReplAction::Ui(prompt) => {
                crate::genui::run_with_open(&prompt, crate::genui::GenUiOutputMode::Text, true)?
            }
            ReplAction::AgentList => agent_cmd::list()?,
            ReplAction::AgentSet(name) => agent_cmd::set(&name)?,
            ReplAction::MemoryRecall { query, limit } => memory::recall(&query, limit).await?,
            ReplAction::MemoryRemember(text) => memory::remember(&text).await?,
            ReplAction::MemoryForget(target) => memory::forget(&target).await?,
            ReplAction::Status => auth::status().await?,
            ReplAction::Tools => print_tools(),
            ReplAction::Sources => print_sources(),
            ReplAction::Mcp => print_mcp_status()?,
            ReplAction::Update => update::check(update::UpdateCheckOptions::default()).await?,
            ReplAction::Doctor => print_doctor()?,
        }
    }

    Ok(())
}

fn split_once_space(input: &str) -> (&str, &str) {
    match input.split_once(char::is_whitespace) {
        Some((head, tail)) => (head, tail.trim()),
        None => (input, ""),
    }
}

fn action_with_text(rest: &str, builder: impl FnOnce(String) -> ReplAction) -> ReplAction {
    if rest.is_empty() {
        ReplAction::Help
    } else {
        builder(rest.to_string())
    }
}

fn parse_agent(rest: &str) -> ReplAction {
    let (command, value) = split_once_space(rest);
    match command {
        "" | "list" => ReplAction::AgentList,
        "set" if !value.is_empty() => ReplAction::AgentSet(value.to_string()),
        _ => ReplAction::Help,
    }
}

fn parse_memory(rest: &str) -> ReplAction {
    let (command, value) = split_once_space(rest);
    match command {
        "recall" if !value.is_empty() => ReplAction::MemoryRecall {
            query: value.to_string(),
            limit: 20,
        },
        "remember" if !value.is_empty() => ReplAction::MemoryRemember(value.to_string()),
        "forget" if !value.is_empty() => ReplAction::MemoryForget(value.to_string()),
        _ => ReplAction::Help,
    }
}

fn print_banner() {
    let cwd = std::env::current_dir()
        .ok()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|| "(unknown workspace)".to_string());
    let persona = agent_cmd::active_persona().unwrap_or_else(|_| "eri".to_string());
    let signed_in = config::load().map(|c| c.is_signed_in()).unwrap_or(false);
    let mcp = find_mcp_config()
        .as_ref()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|| "not configured".to_string());

    println!("eri");
    println!("local agent for code, shell, preview, memory, and MCP");
    println!();
    println!("workspace  {cwd}");
    println!("agent      {persona}");
    println!(
        "account    {}",
        if signed_in { "signed in" } else { "offline" }
    );
    println!("mcp        {mcp}");
    println!();
    println!("type a task, or use /plan /ship /ui /mcp /doctor /exit");
}

fn print_help() {
    println!("commands:");
    println!("  /ask <prompt>");
    println!("  /plan <goal>");
    println!("  /ship <goal>");
    println!("  /ui <interface>       open the desktop visual builder");
    println!("  /agent list");
    println!("  /agent set <name>");
    println!("  /memory recall <query>");
    println!("  /memory remember <fact>");
    println!("  /memory forget <id|all>");
    println!("  /tools");
    println!("  /sources");
    println!("  /mcp");
    println!("  /update");
    println!("  /doctor");
    println!("  /status");
    println!("  /exit");
    println!("bare text is sent as an Eri ask");
}

fn print_tools() {
    println!("eri tools:");
    println!("  agent loop        plan, edit, preview, review, checkpoint, ship");
    println!("  genui             stream structured UI from Eri component contracts");
    println!("  files             read, write, edit, search, mention files/folders");
    println!("  shell             run commands with approval and capture outputs");
    println!("  git               status, diffs, branches, commit/PR summaries");
    println!("  preview/browser   inspect pages, screenshots, responsive states, flows");
    println!("  review            scan diffs, rank risk, suggest fixes");
    println!("  memory            remember, recall, and share context across sessions");
    println!("  universal search  code, docs, PDFs, datasets, web, app data");
    println!("  oracle research   grounded multi-step answers with citations");
    println!("  tracer            autonomous repo/GitHub search subagent");
    println!("  document agent    reason over PDFs, papers, docs, drawings, page cites");
    println!("  autosubscribe     parse dependencies and attach current docs");
    println!("  sync engine       opt-in local folders, databases, notes, chat history");
    println!("  mcp/api/skill     expose Eri tools through MCP, HTTP API, and skills");
    println!("  voice/gaze        local permissioned sight and speech context");
    println!("  update            server manifest, signed local updater, rollback");
}

fn print_sources() {
    println!("source types Eri should read when allowed:");
    println!("  repo code          files, folders, symbols, diffs, branches");
    println!("  package docs       package.json, requirements.txt, Cargo.toml, go.mod");
    println!("  web/docs           URLs, docs sites, changelogs, forums, blogs");
    println!("  PDFs/documents     papers, books, specs, manuals, page citations");
    println!("  datasets           Hugging Face, CSV, parquet, JSONL, SQL tables");
    println!("  app connectors     GitHub, Linear, Notion, Slack, Drive, Supabase");
    println!("  browser/preview    DOM, screenshots, console logs, network errors");
    println!("  local knowledge    notes, memories, prior plans, chat summaries");
    println!("  enterprise         self-hosted indexes, audit logs, RBAC, retention");
}

pub(crate) fn print_mcp_status() -> Result<()> {
    match find_mcp_config() {
        Some(path) => {
            println!("MCP config: {}", path.display());
            let raw = std::fs::read_to_string(&path)
                .with_context(|| format!("read {}", path.display()))?;
            match serde_json::from_str::<Value>(&raw) {
                Ok(value) => print_mcp_servers(&value),
                Err(err) => println!("  malformed JSON: {err}"),
            }
        }
        None => {
            println!("MCP config: not found");
            println!("  run npx eri-wizard or create .eri/mcp.json");
            println!(
                "  Eri expects local MCP servers such as filesystem, git, browser, docs, memory, and app connectors."
            );
        }
    }
    Ok(())
}

fn print_mcp_servers(value: &Value) {
    let servers = value
        .get("servers")
        .or_else(|| value.get("mcpServers"))
        .and_then(Value::as_object);
    let Some(servers) = servers else {
        println!("  no servers registered");
        return;
    };
    if servers.is_empty() {
        println!("  no servers registered");
        return;
    }
    println!("  servers:");
    for (name, server) in servers {
        let command = server
            .get("command")
            .and_then(Value::as_str)
            .unwrap_or("(custom)");
        println!("    {name:<16} {command}");
    }
}

pub(crate) fn print_doctor() -> Result<()> {
    let cwd = std::env::current_dir().context("read current directory")?;
    let creds = config::load()?;
    println!("eri doctor:");
    print_check("workspace", true, &cwd.display().to_string());
    print_check(
        "account",
        creds.is_signed_in(),
        if creds.is_signed_in() {
            "signed in"
        } else {
            "run eri auth login"
        },
    );
    print_check(
        "AGENTS.md",
        cwd.join("AGENTS.md").exists(),
        "project operating rules",
    );
    print_check(
        ".eri/workflow.json",
        cwd.join(".eri").join("workflow.json").exists(),
        "plan/edit/preview/review/checkpoint/ship contract",
    );
    print_check(
        ".eri/mcp.json",
        cwd.join(".eri").join("mcp.json").exists(),
        "local MCP server config",
    );
    print_check(
        "active agent",
        true,
        &agent_cmd::active_persona().unwrap_or_else(|_| "eri".to_string()),
    );
    println!("next:");
    println!("  npx eri-wizard");
    println!("  /agent set builder");
    println!("  /plan build the first feature");
    Ok(())
}

fn print_check(label: &str, ok: bool, detail: &str) {
    let mark = if ok { "ok" } else { "missing" };
    println!("  {label:<18} {mark:<8} {detail}");
}

fn find_mcp_config() -> Option<PathBuf> {
    let workspace = std::env::current_dir().ok()?.join(".eri").join("mcp.json");
    if workspace.exists() {
        return Some(workspace);
    }
    let home = std::env::var("HOME")
        .ok()
        .map(|h| Path::new(&h).join(".eri").join("mcp.json"));
    home.filter(|p| p.exists())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bare_text_becomes_ask() {
        assert_eq!(
            parse_line("what changed in this repo?"),
            ReplAction::Ask("what changed in this repo?".to_string())
        );
    }

    #[test]
    fn slash_commands_parse_core_agent_actions() {
        assert_eq!(
            parse_line("/plan add usage billing"),
            ReplAction::Plan("add usage billing".to_string())
        );
        assert_eq!(
            parse_line("/ship review and prepare branch"),
            ReplAction::Ship("review and prepare branch".to_string())
        );
        assert_eq!(
            parse_line("/ui billing dashboard"),
            ReplAction::Ui("billing dashboard".to_string())
        );
        assert_eq!(parse_line("/agent list"), ReplAction::AgentList);
        assert_eq!(
            parse_line("/agent set builder"),
            ReplAction::AgentSet("builder".to_string())
        );
        assert_eq!(parse_line("/tools"), ReplAction::Tools);
        assert_eq!(parse_line("/sources"), ReplAction::Sources);
        assert_eq!(parse_line("/index"), ReplAction::Sources);
        assert_eq!(parse_line("/mcp"), ReplAction::Mcp);
        assert_eq!(parse_line("/update"), ReplAction::Update);
        assert_eq!(parse_line("/doctor"), ReplAction::Doctor);
    }

    #[test]
    fn memory_and_exit_commands_parse() {
        assert_eq!(
            parse_line("/memory recall package manager"),
            ReplAction::MemoryRecall {
                query: "package manager".to_string(),
                limit: 20
            }
        );
        assert_eq!(
            parse_line("/memory remember use pnpm"),
            ReplAction::MemoryRemember("use pnpm".to_string())
        );
        assert_eq!(parse_line("/exit"), ReplAction::Exit);
    }
}
