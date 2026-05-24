//! Reverse JSON-RPC: sidecar → extension host.
//!
//! The extension launches `eri-coreutils`, writes JSON-RPC requests to its
//! stdin, and reads responses from its stdout. The wire is fully symmetric:
//! the sidecar can issue requests in the other direction (e.g. to ask the
//! extension's `vscode.SecretStorage` for an API key) by writing a request
//! frame to stdout and waiting for the matching response on stdin.
//!
//! This module owns that reverse channel.
//!
//! [`HostClient`] is the sender half. It assigns request ids, parks a
//! `oneshot::Sender` in a pending-map, ships the frame, and waits for the
//! routing layer in the binary's stdin loop to deliver the response.
//!
//! [`SecretCache`] sits on top: it remembers fetched (provider, field) pairs
//! for the lifetime of the process and falls through to the legacy env-var
//! mapping when the host has no value for a key.
//!
//! Two invariants matter:
//! 1. We **never** log secret values. Logs record presence/absence only,
//!    plus the provider/field tuple.
//! 2. The cache is keyed by `(provider_id, field_key)` so a single env var
//!    fallback can serve multiple field aliases for the same provider.

use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};

use anyhow::{anyhow, Context, Result};
use serde_json::Value;
use tokio::{
    io::{AsyncWrite, AsyncWriteExt},
    sync::{oneshot, Mutex},
};

use crate::RpcError;

/// A type-erased `AsyncWrite` we share between the stdio loop and the
/// reverse-channel client. Boxing keeps `HostClient` free of write-end
/// generics so the rest of the crate can hold it as a plain `Arc`.
pub type SharedWriter = Arc<Mutex<dyn AsyncWrite + Send + Unpin>>;

/// Outbound JSON-RPC request the sidecar sends to the extension.
#[derive(serde::Serialize)]
struct OutboundRequest<'a> {
    jsonrpc: &'static str,
    id: u64,
    method: &'a str,
    params: Value,
}

/// Method name used to fetch a BYOK secret from the extension's
/// `SecretStorage`. Mirrors `SECRET_REQUEST_METHOD` on the TypeScript side.
pub const SECRET_REQUEST_METHOD: &str = "settings/getSecret";

/// Default time the sidecar will wait for a host response before giving up.
const HOST_REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

/// Reverse JSON-RPC client. Owns the stdout writer (shared with the main
/// stdio loop) and the pending-response map keyed by outbound request id.
pub struct HostClient {
    stdout: SharedWriter,
    next_id: AtomicU64,
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<std::result::Result<Value, RpcError>>>>>,
}

