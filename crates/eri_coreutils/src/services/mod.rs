//! Per-workspace stateful service handles for the JSON-RPC dispatcher.
//!
//! `Services` is a registry of long-lived handles (semantic index, MCP host)
//! keyed by absolute workspace path. Stateless services (rules, apply,
//! checkpoints, web/docs) don't need entries here — they accept a workspace
//! path on every call.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use eri_index::Index;
use eri_mcp::Mcp;
use tokio::sync::Mutex;

pub mod apply;
pub mod checkpoints;
pub mod index;
pub mod mcp;
pub mod rules;
pub mod tab;
pub mod web_docs;

/// Long-lived per-workspace handles.
#[derive(Default)]
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
}

impl Services {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }
}
