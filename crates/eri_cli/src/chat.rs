//! `eri chat` -- the multi-turn agentic session REPL.
//!
//! Unlike the one-shot `eri build`, chat keeps a persistent `Session` so context
//! is retained across turns and across shell invocations (`--continue` /
//! `--resume`). Each typed message runs the same metered, tool-executing loop as
//! `build`; the full conversation is saved to `~/.config/eri/sessions/<id>.json`
//! after every turn so nothing is lost if the shell closes.

use std::io::Write;

use anyhow::{Context, Result};
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::session::{self, Session};
use crate::{Mode, build_agent};

/// How to open the chat session.
pub enum ResumeMode {
    /// Fresh session in the current directory.
    New,
    /// Continue the most recently updated session.
    Continue,
    /// Resume a specific session by id or id-prefix.
    Resume(String),
}

/// Start or resume a chat session and run the interactive loop.
pub async fn run(resume: ResumeMode, model: &str) -> Result<()> {
    let cwd = std::env::current_dir().context("read current directory")?;
    let mut sess = match resume {
        ResumeMode::New => Session::create(&cwd, model),
        ResumeMode::Continue => match session::latest()? {
            Some(s) => {
                println!(
                    "[eri] continuing session {} ({} turns so far)",
                    s.id, s.turns
                );
                s
            }
            None => {
                println!("[eri] no prior session -- starting a new one");
                Session::create(&cwd, model)
            }
        },
        ResumeMode::Resume(id) => {
            let s = session::resolve(&id)?;
            println!("[eri] resumed session {} ({} turns so far)", s.id, s.turns);
            s
        }
    };

    print_banner(&sess);

    let stdin = BufReader::new(tokio::io::stdin());
    let mut lines = stdin.lines();
    loop {
        print!("eri chat> ");
        std::io::stdout().flush().context("flush prompt")?;
        let Some(line) = lines.next_line().await.context("read terminal input")? else {
            break;
        };
        let line = line.trim().to_string();
        if line.is_empty() {
            continue;
        }
        if line.starts_with('/') {
            if handle_slash(&line, &mut sess).await? == Flow::Exit {
                break;
            }
            continue;
        }
        // A normal message -> one agentic turn with retained context.
        match build_agent::run_session_turn(&mut sess, &line).await {
            Ok(outcome) => {
                println!(
                    "\n[eri] turn done -- {} file(s) touched, {} in / {} out tokens (metered)",
                    outcome.files_written.len(),
                    outcome.tokens_in,
                    outcome.tokens_out
                );
            }
            Err(e) => {
                eprintln!("error: {e}");
            }
        }
        // Persist after every turn so a closed shell never loses history.
        if let Err(e) = sess.save() {
            eprintln!("[eri] warning: could not save session: {e}");
        }
    }

    sess.save().ok();
    println!("[eri] session {} saved.", sess.id);
    Ok(())
}

#[derive(PartialEq, Eq)]
enum Flow {
    Continue,
    Exit,
}

/// Handle an in-chat slash command. Returns whether to keep looping.
async fn handle_slash(line: &str, sess: &mut Session) -> Result<Flow> {
    let without = line.trim_start_matches('/').trim();
    let (cmd, rest) = match without.split_once(char::is_whitespace) {
        Some((h, t)) => (h, t.trim()),
        None => (without, ""),
    };
    match cmd {
        "exit" | "quit" | "q" => return Ok(Flow::Exit),
        "help" | "?" => print_chat_help(),
        "sessions" => list_sessions()?,
        "cost" | "usage" => print_cost(sess),
        "context" => print_context(sess),
        "compact" => compact(sess).await?,
        "clear" => {
            sess.messages.clear();
            println!("[eri] context cleared -- the next message starts fresh (session kept)");
        }
        "init" => run_init(sess)?,
        "diff" => print_diff(sess, rest),
        "status" => print_status(sess),
        "commands" => list_custom_commands(sess),
        "new" => {
            sess.save().ok();
            let cwd = std::env::current_dir().context("read current directory")?;
            *sess = Session::create(&cwd, &sess.model);
            println!("[eri] started a new session {}", sess.id);
        }
        "model" => set_model(sess, rest),
        other => {
            // Fall back to a custom command from .eri/commands/<other>.md.
            if let Some(cmd) = crate::commands::find(&sess.workspace_path(), other) {
                let prompt = crate::commands::expand(&cmd.body, rest);
                match build_agent::run_session_turn(sess, &prompt).await {
                    Ok(o) => println!(
                        "\n[eri] /{other} done -- {} file(s), {} in / {} out tokens",
                        o.files_written.len(),
                        o.tokens_in,
                        o.tokens_out
                    ),
                    Err(e) => eprintln!("error: {e}"),
                }
                sess.save().ok();
            } else {
                println!("[eri] unknown command /{other} -- try /help");
            }
        }
    }
    Ok(Flow::Continue)
}

fn run_git(workspace: &std::path::Path, args: &[&str]) -> Option<String> {
    let out = std::process::Command::new("git")
        .args(args)
        .current_dir(workspace)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).to_string())
}

fn print_diff(sess: &Session, rest: &str) {
    let ws = sess.workspace_path();
    let mut args = vec!["diff", "--stat"];
    if !rest.trim().is_empty() {
        args.push(rest.trim());
    }
    match run_git(&ws, &args) {
        Some(s) if !s.trim().is_empty() => print!("{s}"),
        Some(_) => println!("[eri] no changes in the working tree."),
        None => println!(
            "[eri] not a git repo (or git unavailable) at {}",
            sess.workspace
        ),
    }
}

