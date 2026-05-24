//! JSON-RPC handlers for crash + sentry surfaces.
//!
//!   * `eri/crash/recent`   → `{ entries: [...] }`
//!   * `eri/crash/clear`    → `{ ok: true }`
//!   * `eri/sentry/status`  → `{ enabled, dsnSet, featureCompiled }`
//!   * `eri/sentry/enable`  → `{ ok: true, dsnSet }`
//!   * `eri/sentry/disable` → `{ ok: true }`
//!
//! All five are free-tier — observability is not a paid feature.

use serde::Deserialize;
use serde_json::{json, Value};

use crate::crash;
use crate::DispatchError;
use crate::services::Services;

const ENV_DSN: &str = "ERI_SENTRY_DSN";
const RECENT_DEFAULT: usize = 50;
const RECENT_MAX: usize = 500;

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct RecentParams {
    limit: Option<usize>,
}

pub async fn recent(
    params: Value,
    _services: &Services,
) -> std::result::Result<Value, DispatchError> {
    let parsed: RecentParams = serde_json::from_value(params)
        .map_err(|e| DispatchError::BadParams(e.to_string()))?;
    let limit = parsed
        .limit
        .unwrap_or(RECENT_DEFAULT)
        .min(RECENT_MAX);
    let entries = crash::read_recent_crashes(limit)
        .map_err(DispatchError::Other)?;
    Ok(json!({ "entries": entries }))
}

pub async fn clear(
    _params: Value,
    _services: &Services,
) -> std::result::Result<Value, DispatchError> {
    crash::clear_crash_log().map_err(DispatchError::Other)?;
    Ok(json!({ "ok": true }))
}

pub async fn sentry_status(
    _params: Value,
    _services: &Services,
) -> std::result::Result<Value, DispatchError> {
    let dsn_set = std::env::var(ENV_DSN)
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false);
    let feature_compiled = crash::SENTRY_FEATURE_COMPILED;
    // "enabled" here means: would this process actually report? Both
    // flags must be true. For runtime enable/disable, we toggle the
    // env var — the next sidecar launch picks it up.
    let enabled = dsn_set && feature_compiled;
    Ok(json!({
        "enabled": enabled,
        "dsnSet": dsn_set,
        "featureCompiled": feature_compiled,
    }))
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct SentryEnableParams {
    dsn: Option<String>,
}

pub async fn sentry_enable(
    params: Value,
    _services: &Services,
) -> std::result::Result<Value, DispatchError> {
    let parsed: SentryEnableParams = serde_json::from_value(params)
        .map_err(|e| DispatchError::BadParams(e.to_string()))?;
    // Default to the public eri Sentry DSN sentinel if the caller did
    // not provide one. The actual DSN string is the IDE's
    // responsibility — we only flip the env var. Empty input means
    // "do nothing, this is just a state toggle".
    if let Some(dsn) = parsed.dsn.as_deref() {
        if !dsn.trim().is_empty() {
            // SAFETY: env vars are not async-Send-safe to mutate while
            // other threads read; we accept the small race here because
            // Sentry is only consulted at startup.
            // SAFETY: `std::env::set_var` is `unsafe` on some platforms
            // because it mutates the global environment block. The
            // sidecar only mutates this var on user action (the IDE
            // privacy toggle), never on the hot path.
            unsafe {
                std::env::set_var(ENV_DSN, dsn);
            }
        }
    }
    let dsn_set = std::env::var(ENV_DSN)
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false);
    tracing::info!(dsn_set, "sentry enabled via eri/sentry/enable");
    Ok(json!({ "ok": true, "dsnSet": dsn_set }))
}

pub async fn sentry_disable(
    _params: Value,
    _services: &Services,
) -> std::result::Result<Value, DispatchError> {
    // SAFETY: see `sentry_enable` above.
    unsafe {
        std::env::remove_var(ENV_DSN);
    }
    tracing::info!("sentry disabled via eri/sentry/disable");
    Ok(json!({ "ok": true }))
}
