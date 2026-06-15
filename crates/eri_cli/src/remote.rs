//! `eri remote` — let phone eri act on this computer (Phase 2, ADR-0002).
//!
//! A daemon that polls the cloud command queue for goals the user dispatched
//! from their phone, runs each through the EXISTING control stack
//! (`run_control_agent` + `ControlGate` + the action-log trust trail), and posts
//! the result back (which the cloud relays to the phone).
//!
//! **Safety crux:** remote mode NEVER auto-confirms. The gate is built with
//! `yes = false` and the confirm closure always denies — capturing the first
//! risky prompt so the command is completed as `awaiting_confirm` and the
//! question is bounced to the phone, rather than a risky action running
//! unattended.

use std::time::Duration;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use crate::client::Client;
use crate::config;
use crate::remote_recall;
use crate::{action_log, control_agent, control_safety};

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Deserialize)]
struct PolledCommand {
    id: String,
    goal: String,
    /// The kind of remote turn: `"control"` (actuation) or `"recall"` (a deep
    /// memory lookup answered locally). Defaults to control for back-compat with
    /// rows enqueued before the recall adapter existed (architecture review A).
    #[serde(default = "default_kind")]
    kind: String,
    /// True when the user already confirmed this goal from their phone (H1) —
    /// run it without re-asking. Defaults false for a fresh dispatch.
    #[serde(default)]
    approved: bool,
}

fn default_kind() -> String {
    "control".to_string()
}

#[derive(Deserialize)]
struct PollResponse {
    command: Option<PolledCommand>,
}

#[derive(Serialize)]
struct PollRequest {}

#[derive(Serialize)]
struct CompleteRequest<'a> {
    id: &'a str,
    status: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<String>,
    #[serde(rename = "confirmPrompt", skip_serializing_if = "Option::is_none")]
    confirm_prompt: Option<String>,
    /// Cloud tokens this remote turn cost, so the server can meter remote compute
    /// like any other eri-token spend (review M4). 0 for local recall / fast-lane.
    #[serde(rename = "tokensIn")]
    tokens_in: u64,
    #[serde(rename = "tokensOut")]
    tokens_out: u64,
}

/// What to post back for a finished remote turn: the queue status, the relayed
/// text (or the confirmation prompt), and the tokens it cost.
struct CommandOutcome {
    status: &'static str,
    result: Option<String>,
    confirm_prompt: Option<String>,
    usage: crate::control_turn::TokenUsage,
}

impl CommandOutcome {
    /// A locally-answered or error outcome with no cloud cost.
    fn free(status: &'static str, result: Option<String>) -> Self {
        CommandOutcome {
            status,
            result,
            confirm_prompt: None,
            usage: crate::control_turn::TokenUsage::default(),
        }
    }
}

/// Map a control run's result + whether a confirmation was needed onto the queue
/// status + payload + the tokens it cost. A risky action (confirm requested)
/// ALWAYS becomes `awaiting_confirm` — never reported as `done` — but the tokens
/// already spent reaching it are still metered. Pure + unit-tested.
fn outcome(result: Result<control_agent::ControlRun>, confirm_prompt: Option<String>) -> CommandOutcome {
    // Tokens spent before this point are billed regardless of which branch wins.
    let usage = match &result {
        Ok(run) => run.usage,
        Err(_) => crate::control_turn::TokenUsage::default(),
    };
    if let Some(prompt) = confirm_prompt {
        return CommandOutcome {
            status: "awaiting_confirm",
            result: None,
            confirm_prompt: Some(prompt),
            usage,
        };
    }
    match result {
        Ok(run) => CommandOutcome {
            status: "done",
            result: Some(run.text),
            confirm_prompt: None,
            usage,
        },
        // Cap the error so an internal detail (paths, endpoint dumps) can't be
        // relayed verbatim to the user's phone (review L3).
        Err(e) => CommandOutcome {
            status: "error",
            result: Some(sanitize_error(&e.to_string())),
            confirm_prompt: None,
            usage,
        },
    }
}

/// Keep a relayed error short + first-line-only so internals don't reach the phone.
fn sanitize_error(msg: &str) -> String {
    let first = msg.lines().next().unwrap_or(msg).trim();
    if first.chars().count() > 160 {
        let head: String = first.chars().take(159).collect();
        format!("{}…", head.trim_end())
    } else {
        first.to_string()
    }
}

/// One poll → (maybe execute) → complete cycle. Returns true if a command was
/// handled, false if the queue was empty.
pub async fn run_once(client: &Client, model: &str) -> Result<bool> {
    let polled: PollResponse = client
        .post_json("/api/v1/commands/poll", &PollRequest {})
        .await
        .context("poll command queue")?;
    let Some(cmd) = polled.command else {
        return Ok(false);
    };
    println!("[eri] remote {} goal: {}", cmd.kind, cmd.goal);

    // Route by turn kind: a recall is answered locally from the memory store (no
    // control gate, no actuation agent, $0 cloud tokens); everything else runs
    // the control stack and reports the tokens it spent.
    let outcome = if cmd.kind == "recall" {
        let (status, result, confirm_prompt) = remote_recall::run_recall(&cmd.goal, now_ms());
        CommandOutcome {
            status,
            result,
            confirm_prompt,
            usage: crate::control_turn::TokenUsage::default(),
        }
    } else {
        execute(&cmd.goal, model, cmd.approved).await
    };
    let status = outcome.status;
    let _: serde_json::Value = client
        .post_json(
            "/api/v1/commands/complete",
            &CompleteRequest {
                id: &cmd.id,
                status: outcome.status,
                result: outcome.result,
                confirm_prompt: outcome.confirm_prompt,
                tokens_in: outcome.usage.input,
                tokens_out: outcome.usage.output,
            },
        )
        .await
        .context("complete command")?;
    println!("[eri] remote goal {} → {status}", cmd.id);
    Ok(true)
}

