//! Model Context Protocol (MCP) client for eri.
//!
//! eri talks to user-configured MCP servers so the agent can call
//! community tools (Linear, GitHub, filesystem, browser, ...) the same way
//! Cursor and Claude Desktop do. Spec: <https://spec.modelcontextprotocol.io/>.
//!
//! Surface:
//!
//! ```ignore
//! let mcp = eri_mcp::Mcp::load(workspace).await?;
//! for tool in mcp.tools().await {
//!     println!("{}::{}: {}", tool.server, tool.name, tool.description);
//! }
//! let result = mcp.call_tool(&tool_handle, args).await?;
//! mcp.shutdown().await?;
//! ```
//!
//! Module map:
//!   - [`config`] — `<workspace>/.eri/mcp.json` + `~/.eri/mcp.json` loader
//!   - [`protocol`] — JSON-RPC 2.0 envelope + MCP message types
//!   - [`transport`] — `Transport` trait + stdio and streamable-HTTP impls
//!   - [`client`] — per-server connection: lifecycle, ping, reconnect
//!
//! Why hand-rolled: there is no widely-adopted Rust MCP SDK at the time of
//! writing — the few crates that exist wrap JS or pin to outdated protocol
//! revisions. The slice of the spec a host needs (initialize, tools/list,
//! tools/call, resources/list, resources/read, ping) is small enough to
//! own, and the JSON-RPC layer is shared across every MCP transport.

#![allow(clippy::redundant_field_names)]

pub mod client;
pub mod config;
pub mod error;
pub mod protocol;
pub mod transport;

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Arc;

use serde_json::Value;
use tokio::sync::RwLock;

pub use client::{ConnectionState, ServerStatus};
pub use config::{ServerConfig, TransportKind};
pub use error::McpError;
pub use protocol::{
    CallToolResult, ContentBlock, ListResourcesResult, ListToolsResult, ReadResourceResult,
    ResourceContentBlock, ResourceDefinition, ToolDefinition,
};

use client::Connection;

/// Serializes tests that mutate the process-global `HOME` env var (to point the
/// global-config lookup at a tempdir). Cargo runs tests in this crate's binary
/// in parallel; without this lock a `HOME`-setting test in one module races a
/// `load()` in another. Every test that sets `HOME` must hold this for its
/// duration. Poison-tolerant via `into_inner()` at the call sites.
#[cfg(test)]
pub(crate) static HOME_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Separator used to namespace MCP handles. The IDE renders tools as
/// `<server>__<tool>` so the same name uniquely identifies an entry across
/// every configured server.
pub const NAMESPACE_SEPARATOR: &str = "__";

/// Handle to one tool advertised by one connected MCP server. Carries the
/// schema so a model-side payload builder can splat it into a tools array
/// without re-issuing `tools/list`.
#[derive(Debug, Clone)]
pub struct ToolHandle {
    pub server: String,
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

impl ToolHandle {
    /// `<server>__<tool>` — what model-facing payloads see.
    pub fn qualified_name(&self) -> String {
        format!("{}{}{}", self.server, NAMESPACE_SEPARATOR, self.name)
    }
}

/// Handle to one resource advertised by one connected MCP server.
#[derive(Debug, Clone)]
pub struct ResourceHandle {
    pub server: String,
    pub uri: String,
    pub name: String,
    pub description: String,
    pub mime_type: Option<String>,
}

/// Result of a tool call — content blocks plus an `is_error` flag the
/// server uses to signal tool-level failures (vs transport JSON-RPC errors,
/// which surface as `Err(McpError::ServerError)`).
#[derive(Debug, Clone)]
pub struct ToolResult {
    pub content: Vec<ContentBlock>,
    pub is_error: bool,
}

impl From<CallToolResult> for ToolResult {
    fn from(value: CallToolResult) -> Self {
        Self {
            content: value.content,
            is_error: value.is_error,
        }
    }
}

/// Result of reading a resource.
#[derive(Debug, Clone)]
pub struct ResourceContent {
    pub contents: Vec<ResourceContentBlock>,
}

impl From<ReadResourceResult> for ResourceContent {
    fn from(value: ReadResourceResult) -> Self {
        Self {
            contents: value.contents,
        }
    }
}

/// Top-level MCP host. Holds one `Connection` per configured (and enabled)
/// server. The catalog (`tools`, `resources`) is refreshed eagerly after
/// each server reaches `Ready`; callers may also call [`Mcp::refresh`] to
/// re-poll after a server fires a `list_changed` notification.
pub struct Mcp {
    connections: Vec<Arc<Connection>>,
    catalog: Arc<RwLock<Catalog>>,
}

#[derive(Default, Clone)]
struct Catalog {
    tools: Vec<ToolHandle>,
    resources: Vec<ResourceHandle>,
}

impl Mcp {
    /// Load configs from `<workspace>/.eri/mcp.json` (project) and
    /// `~/.eri/mcp.json` (global), then spawn one `Connection` per enabled
    /// server. Returns immediately — connections come up in the background
    /// and the catalog populates as each handshake completes. Polling
    /// [`Mcp::servers`] returns live state.
    pub async fn load(workspace: &Path) -> Result<Self, McpError> {
        Self::load_with_vars(workspace, &BTreeMap::new()).await
    }

