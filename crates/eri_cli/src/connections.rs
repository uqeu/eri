//! The auto-index "dreaming" loop — async orchestration (Phase 2 #5, ADR-0012).
//!
//! Pulls normalized observations from the user's connected accounts (Gmail /
//! Calendar / … via the website's Composio pass-through endpoint), runs them through
//! the privacy-screened [`ingest_connections`](eri_inference::memory::connections)
//! engine (Q23-DROP before storage), then does ONE batched reflect pass for the
//! cue-less entities. **Cost-bounded**: a hard `max_observations` cap (recent-N, not
//! "all of history") and a single batched haiku call — indexing a life can't be
//! unbounded spend.
//!
//! The fetch is a seam ([`ConnectionSource`]) so the cap/paging orchestration is
//! testable with a mock, and prod wires [`HttpConnectionSource`]. Phase A runs
//! on-device (computer-on); the always-on server-resident variant is Phase B.

use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use eri_inference::memory::connections::{ConnectionObservation, ingest_connections};

use crate::reflection::{ReflectionClient, run_reflection};

/// ~1 month in ms — the backfill window unit.
const MONTH_MS: u64 = 30 * 24 * 60 * 60 * 1000;
/// Default cap on observations fetched per backfill (recent-N — bounded spend).
const DEFAULT_MAX: usize = 1000;
/// Per-fetch page size. Kept small (≤25) because the source endpoint's live Composio
/// Gmail fetch returns empty above ~25 per page (observed 2026-07-02); paging in
/// smaller chunks is robust to that cap. The backfill still reaches `max_observations`
/// by following `nextCursor`.
const PAGE_SIZE: usize = 25;
/// Most-recent ingested observations sent to the single batched reflect pass.
const REFLECT_BATCH: usize = 200;

/// One page from a connection source: the observations + the cursor to resume from
/// (`None` = no more).
pub struct ConnectionFetch {
    pub observations: Vec<ConnectionObservation>,
    pub next_cursor: Option<u64>,
}

/// The connection-data fetch seam. Single-principal — the impl carries the bearer,
/// so a fetch only ever sees the caller's own connected accounts.
#[async_trait::async_trait]
pub trait ConnectionSource: Send + Sync {
    /// Fetch up to `limit` observations newer than `since` (ms epoch).
    async fn fetch(&self, since: u64, limit: usize) -> Result<ConnectionFetch>;
}

/// How a backfill is bounded — every field a guard against unbounded spend.
pub struct BackfillOptions {
    /// Index observations newer than this (ms epoch) — e.g. now − N months.
    pub since: u64,
    /// Hard cap on observations fetched this run (recent-N per source).
    pub max_observations: usize,
    /// Per-fetch page size.
    pub page_size: usize,
    /// Most-recent observations to send to the single batched reflect (haiku) pass.
    pub reflect_batch: usize,
}

/// What a backfill did.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct BackfillReport {
    pub fetched: usize,
    pub ingested: usize,
    pub dropped_sensitive: usize,
    pub entities: usize,
    /// The newest observation `ts` seen — the cursor the continuous trigger advances
    /// to, so the next on-sync pull only fetches what's newer.
    pub newest_ts: u64,
}

/// Page size for the next fetch given the cap, or `None` to stop. Pure — the
/// cost-cap logic is unit-tested without IO.
fn next_page(fetched: usize, opts: &BackfillOptions) -> Option<usize> {
    if fetched >= opts.max_observations {
        return None;
    }
    Some((opts.max_observations - fetched).min(opts.page_size).max(1))
}

/// Run one capped backfill: page through `source` (bounded by `max_observations`),
/// ingest each page privacy-screened (Q23-DROP before storage), advance the cursor,
/// then do ONE batched reflect pass over the most-recent ingested observations.
pub async fn run_backfill(
    source: &dyn ConnectionSource,
    reflect: &dyn ReflectionClient,
    user_id: Option<&str>,
    opts: BackfillOptions,
) -> Result<BackfillReport> {
    let mut cursor = opts.since;
    let mut report = BackfillReport::default();
    while let Some(want) = next_page(report.fetched, &opts) {
        let page = source
            .fetch(cursor, want)
            .await
            .context("fetch connections")?;
        if page.observations.is_empty() {
            break;
        }
        report.fetched += page.observations.len();
        for o in &page.observations {
            report.newest_ts = report.newest_ts.max(o.ts_ms);
        }
        // Q23-DROP before storage happens INSIDE ingest_connections (ADR-0012).
        let ingest = ingest_connections(user_id, &page.observations)
            .context("ingest connection observations")?;
        report.ingested += ingest.ingested;
        report.dropped_sensitive += ingest.dropped_sensitive;
        match page.next_cursor {
            Some(c) if c != cursor => cursor = c,
            // No cursor, or it didn't advance → stop (don't spin on the same page).
            _ => break,
        }
    }
    // ONE batched reflect (haiku) pass for the cue-less entities — over the
    // most-recent ingested observations, capped so a backfill is bounded spend.
    if report.ingested > 0 {
        report.entities = run_reflection(reflect, user_id, opts.reflect_batch)
            .await
            .context("reflect over backfilled observations")?;
    }
    Ok(report)
}

