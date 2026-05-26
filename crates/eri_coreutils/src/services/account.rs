//! Sidecar handlers for the eri.dev account endpoints:
//!
//! * `eri/account/usage`        → proxies `GET /api/v1/usage` with the session bearer.
//! * `eri/account/me`           → proxies `GET /api/v1/me` with the session bearer.
//! * `eri/account/sign_out`     → clears the cached session token and makes a best-
//!   effort `POST /api/v1/auth/revoke` so the IDE never has to talk to the
//!   eri.dev origin directly (and so the extension sandbox stays narrow).
//! * `eri/account/setSession`   → IDE pushes the active user_id into the sidecar
//!   so per-user state (memory partition, …) resolves to the right scope. The
//!   bearer token continues to live in the SecretCache; only the user_id
//!   travels through this call.
//! * `eri/account/clearSession` → drops the user_id snapshot. Called on
//!   sign-out so subsequent calls fall back to anonymous-mode paths.
//!
//! All three are free-tier — they describe the user's own account, not a paid
//! feature, and the IDE polls usage frequently to drive the status bar.
//!
//! Auth discipline: the session bearer is read from [`crate::host_client::SecretCache`]
//! and lives in memory only. It is never logged, never sent except in the
//! `Authorization: Bearer ...` header to the eri.dev base URL, and is cleared
//! by `sign_out` so subsequent calls re-fetch (and get `None`).

use std::time::Duration;

use serde::Deserialize;
use serde_json::Value;

use crate::DispatchError;
use crate::host_client::{ERI_SESSION_FIELD, ERI_SESSION_PROVIDER};
use crate::services::Services;

/// Path for the user-facing usage summary.
const USAGE_PATH: &str = "/api/v1/usage";
/// Path for the user profile / tier descriptor.
const ME_PATH: &str = "/api/v1/me";
/// Path for best-effort token revocation on sign-out.
const REVOKE_PATH: &str = "/api/v1/auth/revoke";

/// Shape returned by the eri.dev backend for an over-quota response. The
/// backend uses the same envelope on usage GETs (rare) as on inference POSTs
/// so a single decoder handles both.
#[derive(Debug, Deserialize)]
struct OverQuotaBody {
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    tier: Option<String>,
    #[serde(default)]
    remaining: Option<i64>,
}

/// Shape returned by the eri.dev backend for a rate-limited response.
/// Distinct from `over_quota`: the user is INSIDE their monthly budget
/// but has hit a short-window throttle. Surfaces a clock toast in the
/// IDE instead of the paywall modal.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RateLimitedBody {
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    tier: Option<String>,
    #[serde(default)]
    window: Option<String>,
    #[serde(default)]
    reset_at: Option<String>,
}

/// Parameters for `eri/account/setSession`. The IDE pushes the active
/// sign-in's `user_id` so the sidecar can partition local state (memory
/// file path today) per account.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetSessionParams {
    user_id: String,
}

/// `eri/account/setSession` handler. Stash the active user_id on Services.
/// Idempotent — re-calling with the same id is a no-op.
pub async fn set_session(
    params: Value,
    services: &Services,
) -> Result<Value, DispatchError> {
    let p: SetSessionParams = serde_json::from_value(params)
        .map_err(|e| DispatchError::BadParams(format!("eri/account/setSession: {e}")))?;
    let trimmed = p.user_id.trim();
    if trimmed.is_empty() {
        return Err(DispatchError::BadParams(
            "eri/account/setSession: user_id must be non-empty".into(),
        ));
    }
    services.set_session_user(trimmed.to_string()).await;
    Ok(serde_json::json!({ "ok": true }))
}

/// `eri/account/clearSession` handler. Drops the cached user_id.
pub async fn clear_session(
    _params: Value,
    services: &Services,
) -> Result<Value, DispatchError> {
    services.clear_session().await;
    Ok(serde_json::json!({ "ok": true }))
}

/// `eri/account/usage` handler. Returns whatever JSON the backend produces.
pub async fn usage(_params: Value, services: &Services) -> Result<Value, DispatchError> {
    proxy_get(services, USAGE_PATH).await
}

/// `eri/account/me` handler. Returns whatever JSON the backend produces.
pub async fn me(_params: Value, services: &Services) -> Result<Value, DispatchError> {
    proxy_get(services, ME_PATH).await
}