    /// Like [`load`](Self::load), but expands `${VAR}` placeholders in each
    /// server's config (url/headers/env/args/command) against `vars` first, then
    /// the process environment ([`ServerConfig::expand`]). This is how per-user
    /// remote MCPs (Composio) get their `ERI_USER_ID` + secrets at connect time
    /// without those ever living on disk.
    ///
    /// A server whose placeholders can't all resolve (a missing secret, or no
    /// per-user id supplied) is **skipped** — fail-closed: we never open a
    /// connection that would send a literal `${COMPOSIO_API_KEY}`. The rest of
    /// the pool still comes up.
    pub async fn load_with_vars(
        workspace: &Path,
        vars: &BTreeMap<String, String>,
    ) -> Result<Self, McpError> {
        let all = config::load(workspace)?;
        let active = config::active_servers(&all);

        let mut connections = Vec::with_capacity(active.len());
        for server in active {
            match server.expand(vars) {
                Ok(resolved) => connections.push(Connection::open(resolved).await),
                Err(err) => {
                    // Unresolved placeholders → skip, don't crash the pool. Surface
                    // it under debug so a misconfigured server isn't silent.
                    if std::env::var("ERI_DEBUG").is_ok() {
                        eprintln!("eri-mcp: skipping server with unresolved config: {err}");
                    }
                }
            }
        }

        let catalog = Arc::new(RwLock::new(Catalog::default()));

        // Kick off a background refresher that polls catalog data as each
        // connection becomes ready. It re-runs whenever a connection
        // transitions in/out of Ready (we poll because list_changed
        // notifications are optional per spec).
        let refresher_conns = connections.clone();
        let refresher_catalog = catalog.clone();
        tokio::spawn(async move {
            refresh_loop(refresher_conns, refresher_catalog).await;
        });

        Ok(Self {
            connections,
            catalog,
        })
    }

    /// Snapshot of every configured server's current state. Cheap; reads
    /// from per-connection status fields.
    pub async fn servers(&self) -> Vec<ServerStatus> {
        let mut out = Vec::with_capacity(self.connections.len());
        for conn in &self.connections {
            out.push(conn.status().await);
        }
        out
    }

    /// Flat view of every tool exposed across every connected server.
    /// Stable order: per-connection insertion order, then per-tool order
    /// as the server reports it.
    pub async fn tools(&self) -> Vec<ToolHandle> {
        self.catalog.read().await.tools.clone()
    }

    pub async fn resources(&self) -> Vec<ResourceHandle> {
        self.catalog.read().await.resources.clone()
    }

    /// Force a fresh `tools/list` and `resources/list` poll across every
    /// connected server. Useful after the user edits an `mcp.json` and
    /// reloads, or when a server explicitly signaled list-changed.
    pub async fn refresh(&self) {
        refresh_once(&self.connections, &self.catalog).await;
    }

    /// Invoke a tool by handle. The handle's `server` and `name` are passed
    /// through to that server's `tools/call`.
    pub async fn call_tool(
        &self,
        handle: &ToolHandle,
        args: Value,
    ) -> Result<ToolResult, McpError> {
        let conn = self.find_connection(&handle.server)?;
        let raw = conn.call_tool(&handle.name, args).await?;
        Ok(raw.into())
    }

    /// Read a resource by handle.
    pub async fn read_resource(
        &self,
        handle: &ResourceHandle,
    ) -> Result<ResourceContent, McpError> {
        let conn = self.find_connection(&handle.server)?;
        let raw = conn.read_resource(&handle.uri).await?;
        Ok(raw.into())
    }

    fn find_connection(&self, server: &str) -> Result<Arc<Connection>, McpError> {
        self.connections
            .iter()
            .find(|c| c.name() == server)
            .cloned()
            .ok_or_else(|| McpError::UnknownHandle(server.to_string()))
    }

    /// Shut down every connection. Best-effort: errors are logged but the
    /// shutdown sequence runs to completion regardless.
    pub async fn shutdown(self) -> Result<(), McpError> {
        for conn in &self.connections {
            conn.shutdown().await;
        }
        Ok(())
    }
}

impl std::fmt::Debug for Mcp {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Mcp")
            .field("server_count", &self.connections.len())
            .finish()
    }
}

