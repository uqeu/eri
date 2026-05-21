//! eri-coreutils — JSON-RPC stdio sidecar for the eri IDE extension.
//!
//! The bundled `eri.voice-and-diffusion` VSCode extension spawns this binary
//! at IDE startup and communicates with it over JSON-RPC 2.0 framed by
//! Content-Length headers (same wire format as LSP), letting the editor
//! drive the Rust crates that own voice, inference, iteration, and control.

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::sync::Mutex;

const PROTOCOL_VERSION: &str = "0.1.0";

/// JSON-RPC error code returned when a request targets a feature the user's
/// tier does not unlock. Paired with a message of `FEATURE_LOCKED: <name>`
/// so the IDE can surface a paywall without parsing English.
const FEATURE_LOCKED_CODE: i32 = -32004;

#[derive(Clone, Debug, Default)]
struct TierState {
    // Retained for telemetry / future per-tier branching even though feature
    // checks only consult `features`.
    #[allow(dead_code)]
    tier: String,
    features: HashSet<String>,
}

impl TierState {
    fn allows(&self, feature: &str) -> bool {
        self.features.contains(feature)
    }
}

type SharedTierState = Arc<Mutex<TierState>>;

#[derive(Debug, Deserialize)]
struct Request {
    jsonrpc: String,
    id: Option<Value>,
    method: String,
    #[serde(default)]
    #[allow(dead_code)]
    params: Value,
}

#[derive(Debug, Serialize)]
struct Response {
    jsonrpc: &'static str,
    id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<RpcError>,
}

#[derive(Debug, Serialize)]
struct RpcError {
    code: i32,
    message: String,
}

#[derive(Debug, Serialize)]
struct Notification {
    jsonrpc: &'static str,
    method: &'static str,
    params: Value,
}

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
        tokio::spawn(async move {
            if let Err(err) = handle_message(&stdout_for_task, &tier_for_task, message).await {
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
    request: Request,
) -> Result<()> {
    let method = request.method.clone();
    let id = request.id.clone();
    let result = dispatch(&request, tier_state).await;

    match (id, result) {
        (Some(id), Ok(value)) => send_response(stdout, id, Ok(value)).await?,
        (Some(id), Err(DispatchError::FeatureLocked(feature))) => {
            send_response(
                stdout,
                id,
                Err(RpcError {
                    code: FEATURE_LOCKED_CODE,
                    message: format!("FEATURE_LOCKED: {feature}"),
                }),
            )
            .await?;
        }
        (Some(id), Err(DispatchError::Other(err))) => {
            send_response(
                stdout,
                id,
                Err(RpcError {
                    code: -32603,
                    message: err.to_string(),
                }),
            )
            .await?;
        }
        (None, _) => {
            tracing::debug!(method = %method, "notification handled (no response)");
        }
    }
    Ok(())
}

#[derive(Debug)]
enum DispatchError {
    FeatureLocked(&'static str),
    Other(anyhow::Error),
}

impl From<anyhow::Error> for DispatchError {
    fn from(err: anyhow::Error) -> Self {
        DispatchError::Other(err)
    }
}

async fn require_feature(
    tier_state: &SharedTierState,
    feature: &'static str,
) -> std::result::Result<(), DispatchError> {
    let guard = tier_state.lock().await;
    if guard.allows(feature) {
        Ok(())
    } else {
        Err(DispatchError::FeatureLocked(feature))
    }
}

async fn dispatch(
    request: &Request,
    tier_state: &SharedTierState,
) -> std::result::Result<Value, DispatchError> {
    match request.method.as_str() {
        "eri/ping" => Ok(serde_json::json!({ "pong": true })),
        "eri/version" => Ok(serde_json::json!({
            "protocolVersion": PROTOCOL_VERSION,
            "binary": env!("CARGO_PKG_VERSION"),
        })),
        "eri/auth/setTier" => {
            let new_state = parse_set_tier(&request.params)?;
            let mut guard = tier_state.lock().await;
            *guard = new_state;
            Ok(serde_json::json!({ "ok": true }))
        }
        "eri/composer/plan" => {
            require_feature(tier_state, "composer").await?;
            Ok(serde_json::json!({ "stub": true }))
        }
        "eri/inference/iterate" => {
            // Free tier still gets diffusion edits per the pricing page, so
            // this only blocks the inline-edit path used by Cmd-K. The IDE
            // disambiguates by method; the Cmd-K edit method is the one
            // tied to the paid `inlineEdit` feature flag.
            require_feature(tier_state, "inlineEdit").await?;
            Ok(serde_json::json!({ "stub": true }))
        }
        "eri/agent/run" => {
            require_feature(tier_state, "agentMode").await?;
            Ok(serde_json::json!({ "stub": true }))
        }
        "eri/cloud/spawn" => {
            require_feature(tier_state, "cloudAgents").await?;
            Ok(serde_json::json!({ "stub": true }))
        }
        other => Err(DispatchError::Other(anyhow!(
            "method not implemented: {other}"
        ))),
    }
}

fn parse_set_tier(params: &Value) -> Result<TierState> {
    let obj = params
        .as_object()
        .ok_or_else(|| anyhow!("eri/auth/setTier expects an object"))?;
    let tier = obj
        .get("tier")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("eri/auth/setTier missing 'tier' string"))?
        .to_string();
    let features = obj
        .get("features")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect::<HashSet<String>>()
        })
        .unwrap_or_default();
    Ok(TierState { tier, features })
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

async fn write_message<T: Serialize>(
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
