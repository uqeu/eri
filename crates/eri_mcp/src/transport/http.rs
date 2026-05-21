//! Streamable-HTTP transport.
//!
//! Pattern (per MCP spec, "Streamable HTTP"):
//!   - Client POSTs each outbound JSON-RPC message to a single endpoint URL.
//!   - Server may respond with `application/json` (one message in the body)
//!     or `text/event-stream` (zero or more SSE `message:` events). Either
//!     way the messages get pushed onto our inbound queue.
//!   - To receive server-initiated messages between requests, we also open
//!     a long-lived GET on the same URL with `Accept: text/event-stream`
//!     and parse SSE in the background.
//!
//! We hand-roll SSE parsing — `reqwest` exposes a byte stream and a full
//! `eventsource-client` dependency would be overkill for a single event
//! shape (`data: <json>\n\n`).

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use futures_util::StreamExt;
use serde_json::Value;
use tokio::sync::{Mutex, mpsc};

use crate::config::ServerConfig;
use crate::error::McpError;
use crate::protocol::IncomingMessage;
use crate::transport::Transport;

const CHANNEL_BUFFER: usize = 64;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

/// Single-URL HTTP transport. Holds a `reqwest::Client` and an inbound
/// `mpsc` receiver that the background SSE pump feeds. Outbound messages
/// take the POST path; inbound messages come from either POST responses or
/// the GET SSE stream.
pub struct HttpTransport {
    name: String,
    url: String,
    client: reqwest::Client,
    headers: BTreeMap<String, String>,
    inbound: Mutex<mpsc::Receiver<Result<IncomingMessage, McpError>>>,
    inbound_tx: mpsc::Sender<Result<IncomingMessage, McpError>>,
    listener: Mutex<Option<tokio::task::JoinHandle<()>>>,
    closed: Arc<std::sync::atomic::AtomicBool>,
}

impl HttpTransport {
    /// Build a transport from server config. Errors only on malformed URL —
    /// network connectivity is checked lazily on the first send.
    pub async fn connect(config: &ServerConfig) -> Result<Self, McpError> {
        let url = config.url.clone().ok_or_else(|| {
            McpError::Protocol(format!("http server {} has no `url`", config.name))
        })?;

        // Validate the URL upfront so a typo doesn't surface as a generic
        // reqwest error on the first send.
        url::Url::parse(&url).map_err(|e| {
            McpError::Protocol(format!("invalid url for server {}: {e}", config.name))
        })?;

        let client = reqwest::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .build()
            .map_err(|e| McpError::Http(e.to_string()))?;

        let (tx, rx) = mpsc::channel(CHANNEL_BUFFER);

        let mut transport = Self {
            name: config.name.clone(),
            url,
            client,
            headers: config.headers.clone(),
            inbound: Mutex::new(rx),
            inbound_tx: tx,
            listener: Mutex::new(None),
            closed: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        };
        transport.spawn_event_stream().await;
        Ok(transport)
    }

    /// Open a long-lived GET to the endpoint with `Accept: text/event-stream`
    /// and forward parsed JSON-RPC frames to the inbound channel. Some MCP
    /// servers don't support this side channel (they only reply via POST
    /// bodies); we tolerate a 4xx response by silently exiting the task.
    async fn spawn_event_stream(&mut self) {
        let url = self.url.clone();
        let client = self.client.clone();
        let headers = self.headers.clone();
        let tx = self.inbound_tx.clone();
        let closed = self.closed.clone();
        let name = self.name.clone();

        let handle = tokio::spawn(async move {
            let mut req = client.get(&url).header("Accept", "text/event-stream");
            for (k, v) in &headers {
                req = req.header(k, v);
            }
            let response = match req.send().await {
                Ok(r) => r,
                Err(e) => {
                    tracing::debug!(
                        target: "eri_mcp::http",
                        server = %name,
                        error = %e,
                        "GET SSE failed; server may not support server-initiated stream"
                    );
                    return;
                }
            };
            if !response.status().is_success() {
                tracing::debug!(
                    target: "eri_mcp::http",
                    server = %name,
                    status = %response.status(),
                    "GET SSE not supported; falling back to POST-only mode"
                );
                return;
            }

            let mut stream = response.bytes_stream();
            let mut sse = SseBuffer::default();
            while !closed.load(std::sync::atomic::Ordering::Relaxed) {
                let chunk = match stream.next().await {
                    Some(Ok(bytes)) => bytes,
                    Some(Err(e)) => {
                        let _ = tx
                            .send(Err(McpError::Http(format!("SSE read error: {e}"))))
                            .await;
                        return;
                    }
                    None => return,
                };
                for event_data in sse.feed(&chunk) {
                    if let Some(msg) = parse_event(&event_data, &name) {
                        if tx.send(Ok(msg)).await.is_err() {
                            return;
                        }
                    }
                }
            }
        });

        *self.listener.lock().await = Some(handle);
    }
}