/// `eri memory backfill [--months N] [--max N]` — index the last N months of
/// connected-account history into the world model: Q23-screened (sensitive dropped
/// before storage), capped at `max`, one batched reflect pass. User-scoped. Phase A
/// runs on-device — it indexes only while the computer is on (computer-off,
/// always-on indexing is Phase B, a server-resident brain).
pub async fn run(months: u32, max: usize) -> Result<()> {
    let creds = crate::config::load()?;
    if !creds.is_signed_in() {
        anyhow::bail!("not signed in — run `eri auth login` first");
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let since = now.saturating_sub(u64::from(months) * MONTH_MS);
    let source = HttpConnectionSource::from_credentials(&creds)?;
    let report = run_backfill(
        &source,
        &crate::reflection::ProxyReflectionClient,
        creds.user_id.as_deref(),
        BackfillOptions {
            since,
            max_observations: if max == 0 { DEFAULT_MAX } else { max },
            page_size: PAGE_SIZE,
            reflect_batch: REFLECT_BATCH,
        },
    )
    .await?;
    println!(
        "Indexed {} connection observation{} ({} sensitive dropped) — {} entit{} in your world model.",
        report.ingested,
        if report.ingested == 1 { "" } else { "s" },
        report.dropped_sensitive,
        report.entities,
        if report.entities == 1 { "y" } else { "ies" },
    );
    Ok(())
}

/// The incremental on-sync pull is small — the backfill is the onboarding; this
/// keeps it fresh.
const SYNC_PULL_CAP: usize = 200;

/// The persisted per-user pull cursor (newest indexed `ts`), beside the world graph
/// + the other sia state, so the next on-sync pull only fetches what's newer.
#[derive(Serialize, Deserialize, Default)]
struct Cursor {
    since: u64,
}

/// Path of the per-user connections cursor.
fn cursor_path(user_id: Option<&str>) -> io::Result<PathBuf> {
    Ok(
        eri_inference::memory::world_recall::world_graph_path_for(user_id)?
            .with_file_name("connections_cursor.json"),
    )
}

/// Read a cursor file (`0` if absent/unreadable — a fresh user pulls from `since=0`).
fn read_cursor(path: &Path) -> u64 {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str::<Cursor>(&s).ok())
        .map(|c| c.since)
        .unwrap_or(0)
}

/// Persist a cursor.
fn write_cursor(path: &Path, since: u64) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string(&Cursor { since }).map_err(io::Error::other)?;
    std::fs::write(path, json)
}

fn load_cursor(user_id: Option<&str>) -> u64 {
    cursor_path(user_id).map(|p| read_cursor(&p)).unwrap_or(0)
}

fn save_cursor(user_id: Option<&str>, since: u64) -> io::Result<()> {
    write_cursor(&cursor_path(user_id)?, since)
}

/// The continuous on-sync trigger: pull connection observations NEWER than the
/// persisted cursor, ingest them (Q23-screened), reflect once, and advance the
/// cursor — so each `eri sync` keeps the world model fresh without re-indexing
/// history. Bounded by [`SYNC_PULL_CAP`]; the reflect runs only when something new
/// was ingested (no new data → no spend). Signed-out → a no-op.
///
/// Phase A: rides the explicit `eri sync` (the always-on schedule is Phase B). It is
/// the caller's job to treat this as best-effort — a failure (e.g. the endpoint not
/// yet live) must never break the surrounding sync.
pub async fn sync_connections() -> Result<BackfillReport> {
    let creds = crate::config::load()?;
    if !creds.is_signed_in() {
        return Ok(BackfillReport::default());
    }
    let user_id = creds.user_id.clone();
    let since = load_cursor(user_id.as_deref());
    let source = HttpConnectionSource::from_credentials(&creds)?;
    let report = run_backfill(
        &source,
        &crate::reflection::ProxyReflectionClient,
        user_id.as_deref(),
        BackfillOptions {
            since,
            max_observations: SYNC_PULL_CAP,
            page_size: PAGE_SIZE,
            reflect_batch: REFLECT_BATCH,
        },
    )
    .await?;
    if report.newest_ts > since {
        let _ = save_cursor(user_id.as_deref(), report.newest_ts);
    }
    Ok(report)
}

/// The cursor-fetch wire response from the website source endpoint.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionFetchResponse {
    #[serde(default)]
    observations: Vec<ConnectionObservation>,
    #[serde(default)]
    next_cursor: Option<u64>,
}

