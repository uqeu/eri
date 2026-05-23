//! Library half of `eri_coreutils`. Holds the JSON-RPC dispatch state machine
//! and the per-workspace `Services` registry so it can be exercised by
//! integration tests without spinning up the stdio binary.
//!
//! The binary at `src/eri_coreutils.rs` is a thin wrapper that:
//!   1. sets up tracing,
//!   2. constructs the `Services` registry once,
//!   3. reads JSON-RPC frames from stdin and dispatches them.

use anyhow::anyhow;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::sync::Arc;
use tokio::sync::Mutex;

pub mod services;

pub use services::Services;

pub const PROTOCOL_VERSION: &str = "0.1.0";

/// JSON-RPC error code returned when a request targets a feature the user's
/// tier does not unlock. Paired with a message of `FEATURE_LOCKED: <name>`
/// so the IDE can surface a paywall without parsing English.
pub const FEATURE_LOCKED_CODE: i32 = -32004;

/// JSON-RPC -32602: invalid params.
pub const BAD_PARAMS_CODE: i32 = -32602;

/// JSON-RPC -32603: internal error.
pub const INTERNAL_ERROR_CODE: i32 = -32603;

#[derive(Clone, Debug, Default)]
pub struct TierState {
    // Retained for telemetry / future per-tier branching even though feature
    // checks only consult `features`.
    #[allow(dead_code)]
    pub tier: String,
    pub features: HashSet<String>,
}

impl TierState {
    pub fn allows(&self, feature: &str) -> bool {
        self.features.contains(feature)
    }
}

pub type SharedTierState = Arc<Mutex<TierState>>;

#[derive(Debug, Deserialize)]
pub struct Request {
    pub jsonrpc: String,
    pub id: Option<Value>,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Serialize)]
pub struct Response {
    pub jsonrpc: &'static str,
    pub id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
}

#[derive(Debug, Serialize)]
pub struct RpcError {
    pub code: i32,
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct Notification {
    pub jsonrpc: &'static str,
    pub method: &'static str,
    pub params: Value,
}

#[derive(Debug)]
pub enum DispatchError {
    FeatureLocked(&'static str),
    BadParams(String),
    Other(anyhow::Error),
}

impl From<anyhow::Error> for DispatchError {
    fn from(err: anyhow::Error) -> Self {
        DispatchError::Other(err)
    }
}

impl DispatchError {
    /// Map the dispatch error onto a wire-shaped `RpcError`.
    pub fn into_rpc_error(self) -> RpcError {
        match self {
            DispatchError::FeatureLocked(feature) => RpcError {
                code: FEATURE_LOCKED_CODE,
                message: format!("FEATURE_LOCKED: {feature}"),
            },
            DispatchError::BadParams(message) => RpcError {
                code: BAD_PARAMS_CODE,
                message,
            },
            DispatchError::Other(err) => RpcError {
                code: INTERNAL_ERROR_CODE,
                message: err.to_string(),
            },
        }
    }
}

pub async fn require_feature(
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

/// Pure dispatch — returns a JSON value or a structured `DispatchError`.
/// Stdio framing is the binary's concern.
pub async fn dispatch(
    request: &Request,
    tier_state: &SharedTierState,
    services: &Arc<Services>,
) -> std::result::Result<Value, DispatchError> {
    match request.method.as_str() {
        // --- Built-in lifecycle ---
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

        // --- Stubs (existing tier-gated placeholders) ---
        "eri/composer/plan" => {
            require_feature(tier_state, "composer").await?;
            Ok(serde_json::json!({ "stub": true }))
        }
        "eri/inference/iterate" => {
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

        // --- Rules (free tier) ---
        "eri/rules/list" => services::rules::list(request.params.clone(), services).await,
        "eri/rules/active" => services::rules::active(request.params.clone(), services).await,

        // --- Apply (free tier) ---
        "eri/apply/parse" => services::apply::parse(request.params.clone(), services).await,
        "eri/apply/run" => services::apply::run(request.params.clone(), services).await,
        "eri/apply/parse_and_run" => {
            services::apply::parse_and_run(request.params.clone(), services).await
        }

        // --- Index (requires `mcp` feature per spec) ---
        "eri/index/sync" => {
            require_feature(tier_state, "mcp").await?;
            services::index::sync(request.params.clone(), services).await
        }
        "eri/index/search" => {
            require_feature(tier_state, "mcp").await?;
            services::index::search(request.params.clone(), services).await
        }
        "eri/index/stats" => {
            require_feature(tier_state, "mcp").await?;
            services::index::stats(request.params.clone(), services).await
        }

        // --- MCP (gated) ---
        "eri/mcp/connect" => {
            require_feature(tier_state, "mcp").await?;
            services::mcp::connect(request.params.clone(), services).await
        }
        "eri/mcp/tools" => {
            require_feature(tier_state, "mcp").await?;
            services::mcp::tools(request.params.clone(), services).await
        }
        "eri/mcp/call" => {
            require_feature(tier_state, "mcp").await?;
            services::mcp::call(request.params.clone(), services).await
        }
        "eri/mcp/resources" => {
            require_feature(tier_state, "mcp").await?;
            services::mcp::resources(request.params.clone(), services).await
        }
        "eri/mcp/shutdown" => {
            require_feature(tier_state, "mcp").await?;
            services::mcp::shutdown(request.params.clone(), services).await
        }

        // --- Checkpoints (free tier) ---
        "eri/checkpoints/create" => {
            services::checkpoints::create(request.params.clone(), services).await
        }
        "eri/checkpoints/list" => {
            services::checkpoints::list(request.params.clone(), services).await
        }
        "eri/checkpoints/show" => {
            services::checkpoints::show(request.params.clone(), services).await
        }
        "eri/checkpoints/restore" => {
            services::checkpoints::restore(request.params.clone(), services).await
        }
        "eri/checkpoints/prune" => {
            services::checkpoints::prune(request.params.clone(), services).await
        }
        "eri/checkpoints/delete" => {
            services::checkpoints::delete(request.params.clone(), services).await
        }

        // --- Web / docs stubs (free tier; @-mention resolvers) ---
        "eri/web/search" => services::web_docs::web_search(request.params.clone(), services).await,
        "eri/docs/fetch" => services::web_docs::docs_fetch(request.params.clone(), services).await,

        // --- Tab inline completions (free tier; local Ollama) ---
        "eri/tab/complete" => {
            services::tab::handle_complete(request.params.clone(), services).await
        }
        "eri/tab/health" => {
            services::tab::handle_health(request.params.clone(), services).await
        }

        other => Err(DispatchError::Other(anyhow!(
            "method not implemented: {other}"
        ))),
    }
}

fn parse_set_tier(params: &Value) -> std::result::Result<TierState, DispatchError> {
    let obj = params
        .as_object()
        .ok_or_else(|| DispatchError::BadParams("eri/auth/setTier expects an object".into()))?;
    let tier = obj
        .get("tier")
        .and_then(Value::as_str)
        .ok_or_else(|| DispatchError::BadParams("eri/auth/setTier missing 'tier' string".into()))?
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
