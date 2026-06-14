//! `EriApiClient` — the one place that knows how to reach the eri API.
//!
//! The memory transports (Tier-B [`super::sync::HttpSyncTransport`] and, from
//! Phase 1, the Tier-A profile push) both need the same plumbing: a `ureq`
//! agent with sane timeouts, the `ERI_API_BASE` resolution, the `Bearer
//! eri_sk_…` header, and HTTP-status classification. Hand-rolling that per
//! transport is the shallow duplication the architecture review flagged; this
//! is the deep client they adapt over, so TLS posture, base-URL discovery, and
//! bearer handling live (and are audited) in exactly one spot.

use std::time::Duration;

use super::sync::SyncError;

const DEFAULT_API_BASE: &str = "https://eri.dev";
const API_BASE_ENV: &str = "ERI_API_BASE";

/// Resolve the eri API base URL from the (optional) `ERI_API_BASE` value:
/// trimmed + trailing-slash-stripped, falling back to the default when unset or
/// blank. Pure so the resolution is testable without touching the environment.
fn resolve_api_base(env_val: Option<&str>) -> String {
    env_val
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(|v| v.trim_end_matches('/').to_string())
        .unwrap_or_else(|| DEFAULT_API_BASE.to_string())
}

/// An authenticated client for the eri API, scoped to one `eri_sk_…` bearer.
pub struct EriApiClient {
    api_base: String,
    bearer: String,
    http: ureq::Agent,
}

impl EriApiClient {
    /// Build a client reading the base URL from `ERI_API_BASE` (default
    /// `https://eri.dev`).
    pub fn new(bearer: impl Into<String>) -> Self {
        let api_base = resolve_api_base(std::env::var(API_BASE_ENV).ok().as_deref());
        Self::with_base(api_base, bearer)
    }

    /// Build a client against an explicit base URL (tests / callers that already
    /// resolved it).
    pub fn with_base(api_base: impl Into<String>, bearer: impl Into<String>) -> Self {
        let api_base = api_base.into().trim_end_matches('/').to_string();
        // The bearer + (E2E) blob must never cross plaintext HTTP. Loud in dev;
        // HTTPS is enforced for real in prod by the deployed base URL (sec L-3).
        debug_assert!(
            api_base.starts_with("https://") || api_base.starts_with("http://localhost"),
            "EriApiClient requires HTTPS; got: {api_base}"
        );
        let http = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(5))
            .timeout(Duration::from_secs(30))
            .build();
        Self {
            api_base,
            bearer: bearer.into(),
            http,
        }
    }

    pub fn api_base(&self) -> &str {
        &self.api_base
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.api_base, path)
    }

    fn auth(&self) -> String {
        format!("Bearer {}", self.bearer)
    }

    /// Refuse to transmit the bearer (and any blob) over cleartext HTTP — a hard
    /// runtime check in *release* too, not just the debug-only constructor assert
    /// (security: L1). localhost is allowed for local dev.
    fn ensure_secure(&self) -> Result<(), SyncError> {
        if self.api_base.starts_with("https://") || self.api_base.starts_with("http://localhost") {
            Ok(())
        } else {
            Err(SyncError::Transport(
                "refusing to send credentials over insecure HTTP".to_string(),
            ))
        }
    }

    /// GET `path`, returning the response body as a string. Non-2xx and network
    /// failures map to [`SyncError::Transport`] (status only, never the body).
    pub fn get(&self, path: &str) -> Result<String, SyncError> {
        self.ensure_secure()?;
        match self
            .http
            .get(&self.url(path))
            .set("authorization", &self.auth())
            .call()
        {
            Ok(response) => response
                .into_string()
                .map_err(|e| SyncError::Transport(e.to_string())),
            Err(ureq::Error::Status(status, _)) => Err(SyncError::Transport(format!(
                "GET {path} returned {status}"
            ))),
            Err(other) => Err(SyncError::Transport(other.to_string())),
        }
    }

    /// PUT a JSON `body` to `path`. Non-2xx and network failures map to
    /// [`SyncError::Transport`].
    pub fn put_json(&self, path: &str, body: &str) -> Result<(), SyncError> {
        self.ensure_secure()?;
        match self
            .http
            .put(&self.url(path))
            .set("authorization", &self.auth())
            .set("content-type", "application/json")
            .send_string(body)
        {
            Ok(_) => Ok(()),
            Err(ureq::Error::Status(status, _)) => Err(SyncError::Transport(format!(
                "PUT {path} returned {status}"
            ))),
            Err(other) => Err(SyncError::Transport(other.to_string())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_api_base_falls_back_to_default_when_unset_or_blank() {
        assert_eq!(resolve_api_base(None), DEFAULT_API_BASE);
        assert_eq!(resolve_api_base(Some("   ")), DEFAULT_API_BASE);
    }

    #[test]
    fn resolve_api_base_trims_whitespace_and_trailing_slashes() {
        assert_eq!(
            resolve_api_base(Some("  https://x.dev/  ")),
            "https://x.dev"
        );
        assert_eq!(resolve_api_base(Some("https://x.dev///")), "https://x.dev");
    }

    #[test]
    fn with_base_strips_trailing_slash() {
        let c = EriApiClient::with_base("https://x.dev/", "eri_sk_test");
        assert_eq!(c.api_base(), "https://x.dev");
    }
}