#[async_trait]
impl Transport for HttpTransport {
    async fn send(&self, message: Value) -> Result<(), McpError> {
        let mut req = self
            .client
            .post(&self.url)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json, text/event-stream")
            .json(&message);
        for (k, v) in &self.headers {
            req = req.header(k, v);
        }

        let response = req.send().await.map_err(McpError::from)?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(McpError::Http(format!(
                "POST {} -> {} {}",
                self.url, status, body
            )));
        }

        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string())
            .unwrap_or_default();

        // 202 + empty body means "accepted, expect inbound via SSE side
        // channel" — the response carries no message we need to enqueue.
        if status == reqwest::StatusCode::ACCEPTED {
            return Ok(());
        }

        if content_type.starts_with("text/event-stream") {
            // Body is SSE; parse it on the spot (these are bounded — they
            // represent the server's response to *this* request).
            let bytes = response.bytes().await.map_err(McpError::from)?;
            let mut sse = SseBuffer::default();
            for event_data in sse.feed(&bytes) {
                if let Some(msg) = parse_event(&event_data, &self.name) {
                    let _ = self.inbound_tx.send(Ok(msg)).await;
                }
            }
            // Flush any trailing event without a terminating blank line.
            for event_data in sse.flush() {
                if let Some(msg) = parse_event(&event_data, &self.name) {
                    let _ = self.inbound_tx.send(Ok(msg)).await;
                }
            }
        } else {
            // Plain JSON body — one message.
            let bytes = response.bytes().await.map_err(McpError::from)?;
            if bytes.is_empty() {
                return Ok(());
            }
            match serde_json::from_slice::<IncomingMessage>(&bytes) {
                Ok(msg) => {
                    let _ = self.inbound_tx.send(Ok(msg)).await;
                }
                Err(e) => {
                    return Err(McpError::Json(e));
                }
            }
        }
        Ok(())
    }

    async fn recv(&self) -> Result<IncomingMessage, McpError> {
        let mut guard = self.inbound.lock().await;
        guard
            .recv()
            .await
            .ok_or_else(|| McpError::Protocol(format!("server {} channel closed", self.name)))?
    }

    async fn close(&self) -> Result<(), McpError> {
        self.closed
            .store(true, std::sync::atomic::Ordering::Relaxed);
        if let Some(handle) = self.listener.lock().await.take() {
            handle.abort();
        }
        Ok(())
    }
}

/// Incremental SSE parser. The wire format is roughly:
///
/// ```text
/// event: message
/// data: {"jsonrpc":"2.0",...}
///
/// ```
///
/// We only care about the `data:` payload — `event:` is informational and
/// every JSON-RPC message arrives on the implicit `message` event anyway.
/// Multi-line `data:` values are joined by `\n` per spec.
#[derive(Default)]
struct SseBuffer {
    buf: Vec<u8>,
    /// Lines for the in-progress event.
    pending_data: Vec<String>,
}

impl SseBuffer {
    fn feed(&mut self, chunk: &[u8]) -> Vec<String> {
        self.buf.extend_from_slice(chunk);
        let mut events = Vec::new();
        while let Some(pos) = self.buf.iter().position(|&b| b == b'\n') {
            let line_bytes: Vec<u8> = self.buf.drain(..=pos).collect();
            // Drop the trailing '\n' and any '\r' before it.
            let mut line = String::from_utf8_lossy(&line_bytes).into_owned();
            if line.ends_with('\n') {
                line.pop();
            }
            if line.ends_with('\r') {
                line.pop();
            }

            if line.is_empty() {
                if !self.pending_data.is_empty() {
                    events.push(self.pending_data.join("\n"));
                    self.pending_data.clear();
                }
                continue;
            }
            if let Some(value) = line.strip_prefix("data:") {
                // Per spec: a single leading space after the colon is stripped.
                let value = value.strip_prefix(' ').unwrap_or(value);
                self.pending_data.push(value.to_string());
            }
            // Other field names (event:, id:, retry:) are ignored.
        }
        events
    }

    /// Drain any in-progress event without waiting for the terminating blank
    /// line. Used when the underlying byte stream ends.
    fn flush(&mut self) -> Vec<String> {
        if self.pending_data.is_empty() {
            return Vec::new();
        }
        let event = self.pending_data.join("\n");
        self.pending_data.clear();
        vec![event]
    }
}

fn parse_event(raw: &str, server: &str) -> Option<IncomingMessage> {
    match serde_json::from_str::<IncomingMessage>(raw) {
        Ok(msg) => Some(msg),
        Err(error) => {
            tracing::debug!(
                target: "eri_mcp::http",
                server = %server,
                ?error,
                line = raw,
                "dropping non-JSON-RPC SSE event"
            );
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sse_buffer_emits_event_on_blank_line() {
        let mut sse = SseBuffer::default();
        let events = sse.feed(b"data: {\"a\":1}\n\n");
        assert_eq!(events, vec![r#"{"a":1}"#]);
    }

    #[test]
    fn sse_buffer_joins_multi_line_data() {
        let mut sse = SseBuffer::default();
        let mut events = sse.feed(b"data: line1\n");
        assert!(events.is_empty(), "no blank line yet");
        events.extend(sse.feed(b"data: line2\n\n"));
        assert_eq!(events, vec!["line1\nline2"]);
    }

    #[test]
    fn sse_buffer_handles_chunked_input() {
        // Same payload as the first test, but delivered byte-by-byte to
        // ensure the parser tolerates arbitrary chunk boundaries.
        let mut sse = SseBuffer::default();
        let mut events = Vec::new();
        for byte in b"data: {\"x\":42}\n\n".iter() {
            events.extend(sse.feed(&[*byte]));
        }
        assert_eq!(events, vec![r#"{"x":42}"#]);
    }

    #[test]
    fn sse_buffer_ignores_event_and_id_fields() {
        let mut sse = SseBuffer::default();
        let events = sse.feed(b"event: message\nid: 42\ndata: {\"a\":1}\n\n");
        assert_eq!(events, vec![r#"{"a":1}"#]);
    }
}
