//! Connect to every MCP server configured under the current directory
//! (`<cwd>/.eri/mcp.json`) plus `~/.eri/mcp.json` and print their tools.
//! Drives the JSON-RPC handshake end-to-end so a user can sanity-check
//! their config without booting the IDE.

use std::time::Duration;

use eri_mcp::{ConnectionState, Mcp, McpError};

#[tokio::main]
async fn main() -> Result<(), McpError> {
    tracing_subscriber_init();
    let workspace = std::env::current_dir().expect("cwd");
    let mcp = Mcp::load(&workspace).await?;

    // Connections come up asynchronously — wait briefly for the handshake
    // before listing tools, otherwise we'll print an empty catalog.
    for _ in 0..20 {
        tokio::time::sleep(Duration::from_millis(250)).await;
        let servers = mcp.servers().await;
        if servers.is_empty() {
            break;
        }
        if servers.iter().all(|s| {
            matches!(
                s.state,
                ConnectionState::Ready | ConnectionState::Failed | ConnectionState::Backoff(_)
            )
        }) {
            break;
        }
    }
    mcp.refresh().await;

    let servers = mcp.servers().await;
    if servers.is_empty() {
        println!(
            "No MCP servers configured. Add one to <workspace>/.eri/mcp.json or ~/.eri/mcp.json."
        );
        return Ok(());
    }

    for status in &servers {
        println!("=== {} [{}] ===", status.name, status.state);
        if let Some(err) = &status.last_error {
            println!("  last_error: {err}");
        }
    }

    let tools = mcp.tools().await;
    if tools.is_empty() {
        println!("\n(no tools advertised)");
    } else {
        println!("\nTools:");
        for tool in tools {
            println!("  - {}: {}", tool.qualified_name(), tool.description);
        }
    }

    mcp.shutdown().await?;
    Ok(())
}

/// Optional: print warnings to stderr when run via `cargo run --example`.
/// Kept inline so the example doesn't pull in `tracing-subscriber` as a
/// crate dependency.
fn tracing_subscriber_init() {
    // No-op: callers can set RUST_LOG and we'll let the parent app pick up
    // the env. The example doesn't need a subscriber to work.
}
