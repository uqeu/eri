//! `eri sync` — mirror local memory to the cloud (ADR-0001).
//!
//! Two tiers, one command:
//!   - **Tier-B** (the full memory blob) round-trips E2E-encrypted under
//!     `K_user` and converges via merge, so memory follows you across devices.
//!   - **Tier-A** (the small, server-readable personalization profile) is pushed
//!     so phone eri actually knows your day.
//!
//! The `eri_inference` transports are blocking (`ureq`); this module runs them
//! off the async runtime via `spawn_blocking`, so the tokio reactor is never
//! stalled. Auth + base URL come from the signed-in credentials — the same ones
//! the rest of the CLI uses.

use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};
use eri_inference::memory::{
    MemoryStore,
    keys::{KeychainStore, k_user},
    profile,
    profile_sync::{HttpProfileTransport, push_profile},
    sync::{HttpSyncTransport, MemorySync},
};

use crate::config;

/// What a sync moved, for a friendly one-line summary.
pub struct SyncReport {
    pub observations: usize,
    pub profile_facts: usize,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Run one full cloud sync (both tiers) for the signed-in user. Blocking — only
/// call from `spawn_blocking`. Idempotent: re-running on an unchanged store is a
/// no-op beyond the round-trip.
fn sync_blocking(base: String, bearer: String, user_id: String) -> Result<SyncReport> {
    let mut store = MemoryStore::open_for(Some(&user_id)).context("open local memory store")?;

    // Tier-B: encrypted blob round-trip + convergent merge (union + LWW + tombstones).
    let key = k_user(&KeychainStore, &user_id).context("derive K_user from the keychain")?;
    let transport = HttpSyncTransport::new(base.clone(), bearer.clone());
    MemorySync::new(transport, key)
        .sync(&mut store)
        .context("Tier-B memory sync")?;

    // Tier-A: distill + push the server-readable profile so phone eri knows you.
    let prof = profile::distill(&store.all(), now_ms());
    push_profile(&HttpProfileTransport::new(base, bearer), &prof).context("Tier-A profile push")?;

    Ok(SyncReport {
        observations: store.all().len(),
        profile_facts: prof.facts.len(),
    })
}

/// Resolve (base, bearer, user_id) from the signed-in credentials, or a reason
/// we can't sync.
fn sync_inputs() -> Result<(String, String, String)> {
    let creds = config::load()?;
    let bearer = creds
        .bearer()
        .context("not signed in — run `eri auth login` first")?;
    let user_id = creds
        .user_id
        .clone()
        .context("credentials are missing a user id — run `eri auth login` again")?;
    Ok((creds.base_url(), bearer, user_id))
}

/// `eri sync` — explicit, foreground sync with a printed summary.
pub async fn run() -> Result<()> {
    let (base, bearer, user_id) = sync_inputs()?;
    let report = tokio::task::spawn_blocking(move || sync_blocking(base, bearer, user_id))
        .await
        .context("sync task panicked")??;
    println!(
        "synced ✓  {} memories · {} profile facts pushed to phone eri",
        report.observations, report.profile_facts
    );
    Ok(())
}

/// Fire-and-forget best-effort sync (e.g. after a `remember`, on startup). Never
/// surfaces an error to the user — a sync failure must never break a local
/// command — it's logged at debug. No-op when signed out.
pub fn spawn_best_effort() {
    let Ok((base, bearer, user_id)) = sync_inputs() else {
        return;
    };
    tokio::task::spawn_blocking(move || {
        if let Err(e) = sync_blocking(base, bearer, user_id)
            && std::env::var("ERI_DEBUG").is_ok()
        {
            eprintln!("eri: background memory sync failed: {e:#}");
        }
    });
}
