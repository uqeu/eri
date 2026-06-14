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
}

/// Map a control run's result + whether a confirmation was needed onto the queue
/// status + payload. A risky action (confirm requested) ALWAYS becomes
/// `awaiting_confirm` — never reported as `done`. Pure + unit-tested.
fn outcome(
    result: Result<String>,
    confirm_prompt: Option<String>,
) -> (&'static str, Option<String>, Option<String>) {
    if let Some(prompt) = confirm_prompt {
        return ("awaiting_confirm", None, Some(prompt));
    }
    match result {
        Ok(summary) => ("done", Some(summary), None),
        // Cap the error so an internal detail (paths, endpoint dumps) can't be
        // relayed verbatim to the user's phone (review L3).
        Err(e) => ("error", Some(sanitize_error(&e.to_string())), None),
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
    // control gate, no actuation agent); everything else runs the control stack.
    let (status, result, confirm_prompt) = if cmd.kind == "recall" {
        remote_recall::run_recall(&cmd.goal, now_ms())
    } else {
        execute(&cmd.goal, model, cmd.approved).await
    };
    let _: serde_json::Value = client
        .post_json(
            "/api/v1/commands/complete",
            &CompleteRequest {
                id: &cmd.id,
                status,
                result,
                confirm_prompt,
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
async fn execute(
    goal: &str,
    model: &str,
    approved: bool,
) -> (&'static str, Option<String>, Option<String>) {
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
            return (
                "error",
                Some(
                    "this computer isn't reachable for control (the eri app isn't running)".into(),
                ),
                None,
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

    #[test]
    fn a_risky_goal_becomes_awaiting_confirm_even_if_the_run_returns_ok() {
        let (status, result, prompt) = outcome(
            Ok("partial".into()),
            Some("eri wants to: send an email".into()),
        );
        assert_eq!(status, "awaiting_confirm");
        assert!(result.is_none());
        assert_eq!(prompt.as_deref(), Some("eri wants to: send an email"));
    }

    #[test]
    fn a_clean_run_is_done_with_the_summary() {
        let (status, result, prompt) = outcome(Ok("opened Spotify".into()), None);
        assert_eq!(status, "done");
        assert_eq!(result.as_deref(), Some("opened Spotify"));
        assert!(prompt.is_none());
    }

    #[test]
    fn a_failed_run_is_error_with_the_reason() {
        let (status, result, prompt) = outcome(Err(anyhow::anyhow!("app not found")), None);
        assert_eq!(status, "error");
        assert!(result.unwrap().contains("app not found"));
        assert!(prompt.is_none());
    }
}
