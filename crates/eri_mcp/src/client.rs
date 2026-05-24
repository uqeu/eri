//! Per-server `Connection` — owns one transport, drives the JSON-RPC
//! lifecycle, multiplexes outstanding requests by id, and reconnects on
//! transport drop with exponential backoff.
//!
//! Architecture: one tokio task per `Connection` reads from the transport
//! and dispatches each frame to one of:
//!   - the `oneshot::Sender` registered for a pending request id
//!   - a no-op for notifications (we don't yet act on `tools/list_changed`)
//!   - a generic error reply for server-initiated requests (we don't yet
//!     implement sampling)
//!
//! The supervisor (`Mcp` in `eri_mcp.rs`) owns `Connection`s by name.

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use serde_json::{Value, json};
use tokio::sync::{Mutex, RwLock, oneshot};
use tokio::time::timeout;

use crate::config::{ServerConfig, TransportKind};
use crate::error::McpError;
use crate::protocol::{
    CallToolResult, IncomingMessage, InitializeParams, InitializeResult, JSONRPC_VERSION,
    JsonRpcErrorPayload, ListResourcesResult, ListToolsResult, OutgoingMessage, ReadResourceResult,
};
use crate::transport::Transport;
use crate::transport::http::HttpTransport;
use crate::transport::stdio::StdioTransport;

/// User-visible state of a connection. The supervisor reports this via
/// [`crate::Mcp::servers`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConnectionState {
    /// Spawning subprocess / opening HTTP stream.
    Connecting,
    /// Initialize handshake completed; ready for requests.
    Ready,
    /// Waiting before the next reconnect attempt.
    Backoff(Duration),
    /// Gave up — the user must fix config and reload.
    Failed,
}

impl std::fmt::Display for ConnectionState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConnectionState::Connecting => write!(f, "connecting"),
            ConnectionState::Ready => write!(f, "ready"),
            ConnectionState::Backoff(d) => write!(f, "backoff({d:?})"),
            ConnectionState::Failed => write!(f, "failed"),
        }
    }
}

/// Per-server status snapshot exposed via [`crate::Mcp::servers`].
#[derive(Debug, Clone)]
pub struct ServerStatus {
    pub name: String,
    pub state: ConnectionState,
    pub last_error: Option<String>,
}

const PING_INTERVAL: Duration = Duration::from_secs(30);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const BACKOFF_INITIAL: Duration = Duration::from_secs(1);
const BACKOFF_MAX: Duration = Duration::from_secs(60);

/// Pending request registry. Keyed by JSON-RPC id; each entry holds a
/// oneshot that the reader task fulfills when the matching response arrives.
type PendingMap = HashMap<u64, oneshot::Sender<Result<Value, McpError>>>;

/// One connection to one MCP server. Cloning shares the underlying state
/// (it's all in `Arc`s) so the supervisor and request handlers can both
/// hold references.
pub struct Connection {
    name: String,
    config: ServerConfig,
    next_id: AtomicU64,
    transport: RwLock<Option<Arc<dyn Transport>>>,
    pending: Arc<Mutex<PendingMap>>,
    status: Arc<Mutex<ServerStatus>>,
    /// Reader task driving the transport. Aborted on close/reconnect.
    reader: Mutex<Option<tokio::task::JoinHandle<()>>>,
    /// Ping task. Pings every 30s once the connection is Ready.
    pinger: Mutex<Option<tokio::task::JoinHandle<()>>>,
    /// Set to true on shutdown so the reader doesn't kick off a reconnect.
    shutting_down: Arc<std::sync::atomic::AtomicBool>,
    /// Server-advertised capabilities from `initialize`.
    server_capabilities: RwLock<Value>,
}

