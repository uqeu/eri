//! Observation collectors — typed wrappers around `MemoryStore::insert`.
//!
//! Each collector knows the canonical `kind` string and body shape for its
//! observation type, so callers don't have to remember the JSON keys. The
//! `body` column stays JSON-stringified in the underlying store so v2's
//! schema migration can extend without breaking older data.

use std::io;
use std::path::Path;

use serde::Serialize;

use super::MemoryStore;

#[derive(Serialize)]
struct EditOutcome<'a> {
    path: &'a str,
    summary: &'a str,
}

/// Record one diff-review outcome from `ApplyOrchestrator`.
pub fn observe_edit_outcome(
    store: &mut MemoryStore,
    workspace: &Path,
    path: &str,
    summary: &str,
    accepted: bool,
) -> io::Result<()> {
    let kind = if accepted {
        "edit_accepted"
    } else {
        "edit_rejected"
    };
    let body = serde_json::to_string(&EditOutcome { path, summary }).map_err(|e| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!("serialize outcome: {e}"),
        )
    })?;
    store.insert(kind, workspace, &body)?;
    Ok(())
}

/// Record one voice-cadence signal — short utterance, long pause, etc.
/// Stored as plain prose, no structure required.
pub fn observe_voice_pattern(
    store: &mut MemoryStore,
    workspace: &Path,
    note: &str,
) -> io::Result<()> {
    store.insert("voice_pattern", workspace, note)?;
    Ok(())
}

/// Record an explicit user-supplied fact via `/remember <text>`. Returns
/// the stored observation by value so the borrow on `store` ends with the
/// call — keeps callers from holding onto a `MemoryStore` reference.
pub fn remember_fact(
    store: &mut MemoryStore,
    workspace: &Path,
    text: &str,
) -> io::Result<super::Observation> {
    store.insert("fact", workspace, text)
}
