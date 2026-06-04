//! `eri memory recall` / `eri memory remember` / `eri memory forget`.
//!
//! Calls the eri.dev memory API, which is the same store the IDE syncs
//! into via `/api/v1/memory/*`. Bearer-authenticated so each user's
//! observations stay scoped.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use crate::client::Client;
use crate::config;

#[derive(Debug, Serialize)]
struct RecallBody<'a> {
    query: &'a str,
    limit: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Observation {
    id: String,
    kind: String,
    body: String,
    #[serde(default)]
    ts_ms: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct RecallResponse {
    results: Vec<Observation>,
}

#[derive(Debug, Serialize)]
struct RememberBody<'a> {
    text: &'a str,
}

#[derive(Debug, Serialize)]
struct ForgetBody<'a> {
    target: &'a str,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OkResponse {
    ok: bool,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    removed: Option<usize>,
}

pub async fn recall(query: &str, limit: usize) -> Result<()> {
    let client = require_client()?;
    let response: RecallResponse = client
        .post_json(
            "/api/v1/memory/recall",
            &RecallBody {
                query,
                limit: limit.max(1).min(100),
            },
        )
        .await
        .context("recall request")?;
    if response.results.is_empty() {
        println!("No observations match `{query}`.");
        return Ok(());
    }
    println!(
        "{} observation{}:",
        response.results.len(),
        if response.results.len() == 1 { "" } else { "s" }
    );
    for o in response.results {
        let body = o.body.lines().next().unwrap_or("");
        println!("- [{}] {body}  ({})", o.kind, o.id);
    }
    Ok(())
}

pub async fn remember(text: &str) -> Result<()> {
    let text = text.trim();
    if text.is_empty() {
        anyhow::bail!("remember text must be non-empty");
    }
    let client = require_client()?;
    let response: OkResponse = client
        .post_json("/api/v1/memory/remember", &RememberBody { text })
        .await
        .context("remember request")?;
    if !response.ok {
        anyhow::bail!("remember failed");
    }
    println!("Remembered ({}).", response.id.as_deref().unwrap_or("ok"));
    Ok(())
}

pub async fn forget(target: &str) -> Result<()> {
    let target = target.trim();
    if target.is_empty() {
        anyhow::bail!("forget needs an observation id or `all`");
    }
    let client = require_client()?;
    let response: OkResponse = client
        .post_json("/api/v1/memory/forget", &ForgetBody { target })
        .await
        .context("forget request")?;
    if !response.ok {
        anyhow::bail!("forget failed");
    }
    let removed = response.removed.unwrap_or(0);
    println!(
        "Forgot {removed} observation{}.",
        if removed == 1 { "" } else { "s" }
    );
    Ok(())
}

fn require_client() -> Result<Client> {
    let creds = config::load()?;
    if !creds.is_signed_in() {
        anyhow::bail!("not signed in — run `eri auth login` first");
    }
    Client::from_credentials(&creds)
}
