//! Library half of `eri_coreutils`. Holds the JSON-RPC dispatch state machine
//! and the per-workspace `Services` registry so it can be exercised by
//! integration tests without spinning up the stdio binary.
//!
//! The binary at `src/eri_coreutils.rs` is a thin wrapper that:
//!   1. sets up tracing,
//!   2. constructs the `Services` registry once,
//!   3. reads JSON-RPC frames from stdin and dispatches them.

use anyhow::anyhow;
use eri_hooks::{HookEvent, Hooks};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

pub mod audit;
pub mod crash;
pub mod host_client;
pub mod services;

pub use audit::{AuditEntry, AuditLogger, AuditStatus, RotationPolicy};
pub use crash::{install_panic_handler, install_sentry, install_tracing_subscriber};
pub use host_client::{HostClient, SecretCache, SharedWriter};
pub use services::{Notifier, Services};

/// A `Notifier` that serialises a JSON-RPC notification frame onto the
/// shared stdout writer. Used by the binary so background services (voice,
/// gaze, etc.) can push unsolicited events to the IDE.
pub struct StdoutNotifier {
    stdout: SharedWriter,
}

impl StdoutNotifier {
    pub fn new(stdout: SharedWriter) -> Arc<Self> {
        Arc::new(Self { stdout })
    }
}

impl Notifier for StdoutNotifier {
    fn notify(&self, method: &'static str, params: Value) {
        let stdout = Arc::clone(&self.stdout);
        // Spawn so the caller (often inside a synchronous chunk of a
        // service handler) returns immediately. Frame ordering is preserved
        // by the writer mutex.
        tokio::spawn(async move {
            let payload = Notification {
                jsonrpc: "2.0",
                method,
                params,
            };
            let body = match serde_json::to_vec(&payload) {
                Ok(body) => body,
                Err(err) => {
                    tracing::warn!(method, error = %err, "failed to serialise notification");
                    return;
                }
            };
            let header = format!("Content-Length: {}\r\n\r\n", body.len());
            let mut guard = stdout.lock().await;
            use tokio::io::AsyncWriteExt;
            if let Err(err) = guard.write_all(header.as_bytes()).await {
                tracing::warn!(method, error = %err, "notify header write failed");
                return;
            }
            if let Err(err) = guard.write_all(&body).await {
                tracing::warn!(method, error = %err, "notify body write failed");
                return;
            }
            let _ = guard.flush().await;
        });
    }
}

pub const PROTOCOL_VERSION: &str = "0.1.0";

/// JSON-RPC error code returned when a request targets a feature the user's
/// tier does not unlock. Paired with a message of `FEATURE_LOCKED: <name>`
/// so the IDE can surface a paywall without parsing English.
pub const FEATURE_LOCKED_CODE: i32 = -32004;

/// JSON-RPC -32602: invalid params.
pub const BAD_PARAMS_CODE: i32 = -32602;

/// JSON-RPC -32603: internal error.
pub const INTERNAL_ERROR_CODE: i32 = -32603;

/// JSON-RPC -32100: Tab model is still downloading. Paired with a message
/// that is the JSON payload `{"stage":"downloading","progress":0.0..=1.0}`
/// so the IDE can drive a progress UI without hitting `eri/tab/health`.
pub const TAB_DOWNLOADING_CODE: i32 = -32100;
const TAB_DOWNLOADING_SENTINEL: &str = "__DOWNLOADING__";

