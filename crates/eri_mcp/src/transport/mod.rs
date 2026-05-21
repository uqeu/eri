//! Transport abstraction.
//!
//! A `Transport` is a duplex byte channel that frames MCP messages as JSON
//! objects. The two production implementations are [`stdio::StdioTransport`]
//! (newline-delimited JSON over a child's stdio pipes) and
//! [`http::HttpTransport`] (POST JSON-RPC with an SSE response).
//!
//! Implementations are responsible for framing: `send` accepts a single
//! `serde_json::Value`, `recv` yields one decoded `IncomingMessage` at a
//! time. Both directions are async and `Send + Sync` so the per-server
//! [`crate::client::Connection`] can drive a write-half from a request task
//! while a separate task pumps the read half into a multiplexer.

use async_trait::async_trait;
use serde_json::Value;

use crate::error::McpError;
use crate::protocol::IncomingMessage;

pub mod http;
pub mod stdio;

/// Duplex message channel. Implementations must be safe to share across
/// tasks; the client wraps reads behind a `Mutex` and serializes writes
/// through a single `tokio::sync::Mutex`.
#[async_trait]
pub trait Transport: Send + Sync {
    /// Send one already-serialized JSON-RPC message.
    async fn send(&self, message: Value) -> Result<(), McpError>;

    /// Block until one inbound message is available, then return it.
    /// Returns an error when the underlying channel closes — the client's
    /// reconnect loop treats that as a transport drop.
    async fn recv(&self) -> Result<IncomingMessage, McpError>;

    /// Stop the transport and release resources (kill the child, close
    /// the HTTP stream). Idempotent.
    async fn close(&self) -> Result<(), McpError>;
}
