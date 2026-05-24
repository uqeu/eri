//! Stdio transport for MCP servers spawned as subprocesses.
//!
//! Framing: newline-delimited JSON. We write each outbound message as a
//! single line ending with `\n` and parse inbound messages line-by-line.
//! Servers' stderr is inherited so crash output reaches the user's terminal.

use std::process::Stdio;
use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;

use crate::config::ServerConfig;
use crate::error::McpError;
use crate::protocol::IncomingMessage;
use crate::transport::Transport;

/// One process per server. The child is kept alive by holding a handle
/// inside [`StdioTransport::inner`]; `close()` (or drop) kills it.
pub struct StdioTransport {
    name: String,
    inner: Arc<StdioInner>,
}

struct StdioInner {
    /// Locked for the duration of a write. Writes are line-atomic.
    stdin: Mutex<Option<ChildStdin>>,
    /// Locked for the duration of a read. Reads are line-atomic.
    stdout: Mutex<Option<BufReader<ChildStdout>>>,
    /// `Some` until `close()` runs. Dropping the Child kills the process.
    child: Mutex<Option<Child>>,
}

impl StdioTransport {
    /// Spawn the configured command and hand back a connected transport.
    /// Errors out only on spawn failure or missing stdio pipes; the handshake
    /// itself is the caller's responsibility (see [`crate::client`]).
    pub async fn spawn(config: &ServerConfig) -> Result<Self, McpError> {
        let command = config.command.clone().ok_or_else(|| {
            McpError::Protocol(format!("stdio server {} has no `command`", config.name))
        })?;

        let mut cmd = Command::new(command);
        cmd.args(&config.args)
            .envs(config.env.iter())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            // Inherit stderr — MCP server crash logs land in the user's
            // shell, where they belong. The IDE captures stderr separately
            // when the server runs in-app.
            .stderr(Stdio::inherit())
            // Keep child grouped with us so killing us also takes down the
            // children (on Unix; Windows tokio handles this on Drop too).
            .kill_on_drop(true);

        let mut child = cmd.spawn().map_err(|source| McpError::ProcessSpawn {
            name: config.name.clone(),
            source,
        })?;

        let stdin = child.stdin.take().ok_or_else(|| McpError::PipeMissing {
            name: config.name.clone(),
        })?;
        let stdout = child.stdout.take().ok_or_else(|| McpError::PipeMissing {
            name: config.name.clone(),
        })?;

        Ok(Self {
            name: config.name.clone(),
            inner: Arc::new(StdioInner {
                stdin: Mutex::new(Some(stdin)),
                stdout: Mutex::new(Some(BufReader::new(stdout))),
                child: Mutex::new(Some(child)),
            }),
        })
    }

    pub fn name(&self) -> &str {
        &self.name
    }
}

#[async_trait]
impl Transport for StdioTransport {
    async fn send(&self, message: Value) -> Result<(), McpError> {
        let line = serde_json::to_string(&message)?;
        let mut guard = self.inner.stdin.lock().await;
        let stdin = guard.as_mut().ok_or_else(|| McpError::NotConnected {
            name: self.name.clone(),
            state: "closed".into(),
        })?;
        stdin.write_all(line.as_bytes()).await?;
        stdin.write_all(b"\n").await?;
        stdin.flush().await?;
        Ok(())
    }

    async fn recv(&self) -> Result<IncomingMessage, McpError> {
        // We pump a line at a time, skipping anything that doesn't parse as
        // a JSON object — some servers print startup banners to stdout
        // before the protocol kicks in, which would otherwise fault the
        // client on first response.
        loop {
            let mut buf = String::new();
            let n = {
                let mut guard = self.inner.stdout.lock().await;
                let stdout = guard.as_mut().ok_or_else(|| McpError::NotConnected {
                    name: self.name.clone(),
                    state: "closed".into(),
                })?;
                stdout.read_line(&mut buf).await?
            };
            if n == 0 {
                return Err(McpError::Protocol(format!(
                    "MCP server {} closed stdout",
                    self.name
                )));
            }
            let trimmed = buf.trim();
            if trimmed.is_empty() {
                continue;
            }
            match serde_json::from_str::<IncomingMessage>(trimmed) {
                Ok(msg) => return Ok(msg),
                Err(error) => {
                    tracing::debug!(
                        target: "eri_mcp::stdio",
                        server = %self.name,
                        ?error,
                        line = trimmed,
                        "dropping non-JSON-RPC line from server stdout"
                    );
                    continue;
                }
            }
        }
    }

    async fn close(&self) -> Result<(), McpError> {
        // Drop pipes first so the child sees EOF on stdin; then kill in case
        // it doesn't exit on its own.
        let _ = self.inner.stdin.lock().await.take();
        let _ = self.inner.stdout.lock().await.take();
        if let Some(mut child) = self.inner.child.lock().await.take() {
            let _ = child.start_kill();
            let _ = child.wait().await;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::IncomingMessage;
    use std::collections::BTreeMap;

    /// Smoke test using `/bin/cat` as an echo server: every line we send
    /// arrives back on stdout. We can pretend each echoed line is a
    /// well-formed JSON-RPC notification and verify it round-trips.
    #[tokio::test]
    async fn stdio_transport_round_trips_through_cat() {
        if !std::path::Path::new("/bin/cat").exists() {
            // Skip on platforms without /bin/cat (Windows CI, mostly).
            return;
        }
        let config = ServerConfig {
            name: "cat-echo".into(),
            command: Some("/bin/cat".into()),
            args: vec![],
            env: BTreeMap::new(),
            ..Default::default()
        };
        let transport = StdioTransport::spawn(&config).await.expect("spawn cat");

        // A valid JSON-RPC notification round-trips through the pipe.
        let msg = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "notifications/progress",
            "params": {"value": 1}
        });
        transport.send(msg.clone()).await.expect("send");

        let recv = transport.recv().await.expect("recv");
        match recv {
            IncomingMessage::Notification(n) => {
                assert_eq!(n.method, "notifications/progress");
                assert_eq!(n.params.unwrap()["value"], 1);
            }
            other => panic!("expected Notification, got {other:?}"),
        }

        transport.close().await.expect("close");
    }
}
