//! `eri ask`, `eri plan`, `eri ship`, `eri test`, `eri refactor`,
//! `eri explain` — agent-mode subcommands. All route through
//! `/api/v1/agent/run` with different persona / intent envelopes so
//! the backend's brain layer can pick the right model + budget.

use std::io::{self, Write};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use crate::client::Client;
use crate::config;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentRunBody<'a> {
    intent: &'a str,
    prompt: &'a str,
    workspace_root: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    persona: Option<&'a str>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    targets: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentEvent {
    kind: String,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    routed_to: Option<String>,
    #[serde(default)]
    tokens_in: Option<u64>,
    #[serde(default)]
    tokens_out: Option<u64>,
}

pub async fn ask(prompt: &str) -> Result<()> {
    run_intent("ask", prompt, None, &[]).await
}

pub async fn plan(prompt: &str) -> Result<()> {
    run_intent("plan", prompt, Some("architect"), &[]).await
}

pub async fn ship(prompt: &str) -> Result<()> {
    run_intent("ship", prompt, Some("shipper"), &[]).await
}

pub async fn test(scope: &str) -> Result<()> {
    let prompt = if scope.is_empty() {
        "Add tests for any code without coverage in the current workspace.".to_string()
    } else {
        format!("Add tests for {scope}.")
    };
    let targets = scope_targets(scope);
    run_intent("test", &prompt, Some("tester"), &targets).await
}

pub async fn refactor(scope: &str) -> Result<()> {
    let prompt = if scope.is_empty() {
        "Suggest a clean refactor for the active file or selection.".to_string()
    } else {
        format!("Refactor {scope}.")
    };
    let targets = scope_targets(scope);
    run_intent("refactor", &prompt, Some("architect"), &targets).await
}

pub async fn explain(target: &str) -> Result<()> {
    if target.is_empty() {
        anyhow::bail!("explain needs a target — file path or `file:line` range");
    }
    let prompt = format!("Explain {target} in plain language. Include design intent + edge cases.");
    run_intent("explain", &prompt, None, &[target.to_string()]).await
}

pub async fn sketch(prompt: &str) -> Result<()> {
    if prompt.is_empty() {
        anyhow::bail!("sketch needs a description of what to draft");
    }
    run_intent("sketch", prompt, None, &[]).await
}

fn scope_targets(scope: &str) -> Vec<String> {
    if scope.is_empty() {
        Vec::new()
    } else {
        vec![scope.to_string()]
    }
}

async fn run_intent(
    intent: &str,
    prompt: &str,
    persona: Option<&str>,
    targets: &[String],
) -> Result<()> {
    let creds = config::load()?;
    if !creds.is_signed_in() {
        anyhow::bail!("not signed in — run `eri auth login` first");
    }
    let client = Client::from_credentials(&creds)?;
    let workspace_root = std::env::current_dir()
        .ok()
        .map(|p| p.to_string_lossy().to_string());

    let body = AgentRunBody {
        intent,
        prompt,
        workspace_root,
        persona,
        targets: targets.to_vec(),
    };
    let response = client
        .post_stream("/api/v1/agent/run", &body)
        .await
        .with_context(|| format!("dispatch /api/v1/agent/run intent={intent}"))?;

    stream_events(response).await
}

async fn stream_events(mut response: reqwest::Response) -> Result<()> {
    let mut buffer = String::new();
    let mut stdout = io::stdout().lock();
    let mut totals_in: u64 = 0;
    let mut totals_out: u64 = 0;
    while let Some(chunk) = response
        .chunk()
        .await
        .context("read SSE stream")?
    {
        buffer.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(idx) = buffer.find('\n') {
            let line = buffer[..idx].trim_end_matches('\r').to_string();
            buffer.drain(..=idx);
            handle_line(&line, &mut stdout, &mut totals_in, &mut totals_out)?;
        }
    }
    if !buffer.is_empty() {
        let trailing = buffer.clone();
        handle_line(&trailing, &mut stdout, &mut totals_in, &mut totals_out)?;
    }
    writeln!(stdout)?;
    Ok(())
}

fn handle_line(
    line: &str,
    stdout: &mut impl Write,
    totals_in: &mut u64,
    totals_out: &mut u64,
) -> Result<()> {
    let payload = if let Some(rest) = line.strip_prefix("data:") {
        rest.trim()
    } else if !line.is_empty() && !line.starts_with("event:") && !line.starts_with(":") {
        // Plain NDJSON fallback for non-SSE backends.
        line.trim()
    } else {
        return Ok(());
    };
    if payload.is_empty() || payload == "[DONE]" {
        return Ok(());
    }
    let event: AgentEvent = match serde_json::from_str(payload) {
        Ok(e) => e,
        Err(_) => {
            writeln!(stdout, "{payload}")?;
            return Ok(());
        }
    };
    match event.kind.as_str() {
        "token" => {
            if let Some(t) = event.text {
                write!(stdout, "{t}")?;
                stdout.flush()?;
            }
        }
        "tool_call" => {
            if let Some(msg) = event.message {
                writeln!(stdout, "\n[tool] {msg}")?;
            }
        }
        "done" => {
            if let Some(t) = event.tokens_in {
                *totals_in = t;
            }
            if let Some(t) = event.tokens_out {
                *totals_out = t;
            }
            writeln!(stdout)?;
            if let Some(model) = event.routed_to {
                eprintln!(
                    "done — model: {model}, tokens: {}→{}",
                    *totals_in, *totals_out
                );
            } else {
                eprintln!("done — tokens: {}→{}", *totals_in, *totals_out);
            }
        }
        "error" => {
            writeln!(stdout)?;
            if let Some(msg) = event.message {
                anyhow::bail!("agent error: {msg}");
            }
            anyhow::bail!("agent error (no message)");
        }
        _ => {
            if let Some(msg) = event.message.or(event.text) {
                writeln!(stdout, "[{}] {msg}", event.kind)?;
            }
        }
    }
    Ok(())
}
