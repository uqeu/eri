//! eri-coreutils — JSON-RPC stdio sidecar for the eri IDE extension.
//!
//! The bundled `eri.voice-and-diffusion` VSCode extension spawns this binary
//! at IDE startup and communicates with it over JSON-RPC 2.0 framed by
//! Content-Length headers (same wire format as LSP), letting the editor
//! drive the Rust crates that own voice, inference, iteration, and control.
//!
//! The stdio channel is symmetric: the extension writes requests to stdin,
//! the sidecar writes responses to stdout. The sidecar can also issue its
//! own requests in the reverse direction — see [`eri_coreutils::HostClient`]
//! — by writing a frame to stdout and matching the extension's response by
//! id when it arrives on stdin.

use anyhow::{Context, Result, anyhow};
use serde_json::Value;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::sync::Mutex;

use eri_coreutils::{
    DispatchError, HostClient, Notification, PROTOCOL_VERSION, Request, Response, RpcError,
    Services, SharedTierState, SharedWriter, TierState, dispatch, install_panic_handler,
    install_sentry, install_tracing_subscriber,
};

#[tokio::main]
async fn main() -> Result<()> {
    // Resolve the workspace root from ERI_WORKSPACE (set by the IDE
    // extension when it spawns the sidecar). Fall back to None — both
    // helpers degrade gracefully to `~/.eri/`.
    let workspace = std::env::var("ERI_WORKSPACE")
        .ok()
        .filter(|s| !s.is_empty())
        .map(std::path::PathBuf::from);

    // Tracing FIRST so the rest of init logs.
    if let Err(err) = install_tracing_subscriber(workspace.as_deref()) {
        eprintln!("[eri] failed to install tracing subscriber: {err}");
    }
    // Panic handler SECOND so any panic during the remainder of init
    // lands in crash.log.
    if let Err(err) = install_panic_handler(workspace.as_deref()) {
        eprintln!("[eri] failed to install panic handler: {err}");
    }
    // Sentry LAST — optional, no-op without the `sentry` feature or
    // without `ERI_SENTRY_DSN`. The guard must live for the duration of
    // `main` so we bind it explicitly.
    let _sentry_guard = install_sentry();

    tracing::info!(
        protocol = PROTOCOL_VERSION,
        "eri-coreutils sidecar starting"
    );

    // Type-erased shared stdout so `HostClient` and the response writer can
    // both hold a clone of the same `Arc<Mutex<dyn AsyncWrite>>`.
    let stdout: SharedWriter = Arc::new(Mutex::new(tokio::io::stdout()));
    let mut stdin = BufReader::new(tokio::io::stdin());
    let tier_state: SharedTierState = Arc::new(Mutex::new(TierState::default()));
    let host_client = HostClient::new(Arc::clone(&stdout));
    let services: Arc<Services> = Services::with_host(Arc::clone(&host_client));

    send_notification(
        &stdout,
        "eri/ready",
        serde_json::json!({
            "protocolVersion": PROTOCOL_VERSION,
            "pid": std::process::id(),
        }),
    )
    .await?;

    loop {
        let message = match read_message(&mut stdin).await {
            Ok(Some(message)) => message,
            Ok(None) => {
                tracing::info!("stdin closed, shutting down");
                break;
            }
            Err(err) => {
                tracing::error!(error = %err, "failed to read message");
                continue;
            }
        };

        // Route: if the frame has a `method` field it's a request from the
        // extension; otherwise it's a response to one of *our* outbound
        // requests (typically `settings/getSecret`).
        match classify(&message) {
            InboundKind::Request(request) => {
                let stdout_for_task = Arc::clone(&stdout);
                let tier_for_task = Arc::clone(&tier_state);
                let services_for_task = Arc::clone(&services);
                tokio::spawn(async move {
                    if let Err(err) = handle_message(
                        &stdout_for_task,
                        &tier_for_task,
                        &services_for_task,
                        request,
                    )
                    .await
                    {
                        tracing::error!(error = %err, "handler failed");
                    }
                });
            }
            InboundKind::Response { id, result } => {
                if !host_client.route_response(id, result).await {
                    tracing::warn!(id, "response with no pending requester");
                }
            }
            InboundKind::Malformed(why) => {
                tracing::warn!(reason = %why, "ignoring malformed frame");
            }
        }
    }

    Ok(())
}

enum InboundKind {
    Request(Request),
    Response {
        id: u64,
        result: std::result::Result<Value, RpcError>,
    },
    Malformed(String),
}