/// `eri/account/sign_out` handler. Clears the cached bearer locally then
/// fires a best-effort revoke against the backend. The local clear is
/// authoritative — even if the revoke RPC fails, subsequent inference calls
/// will fail to authenticate and the IDE will surface a fresh sign-in.
pub async fn sign_out(_params: Value, services: &Services) -> Result<Value, DispatchError> {
    // Snapshot the bearer BEFORE clearing so we can revoke server-side. If
    // there is no bearer to start with, sign-out is a no-op success.
    let bearer = services
        .secrets
        .eri_session_token(services.host_client.as_deref())
        .await;
    services
        .secrets
        .clear(ERI_SESSION_PROVIDER, ERI_SESSION_FIELD)
        .await;
    services.clear_session().await;

    let revoked = match bearer {
        Some(token) => {
            let base_url = services.secrets.eri_base_url();
            // Best-effort — do not let a network failure block sign-out.
            match revoke_blocking(base_url, token).await {
                Ok(()) => true,
                Err(err) => {
                    // Never log the bearer; only the failure reason.
                    tracing::warn!(error = %err, "sign_out revoke RPC failed (ignored)");
                    false
                }
            }
        }
        None => false,
    };

    Ok(serde_json::json!({ "ok": true, "revoked": revoked }))
}

/// Common helper: GET a path under the eri.dev proxy with the session
/// bearer. Maps HTTP 402 to [`DispatchError::OverQuota`] so the IDE can
/// drive the upgrade dialog instead of a generic toast.
async fn proxy_get(services: &Services, path: &'static str) -> Result<Value, DispatchError> {
    let bearer = services
        .secrets
        .eri_session_token(services.host_client.as_deref())
        .await
        .ok_or_else(|| {
            DispatchError::BadParams("eri session token not available; user must sign in".into())
        })?;
    let base_url = services.secrets.eri_base_url();
    let url = format!("{}{}", base_url.trim_end_matches('/'), path);
    get_blocking(url, bearer).await
}

/// Run a synchronous `ureq` GET in a blocking task. Keeps the tokio runtime
/// free; `ureq` does not have an async surface so the spawn is necessary.
async fn get_blocking(url: String, bearer: String) -> Result<Value, DispatchError> {
    tokio::task::spawn_blocking(move || -> Result<Value, DispatchError> {
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(5))
            .timeout(Duration::from_secs(15))
            .build();
        let request = agent
            .get(&url)
            .set("accept", "application/json")
            .set("authorization", &format!("Bearer {bearer}"));
        match request.call() {
            Ok(response) => {
                let text = response
                    .into_string()
                    .map_err(|err| DispatchError::Other(anyhow::anyhow!(err.to_string())))?;
                serde_json::from_str::<Value>(&text)
                    .map_err(|err| DispatchError::Other(anyhow::anyhow!(err)))
            }
            Err(ureq::Error::Status(402, response)) => {
                let body = response.into_string().unwrap_or_default();
                Err(map_over_quota(&body))
            }
            Err(ureq::Error::Status(429, response)) => {
                let body = response.into_string().unwrap_or_default();
                Err(map_rate_limited(&body))
            }
            Err(ureq::Error::Status(status, response)) => {
                // Truncate body — it may carry HTML stack traces from upstream
                // proxies; we just need a code for the IDE.
                let body = response.into_string().unwrap_or_default();
                let snippet: String = body.chars().take(256).collect();
                Err(DispatchError::Other(anyhow::anyhow!(
                    "eri backend returned {status}: {snippet}"
                )))
            }
            Err(other) => Err(DispatchError::Other(anyhow::anyhow!(
                "eri backend transport: {other}"
            ))),
        }
    })
    .await
    .map_err(|err| DispatchError::Other(anyhow::anyhow!("blocking task join: {err}")))?
}

async fn revoke_blocking(base_url: String, bearer: String) -> anyhow::Result<()> {
    tokio::task::spawn_blocking(move || -> anyhow::Result<()> {
        let url = format!("{}{}", base_url.trim_end_matches('/'), REVOKE_PATH);
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(5))
            .timeout(Duration::from_secs(10))
            .build();
        let _ = agent
            .post(&url)
            .set("authorization", &format!("Bearer {bearer}"))
            .send_string("")
            .map_err(|err| anyhow::anyhow!(err.to_string()))?;
        Ok(())
    })
    .await
    .map_err(|err| anyhow::anyhow!("blocking task join: {err}"))?
}

