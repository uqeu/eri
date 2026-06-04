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
            if handle_slash(&line, &mut sess)? == Flow::Exit {
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
fn handle_slash(line: &str, sess: &mut Session) -> Result<Flow> {
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
        "new" => {
            sess.save().ok();
            let cwd = std::env::current_dir().context("read current directory")?;
            *sess = Session::create(&cwd, &sess.model);
            println!("[eri] started a new session {}", sess.id);
        }
        "model" => set_model(sess, rest),
        other => println!("[eri] unknown command /{other} -- try /help"),
    }
    Ok(Flow::Continue)
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
    println!();
    println!("type a message, or /help /sessions /cost /new /model /exit");
}

fn print_chat_help() {
    println!("chat commands:");
    println!("  /sessions          list saved sessions");
    println!("  /cost              tokens used this session");
    println!("  /new               start a fresh session");
    println!("  /model <tier>      switch tier: fast | thinking | auto");
    println!("  /exit              save and quit");
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
