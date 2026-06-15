//! `eri composio` — connect the user's apps through Composio (phone-eri
//! connector layer, ADR-0002).
//!
//! The Composio MCP server is **built in** to eri (`eri_mcp::config::builtin_servers`),
//! so there's nothing to set up: once `COMPOSIO_API_KEY` is present (plus a
//! signed-in user) eri mints a per-user Tool Router session at launch and the
//! pool connects to it automatically. These commands
//! are just the connect flow on top of that:
//!   - `eri composio connect <toolkit>` starts a connection and opens Composio's
//!     hosted authorize page.
//!   - `eri composio apps` lists which toolkits are connected / pending.
//!
//! The cloud routes (`/api/composio/connect`, `/api/composio/status`) hold the
//! Composio API key and do the SDK calls; this is the user's bearer-authed client.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use crate::client::Client;
use crate::config;

#[derive(Serialize)]
struct ConnectBody<'a> {
    toolkit: &'a str,
}

#[derive(Deserialize)]
struct ConnectResponse {
    #[serde(rename = "redirectUrl")]
    redirect_url: Option<String>,
}

#[derive(Deserialize)]
struct Connection {
    toolkit: String,
    status: String,
}

#[derive(Deserialize)]
struct StatusResponse {
    connections: Vec<Connection>,
}

/// `eri composio connect <toolkit>` — start a connection + open the authorize page.
pub async fn connect(toolkit: &str) -> Result<()> {
    let toolkit = toolkit.trim().to_lowercase();
    if toolkit.is_empty() {
        anyhow::bail!("usage: eri composio connect <toolkit>  (e.g. gmail)");
    }
    let creds = config::load()?;
    let client = Client::from_credentials(&creds)?;
    let resp: ConnectResponse = client
        .post_json("/api/composio/connect", &ConnectBody { toolkit: &toolkit })
        .await
        .context("start Composio connection")?;
    let Some(url) = resp.redirect_url else {
        anyhow::bail!("Composio didn't return an authorize link — is the toolkit enabled?");
    };
    println!("Open this link to connect {toolkit} (log in to your own account):\n  {url}");
    // Best-effort: pop it open on macOS. Printing is the source of truth.
    let _ = std::process::Command::new("open").arg(&url).status();
    Ok(())
}

/// `eri composio apps` — list connected / pending toolkits.
pub async fn apps() -> Result<()> {
    let creds = config::load()?;
    let client = Client::from_credentials(&creds)?;
    let resp: StatusResponse = client
        .get_json("/api/composio/status")
        .await
        .context("list Composio connections")?;
    if resp.connections.is_empty() {
        println!("No apps connected yet. Connect one with: eri composio connect <toolkit>");
        return Ok(());
    }
    println!("Connected apps:");
    for c in resp.connections {
        let mark = match c.status.as_str() {
            "active" => "✓",
            "pending" => "…",
            _ => "✗",
        };
        println!("  {mark} {} ({})", c.toolkit, c.status);
    }
    Ok(())
}