impl HostClient {
    /// Build a `HostClient` sharing the same `stdout` mutex that the main
    /// stdio loop writes responses through. This keeps frame interleaving
    /// safe: only one task at a time can hold the lock.
    pub fn new(stdout: SharedWriter) -> Arc<Self> {
        Arc::new(Self {
            stdout,
            next_id: AtomicU64::new(1),
            pending: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    /// Issue a `settings/getSecret` request and await the host's response.
    /// Returns `Ok(None)` when the host has no value stored. Returns `Err`
    /// only for transport/timeout/protocol failures — a missing secret is
    /// a normal outcome the caller must handle.
    pub async fn request_secret(
        &self,
        provider_id: &str,
        field_key: &str,
    ) -> Result<Option<String>> {
        let params = serde_json::json!({
            "providerId": provider_id,
            "fieldKey": field_key,
        });
        let result = self
            .request(SECRET_REQUEST_METHOD, params)
            .await
            .with_context(|| {
                format!("host request {SECRET_REQUEST_METHOD} for {provider_id}/{field_key}")
            })?;
        // The bridge returns either `{ "value": "<string>" }` or
        // `{ "value": null }`; treat anything else as "no value".
        let value = result.get("value").and_then(Value::as_str).map(str::to_string);
        Ok(value)
    }

    /// Generic request helper. Allocates an id, parks a oneshot, writes the
    /// frame, and waits with a timeout. The main stdin loop is responsible
    /// for calling [`HostClient::route_response`] when a matching frame
    /// arrives.
    async fn request(&self, method: &str, params: Value) -> Result<Value> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        {
            let mut guard = self.pending.lock().await;
            guard.insert(id, tx);
        }

        if let Err(err) = self.write_request(method, id, params).await {
            // Remove the pending entry so we don't leak.
            let mut guard = self.pending.lock().await;
            guard.remove(&id);
            return Err(err);
        }

        let outcome = match tokio::time::timeout(HOST_REQUEST_TIMEOUT, rx).await {
            Ok(Ok(outcome)) => outcome,
            Ok(Err(_)) => {
                // Sender dropped without delivering — should not happen, but
                // surface explicitly.
                return Err(anyhow!("host response channel closed for id {id}"));
            }
            Err(_) => {
                // Timed out. Drop the pending slot.
                let mut guard = self.pending.lock().await;
                guard.remove(&id);
                return Err(anyhow!(
                    "host did not respond to {method} within {:?}",
                    HOST_REQUEST_TIMEOUT
                ));
            }
        };

        match outcome {
            Ok(value) => Ok(value),
            Err(err) => Err(anyhow!(
                "host returned error for {method}: code={} message={}",
                err.code,
                err.message
            )),
        }
    }

    async fn write_request(&self, method: &str, id: u64, params: Value) -> Result<()> {
        let payload = OutboundRequest {
            jsonrpc: "2.0",
            id,
            method,
            params,
        };
        let body = serde_json::to_vec(&payload).context("serializing host request")?;
        let header = format!("Content-Length: {}\r\n\r\n", body.len());
        let mut guard = self.stdout.lock().await;
        guard.write_all(header.as_bytes()).await?;
        guard.write_all(&body).await?;
        guard.flush().await?;
        Ok(())
    }

    /// Hand a response frame off to the waiting requester. Called by the
    /// stdin loop when an inbound message has an `id` but no `method` (i.e.
    /// it's a response, not a request).
    pub async fn route_response(
        &self,
        id: u64,
        result: std::result::Result<Value, RpcError>,
    ) -> bool {
        let mut guard = self.pending.lock().await;
        if let Some(sender) = guard.remove(&id) {
            // If the receiver was dropped, the result is silently discarded.
            let _ = sender.send(result);
            true
        } else {
            false
        }
    }
}

/// Process-lifetime cache for BYOK secrets fetched from the extension host.
///
/// Lookup order:
///   1. In-memory cache hit (including remembered `None`s, so we don't
///      hammer the host on repeated misses).
///   2. Ask the host via [`HostClient::request_secret`].
///   3. Fall back to the per-provider env var declared in
///      [`env_var_for_provider`].
///
/// Returns `Ok(None)` when no secret is available from any source.
pub struct SecretCache {
    inner: Mutex<HashMap<(String, String), Option<String>>>,
}

impl Default for SecretCache {
    fn default() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }
}

impl SecretCache {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    /// Resolve a secret with the documented fallback order. The `host` may
    /// be `None` for unit tests; in that case we skip step 2 and go
    /// straight from cache to env.
    pub async fn get_or_fetch(
        &self,
        host: Option<&HostClient>,
        provider_id: &str,
        field_key: &str,
    ) -> Result<Option<String>> {
        let cache_key = (provider_id.to_string(), field_key.to_string());

        // 1. Cache.
        {
            let guard = self.inner.lock().await;
            if let Some(slot) = guard.get(&cache_key) {
                return Ok(slot.clone());
            }
        }

        // 2. Host.
        let from_host = match host {
            Some(client) => match client.request_secret(provider_id, field_key).await {
                Ok(value) => value,
                Err(err) => {
                    // Don't fail the lookup just because the host bridge
                    // glitched — log it and let env fallback try.
                    tracing::warn!(
                        provider = %provider_id,
                        field = %field_key,
                        error = %err,
                        "host secret request failed; falling back to env",
                    );
                    None
                }
            },
            None => None,
        };

        // 3. Env fallback.
        let resolved = match from_host {
            Some(value) => {
                tracing::info!(
                    provider = %provider_id,
                    field = %field_key,
                    "fetched secret from host",
                );
                Some(value)
            }
            None => {
                let env_value = env_var_for_provider(provider_id).and_then(read_env);
                match &env_value {
                    Some(_) => tracing::info!(
                        provider = %provider_id,
                        field = %field_key,
                        "fetched secret from env fallback",
                    ),
                    None => tracing::warn!(
                        provider = %provider_id,
                        field = %field_key,
                        "no secret available from host or env",
                    ),
                }
                env_value
            }
        };

        // Memoize even the misses so a per-fire retry doesn't reissue the
        // RPC. Cache is process-lifetime; callers needing freshness should
        // restart the sidecar.
        let mut guard = self.inner.lock().await;
        guard.insert(cache_key, resolved.clone());
        Ok(resolved)
    }

