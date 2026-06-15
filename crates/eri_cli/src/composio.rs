//! `eri composio` — connect the user's apps through Composio and wire the
//! computer to call them (phone-eri connector layer, ADR-0002).
//!
//! Three pieces:
//!   - `eri composio setup` writes the single Composio MCP server into
//!     `~/.eri/mcp.json` (idempotent). The url + api key + per-user id are
//!     `${VAR}` placeholders the pool resolves at launch (the `${VAR}` keystone),
//!     so no secret is written to disk.
//!   - `eri composio connect <toolkit>` asks the cloud to start a connection and
//!     opens Composio's hosted authorize page; it also runs `setup` so the tools
//!     are reachable once authorized.
//!   - `eri composio apps` lists which toolkits are connected / pending.
//!
//! The cloud routes (`/api/composio/connect`, `/api/composio/status`) hold the
//! Composio API key and do the SDK calls; this CLI is the user's bearer-authed
//! client + the local mcp.json wiring.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::client::Client;
use crate::config;

/// The Composio MCP server entry written into `~/.eri/mcp.json`. Every secret /
/// per-user value is a `${VAR}` the pool expands at connect time — the api key
/// from the process env, the user id injected by `mcp_vars()`. Nothing sensitive
/// touches disk.
fn composio_entry() -> Value {
    json!({
        "url": "https://backend.composio.dev/v3/mcp/${COMPOSIO_MCP_SERVER_ID}?user_id=${ERI_USER_ID}",
        "transport": "http",
        "headers": { "x-api-key": "${COMPOSIO_API_KEY}" }
    })
}

/// Ensure an `mcp.json` (the raw file contents, or `None` for a fresh file) has
/// the `composio` server under `mcpServers`, preserving every other server +
/// field. Returns the new file contents. Pure + tested — the idempotent core.
pub fn ensure_composio_entry(existing: Option<&str>) -> Result<String> {
    let mut root: Value = match existing {
        Some(raw) if !raw.trim().is_empty() => {
            serde_json::from_str(raw).context("existing mcp.json is not valid JSON")?
        }
        _ => json!({}),
    };
    if !root.is_object() {
        anyhow::bail!("mcp.json root is not an object");
    }
    let obj = root.as_object_mut().unwrap();
    let servers = obj
        .entry("mcpServers")
        .or_insert_with(|| json!({}));
    if !servers.is_object() {
        anyhow::bail!("mcp.json `mcpServers` is not an object");
    }
    servers
        .as_object_mut()
        .unwrap()
        .insert("composio".to_string(), composio_entry());
    serde_json::to_string_pretty(&root).context("serialize mcp.json")
}

/// `eri composio setup` — write/refresh the Composio MCP entry in `~/.eri/mcp.json`.
pub fn setup() -> Result<()> {
    let path = eri_mcp::config::global_path()
        .context("could not resolve ~/.eri/mcp.json (no HOME?)")?;
    let existing = std::fs::read_to_string(&path).ok();
    let updated = ensure_composio_entry(existing.as_deref())?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    std::fs::write(&path, updated).with_context(|| format!("write {}", path.display()))?;
    println!(
        "✓ Composio wired into {}. Set COMPOSIO_API_KEY + COMPOSIO_MCP_SERVER_ID in your environment.",
        path.display()
    );
    Ok(())
}

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

/// `eri composio connect <toolkit>` — start a connection + open the authorize
/// page, and make sure the local mcp wiring is in place.
pub async fn connect(toolkit: &str) -> Result<()> {
    let toolkit = toolkit.trim().to_lowercase();
    if toolkit.is_empty() {
        anyhow::bail!("usage: eri composio connect <toolkit>  (e.g. gmail)");
    }
    setup()?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ensure_adds_composio_to_a_fresh_file() {
        let out = ensure_composio_entry(None).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert!(v["mcpServers"]["composio"]["url"].as_str().unwrap().contains("${ERI_USER_ID}"));
        assert_eq!(
            v["mcpServers"]["composio"]["headers"]["x-api-key"],
            json!("${COMPOSIO_API_KEY}")
        );
    }

    #[test]
    fn ensure_preserves_other_servers_and_is_idempotent() {
        let existing = r#"{"mcpServers":{"github":{"url":"https://mcp.github.com"}}}"#;
        let once = ensure_composio_entry(Some(existing)).unwrap();
        let v: Value = serde_json::from_str(&once).unwrap();
        // The pre-existing server is untouched; composio is added.
        assert_eq!(v["mcpServers"]["github"]["url"], json!("https://mcp.github.com"));
        assert!(v["mcpServers"]["composio"].is_object());
        // Running again is a no-op (same result).
        let twice = ensure_composio_entry(Some(&once)).unwrap();
        assert_eq!(once, twice);
    }

    #[test]
    fn ensure_rejects_a_malformed_file() {
        assert!(ensure_composio_entry(Some("{not json")).is_err());
    }
}