/// Production [`ConnectionSource`]: GETs the website's single-principal
/// `/api/v1/connections/observations` PASS-THROUGH endpoint (it fetches Composio
/// live and returns normalized texts; raw bodies are persisted nowhere). Live IO.
pub struct HttpConnectionSource {
    client: crate::client::Client,
}

impl HttpConnectionSource {
    pub fn from_credentials(creds: &crate::config::Credentials) -> Result<Self> {
        Ok(Self {
            client: crate::client::Client::from_credentials(creds)?,
        })
    }
}

#[async_trait::async_trait]
impl ConnectionSource for HttpConnectionSource {
    async fn fetch(&self, since: u64, limit: usize) -> Result<ConnectionFetch> {
        let path = format!("/api/v1/connections/observations?since={since}&limit={limit}");
        let resp: ConnectionFetchResponse = self.client.get_json(&path).await?;
        Ok(ConnectionFetch {
            observations: resp.observations,
            next_cursor: resp.next_cursor,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    fn obs(source_id: &str, text: &str) -> ConnectionObservation {
        ConnectionObservation {
            source_id: source_id.into(),
            text: text.into(),
            kind: "email".into(),
            ts_ms: 1,
        }
    }

    #[test]
    fn next_page_respects_the_cap_then_stops() {
        let opts = BackfillOptions {
            since: 0,
            max_observations: 250,
            page_size: 100,
            reflect_batch: 200,
        };
        assert_eq!(next_page(0, &opts), Some(100));
        assert_eq!(next_page(100, &opts), Some(100));
        assert_eq!(next_page(200, &opts), Some(50)); // only 50 left under the cap
        assert_eq!(next_page(250, &opts), None); // cap reached → stop
        assert_eq!(next_page(300, &opts), None);
    }

    /// A scripted source: hands out pre-set pages in order, recording the cap it was
    /// asked for so the test can assert the orchestration never over-fetches.
    struct ScriptedSource {
        pages: Mutex<std::collections::VecDeque<Vec<ConnectionObservation>>>,
    }
    #[async_trait::async_trait]
    impl ConnectionSource for ScriptedSource {
        async fn fetch(&self, _since: u64, limit: usize) -> Result<ConnectionFetch> {
            let mut pages = self.pages.lock().unwrap();
            let page = pages.pop_front().unwrap_or_default();
            // Honour the requested cap (the real endpoint does too).
            let observations: Vec<_> = page.into_iter().take(limit).collect();
            // Advance the cursor while pages remain; None when drained.
            let next_cursor = if pages.is_empty() { None } else { Some(1) };
            Ok(ConnectionFetch {
                observations,
                next_cursor,
            })
        }
    }

    struct MockReflect;
    #[async_trait::async_trait]
    impl ReflectionClient for MockReflect {
        async fn reflect(&self, _system: &str, _observations: &str) -> Result<Option<String>> {
            Ok(Some(
                r#"{"entities":[{"kind":"person","name":"Priya"}],"relations":[]}"#.into(),
            ))
        }
    }

    #[allow(clippy::await_holding_lock)] // current-thread test; HOME isolation held across await
    #[tokio::test]
    async fn backfill_ingests_drops_sensitive_and_reflects_once() {
        let _lock = crate::config::ENV_TEST_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let dir = tempfile::TempDir::new().unwrap();
        let prev = std::env::var("HOME").ok();
        unsafe {
            std::env::set_var("HOME", dir.path());
        }

        let source = ScriptedSource {
            pages: Mutex::new(
                vec![
                    vec![
                        obs("gmail:1", "I work with Priya on the atlas project"),
                        obs("gmail:2", "Your password is hunter2"), // Q23 → dropped
                    ],
                    vec![obs("gcal:1", "standup with Sam about the harbor app")],
                ]
                .into(),
            ),
        };
        let report = run_backfill(
            &source,
            &MockReflect,
            None,
            BackfillOptions {
                since: 0,
                max_observations: 1000,
                page_size: 100,
                reflect_batch: 200,
            },
        )
        .await
        .unwrap();

        assert_eq!(report.fetched, 3, "both pages fetched");
        assert_eq!(report.ingested, 2, "two clean observations stored");
        assert_eq!(
            report.dropped_sensitive, 1,
            "the credential snippet was dropped"
        );
        assert!(
            report.entities >= 1,
            "the reflect pass ran and wrote entities"
        );
        assert_eq!(
            report.newest_ts, 1,
            "the cursor advances to the newest observation ts"
        );

        unsafe {
            match prev.as_deref() {
                Some(v) => std::env::set_var("HOME", v),
                None => std::env::remove_var("HOME"),
            }
        }
    }

    #[test]
    fn the_cursor_round_trips_and_a_missing_file_is_zero() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("connections_cursor.json");
        assert_eq!(read_cursor(&path), 0, "absent cursor → pull from since=0");
        write_cursor(&path, 1_750_000_000_000).unwrap();
        assert_eq!(read_cursor(&path), 1_750_000_000_000, "cursor round-trips");
    }
}