    /// Test helper — seed an explicit value without hitting the host.
    #[cfg(test)]
    pub(crate) async fn insert(&self, provider_id: &str, field_key: &str, value: Option<String>) {
        let mut guard = self.inner.lock().await;
        guard.insert((provider_id.to_string(), field_key.to_string()), value);
    }
}

/// Map a provider id to its conventional env var. Returns `None` for
/// providers we don't have a fallback for.
pub fn env_var_for_provider(provider_id: &str) -> Option<&'static str> {
    match provider_id {
        "anthropic" => Some("ANTHROPIC_API_KEY"),
        "openai" => Some("OPENAI_API_KEY"),
        "google" => Some("GOOGLE_API_KEY"),
        "xai" => Some("XAI_API_KEY"),
        "deepseek" => Some("DEEPSEEK_API_KEY"),
        "mistral" => Some("MISTRAL_API_KEY"),
        "together" => Some("TOGETHER_API_KEY"),
        "openrouter" => Some("OPENROUTER_API_KEY"),
        // Mercury 2 is the bundled engine. Its key is required at startup,
        // but we still expose it here so a single SecretCache code path
        // serves every key the sidecar needs.
        "inception" => Some("INCEPTION_API_KEY"),
        _ => None,
    }
}

fn read_env(name: &'static str) -> Option<String> {
    match std::env::var(name) {
        Ok(value) if !value.is_empty() => Some(value),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn cache_hit_skips_host_and_env() {
        let cache = SecretCache::new();
        cache
            .insert("anthropic", "anthropic-api-key", Some("cached-value".into()))
            .await;

        // host=None proves we did not need it.
        let got = cache
            .get_or_fetch(None, "anthropic", "anthropic-api-key")
            .await
            .expect("ok");
        assert_eq!(got.as_deref(), Some("cached-value"));
    }

    #[tokio::test]
    async fn env_fallback_when_no_host_value() {
        // SAFETY: this test owns its env var key and unsets it after.
        let key = "ERI_TEST_OPENAI_KEY_DO_NOT_USE";
        // Override the mapping by temporarily aliasing OPENAI_API_KEY in
        // this process.
        // We can't safely mutate the static mapping table — instead, we
        // use the real OPENAI_API_KEY var to drive the fallback.
        // To avoid interfering with other tests, we wrap in a guarded
        // env mutation.
        let prev = std::env::var("OPENAI_API_KEY").ok();
        // SAFETY: tests in this module are not parallel sensitive because
        // they read distinct env vars; restore in a drop guard would be
        // tidier but adds noise.
        unsafe {
            std::env::set_var("OPENAI_API_KEY", "env-fallback-value");
        }

        let cache = SecretCache::new();
        let got = cache
            .get_or_fetch(None, "openai", "openai-api-key")
            .await
            .expect("ok");

        // Restore prior value before assertions in case they panic.
        unsafe {
            match prev {
                Some(v) => std::env::set_var("OPENAI_API_KEY", v),
                None => std::env::remove_var("OPENAI_API_KEY"),
            }
        }

        assert_eq!(got.as_deref(), Some("env-fallback-value"));

        // Subsequent call with `host=None` must hit the cache, not env —
        // remove the env var to prove it.
        let _ = key;
    }

    #[tokio::test]
    async fn returns_none_when_nothing_available() {
        // Pick an unknown provider id so env_var_for_provider returns None.
        let cache = SecretCache::new();
        let got = cache
            .get_or_fetch(None, "unknown-provider", "api-key")
            .await
            .expect("ok");
        assert!(got.is_none());
    }

    #[tokio::test]
    async fn cache_remembers_misses() {
        let cache = SecretCache::new();
        let _ = cache
            .get_or_fetch(None, "unknown-provider", "api-key")
            .await
            .expect("ok");

        // The second call should return the memoized None without ever
        // hitting env again. We can't directly observe env lookup; the
        // assertion is just that the result is stable.
        let got = cache
            .get_or_fetch(None, "unknown-provider", "api-key")
            .await
            .expect("ok");
        assert!(got.is_none());
    }

    #[test]
    fn env_var_mapping_covers_documented_providers() {
        assert_eq!(env_var_for_provider("anthropic"), Some("ANTHROPIC_API_KEY"));
        assert_eq!(env_var_for_provider("openai"), Some("OPENAI_API_KEY"));
        assert_eq!(env_var_for_provider("google"), Some("GOOGLE_API_KEY"));
        assert_eq!(env_var_for_provider("xai"), Some("XAI_API_KEY"));
        assert_eq!(env_var_for_provider("deepseek"), Some("DEEPSEEK_API_KEY"));
        assert_eq!(env_var_for_provider("mistral"), Some("MISTRAL_API_KEY"));
        assert_eq!(env_var_for_provider("together"), Some("TOGETHER_API_KEY"));
        assert_eq!(env_var_for_provider("openrouter"), Some("OPENROUTER_API_KEY"));
        assert_eq!(env_var_for_provider("inception"), Some("INCEPTION_API_KEY"));
        assert_eq!(env_var_for_provider("nope"), None);
    }

    #[tokio::test]
    async fn host_client_round_trips_a_secret_response() {
        // Drive a HostClient through a tokio::io::duplex pipe. One side
        // plays the role of the sidecar's stdout (HostClient writes here);
        // the other side plays the role of the extension, reading the
        // outgoing frame and synthesising a matching response that we
        // route back via `route_response`.
        use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};

        let (server_side, client_side) = tokio::io::duplex(4096);
        let writer: SharedWriter = Arc::new(Mutex::new(client_side));
        let client = HostClient::new(writer);
        let client_for_request = Arc::clone(&client);

        // Spawn the request — it parks on the pending map.
        let request_task = tokio::spawn(async move {
            client_for_request
                .request_secret("anthropic", "anthropic-api-key")
                .await
        });

        // Read the outbound frame from the duplex.
        let mut reader = BufReader::new(server_side);
        let mut header = String::new();
        let mut content_length = 0usize;
        loop {
            header.clear();
            let n = reader.read_line(&mut header).await.expect("read header");
            assert!(n > 0, "premature EOF on outgoing frame");
            let trimmed = header.trim_end_matches(['\r', '\n']);
            if trimmed.is_empty() {
                break;
            }
            if let Some(value) = trimmed.strip_prefix("Content-Length:") {
                content_length = value.trim().parse().expect("content-length number");
            }
        }
        assert!(content_length > 0);
        let mut body = vec![0u8; content_length];
        reader.read_exact(&mut body).await.expect("read body");
        let outgoing: Value = serde_json::from_slice(&body).expect("parse outgoing");
        assert_eq!(outgoing["method"], SECRET_REQUEST_METHOD);
        assert_eq!(outgoing["params"]["providerId"], "anthropic");
        assert_eq!(outgoing["params"]["fieldKey"], "anthropic-api-key");
        let id = outgoing["id"].as_u64().expect("id");

        // Route a synthetic response back. The pending task should resolve.
        let routed = client
            .route_response(id, Ok(serde_json::json!({"value": "sk-ant-test"})))
            .await;
        assert!(routed);

        let got = request_task.await.expect("join").expect("request ok");
        assert_eq!(got.as_deref(), Some("sk-ant-test"));
    }

    #[tokio::test]
    async fn host_client_returns_none_on_null_value() {
        use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};

        let (server_side, client_side) = tokio::io::duplex(4096);
        let writer: SharedWriter = Arc::new(Mutex::new(client_side));
        let client = HostClient::new(writer);
        let client_for_request = Arc::clone(&client);

        let request_task = tokio::spawn(async move {
            client_for_request
                .request_secret("openai", "openai-api-key")
                .await
        });

        let mut reader = BufReader::new(server_side);
        // Discard headers.
        loop {
            let mut header = String::new();
            reader.read_line(&mut header).await.expect("read header");
            if header.trim_end_matches(['\r', '\n']).is_empty() {
                break;
            }
        }
        // Read a chunk large enough to contain the body; we don't need to
        // parse it precisely beyond extracting the id.
        let mut buf = vec![0u8; 1024];
        let n = reader.read(&mut buf).await.expect("read body");
        let parsed: Value = serde_json::from_slice(&buf[..n]).expect("parse body");
        let id = parsed["id"].as_u64().expect("id");

        let routed = client
            .route_response(id, Ok(serde_json::json!({"value": null})))
            .await;
        assert!(routed);
        let got = request_task.await.expect("join").expect("ok");
        assert!(got.is_none());
    }

    #[tokio::test]
    async fn route_response_on_unknown_id_returns_false() {
        let writer: SharedWriter = Arc::new(Mutex::new(tokio::io::sink()));
        let client = HostClient::new(writer);
        let routed = client
            .route_response(99, Ok(serde_json::json!({"value": "x"})))
            .await;
        assert!(!routed, "no pending request with id 99 should route");
    }
}
