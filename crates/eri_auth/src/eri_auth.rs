//! Client-side auth foundation for eri.
//!
//! Wraps the `eri.dev` REST auth endpoints in a synchronous [`AuthClient`]
//! built on `ureq`, and stores the long-lived refresh token in the OS
//! keychain via [`keyring`]. The short-lived access token is intentionally
//! never persisted: callers keep it in memory for the session and re-issue
//! via [`AuthClient::refresh`] when it expires.
//!
//! The HTTP contract is fixed by the backend agent — see this module's
//! [`endpoints`] for the exact paths.
//!
//! The keychain plumbing is abstracted behind [`RefreshTokenStore`] so tests
//! can swap in an in-memory implementation via the `test-support` cargo
//! feature instead of hitting the real OS keychain.

use std::time::Duration;

#[cfg(feature = "test-support")]
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use thiserror::Error;

const DEFAULT_API_BASE: &str = "https://eri.dev";
const API_BASE_ENV: &str = "ERI_API_BASE";
const KEYRING_SERVICE: &str = "eri";
const KEYRING_USER: &str = "refresh_token";

/// REST endpoints contracted with the backend auth API. Kept here so callers
/// (and tests) can read off the canonical paths without grepping the request
/// builders.
pub mod endpoints {
    pub const SIGNUP: &str = "/api/auth/signup";
    pub const LOGIN: &str = "/api/auth/login";
    pub const REFRESH: &str = "/api/auth/refresh";
    pub const LOGOUT: &str = "/api/auth/logout";
    pub const ME: &str = "/api/auth/me";
    pub const PASSWORD_RESET: &str = "/api/auth/password-reset";
}

#[derive(Debug, Error)]
pub enum AuthError {
    #[error("auth transport error: {0}")]
    Transport(String),
    #[error("bad credentials")]
    BadCredentials,
    #[error("an account already exists for that email")]
    UserExists,
    #[error("not found")]
    NotFound,
    #[error("network error: {0}")]
    Network(#[from] Box<ureq::Error>),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("keychain error: {0}")]
    Keychain(String),
    #[error("ERI_API_BASE is empty")]
    NoApiBase,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SubscriptionTier {
    #[default]
    Free,
    Starter,
    Pro,
    ProPlus,
    Teams,
    Enterprise,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct UserProfile {
    pub id: String,
    pub email: String,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub tier: SubscriptionTier,
    pub created_at: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuthTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: i64,
    pub user: UserProfile,
}

#[derive(Serialize)]
struct CredentialsBody<'a> {
    email: &'a str,
    password: &'a str,
}

#[derive(Serialize)]
struct RefreshBody<'a> {
    refresh_token: &'a str,
}

#[derive(Serialize)]
struct EmailBody<'a> {
    email: &'a str,
}

#[derive(Deserialize)]
struct MeResponse {
    user: UserProfile,
}

pub struct AuthClient {
    api_base: String,
    http: ureq::Agent,
}

impl AuthClient {
    /// Build an `AuthClient`. Reads `ERI_API_BASE` if set, otherwise points at
    /// `https://eri.dev`. An empty env var is rejected so callers fail fast
    /// instead of silently aiming at `""`.
    pub fn new() -> Result<Self, AuthError> {
        let api_base = match std::env::var(API_BASE_ENV) {
            Ok(value) => {
                let trimmed = value.trim();
                if trimmed.is_empty() {
                    return Err(AuthError::NoApiBase);
                }
                trimmed.trim_end_matches('/').to_string()
            }
            Err(_) => DEFAULT_API_BASE.to_string(),
        };
        let http = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(5))
            .timeout(Duration::from_secs(30))
            .build();
        Ok(Self { api_base, http })
    }

    /// Build an `AuthClient` against a caller-supplied base URL. Used by tests
    /// (which point at a `httpmock` server) and by callers who want to skip
    /// the env-var dance.
    pub fn with_api_base(api_base: impl Into<String>) -> Self {
        let api_base = api_base.into().trim_end_matches('/').to_string();
        let http = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(5))
            .timeout(Duration::from_secs(30))
            .build();
        Self { api_base, http }
    }

    pub fn api_base(&self) -> &str {
        &self.api_base
    }

    pub fn signup(&self, email: &str, password: &str) -> Result<AuthTokens, AuthError> {
        let body = serde_json::to_string(&CredentialsBody { email, password })?;
        let response = self.post_json(endpoints::SIGNUP, &body, None)?;
        let tokens: AuthTokens = serde_json::from_str(&response)?;
        Ok(tokens)
    }

    pub fn login(&self, email: &str, password: &str) -> Result<AuthTokens, AuthError> {
        let body = serde_json::to_string(&CredentialsBody { email, password })?;
        let response = self.post_json(endpoints::LOGIN, &body, None)?;
        let tokens: AuthTokens = serde_json::from_str(&response)?;
        Ok(tokens)
    }

    pub fn refresh(&self, refresh_token: &str) -> Result<AuthTokens, AuthError> {
        let body = serde_json::to_string(&RefreshBody { refresh_token })?;
        let response = self.post_json(endpoints::REFRESH, &body, None)?;
        let tokens: AuthTokens = serde_json::from_str(&response)?;
        Ok(tokens)
    }

    pub fn logout(&self, refresh_token: &str) -> Result<(), AuthError> {
        let body = serde_json::to_string(&RefreshBody { refresh_token })?;
        self.post_json(endpoints::LOGOUT, &body, None)?;
        Ok(())
    }

    pub fn me(&self, access_token: &str) -> Result<UserProfile, AuthError> {
        let url = format!("{}{}", self.api_base, endpoints::ME);
        let bearer = format!("Bearer {}", access_token);
        let response = self
            .http
            .get(&url)
            .set("authorization", &bearer)
            .set("accept", "application/json")
            .call();
        let body = match response {
            Ok(response) => response
                .into_string()
                .map_err(|error| AuthError::Transport(error.to_string()))?,
            Err(ureq::Error::Status(status, response)) => {
                return Err(classify_status(status, response));
            }
            Err(other) => return Err(AuthError::Network(Box::new(other))),
        };
        // Backend may return either a bare profile or `{ "user": { ... } }`.
        // Accept both so we don't fight the API agent over envelope shape.
        if let Ok(envelope) = serde_json::from_str::<MeResponse>(&body) {
            return Ok(envelope.user);
        }
        let profile: UserProfile = serde_json::from_str(&body)?;
        Ok(profile)
    }

    pub fn request_password_reset(&self, email: &str) -> Result<(), AuthError> {
        let body = serde_json::to_string(&EmailBody { email })?;
        self.post_json(endpoints::PASSWORD_RESET, &body, None)?;
        Ok(())
    }

    fn post_json(&self, path: &str, body: &str, bearer: Option<&str>) -> Result<String, AuthError> {
        let url = format!("{}{}", self.api_base, path);
        let mut request = self
            .http
            .post(&url)
            .set("content-type", "application/json")
            .set("accept", "application/json");
        if let Some(token) = bearer {
            let header = format!("Bearer {}", token);
            request = request.set("authorization", &header);
        }
        match request.send_string(body) {
            Ok(response) => response
                .into_string()
                .map_err(|error| AuthError::Transport(error.to_string())),
            Err(ureq::Error::Status(status, response)) => Err(classify_status(status, response)),
            Err(other) => Err(AuthError::Network(Box::new(other))),
        }
    }
}