/// Decode the backend's over-quota envelope into a structured dispatch
/// error. Falls back to opaque defaults when the body isn't the expected
/// shape so the IDE always gets a usable code.
fn map_over_quota(body: &str) -> DispatchError {
    let parsed: Result<OverQuotaBody, _> = serde_json::from_str(body);
    match parsed {
        Ok(payload) if payload.error.as_deref() == Some("over_quota") => DispatchError::OverQuota {
            tier: payload.tier.unwrap_or_else(|| "free".to_string()),
            remaining: payload.remaining.unwrap_or(0),
        },
        _ => DispatchError::OverQuota {
            tier: "free".to_string(),
            remaining: 0,
        },
    }
}

/// Decode the backend's rate-limit envelope into a structured dispatch
/// error. Falls back to opaque defaults when the body isn't the expected
/// shape so the IDE always gets a usable code.
pub(crate) fn map_rate_limited(body: &str) -> DispatchError {
    let parsed: Result<RateLimitedBody, _> = serde_json::from_str(body);
    match parsed {
        Ok(payload) if payload.error.as_deref() == Some("rate_limited") => {
            DispatchError::RateLimited {
                tier: payload.tier.unwrap_or_else(|| "free".to_string()),
                window: payload.window.unwrap_or_else(|| "minute".to_string()),
                reset_at: payload.reset_at.unwrap_or_default(),
            }
        }
        _ => DispatchError::RateLimited {
            tier: "free".to_string(),
            window: "minute".to_string(),
            reset_at: String::new(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn map_over_quota_parses_well_formed_envelope() {
        let body = r#"{"error":"over_quota","tier":"pro","remaining":42}"#;
        match map_over_quota(body) {
            DispatchError::OverQuota { tier, remaining } => {
                assert_eq!(tier, "pro");
                assert_eq!(remaining, 42);
            }
            other => panic!("expected OverQuota, got {other:?}"),
        }
    }

    #[test]
    fn map_over_quota_falls_back_on_garbage_body() {
        match map_over_quota("not json") {
            DispatchError::OverQuota { tier, remaining } => {
                assert_eq!(tier, "free");
                assert_eq!(remaining, 0);
            }
            other => panic!("expected OverQuota, got {other:?}"),
        }
    }

    #[test]
    fn map_rate_limited_parses_well_formed_envelope() {
        let body = r#"{"error":"rate_limited","tier":"pro","window":"minute","resetAt":"2026-05-26T16:42:00Z"}"#;
        match map_rate_limited(body) {
            DispatchError::RateLimited { tier, window, reset_at } => {
                assert_eq!(tier, "pro");
                assert_eq!(window, "minute");
                assert_eq!(reset_at, "2026-05-26T16:42:00Z");
            }
            other => panic!("expected RateLimited, got {other:?}"),
        }
    }

    #[test]
    fn map_rate_limited_falls_back_on_garbage_body() {
        match map_rate_limited("not json") {
            DispatchError::RateLimited { tier, window, reset_at } => {
                assert_eq!(tier, "free");
                assert_eq!(window, "minute");
                assert_eq!(reset_at, "");
            }
            other => panic!("expected RateLimited, got {other:?}"),
        }
    }

    #[test]
    fn map_over_quota_falls_back_when_error_field_missing() {
        // Valid JSON but no `error` field — still classify as OverQuota since
        // we only invoke this on a confirmed HTTP 402 response.
        let body = r#"{"tier":"free","remaining":0}"#;
        assert!(matches!(
            map_over_quota(body),
            DispatchError::OverQuota { .. }
        ));
    }

    #[tokio::test]
    async fn set_session_stores_user_id_on_services() {
        let services = Services::new();
        let params = serde_json::json!({ "userId": "  user_abc  " });
        let result = set_session(params, services.as_ref()).await.unwrap();
        assert_eq!(result, serde_json::json!({ "ok": true }));
        // user_id is trimmed before storage.
        assert_eq!(services.current_user_id().await.as_deref(), Some("user_abc"));
    }

    #[tokio::test]
    async fn set_session_rejects_empty_user_id() {
        let services = Services::new();
        let result = set_session(serde_json::json!({ "userId": "   " }), services.as_ref()).await;
        assert!(matches!(result, Err(DispatchError::BadParams(_))));
        // No state change on rejection.
        assert!(services.current_user_id().await.is_none());
    }

    #[tokio::test]
    async fn clear_session_drops_user_id_snapshot() {
        let services = Services::new();
        services.set_session_user("user_xyz").await;
        assert!(services.current_user_id().await.is_some());
        let result = clear_session(serde_json::json!({}), services.as_ref()).await.unwrap();
        assert_eq!(result, serde_json::json!({ "ok": true }));
        assert!(services.current_user_id().await.is_none());
    }
}