fn classify(value: &Value) -> InboundKind {
    // Requests carry a `method`; responses don't.
    if value.get("method").and_then(Value::as_str).is_some() {
        match serde_json::from_value::<Request>(value.clone()) {
            Ok(req) => {
                if req.jsonrpc != "2.0" {
                    return InboundKind::Malformed(format!(
                        "unexpected jsonrpc version: {}",
                        req.jsonrpc
                    ));
                }
                InboundKind::Request(req)
            }
            Err(err) => InboundKind::Malformed(format!("invalid request: {err}")),
        }
    } else {
        // Treat as a response. We need an integer id we can route on.
        let id_value = match value.get("id") {
            Some(id) => id,
            None => {
                return InboundKind::Malformed("frame missing both method and id".into());
            }
        };
        let id = match id_value.as_u64() {
            Some(id) => id,
            None => {
                return InboundKind::Malformed(format!("response id is not a u64: {id_value}"));
            }
        };
        if let Some(error_value) = value.get("error") {
            let code = error_value
                .get("code")
                .and_then(Value::as_i64)
                .unwrap_or(-32603) as i32;
            let message = error_value
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("unknown host error")
                .to_string();
            return InboundKind::Response {
                id,
                result: Err(RpcError { code, message }),
            };
        }
        let result = value.get("result").cloned().unwrap_or(Value::Null);
        InboundKind::Response {
            id,
            result: Ok(result),
        }
    }
}

async fn read_message<R: AsyncReadExt + AsyncBufReadExt + Unpin>(
    reader: &mut R,
) -> Result<Option<Value>> {
    let mut content_length: Option<usize> = None;
    let mut header = String::new();

    loop {
        header.clear();
        let bytes = reader
            .read_line(&mut header)
            .await
            .context("reading header line")?;
        if bytes == 0 {
            return Ok(None);
        }
        let trimmed = header.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }
        if let Some(value) = trimmed.strip_prefix("Content-Length:") {
            content_length = Some(
                value
                    .trim()
                    .parse()
                    .context("parsing Content-Length header")?,
            );
        }
    }

    let length = content_length.ok_or_else(|| anyhow!("missing Content-Length header"))?;
    let mut body = vec![0u8; length];
    reader
        .read_exact(&mut body)
        .await
        .context("reading message body")?;

    let value: Value = serde_json::from_slice(&body).context("parsing JSON-RPC frame")?;
    Ok(Some(value))
}

async fn handle_message(
    stdout: &SharedWriter,
    tier_state: &SharedTierState,
    services: &Arc<Services>,
    request: Request,
) -> Result<()> {
    let method = request.method.clone();
    let id = request.id.clone();
    let result = dispatch(&request, tier_state, services).await;

    match (id, result) {
        (Some(id), Ok(value)) => send_response(stdout, id, Ok(value)).await?,
        (Some(id), Err(err)) => {
            let rpc_err = match err {
                DispatchError::FeatureLocked(_)
                | DispatchError::BadParams(_)
                | DispatchError::Other(_) => err.into_rpc_error(),
            };
            send_response(stdout, id, Err(rpc_err)).await?;
        }
        (None, _) => {
            tracing::debug!(method = %method, "notification handled (no response)");
        }
    }
    Ok(())
}

async fn send_response(
    stdout: &SharedWriter,
    id: Value,
    outcome: std::result::Result<Value, RpcError>,
) -> Result<()> {
    let response = match outcome {
        Ok(value) => Response {
            jsonrpc: "2.0",
            id,
            result: Some(value),
            error: None,
        },
        Err(err) => Response {
            jsonrpc: "2.0",
            id,
            result: None,
            error: Some(err),
        },
    };
    write_message(stdout, &response).await
}

async fn send_notification(
    stdout: &SharedWriter,
    method: &'static str,
    params: Value,
) -> Result<()> {
    let notification = Notification {
        jsonrpc: "2.0",
        method,
        params,
    };
    write_message(stdout, &notification).await
}

async fn write_message<T: serde::Serialize>(stdout: &SharedWriter, value: &T) -> Result<()> {
    let body = serde_json::to_vec(value).context("serializing message")?;
    let header = format!("Content-Length: {}\r\n\r\n", body.len());
    let mut guard = stdout.lock().await;
    guard.write_all(header.as_bytes()).await?;
    guard.write_all(&body).await?;
    guard.flush().await?;
    Ok(())
}