/// Run a goal through the control stack. When `approved` (the user already said
/// go-ahead from their phone) it runs with auto-confirm — risky actions execute,
/// but sensitive-action REFUSALS and the app denylist still hold. Otherwise it's
/// the never-confirm remote gate that bounces risky actions back to the phone.
async fn execute(goal: &str, model: &str, approved: bool) -> CommandOutcome {
    // Load the store for its app DENYLIST, but build a REMOTE gate: a permission
    // granted at the keyboard does NOT auto-run a risky action unattended; every
    // risky action bounces to the phone (security C1). Once the user has
    // confirmed (`approved`), auto-confirm runs the goal they OK'd.
    let permissions = control_safety::PermissionStore::default_path()
        .map(|p| control_safety::PermissionStore::load(&p))
        .unwrap_or_default();
    let gate = if approved {
        control_agent::ControlGate::with_permissions(true, permissions)
    } else {
        control_agent::ControlGate::for_remote(permissions)
    };

    // Capture the first risky prompt to ask the user naturally on their phone;
    // always deny here (only consulted in the non-approved remote gate).
    let confirm_prompt = std::cell::RefCell::new(None::<String>);
    let mut confirm = |desc: &str, _perm: Option<control_safety::Permission>| -> bool {
        let mut slot = confirm_prompt.borrow_mut();
        if slot.is_none() {
            *slot = Some(format!(
                "Quick check before I do this — {desc}. Want me to go ahead? 🌿"
            ));
        }
        false
    };

    // Persist remote actions to the SAME trust trail as the local session, so
    // they show in `eri control --history`/`--undo` (security C2). Load first so
    // we append rather than overwrite the existing history.
    let log_path = action_log::default_log_path();
    let log = std::sync::Arc::new(std::sync::Mutex::new(
        log_path
            .as_ref()
            .map(|p| action_log::ActionLog::load(p))
            .unwrap_or_default(),
    ));
    let result = match control_agent::HttpBridge::from_env() {
        Some(inner) => {
            let bridge = control_agent::LoggingBridge::new(&inner, std::sync::Arc::clone(&log));
            let r = control_agent::run_control_agent(goal, model, &bridge, &gate, &mut confirm, 24)
                .await;
            if let Some(p) = &log_path
                && let Ok(l) = log.lock()
            {
                let _ = l.save(p);
            }
            r
        }
        None => {
            // No live actuation endpoint — report rather than silently no-op.
            return CommandOutcome::free(
                "error",
                Some("this computer isn't reachable for control (the eri app isn't running)".into()),
            );
        }
    };
    outcome(result, confirm_prompt.into_inner())
}

/// Daemon loop: poll on an interval until interrupted.
pub async fn serve(model: &str, interval: Duration) -> Result<()> {
    let creds = config::load()?;
    if !creds.is_signed_in() {
        anyhow::bail!("not signed in — run `eri auth login` first");
    }
    let client = Client::from_credentials(&creds)?;
    println!("[eri] remote control on: polling for goals from your phone… (Ctrl-C to stop)");
    loop {
        match run_once(&client, model).await {
            Ok(true) => {} // handled one — poll again immediately
            Ok(false) => tokio::time::sleep(interval).await,
            Err(e) => {
                eprintln!("[eri] remote poll error: {e:#}");
                tokio::time::sleep(interval).await;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::control_turn::TokenUsage;

    fn run(text: &str, input: u64, output: u64) -> control_agent::ControlRun {
        control_agent::ControlRun {
            text: text.into(),
            usage: TokenUsage { input, output },
        }
    }

    #[test]
    fn a_risky_goal_becomes_awaiting_confirm_even_if_the_run_returns_ok() {
        // Even parked at awaiting_confirm, the tokens already spent reaching the
        // risky action are reported so remote compute is still metered (M4).
        let o = outcome(
            Ok(run("partial", 120, 40)),
            Some("eri wants to: send an email".into()),
        );
        assert_eq!(o.status, "awaiting_confirm");
        assert!(o.result.is_none());
        assert_eq!(o.confirm_prompt.as_deref(), Some("eri wants to: send an email"));
        assert_eq!(o.usage, TokenUsage { input: 120, output: 40 });
    }

    #[test]
    fn a_clean_run_is_done_with_the_summary_and_its_tokens() {
        let o = outcome(Ok(run("opened Spotify", 200, 80)), None);
        assert_eq!(o.status, "done");
        assert_eq!(o.result.as_deref(), Some("opened Spotify"));
        assert!(o.confirm_prompt.is_none());
        assert_eq!(o.usage, TokenUsage { input: 200, output: 80 });
    }

    #[test]
    fn a_failed_run_is_error_with_the_reason_and_zero_tokens() {
        let o = outcome(Err(anyhow::anyhow!("app not found")), None);
        assert_eq!(o.status, "error");
        assert!(o.result.unwrap().contains("app not found"));
        assert!(o.confirm_prompt.is_none());
        assert_eq!(o.usage, TokenUsage::default());
    }
}