fn print_status(sess: &Session) {
    let creds = crate::config::load().unwrap_or_default();
    let who = creds.email.as_deref().unwrap_or("not signed in");
    let tier = creds.tier.as_deref().unwrap_or("-");
    println!("[eri] account    {who} ({tier})");
    println!("      session    {} -- {} turns", sess.id, sess.turns);
    println!("      workspace  {}", sess.workspace);
    let ws = sess.workspace_path();
    if let Some(branch) = run_git(&ws, &["rev-parse", "--abbrev-ref", "HEAD"]) {
        let branch = branch.trim();
        let dirty = run_git(&ws, &["status", "--porcelain"])
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false);
        println!(
            "      git        {branch}{}",
            if dirty { " (uncommitted changes)" } else { "" }
        );
    }
    let agents = if crate::project::has_agents_md(&ws) {
        "loaded"
    } else {
        "none"
    };
    println!("      AGENTS.md  {agents}");
}

fn list_custom_commands(sess: &Session) {
    let cmds = crate::commands::discover(&sess.workspace_path());
    if cmds.is_empty() {
        println!("[eri] no custom commands. Add .eri/commands/<name>.md to define /<name>.");
        return;
    }
    println!("custom commands:");
    for c in &cmds {
        let first = c.body.lines().find(|l| !l.trim().is_empty()).unwrap_or("");
        println!(
            "  /{:<14} {:<8} {}",
            c.name,
            c.scope,
            short(first.trim(), 48)
        );
    }
}

fn print_context(sess: &Session) {
    let root = sess.workspace_path();
    let agents = if crate::project::has_agents_md(&root) {
        "loaded"
    } else {
        "none (run /init)"
    };
    println!(
        "[eri] context: {} message(s) in history, AGENTS.md {}, workspace {}",
        sess.messages.len(),
        agents,
        sess.workspace
    );
}

async fn compact(sess: &mut Session) -> Result<()> {
    let model = sess.model.clone();
    println!("[eri] compacting conversation...");
    let (old, new) = build_agent::compact_session(sess, &model).await?;
    sess.save().ok();
    println!("[eri] compacted {old} message(s) -> {new}; continuity kept as a summary");
    Ok(())
}

fn run_init(sess: &Session) -> Result<()> {
    let (path, created) = crate::project::scaffold(&sess.workspace_path())?;
    if created {
        println!(
            "[eri] wrote {} -- fill it in; eri reads it each turn",
            path.display()
        );
    } else {
        println!("[eri] {} already exists", path.display());
    }
    Ok(())
}

fn set_model(sess: &mut Session, rest: &str) {
    let mode = match rest {
        "fast" => Some(Mode::Fast),
        "thinking" => Some(Mode::Thinking),
        "auto" => Some(Mode::Auto),
        "" => None,
        other => {
            println!("[eri] unknown mode '{other}' -- use fast | thinking | auto");
            return;
        }
    };
    match mode {
        Some(m) => {
            sess.model = crate::model_for_mode(m).to_string();
            println!("[eri] mode set to {rest}");
        }
        None => println!("[eri] current mode tier is set; pass fast | thinking | auto to change"),
    }
}

fn print_banner(sess: &Session) {
    println!("eri chat -- multi-turn session (context retained across turns)");
    println!("session    {}", sess.id);
    println!("workspace  {}", sess.workspace);
    // Surface what project context is being injected, so a freshly-cloned
    // AGENTS.md folded into the prompt is visible, not silent.
    if crate::project::has_agents_md(&sess.workspace_path()) {
        println!("AGENTS.md  loaded from this workspace (informational; review it with /context)");
    }
    println!();
    println!("type a message, or /help /sessions /cost /context /compact /new /model /exit");
}

fn print_chat_help() {
    println!("chat commands:");
    println!("  /sessions          list saved sessions");
    println!("  /cost              tokens used this session");
    println!("  /context           history size + AGENTS.md status");
    println!("  /status            account, session, git, AGENTS.md");
    println!("  /diff [ref]        git diff --stat of the workspace");
    println!("  /compact           summarize history to shrink context");
    println!("  /clear             forget the conversation (keep the session)");
    println!("  /init              scaffold AGENTS.md for this project");
    println!("  /commands          list custom .eri/commands/*.md commands");
    println!("  /new               start a fresh session");
    println!("  /model <tier>      switch tier: fast | thinking | auto");
    println!("  /exit              save and quit");
    println!("custom: /<name> runs .eri/commands/<name>.md ($ARGUMENTS expanded)");
    println!("any other line is sent as a message (prior turns are remembered)");
}

fn print_cost(sess: &Session) {
    // Mirror the backend's weighted "eri credits": output counts 5x.
    let credits = sess.tokens_in + 5 * sess.tokens_out;
    println!(
        "[eri] this session: {} turns, {} in / {} out tokens (~{} eri credits)",
        sess.turns, sess.tokens_in, sess.tokens_out, credits
    );
}

/// Print all saved sessions (newest first). Also the `eri sessions` command.
pub(crate) fn list_sessions() -> Result<()> {
    let listed = session::list()?;
    if listed.is_empty() {
        println!("[eri] no saved sessions yet");
        return Ok(());
    }
    println!("saved sessions (newest first):");
    for m in listed.iter().take(20) {
        let title = m.title.as_deref().unwrap_or("(untitled)");
        let credits = m.tokens_in + 5 * m.tokens_out;
        let ws = m
            .workspace
            .rsplit(['/', '\\'])
            .next()
            .filter(|s| !s.is_empty())
            .unwrap_or(m.workspace.as_str());
        println!(
            "  {:<22} {:>3} turns  {:>7} cr  {:<14} {}",
            m.id,
            m.turns,
            credits,
            short(ws, 14),
            short(title, 40)
        );
    }
    println!("resume with: eri chat --resume <id>");
    Ok(())
}

fn short(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let head: String = s.chars().take(max - 1).collect();
        format!("{head}…")
    }
}