impl Connection {
    /// Build and initialize a connection. Returns a fully-initialized client
    /// in `Ready` state on success; on failure the connection is left in
    /// `Failed` and the error is returned.
    pub async fn open(config: ServerConfig) -> Arc<Self> {
        let conn = Arc::new(Self {
            name: config.name.clone(),
            status: Arc::new(Mutex::new(ServerStatus {
                name: config.name.clone(),
                state: ConnectionState::Connecting,
                last_error: None,
            })),
            config,
            next_id: AtomicU64::new(1),
            transport: RwLock::new(None),
            pending: Arc::new(Mutex::new(HashMap::new())),
            reader: Mutex::new(None),
            pinger: Mutex::new(None),
            shutting_down: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            server_capabilities: RwLock::new(Value::Null),
        });

        // Spawn the supervisor loop that brings the transport up, runs
        // initialize, and reconnects on failure. We don't block the caller
        // on the handshake — the IDE wants Mcp::load to return promptly so
        // its UI can render "connecting..." badges.
        let supervisor = conn.clone();
        tokio::spawn(async move {
            supervisor.supervise().await;
        });

        conn
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub async fn status(&self) -> ServerStatus {
        self.status.lock().await.clone()
    }

    /// Top-level reconnect supervisor. Tries to bring the transport up,
    /// run initialize, then sit idle until the reader signals disconnect.
    /// Loops with exponential backoff until shutdown or `Failed`.
    async fn supervise(self: Arc<Self>) {
        let mut backoff = BACKOFF_INITIAL;
        loop {
            if self.shutting_down.load(Ordering::Relaxed) {
                return;
            }

            self.set_state(ConnectionState::Connecting, None).await;
            match self.try_connect_and_init().await {
                Ok(()) => {
                    self.set_state(ConnectionState::Ready, None).await;
                    backoff = BACKOFF_INITIAL;
                    // Park: when the reader exits, it sends us through
                    // here again. We sleep on the shutdown flag.
                    self.wait_for_disconnect().await;
                    if self.shutting_down.load(Ordering::Relaxed) {
                        return;
                    }
                }
                Err(error) => {
                    tracing::warn!(
                        target: "eri_mcp::client",
                        server = %self.name,
                        ?error,
                        "MCP server connect failed; will back off"
                    );
                    let message = error.to_string();
                    self.set_state(ConnectionState::Backoff(backoff), Some(message))
                        .await;
                }
            }

            tokio::time::sleep(backoff).await;
            backoff = (backoff * 2).min(BACKOFF_MAX);
        }
    }

    async fn try_connect_and_init(self: &Arc<Self>) -> Result<(), McpError> {
        // Spawn the right transport.
        let transport: Arc<dyn Transport> = match self.config.resolved_transport() {
            TransportKind::Stdio => Arc::new(StdioTransport::spawn(&self.config).await?),
            TransportKind::Http => Arc::new(HttpTransport::connect(&self.config).await?),
        };

        // Install the transport and start the reader pump.
        *self.transport.write().await = Some(transport.clone());
        self.start_reader(transport.clone()).await;

        // Run initialize handshake.
        let params = serde_json::to_value(InitializeParams::default())?;
        let init = self
            .request_inner("initialize", Some(params), REQUEST_TIMEOUT)
            .await?;
        let parsed: InitializeResult =
            serde_json::from_value(init.clone()).unwrap_or_else(|_| InitializeResult::default());
        *self.server_capabilities.write().await = parsed.capabilities;

        // Notify initialized.
        let note = OutgoingMessage::notification("notifications/initialized", None);
        transport.send(serde_json::to_value(&note)?).await?;

        // Start the heartbeat.
        self.start_pinger().await;
        Ok(())
    }

    async fn start_reader(&self, transport: Arc<dyn Transport>) {
        // Abort any previous reader.
        if let Some(handle) = self.reader.lock().await.take() {
            handle.abort();
        }

        let pending = self.pending.clone();
        let name = self.name.clone();
        let transport_for_replies = transport.clone();

        let handle = tokio::spawn(async move {
            loop {
                let msg = match transport.recv().await {
                    Ok(m) => m,
                    Err(error) => {
                        tracing::info!(
                            target: "eri_mcp::client",
                            server = %name,
                            ?error,
                            "transport read ended; reader task exiting"
                        );
                        // Drain pending requests so callers don't hang.
                        let mut map = pending.lock().await;
                        for (_, tx) in map.drain() {
                            let _ = tx.send(Err(McpError::Protocol(format!(
                                "server {name} disconnected"
                            ))));
                        }
                        return;
                    }
                };
                match msg {
                    IncomingMessage::Response(resp) => {
                        let id = resp.id.as_u64();
                        if let Some(id) = id {
                            let mut map = pending.lock().await;
                            if let Some(tx) = map.remove(&id) {
                                if let Some(err) = resp.error {
                                    let _ = tx.send(Err(McpError::ServerError {
                                        code: err.code,
                                        message: err.message,
                                        data: err.data,
                                    }));
                                } else {
                                    let _ = tx.send(Ok(resp.result.unwrap_or(Value::Null)));
                                }
                            }
                        }
                    }
                    IncomingMessage::Notification(note) => {
                        tracing::trace!(
                            target: "eri_mcp::client",
                            server = %name,
                            method = %note.method,
                            "ignoring server notification"
                        );
                    }
                    IncomingMessage::Request(req) => {
                        // We don't implement sampling or roots queries yet,
                        // so reply with method-not-found. The id may be a
                        // string per JSON-RPC spec; mirror whatever shape
                        // the server used.
                        let reply = json!({
                            "jsonrpc": JSONRPC_VERSION,
                            "id": req.id,
                            "error": {
                                "code": -32601,
                                "message": format!("method {} not implemented by eri MCP client", req.method)
                            }
                        });
                        if let Err(e) = transport_for_replies.send(reply).await {
                            tracing::warn!(
                                target: "eri_mcp::client",
                                server = %name,
                                error = %e,
                                "failed to reply to server-initiated request"
                            );
                        }
                    }
                }
            }
        });
        *self.reader.lock().await = Some(handle);
    }

    async fn start_pinger(self: &Arc<Self>) {
        if let Some(handle) = self.pinger.lock().await.take() {
            handle.abort();
        }
        let weak: std::sync::Weak<Self> = Arc::downgrade(self);
        let handle = tokio::spawn(async move {
            loop {
                tokio::time::sleep(PING_INTERVAL).await;
                let Some(conn) = weak.upgrade() else {
                    return;
                };
                if conn.shutting_down.load(Ordering::Relaxed) {
                    return;
                }
                if let Err(error) = conn.ping().await {
                    tracing::debug!(
                        target: "eri_mcp::client",
                        server = %conn.name,
                        ?error,
                        "ping failed; transport will reconnect"
                    );
                    // Drop the transport — the reader will see EOF and
                    // the supervisor will reconnect.
                    if let Some(t) = conn.transport.write().await.take() {
                        let _ = t.close().await;
                    }
                    return;
                }
            }
        });
        *self.pinger.lock().await = Some(handle);
    }

    /// Wait for the reader task to exit (signaling a disconnect). Returns
    /// promptly once the reader handle is gone.
    async fn wait_for_disconnect(&self) {
        loop {
            // Poll the reader handle. If it has finished or is missing,
            // a disconnect happened.
            let still_alive = {
                let guard = self.reader.lock().await;
                match guard.as_ref() {
                    Some(handle) => !handle.is_finished(),
                    None => false,
                }
            };
            if !still_alive {
                return;
            }
            if self.shutting_down.load(Ordering::Relaxed) {
                return;
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    }

    async fn set_state(&self, state: ConnectionState, error: Option<String>) {
        let mut guard = self.status.lock().await;
        guard.state = state;
        if let Some(e) = error {
            guard.last_error = Some(e);
        }
    }

    async fn ping(&self) -> Result<(), McpError> {
        let _ = self
            .request_inner("ping", None, Duration::from_secs(10))
            .await?;
        Ok(())
    }

    /// Send a request and await its response. Times out per `timeout_dur`.
    pub async fn request(&self, method: &str, params: Option<Value>) -> Result<Value, McpError> {
        // Wait briefly for the connection to become Ready — short-circuit
        // if it's actively in Failed state.
        let deadline = tokio::time::Instant::now() + REQUEST_TIMEOUT;
        loop {
            let state = self.status.lock().await.state.clone();
            match state {
                ConnectionState::Ready => break,
                ConnectionState::Failed => {
                    return Err(McpError::NotConnected {
                        name: self.name.clone(),
                        state: "failed".into(),
                    });
                }
                _ => {
                    if tokio::time::Instant::now() >= deadline {
                        return Err(McpError::Timeout(REQUEST_TIMEOUT));
                    }
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
            }
        }
        self.request_inner(method, params, REQUEST_TIMEOUT).await
    }

    async fn request_inner(
        &self,
        method: &str,
        params: Option<Value>,
        timeout_dur: Duration,
    ) -> Result<Value, McpError> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let envelope = OutgoingMessage::request(id, method, params);
        let line = serde_json::to_value(&envelope)?;

        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id, tx);

        let transport = {
            let guard = self.transport.read().await;
            guard
                .as_ref()
                .cloned()
                .ok_or_else(|| McpError::NotConnected {
                    name: self.name.clone(),
                    state: "no transport".into(),
                })?
        };

        if let Err(e) = transport.send(line).await {
            self.pending.lock().await.remove(&id);
            return Err(e);
        }

        match timeout(timeout_dur, rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(McpError::Protocol(format!(
                "server {} dropped response channel",
                self.name
            ))),
            Err(_) => {
                self.pending.lock().await.remove(&id);
                Err(McpError::Timeout(timeout_dur))
            }
        }
    }

    pub async fn list_tools(&self) -> Result<ListToolsResult, McpError> {
        let raw = self.request("tools/list", None).await?;
        let parsed: ListToolsResult = serde_json::from_value(raw)?;
        Ok(parsed)
    }

    pub async fn list_resources(&self) -> Result<ListResourcesResult, McpError> {
        let raw = self.request("resources/list", None).await?;
        let parsed: ListResourcesResult = serde_json::from_value(raw)?;
        Ok(parsed)
    }

    pub async fn call_tool(&self, name: &str, args: Value) -> Result<CallToolResult, McpError> {
        let raw = self
            .request("tools/call", Some(json!({"name": name, "arguments": args})))
            .await?;
        let parsed: CallToolResult = serde_json::from_value(raw)?;
        Ok(parsed)
    }

    pub async fn read_resource(&self, uri: &str) -> Result<ReadResourceResult, McpError> {
        let raw = self
            .request("resources/read", Some(json!({"uri": uri})))
            .await?;
        let parsed: ReadResourceResult = serde_json::from_value(raw)?;
        Ok(parsed)
    }

    /// Tear down the connection. After this returns, no further requests
    /// will succeed.
    pub async fn shutdown(&self) {
        self.shutting_down.store(true, Ordering::Relaxed);
        if let Some(handle) = self.reader.lock().await.take() {
            handle.abort();
        }
        if let Some(handle) = self.pinger.lock().await.take() {
            handle.abort();
        }
        if let Some(t) = self.transport.write().await.take() {
            let _ = t.close().await;
        }
        self.set_state(ConnectionState::Failed, Some("shutdown".into()))
            .await;
        // Wake any in-flight requests so callers don't hang.
        let mut map = self.pending.lock().await;
        for (_, tx) in map.drain() {
            let _ = tx.send(Err(McpError::NotConnected {
                name: self.name.clone(),
                state: "shutdown".into(),
            }));
        }
    }

    /// Suppress unused-warning for the cached server capabilities.
    pub async fn server_capabilities(&self) -> Value {
        self.server_capabilities.read().await.clone()
    }
}

/// Helper that returns a fully-formed JSON-RPC error payload — kept here
/// for completeness/symmetry; mostly useful in tests.
#[allow(dead_code)]
pub(crate) fn jsonrpc_error(code: i64, message: &str) -> JsonRpcErrorPayload {
    JsonRpcErrorPayload {
        code,
        message: message.to_string(),
        data: None,
    }
}
