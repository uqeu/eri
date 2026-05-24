//! Per-workspace stateful service handles for the JSON-RPC dispatcher.
//!
//! `Services` is a registry of long-lived handles (semantic index, MCP host)
//! keyed by absolute workspace path. Stateless services (rules, apply,
//! checkpoints, web/docs) don't need entries here — they accept a workspace
//! path on every call.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use eri_graph::Graph;
use eri_index::Index;
use eri_mcp::Mcp;
use eri_tab::LlamaTabEngine;
use tokio::sync::{Mutex, OnceCell, RwLock};

use crate::audit::AuditLogger;
use crate::host_client::{HostClient, SecretCache};

pub mod apply;
pub mod audit_svc;
pub mod brain;
pub mod checkpoints;
pub mod codemaps;
pub mod crash;
pub mod graph;
pub mod hooks;
pub mod index;
pub mod iterate;
pub mod mcp;
pub mod review;
pub mod rules;
pub mod skills;
pub mod tab;
pub mod web_docs;

/// Tracks an in-flight (or completed) model download so health/complete
/// can report progress to the IDE without restarting the download.
#[derive(Debug, Default, Clone)]
pub struct TabDownloadState {
    /// `Some(0.0..=1.0)` while downloading; `None` once finished or never started.
    pub progress: Option<f32>,
    pub error: Option<String>,
}

/// Long-lived per-workspace handles.
pub struct Services {
    /// Open `Index` per workspace. We hold an `Arc<Mutex<Index>>` for each
    /// workspace so concurrent calls serialise but don't reopen the SQLite
    /// database. The outer mutex guards insertion only.
    pub indexes: Mutex<HashMap<PathBuf, Arc<Mutex<Index>>>>,
    /// Live MCP hosts. `Mcp::shutdown` consumes the value, so we hold an
    /// `Option<Mcp>` we can `take()` out at shutdown time. The outer
    /// `Mutex<HashMap>` guards insertion; the inner `Mutex<Option<Mcp>>`
    /// serialises per-workspace use.
    pub mcps: Mutex<HashMap<PathBuf, Arc<Mutex<Option<Mcp>>>>>,
    /// Open agent-memory graphs per workspace. Same Arc<Mutex<...>> pattern
    /// as `indexes` so concurrent calls serialise but the SQLite connection
    /// isn't reopened on every dispatch.
    pub graphs: Mutex<HashMap<PathBuf, Arc<Mutex<Graph>>>>,
    /// Process-wide Tab inference engine. Loaded lazily on first call to
    /// `eri/tab/complete` or `eri/tab/preload`. Once loaded it's reused
    /// for every completion; process exit drops it.
    pub tab_engine: OnceCell<Arc<LlamaTabEngine>>,
    /// Live download progress for the Tab model. Surfaced via `eri/tab/health`.
    pub tab_download: RwLock<TabDownloadState>,
    /// Reverse JSON-RPC client used to ask the extension for BYOK secrets.
    /// `None` in tests that don't exercise the secret-fetch path; the
    /// binary always wires this up.
    pub host_client: Option<Arc<HostClient>>,
    /// Process-lifetime BYOK secret cache, shared across all dispatch
    /// handlers and inference providers.
    pub secrets: Arc<SecretCache>,
    /// Opt-in local audit log. Constructed at sidecar startup; defaults to
    /// disabled and is flipped on via `eri/audit/enable`.
    pub audit: Arc<AuditLogger>,
    /// Lazily-constructed brain instance shared across all `eri/brain/plan`
    /// calls. `None` until the first request, then populated and reused.
    pub brain: brain::SharedBrain,
}

impl Default for Services {
    fn default() -> Self {
        // Resolve the initial enabled flag from `ERI_AUDIT_ENABLED` so an
        // operator can pre-enable audit before the IDE has a chance to call
        // `eri/audit/enable`. Default disabled.
        let initial_enabled = std::env::var("ERI_AUDIT_ENABLED")
            .ok()
            .map(|v| matches!(v.as_str(), "1" | "true" | "TRUE" | "yes" | "on"))
            .unwrap_or(false);
        let audit = match AuditLogger::open(None, initial_enabled) {
            Ok(logger) => Arc::new(logger),
            Err(err) => {
                tracing::warn!(error = %err, "failed to open audit logger; using disabled fallback");
                Arc::new(AuditLogger::open_disabled_fallback())
            }
        };
        Self {
            indexes: Mutex::new(HashMap::new()),
            mcps: Mutex::new(HashMap::new()),
            graphs: Mutex::new(HashMap::new()),
            tab_engine: OnceCell::new(),
            tab_download: RwLock::new(TabDownloadState::default()),
            host_client: None,
            secrets: SecretCache::new(),
            audit,
            brain: Mutex::new(None),
        }
    }
}

impl Services {
    /// Build a `Services` registry without a host client. Used in tests and
    /// in code paths that never need to fetch BYOK secrets.
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    /// Build a `Services` registry wired up with the reverse-channel host
    /// client. The binary uses this so secret lookups can round-trip to the
    /// extension's `SecretStorage`.
    pub fn with_host(host: Arc<HostClient>) -> Arc<Self> {
        let mut services = Self::default();
        services.host_client = Some(host);
        Arc::new(services)
    }

    /// Convenience: resolve a secret using the cache + host + env chain.
    /// Returns `Ok(None)` when no secret is available from any source.
    pub async fn fetch_secret(
        &self,
        provider_id: &str,
        field_key: &str,
    ) -> anyhow::Result<Option<String>> {
        self.secrets
            .get_or_fetch(self.host_client.as_deref(), provider_id, field_key)
            .await
    }
}