/// JSON-RPC -32402: the eri.dev inference proxy returned HTTP 402
/// `over_quota`. Paired with a JSON-shaped message
/// `{"tier":"free","remaining":0}` so the IDE can pop the upgrade dialog
/// without parsing free-form English. Mirrors HTTP 402 / Payment Required.
pub const OVER_QUOTA_CODE: i32 = -32402;

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
    /// The eri.dev backend rejected the call because the user is over their
    /// tier quota. The IDE surfaces this with an upgrade CTA instead of the
    /// generic error toast.
    OverQuota { tier: String, remaining: i64 },
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
            DispatchError::OverQuota { tier, remaining } => RpcError {
                code: OVER_QUOTA_CODE,
                message: format!(
                    "OVER_QUOTA: {{\"tier\":\"{}\",\"remaining\":{}}}",
                    tier.replace('"', ""),
                    remaining
                ),
            },
            DispatchError::Other(err) => {
                let msg = err.to_string();
                if let Some(payload) = msg.strip_prefix(TAB_DOWNLOADING_SENTINEL) {
                    RpcError {
                        code: TAB_DOWNLOADING_CODE,
                        message: payload.to_string(),
                    }
                } else {
                    RpcError {
                        code: INTERNAL_ERROR_CODE,
                        message: msg,
                    }
                }
            }
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
/// Stdio framing is the binary's concern. Lifecycle hooks (PreToolUse /
/// PostToolUse / PostToolError) are fired around the inner call when a
/// workspace path can be derived from the request params. Hook failures
/// are logged but never block dispatch.
pub async fn dispatch(
    request: &Request,
    tier_state: &SharedTierState,
    services: &Arc<Services>,
) -> std::result::Result<Value, DispatchError> {
    let method = request.method.as_str();
    // Lifecycle methods skip the hook wrapper to avoid recursion.
    let is_meta = matches!(
        method,
        "eri/ping" | "eri/version" | "eri/auth/setTier" | "eri/hooks/list" | "eri/hooks/fire"
    );
    let workspace = if is_meta {
        None
    } else {
        extract_workspace(&request.params)
    };

    if let Some(ws) = workspace.as_deref() {
        fire_hooks_safe(
            ws,
            HookEvent::PreToolUse {
                method: method.to_string(),
                params: request.params.clone(),
            },
        )
        .await;
    }

    // Stamp a wall-clock start so we can attach `duration_ms` to the audit
    // entry. We only sanitize params if audit is enabled — keeps the cold
    // path zero-cost.
    let audit_enabled = services.audit.is_enabled();
    let started_at = std::time::Instant::now();
    let params_shape = if audit_enabled {
        Some(audit::audit_params_shape(&request.params))
    } else {
        None
    };

    let result = dispatch_inner(request, tier_state, services).await;

    if let Some(ws) = workspace.as_deref() {
        match &result {
            Ok(value) => {
                fire_hooks_safe(
                    ws,
                    HookEvent::PostToolUse {
                        method: method.to_string(),
                        result: value.clone(),
                    },
                )
                .await;
            }
            Err(err) => {
                let message = match err {
                    DispatchError::FeatureLocked(f) => format!("FEATURE_LOCKED: {f}"),
                    DispatchError::BadParams(m) => m.clone(),
                    DispatchError::OverQuota { tier, remaining } => {
                        format!("OVER_QUOTA: tier={tier} remaining={remaining}")
                    }
                    DispatchError::Other(e) => e.to_string(),
                };
                fire_hooks_safe(
                    ws,
                    HookEvent::PostToolError {
                        method: method.to_string(),
                        error: message,
                    },
                )
                .await;
            }
        }
    }

    // Record the dispatch in the audit log. We bail when the logger is
    // disabled to avoid even shape-computation; on the hot path the spawn
    // costs us one atomic load + a fast return.
    if audit_enabled {
        let duration_ms = started_at.elapsed().as_millis() as u64;
        let (status, error_kind) = match &result {
            Ok(_) => (AuditStatus::Ok, None),
            Err(DispatchError::FeatureLocked(_)) => (AuditStatus::Skipped, Some("feature_locked")),
            Err(DispatchError::BadParams(_)) => (AuditStatus::Error, Some("bad_params")),
            Err(DispatchError::OverQuota { .. }) => (AuditStatus::Error, Some("over_quota")),
            Err(DispatchError::Other(e)) => (
                AuditStatus::Error,
                Some(audit::audit_error_kind(&e.to_string())),
            ),
        };
        let mut metadata = serde_json::json!({
            "paramsShape": params_shape.unwrap_or(Value::Null),
        });
        if let Some(kind) = error_kind {
            if let Some(obj) = metadata.as_object_mut() {
                obj.insert("errorKind".to_string(), Value::String(kind.to_string()));
            }
        }
        let mut entry = AuditEntry::new("dispatch", status)
            .with_method(method.to_string())
            .with_duration(duration_ms)
            .with_metadata(metadata);
        if let Some(ws) = workspace.as_ref() {
            entry = entry.with_workspace(ws.clone());
        }
        let audit = Arc::clone(&services.audit);
        tokio::spawn(async move {
            audit.record(entry).await;
        });
    }

    result
}

