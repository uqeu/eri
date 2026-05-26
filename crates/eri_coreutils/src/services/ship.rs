//! `eri/ship/run` JSON-RPC handler — Builder/Checker tandem ship.
//!
//! Proxies the request to `{ERI_BASE_URL}/api/v1/inference/ship`, reads
//! the SSE stream of [`TandemEvent`]s, and re-emits each frame as an
//! `eri/ship/event` notification on the JSON-RPC channel so the extension
//! can render per-builder + checker progress in real time.
//!
//! HTTP 402 (over-quota) → [`DispatchError::OverQuota`] so the IDE pops
//! the upgrade dialog via the existing `-32402` handler.
//!
//! HTTP 401 / network failure / missing session → returned as a generic
//! `DispatchError::Other` carrying enough context for diagnostics.

use std::sync::Arc;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::services::Services;
use crate::{DispatchError, SharedTierState};

/// One file pulled from the workspace into the ship context.
#[derive(Debug, Clone, Deserialize, Serialize)]
struct WorkspaceFileWire {
    path: String,
    #[serde(default)]
    content: String,
}

/// Optional plan override. When unset, the backend uses
/// `tandem.ts::DEFAULT_PLAN` (Sonnet + GPT-4o builders, Gemini checker).
#[derive(Debug, Clone, Deserialize, Serialize)]
struct BuilderCheckerPlanWire {
    builders: Vec<TandemSlotWire>,
    checker: TandemSlotWire,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct TandemSlotWire {
    role: String,
    provider: String,
    model: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShipParams {
    instructions: String,
    workspace_files: Vec<WorkspaceFileWire>,
    #[serde(default)]
    plan: Option<BuilderCheckerPlanWire>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ShipResult {
    /// Whether the ship completed without `ship_failed`.
    ok: bool,
    /// Models that produced output (at least the checker if ok).
    survivors: Vec<String>,
    /// Aggregate token spend across all three model calls.
    total_tokens_in: u64,
    total_tokens_out: u64,
    /// Cost in micro-USD; rough estimate per `lib/inference/tokens.ts`.
    total_cost_micros: u64,
    /// Final merged patchset emitted by the checker — search/replace
    /// blocks in eri_apply's canonical format, ready for ApplyOrchestrator.
    merged_patchset: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct TokenCountsWire {
    #[serde(default)]
    tokens_in: u64,
    #[serde(default)]
    tokens_out: u64,
}

/// `eri/ship/run` handler. Returns the aggregate after the SSE stream
/// closes; per-frame progress is delivered via `eri/ship/event`
/// notifications during the stream.
pub async fn run(
    params: Value,
    _tier_state: &SharedTierState,
    services: &Arc<Services>,
) -> Result<Value, DispatchError> {
    let p: ShipParams = serde_json::from_value(params)
        .map_err(|e| DispatchError::BadParams(format!("eri/ship/run: {e}")))?;

    let session = services
        .secrets
        .eri_session_token(services.host_client.as_deref())
        .await
        .ok_or_else(|| {
            DispatchError::Other(anyhow::anyhow!(
                "no eri session token; user must sign in to ship"
            ))
        })?;
    let base_url = services.secrets.eri_base_url();
    let url = format!("{base_url}/api/v1/inference/ship");

    let body = serde_json::json!({
        "instructions": p.instructions,
        "workspaceFiles": p.workspace_files,
        "plan": p.plan,
    });

    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| DispatchError::Other(anyhow::anyhow!("ship http client: {e}")))?;

    let response = client
        .post(&url)
        .bearer_auth(&session)
        .header("accept", "text/event-stream")
        .json(&body)
        .send()
        .await
        .map_err(|e| DispatchError::Other(anyhow::anyhow!("ship request failed: {e}")))?;

    let status = response.status();
    if status == reqwest::StatusCode::PAYMENT_REQUIRED {
        // Best effort to extract the JSON `{ tier, remaining }` payload.
        let payload = response.json::<serde_json::Value>().await.ok();
        let tier = payload
            .as_ref()
            .and_then(|v| v.get("tier"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();
        let remaining = payload
            .as_ref()
            .and_then(|v| v.get("remaining"))
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        return Err(DispatchError::OverQuota { tier, remaining });
    }
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        // Best effort to extract { tier, window, resetAt } so the IDE
        // can drive the clock toast instead of the paywall modal.
        let payload = response.json::<serde_json::Value>().await.ok();
        let tier = payload
            .as_ref()
            .and_then(|v| v.get("tier"))
            .and_then(|v| v.as_str())
            .unwrap_or("free")
            .to_string();
        let window = payload
            .as_ref()
            .and_then(|v| v.get("window"))
            .and_then(|v| v.as_str())
            .unwrap_or("minute")
            .to_string();
        let reset_at = payload
            .as_ref()
            .and_then(|v| v.get("resetAt"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        return Err(DispatchError::RateLimited {
            tier,
            window,
            reset_at,
        });
    }
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(DispatchError::Other(anyhow::anyhow!(
            "ship upstream status {}: {}",
            status.as_u16(),
            text
        )));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut survivors: Vec<String> = Vec::new();
    let mut totals_in: u64 = 0;
    let mut totals_out: u64 = 0;
    let mut totals_cost: u64 = 0;
    let mut merged_patchset = String::new();
    let mut ok = false;

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| {
            DispatchError::Other(anyhow::anyhow!("ship stream read: {e}"))
        })?;
        let text = match std::str::from_utf8(&bytes) {
            Ok(s) => s,
            Err(_) => continue,
        };
        buffer.push_str(text);

        // SSE frames are separated by blank lines.
        while let Some(idx) = buffer.find("\n\n") {
            let frame = buffer[..idx].to_string();
            buffer = buffer[idx + 2..].to_string();
            for line in frame.lines() {
                let Some(payload) = line.strip_prefix("data:") else {
                    continue;
                };
                let payload = payload.trim();
                if payload.is_empty() {
                    continue;
                }
                let parsed: Value = match serde_json::from_str(payload) {
                    Ok(v) => v,
                    Err(_) => continue,
                };

                // Side-effects driven by event kind.
                if let Some(kind) = parsed.get("kind").and_then(|v| v.as_str()) {
                    match kind {
                        "builder_done" | "checker_done" => {
                            if let Some(tokens) = parsed.get("tokens") {
                                if let Ok(t) =
                                    serde_json::from_value::<TokenCountsWire>(tokens.clone())
                                {
                                    totals_in += t.tokens_in;
                                    totals_out += t.tokens_out;
                                }
                            }
                            if let Some(cost) =
                                parsed.get("cost_usd_micros").and_then(|v| v.as_u64())
                            {
                                totals_cost += cost;
                            }
                            if kind == "checker_done" {
                                if let Some(text) =
                                    parsed.get("text").and_then(|v| v.as_str())
                                {
                                    merged_patchset.push_str(text);
                                }
                            }
                        }
                        "ship_done" => {
                            ok = true;
                            if let Some(arr) =
                                parsed.get("survivors").and_then(|v| v.as_array())
                            {
                                survivors = arr
                                    .iter()
                                    .filter_map(|v| v.as_str().map(str::to_string))
                                    .collect();
                            }
                        }
                        _ => {}
                    }
                }

                // Forward every event verbatim to the extension.
                if let Some(notifier) = services.notifier.as_ref() {
                    notifier.notify("eri/ship/event", parsed);
                }
            }
        }
    }

    Ok(serde_json::to_value(ShipResult {
        ok,
        survivors,
        total_tokens_in: totals_in,
        total_tokens_out: totals_out,
        total_cost_micros: totals_cost,
        merged_patchset,
    })
    .unwrap_or(Value::Null))
}
