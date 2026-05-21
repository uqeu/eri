//! eri-coreutils — JSON-RPC stdio sidecar for the eri IDE extension.
//!
//! The bundled `eri.voice-and-diffusion` VSCode extension spawns this binary
//! at IDE startup and communicates with it over JSON-RPC 2.0 framed by
//! Content-Length headers (same wire format as LSP), letting the editor
//! drive the Rust crates that own voice, inference, iteration, and control.

use anyhow::{anyhow, Context, Result};
use serde_json::Value;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::sync::Mutex;

use eri_coreutils::{
    dispatch, DispatchError, Notification, Request, Response, RpcError, Services, SharedTierState,
    TierState, PROTOCOL_VERSION,
};

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_env("ERI_LOG")
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    tracing::info!(protocol = PROTOCOL_VERSION, "eri-coreutils sidecar starting");

    let stdout = Arc::new(Mutex::new(tokio::io::stdout()));
    let mut stdin = BufReader::new(tokio::io::stdin());
    let tier_state: SharedTierState = Arc::new(Mutex::new(TierState::default()));
    let services: Arc<Services> = Services::new();

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

        let stdout_for_task = Arc::clone(&stdout);
        let tier_for_task = Arc::clone(&tier_state);
        let services_for_task = Arc::clone(&services);
        tokio::spawn(async move {
            if let Err(err) =
                handle_message(&stdout_for_task, &tier_for_task, &services_for_task, message).await
            {
                tracing::error!(error = %err, "handler failed");
            }
        });
    }

    Ok(())
}

async fn read_message<R: AsyncReadExt + AsyncBufReadExt + Unpin>(
    reader: &mut R,
) -> Result<Option<Request>> {
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

    let request: Request = serde_json::from_slice(&body).context("parsing JSON-RPC request")?;
    if request.jsonrpc != "2.0" {
        return Err(anyhow!(
            "unexpected jsonrpc version: {}",
            request.jsonrpc
        ));
    }
    Ok(Some(request))
}

async fn handle_message(
    stdout: &Arc<Mutex<tokio::io::Stdout>>,
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
    stdout: &Arc<Mutex<tokio::io::Stdout>>,
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
    stdout: &Arc<Mutex<tokio::io::Stdout>>,
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

async fn write_message<T: serde::Serialize>(
    stdout: &Arc<Mutex<tokio::io::Stdout>>,
    value: &T,
) -> Result<()> {
    let body = serde_json::to_vec(value).context("serializing message")?;
    let header = format!("Content-Length: {}\r\n\r\n", body.len());
    let mut guard = stdout.lock().await;
    guard.write_all(header.as_bytes()).await?;
    guard.write_all(&body).await?;
    guard.flush().await?;
    Ok(())
}