/// Best-effort hook fire: never panics, never blocks dispatch, logs errors.
pub async fn fire_hooks_safe(workspace: &std::path::Path, event: HookEvent) {
    let workspace = workspace.to_path_buf();
    let event_name = event.name();
    let load = tokio::task::spawn_blocking({
        let workspace = workspace.clone();
        move || Hooks::load(&workspace)
    })
    .await;
    let hooks = match load {
        Ok(Ok(h)) => h,
        Ok(Err(e)) => {
            tracing::warn!(
                workspace = %workspace.display(),
                event = event_name,
                error = %e,
                "failed to load hooks",
            );
            return;
        }
        Err(e) => {
            tracing::warn!(event = event_name, error = %e, "hook load task join error");
            return;
        }
    };
    let outcomes = hooks.fire(event).await;
    for outcome in outcomes {
        if outcome.timed_out {
            tracing::warn!(
                event = %outcome.event,
                command = %outcome.command_preview,
                "hook timed out",
            );
        }
        if let Some(err) = outcome.spawn_error.as_deref() {
            tracing::warn!(
                event = %outcome.event,
                command = %outcome.command_preview,
                error = %err,
                "hook spawn failed",
            );
        }
        match outcome.exit_code {
            Some(0) | None => {}
            Some(code) => {
                tracing::warn!(
                    event = %outcome.event,
                    command = %outcome.command_preview,
                    exit_code = code,
                    "hook exited non-zero",
                );
            }
        }
    }
}

/// Best-effort extraction of a workspace path from a params object. Returns
/// `None` when the request doesn't carry one (e.g. `eri/ping`) — callers
/// then skip the hook fire entirely.
fn extract_workspace(params: &Value) -> Option<PathBuf> {
    let obj = params.as_object()?;
    let value = obj.get("workspace")?;
    let s = value.as_str()?;
    if s.is_empty() {
        return None;
    }
    Some(PathBuf::from(s))
}

