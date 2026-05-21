//! Launch every MCP server configured in `~/.eri/mcp.json` and print the tools
//! they advertise. Drives the JSON-RPC handshake end-to-end so the user can
//! sanity-check their config without touching the eri UI.

use eri_mcp::{McpClient, McpError, load_user_config};

fn main() -> Result<(), McpError> {
    let servers = load_user_config()?;
    if servers.is_empty() {
        println!(
            "No MCP servers configured. Edit ~/.eri/mcp.json to add one (the file should already \
             exist with commented-out examples)."
        );
        return Ok(());
    }

    for config in &servers {
        println!("=== {} ({}) ===", config.name, config.command);
        match McpClient::launch(config) {
            Ok(mut client) => match client.list_tools() {
                Ok(tools) => {
                    if tools.is_empty() {
                        println!("  (no tools)");
                    } else {
                        for tool in &tools {
                            println!("  - {}: {}", tool.name, tool.description);
                        }
                    }
                    client.shutdown();
                }
                Err(error) => {
                    eprintln!("  list_tools failed: {error}");
                    client.shutdown();
                }
            },
            Err(error) => {
                eprintln!("  launch failed: {error}");
            }
        }
    }
    Ok(())
}