/// Polls catalog data from every Ready connection every few seconds. The
/// loop is cheap (only fires `tools/list` when servers are Ready) and
/// exits when all `Arc`s on `connections` are dropped — i.e. when the
/// parent `Mcp` is dropped after `shutdown`.
async fn refresh_loop(connections: Vec<Arc<Connection>>, catalog: Arc<RwLock<Catalog>>) {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(5));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        interval.tick().await;
        if Arc::strong_count(&catalog) == 1 {
            // The parent Mcp has been dropped — nothing left to update.
            return;
        }
        refresh_once(&connections, &catalog).await;
    }
}

async fn refresh_once(connections: &[Arc<Connection>], catalog: &Arc<RwLock<Catalog>>) {
    let mut tools: Vec<ToolHandle> = Vec::new();
    let mut resources: Vec<ResourceHandle> = Vec::new();

    for conn in connections {
        let status = conn.status().await;
        if status.state != ConnectionState::Ready {
            continue;
        }
        match conn.list_tools().await {
            Ok(list) => {
                for tool in list.tools {
                    tools.push(ToolHandle {
                        server: conn.name().to_string(),
                        name: tool.name,
                        description: tool.description,
                        input_schema: tool.input_schema,
                    });
                }
            }
            Err(error) => {
                tracing::warn!(
                    target: "eri_mcp",
                    server = %conn.name(),
                    ?error,
                    "tools/list failed; skipping this server's tools for this refresh"
                );
            }
        }
        match conn.list_resources().await {
            Ok(list) => {
                for resource in list.resources {
                    resources.push(ResourceHandle {
                        server: conn.name().to_string(),
                        uri: resource.uri,
                        name: resource.name,
                        description: resource.description,
                        mime_type: resource.mime_type,
                    });
                }
            }
            Err(error) => {
                // Not every server implements resources; treat list errors
                // as "no resources" rather than logging them at WARN.
                tracing::debug!(
                    target: "eri_mcp",
                    server = %conn.name(),
                    ?error,
                    "resources/list unavailable for this server"
                );
            }
        }
    }

    let mut guard = catalog.write().await;
    guard.tools = tools;
    guard.resources = resources;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_handle_qualified_name_uses_double_underscore_separator() {
        let h = ToolHandle {
            server: "github".into(),
            name: "create_issue".into(),
            description: String::new(),
            input_schema: serde_json::json!({}),
        };
        assert_eq!(h.qualified_name(), "github__create_issue");
    }

    // The HOME_ENV_LOCK guard MUST live across the awaits below: HOME is set
    // for the whole async load (which reads it), so the lock can't be dropped
    // early without un-serializing the env mutation against sibling tests.
    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn mcp_load_with_no_config_returns_empty_state() {
        // Serialize with other HOME-mutating tests in this binary.
        let _env = HOME_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        // Point HOME to a fresh dir with no .eri/ so the global lookup is
        // a clean miss; we don't want to read the developer's real config.
        let dir = tempfile::tempdir().unwrap();
        let prev_home = std::env::var_os("HOME");
        unsafe {
            std::env::set_var("HOME", dir.path());
        }
        let mcp = Mcp::load(dir.path()).await.expect("loads cleanly");
        assert!(mcp.servers().await.is_empty());
        assert!(mcp.tools().await.is_empty());
        assert!(mcp.resources().await.is_empty());
        mcp.shutdown().await.unwrap();
        unsafe {
            match prev_home {
                Some(v) => std::env::set_var("HOME", v),
                None => std::env::remove_var("HOME"),
            }
        }
    }

    // A remote server whose ${VAR}s can't resolve is skipped (fail-closed), never
    // connected with a literal placeholder. Uses only an unresolvable server, so
    // no real Connection::open / network happens.
    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn load_with_vars_skips_servers_with_unresolved_placeholders() {
        let _env = HOME_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let dir = tempfile::tempdir().unwrap();
        let eri_dir = dir.path().join(".eri");
        std::fs::create_dir_all(&eri_dir).unwrap();
        std::fs::write(
            eri_dir.join("mcp.json"),
            r#"{"mcpServers":{"composio":{"url":"https://x/${NEVER_SET_VAR}","transport":"http"}}}"#,
        )
        .unwrap();
        let prev_home = std::env::var_os("HOME");
        unsafe {
            std::env::set_var("HOME", dir.path());
        }
        // Empty vars + (unset) env → the one server can't expand → skipped.
        let mcp = Mcp::load_with_vars(dir.path(), &BTreeMap::new())
            .await
            .expect("loads cleanly");
        assert!(
            mcp.servers().await.is_empty(),
            "an unresolvable server must be skipped, not connected"
        );
        mcp.shutdown().await.unwrap();
        unsafe {
            match prev_home {
                Some(v) => std::env::set_var("HOME", v),
                None => std::env::remove_var("HOME"),
            }
        }
    }
}