async fn dispatch_inner(
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
            services::iterate::iterate(request.params.clone(), tier_state, services).await
        }
        "eri/ship/run" => {
            services::ship::run(request.params.clone(), tier_state, services).await
        }
        "eri/slash/run" => {
            services::slash::run(request.params.clone(), tier_state, services).await
        }
        "eri/memory/recall" => {
            services::memory::recall(request.params.clone(), tier_state, services).await
        }
        "eri/memory/remember" => {
            services::memory::remember(request.params.clone(), tier_state, services).await
        }
        "eri/memory/forget" => {
            services::memory::forget(request.params.clone(), tier_state, services).await
        }
        "eri/memory/patterns" => {
            services::memory::patterns(request.params.clone(), tier_state, services).await
        }
        "eri/background/enable" => {
            services::background::enable(request.params.clone(), tier_state, services).await
        }
        "eri/background/disable" => {
            services::background::disable(request.params.clone(), tier_state, services).await
        }
        "eri/background/approveBash" => {
            services::background::approve_bash(request.params.clone(), tier_state, services).await
        }
        "eri/background/trusted" => {
            services::background::trusted(request.params.clone(), tier_state, services).await
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

        // --- Skills (free tier) ---
        "eri/skills/list" => services::skills::list(request.params.clone(), services).await,
        "eri/skills/load" => services::skills::load(request.params.clone(), services).await,

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

        // --- Graph (free tier; agent-memory knowledge graph) ---
        "eri/graph/insert_node" => {
            services::graph::insert_node(request.params.clone(), services).await
        }
        "eri/graph/insert_edge" => {
            services::graph::insert_edge(request.params.clone(), services).await
        }
        "eri/graph/get" => services::graph::get(request.params.clone(), services).await,
        "eri/graph/neighbors" => services::graph::neighbors(request.params.clone(), services).await,
        "eri/graph/traverse" => services::graph::traverse(request.params.clone(), services).await,
        "eri/graph/query_kind" => {
            services::graph::query_kind(request.params.clone(), services).await
        }
        "eri/graph/search" => services::graph::search(request.params.clone(), services).await,
        "eri/graph/stats" => services::graph::stats(request.params.clone(), services).await,
        "eri/graph/export" => services::graph::export(request.params.clone(), services).await,

        // --- Codemaps (free tier; visual codebase artifacts) ---
        "eri/codemaps/list" => services::codemaps::list(request.params.clone(), services).await,
        "eri/codemaps/generate" => {
            services::codemaps::generate(request.params.clone(), services).await
        }
        "eri/codemaps/load" => services::codemaps::load(request.params.clone(), services).await,
        "eri/codemaps/svg" => services::codemaps::svg(request.params.clone(), services).await,

        // --- Tab inline completions (free tier; embedded llama.cpp) ---
        "eri/tab/complete" => {
            services::tab::handle_complete(request.params.clone(), services).await
        }
        "eri/tab/health" => services::tab::handle_health(request.params.clone(), services).await,
        "eri/tab/preload" => services::tab::handle_preload(request.params.clone(), services).await,

        // --- Review (free tier; forge-neutral PR review surface) ---
        "eri/review/local" => services::review::local(request.params.clone(), services).await,
        "eri/review/pr" => services::review::pr(request.params.clone(), services).await,
        "eri/review/patch" => services::review::patch(request.params.clone(), services).await,

        // --- Hooks (free tier; lifecycle automation) ---
        "eri/hooks/list" => services::hooks::list(request.params.clone(), services).await,
        "eri/hooks/fire" => services::hooks::fire(request.params.clone(), services).await,

        // --- Brain (free tier; classify + route + budget) ---
        "eri/brain/plan" => services::brain::plan(request.params.clone(), services).await,

        // --- Voice (free tier; local Whisper continuous listen) ---
        "eri/voice/start" => services::voice::start(request.params.clone(), services).await,
        "eri/voice/stop" => services::voice::stop(request.params.clone(), services).await,
        "eri/voice/toggle" => services::voice::toggle(request.params.clone(), services).await,
        "eri/voice/status" => services::voice::status(request.params.clone(), services).await,
        "eri/voice/probe" => services::voice::probe(request.params.clone(), services).await,

        // --- Audit log (free tier; local-only privacy primitive) ---
        "eri/audit/status" => services::audit_svc::status(request.params.clone(), services).await,
        "eri/audit/enable" => services::audit_svc::enable(request.params.clone(), services).await,
        "eri/audit/disable" => services::audit_svc::disable(request.params.clone(), services).await,
        "eri/audit/recent" => services::audit_svc::recent(request.params.clone(), services).await,

        // --- Preview window (free tier; spawns the Swift WKWebView app) ---
        "eri/preview/open" => services::preview::open(request.params.clone(), services).await,
        "eri/preview/close" => services::preview::close(request.params.clone(), services).await,
        "eri/preview/reload" => services::preview::reload(request.params.clone(), services).await,
        "eri/preview/load" => services::preview::load(request.params.clone(), services).await,
        "eri/preview/gaze" => services::preview::gaze(request.params.clone(), services).await,
        "eri/preview/status" => services::preview::status(request.params.clone(), services).await,
        "eri/preview/loadHtml" => {
            services::preview::load_html(request.params.clone(), services).await
        }
        "eri/preview/discover" => {
            services::preview::discover(request.params.clone(), services).await
        }

        // --- Gaze sidecar (free tier; local-only, never leaves the machine) ---
        "eri/gaze/start" => services::gaze::start(request.params.clone(), services).await,
        "eri/gaze/stop" => services::gaze::stop(request.params.clone(), services).await,
        "eri/gaze/status" => services::gaze::status(request.params.clone(), services).await,
        "eri/gaze/calibrate" => services::gaze::calibrate(request.params.clone(), services).await,

        // --- eri.dev account proxy (free tier; user's own data) ---
        "eri/account/usage" => services::account::usage(request.params.clone(), services).await,
        "eri/account/me" => services::account::me(request.params.clone(), services).await,
        "eri/account/sign_out" => {
            services::account::sign_out(request.params.clone(), services).await
        }
        "eri/account/setSession" => {
            services::account::set_session(request.params.clone(), services).await
        }
        "eri/account/clearSession" => {
            services::account::clear_session(request.params.clone(), services).await
        }

        // --- Crash + Sentry (free tier; local-only observability) ---
        "eri/crash/recent" => services::crash::recent(request.params.clone(), services).await,
        "eri/crash/clear" => services::crash::clear(request.params.clone(), services).await,
        "eri/sentry/status" => {
            services::crash::sentry_status(request.params.clone(), services).await
        }
        "eri/sentry/enable" => {
            services::crash::sentry_enable(request.params.clone(), services).await
        }
        "eri/sentry/disable" => {
            services::crash::sentry_disable(request.params.clone(), services).await
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