fn classify_status(status: u16, response: ureq::Response) -> AuthError {
    match status {
        401 | 403 => AuthError::BadCredentials,
        404 => AuthError::NotFound,
        409 => AuthError::UserExists,
        _ => {
            let body = response.into_string().unwrap_or_default();
            AuthError::Transport(format!("auth endpoint returned {status}: {body}"))
        }
    }
}

/// Storage trait for the long-lived refresh token. The production
/// implementation routes through the OS keychain via [`keyring`]; tests
/// substitute an in-memory store via the `test-support` cargo feature so they
/// never touch the real keychain in CI.
pub trait RefreshTokenStore: Send + Sync {
    fn save(&self, token: &str) -> Result<(), AuthError>;
    fn load(&self) -> Result<Option<String>, AuthError>;
    fn clear(&self) -> Result<(), AuthError>;
}

/// Default keychain-backed store. Uses `keyring::Entry` under the
/// `service = "eri"` / `user = "refresh_token"` slot.
pub struct KeyringStore;

impl KeyringStore {
    pub fn new() -> Self {
        Self
    }

    fn entry() -> Result<keyring::Entry, AuthError> {
        keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
            .map_err(|error| AuthError::Keychain(error.to_string()))
    }
}

impl Default for KeyringStore {
    fn default() -> Self {
        Self::new()
    }
}

impl RefreshTokenStore for KeyringStore {
    fn save(&self, token: &str) -> Result<(), AuthError> {
        let entry = Self::entry()?;
        entry
            .set_password(token)
            .map_err(|error| AuthError::Keychain(error.to_string()))
    }

    fn load(&self) -> Result<Option<String>, AuthError> {
        let entry = Self::entry()?;
        match entry.get_password() {
            Ok(token) => Ok(Some(token)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(AuthError::Keychain(error.to_string())),
        }
    }

    fn clear(&self) -> Result<(), AuthError> {
        let entry = Self::entry()?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(AuthError::Keychain(error.to_string())),
        }
    }
}

/// Persist `token` to the OS keychain. Convenience wrapper around
/// [`KeyringStore::save`] for callers that don't want to thread a store
/// through their call sites.
pub fn save_refresh_token(token: &str) -> Result<(), AuthError> {
    KeyringStore::new().save(token)
}

pub fn load_refresh_token() -> Result<Option<String>, AuthError> {
    KeyringStore::new().load()
}

pub fn clear_refresh_token() -> Result<(), AuthError> {
    KeyringStore::new().clear()
}

/// In-memory refresh-token store. Gated behind the `test-support` feature so
/// it never ships in release binaries and so CI doesn't accidentally hit the
/// real keychain. Implements the same [`RefreshTokenStore`] contract.
#[cfg(feature = "test-support")]
pub struct MemoryStore {
    slot: Mutex<Option<String>>,
}

#[cfg(feature = "test-support")]
impl MemoryStore {
    pub fn new() -> Self {
        Self {
            slot: Mutex::new(None),
        }
    }
}

#[cfg(feature = "test-support")]
impl Default for MemoryStore {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(feature = "test-support")]
impl RefreshTokenStore for MemoryStore {
    fn save(&self, token: &str) -> Result<(), AuthError> {
        let mut slot = self
            .slot
            .lock()
            .map_err(|error| AuthError::Keychain(error.to_string()))?;
        *slot = Some(token.to_string());
        Ok(())
    }

    fn load(&self) -> Result<Option<String>, AuthError> {
        let slot = self
            .slot
            .lock()
            .map_err(|error| AuthError::Keychain(error.to_string()))?;
        Ok(slot.clone())
    }

    fn clear(&self) -> Result<(), AuthError> {
        let mut slot = self
            .slot
            .lock()
            .map_err(|error| AuthError::Keychain(error.to_string()))?;
        *slot = None;
        Ok(())
    }
}
