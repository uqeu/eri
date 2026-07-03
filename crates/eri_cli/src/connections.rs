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
use crate::sensitivity::SensitivityScreen;

/// ~1 month in ms — the backfill window unit.
const MONTH_MS: u64 = 30 * 24 * 60 * 60 * 1000;
/// Default cap on observations fetched per backfill (recent-N — bounded spend).
const DEFAULT_MAX: usize = 1000;
/// Per-fetch page size — up to the endpoint's documented 200 ceiling (it honours
/// large limits across the Composio per-call cap via internal paging). Kept at 100 so
/// one screen batch stays well under the precision pass's response-token budget.
const PAGE_SIZE: usize = 100;
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
    /// Fetch a page: observations with `ts > since` (the floor) and — for backward,
    /// deep paging — `ts < before` (the ceiling; `None` starts at newest). Up to
    /// `limit`. `next_cursor` is the OLDEST `ts` in the page, passed back as `before`
    /// to walk older; `None` when history under the floor is exhausted.
    async fn fetch(&self, since: u64, before: Option<u64>, limit: usize)
    -> Result<ConnectionFetch>;
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
    /// Already-modelled observations skipped (idempotent by `source_id`) — not
    /// new, not dropped; already in the world model from a prior run.
    pub skipped: usize,
    /// Dropped by the Claude precision screen (the "exclude if unsure" gate).
    pub screened_out: usize,
    /// Dropped by the deterministic keyword floor inside ingest (defense in depth).
    pub dropped_sensitive: usize,
    /// Total distinct entities in the world model AFTER this backfill — the real
    /// count (people/projects/apps/… across the whole window), not just what the
    /// single reflect pass wrote.
    pub entities: usize,
    /// Pages fetched from the source (each a backward step through history).
    pub pages: usize,
    /// The newest observation `ts` seen — the cursor the continuous trigger advances
    /// to, so the next on-sync pull only fetches what's newer.
    pub newest_ts: u64,
    /// The oldest observation `ts` reached — with `since`, the actual window walked.
    pub oldest_ts: u64,
    /// True when paging stopped because history under the `since` floor was
    /// exhausted (the WHOLE window was walked); false when it stopped at the
    /// `max_observations` cap (more history remains under the floor).
    pub reached_floor: bool,
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
    screen: &dyn SensitivityScreen,
    reflect: &dyn ReflectionClient,
    user_id: Option<&str>,
    opts: BackfillOptions,
) -> Result<BackfillReport> {
    // Backward, deep paging (ADR-0012 contract): a fixed `since` floor, walking
    // `before` from newest toward oldest via each page's `next_cursor`.
    let mut before: Option<u64> = None;
    let mut report = BackfillReport::default();
    let mut oldest_ts = u64::MAX;
    while let Some(want) = next_page(report.fetched, &opts) {
        let page = source
            .fetch(opts.since, before, want)
            .await
            .context("fetch connections")?;
        if page.observations.is_empty() {
            // No more history under the floor — the WHOLE window was walked.
            report.reached_floor = true;
            break;
        }
        report.pages += 1;
        let page_len = page.observations.len();
        report.fetched += page_len;
        for o in &page.observations {
            report.newest_ts = report.newest_ts.max(o.ts_ms);
            oldest_ts = oldest_ts.min(o.ts_ms);
        }
        // PRECISION pass (ADR-0012 / ADR-0010 §5): the Claude "exclude if unsure"
        // screen ABOVE the keyword floor. FAIL-CLOSED — a screen error drops the whole
        // page (never ingest unscreened data). Only SAFE-cleared observations proceed.
        let texts: Vec<&str> = page.observations.iter().map(|o| o.text.as_str()).collect();
        let keep = screen
            .screen(&texts)
            .await
            .unwrap_or_else(|_| vec![false; texts.len()]);
        let safe: Vec<ConnectionObservation> = page
            .observations
            .into_iter()
            .zip(keep)
            .filter_map(|(o, k)| k.then_some(o))
            .collect();
        report.screened_out += page_len - safe.len();
        // The keyword floor (ADR-0012) runs again inside ingest_connections — defense
        // in depth for anything the precision pass cleared.
        let ingest =
            ingest_connections(user_id, &safe).context("ingest connection observations")?;
        report.ingested += ingest.ingested;
        report.skipped += ingest.skipped;
        report.dropped_sensitive += ingest.dropped_sensitive;
        match page.next_cursor {
            // Walk older: the page's oldest ts becomes the next `before` ceiling.
            Some(oldest) if Some(oldest) != before => before = Some(oldest),
            // null (history exhausted) or non-advancing → the window is fully
            // walked; stop (never spin a page).
            _ => {
                report.reached_floor = true;
                break;
            }
        }
    }
    report.oldest_ts = if report.fetched == 0 { 0 } else { oldest_ts };
    // ONE batched reflect (haiku) pass for the cue-less entities — over the
    // most-recent ingested observations, capped so a backfill is bounded spend.
    // Then report the REAL entity total (deterministic ingest across the whole
    // window + what the reflect pass added), not just the reflect pass's count.
    if report.ingested > 0 {
        run_reflection(reflect, user_id, opts.reflect_batch)
            .await
            .context("reflect over backfilled observations")?;
        report.entities = eri_inference::memory::world_recall::entity_total(user_id);
    }
    Ok(report)
}

/// Safety ceiling for a `--full` deep-history walk — a runaway backstop, not the
/// intended stopping point (the `since` floor is). Six months of a heavy inbox is
/// well under this.
const FULL_MAX: usize = 50_000;

/// `eri memory backfill [--months N] [--max N] [--full]` — index the last N months
/// of connected-account history into the world model: Q23-screened (sensitive
/// dropped before storage), one batched reflect pass. Default is recent-N
/// (cost-bounded onboarding); `--full` walks the WHOLE window (to the floor,
/// bounded only by [`FULL_MAX`]) — the deep-history backfill. User-scoped. Phase A
/// runs on-device — it indexes only while the computer is on (computer-off,
/// always-on indexing is Phase B, a server-resident brain).
pub async fn run(months: u32, max: usize, full: bool) -> Result<()> {
    let creds = crate::config::load()?;
    if !creds.is_signed_in() {
        anyhow::bail!("not signed in — run `eri auth login` first");
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let since = now.saturating_sub(u64::from(months) * MONTH_MS);
    // `--full`: walk the whole window (high ceiling); else recent-N (default cap
    // unless an explicit --max is given).
    let cap = if full {
        FULL_MAX
    } else if max == 0 {
        DEFAULT_MAX
    } else {
        max
    };
    let source = HttpConnectionSource::from_credentials(&creds)?;
    let report = run_backfill(
        &source,
        &crate::sensitivity::ClaudeSensitivityScreen,
        &crate::reflection::ProxyReflectionClient,
        creds.user_id.as_deref(),
        BackfillOptions {
            since,
            max_observations: cap,
            page_size: PAGE_SIZE,
            reflect_batch: REFLECT_BATCH,
        },
    )
    .await?;
    print_report(months, &report);
    Ok(())
}

/// The real-counts summary a backfill reports: the window walked, what was
/// indexed, the Q23 privacy breakdown, the entity total, and whether the WHOLE
/// window was covered or the cap stopped it. Pure formatting — unit-tested.
fn format_report(months: u32, r: &BackfillReport) -> String {
    let coverage = if r.reached_floor {
        format!(
            "✓ walked your whole {months}-month window ({} page(s))",
            r.pages
        )
    } else {
        format!(
            "⚠ stopped at the {}-observation cap — more history remains; re-run with --full",
            r.fetched
        )
    };
    format!(
        "Indexed {ing} new observation(s) ({skipped} already known) of {fetched} fetched from your connected accounts.\n\
         Privacy screen dropped {total_dropped} ({precision} by the precision pass, {floor} by the keyword floor).\n\
         Your world model now holds {ent} entit{ent_suffix}.\n\
         {coverage}.",
        ing = r.ingested,
        skipped = r.skipped,
        fetched = r.fetched,
        total_dropped = r.screened_out + r.dropped_sensitive,
        precision = r.screened_out,
        floor = r.dropped_sensitive,
        ent = r.entities,
        ent_suffix = if r.entities == 1 { "y" } else { "ies" },
    )
}

fn print_report(months: u32, r: &BackfillReport) {
    println!("{}", format_report(months, r));
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
        &crate::sensitivity::ClaudeSensitivityScreen,
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
    async fn fetch(
        &self,
        since: u64,
        before: Option<u64>,
        limit: usize,
    ) -> Result<ConnectionFetch> {
        let mut path = format!("/api/v1/connections/observations?since={since}&limit={limit}");
        if let Some(before) = before {
            path.push_str(&format!("&before={before}"));
        }
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
        obs_ts(source_id, text, 1)
    }

    fn obs_ts(source_id: &str, text: &str, ts_ms: u64) -> ConnectionObservation {
        ConnectionObservation {
            source_id: source_id.into(),
            text: text.into(),
            kind: "email".into(),
            ts_ms,
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

    #[test]
    fn format_report_shows_real_counts_and_coverage() {
        let full = BackfillReport {
            fetched: 176,
            ingested: 158,
            skipped: 12,
            screened_out: 18,
            dropped_sensitive: 0,
            entities: 42,
            pages: 3,
            reached_floor: true,
            ..Default::default()
        };
        let s = format_report(6, &full);
        assert!(s.contains("158 new observation(s)"), "new ingests: {s}");
        assert!(
            s.contains("12 already known"),
            "idempotent skips surfaced: {s}"
        );
        assert!(s.contains("of 176 fetched"), "fetched total: {s}");
        assert!(
            s.contains("18 by the precision pass"),
            "Q23 precision drops: {s}"
        );
        assert!(s.contains("42 entit"), "the real entity total: {s}");
        assert!(s.contains("whole 6-month window"), "coverage: {s}");

        // Cap case: history remains → nudge --full.
        let capped = BackfillReport {
            fetched: 1000,
            reached_floor: false,
            ..Default::default()
        };
        assert!(
            format_report(6, &capped).contains("--full"),
            "cap nudges --full"
        );
    }

    /// A scripted source: hands out pre-set pages in order, recording the cap it was
    /// asked for so the test can assert the orchestration never over-fetches.
    struct ScriptedSource {
        pages: Mutex<std::collections::VecDeque<Vec<ConnectionObservation>>>,
    }
    #[async_trait::async_trait]
    impl ConnectionSource for ScriptedSource {
        async fn fetch(
            &self,
            _since: u64,
            _before: Option<u64>,
            limit: usize,
        ) -> Result<ConnectionFetch> {
            let mut pages = self.pages.lock().unwrap();
            let page = pages.pop_front().unwrap_or_default();
            // Honour the requested cap (the real endpoint does too).
            let observations: Vec<_> = page.into_iter().take(limit).collect();
            // A distinct, decreasing `before` cursor while pages remain (backward
            // paging); None when drained (history exhausted).
            let next_cursor = if pages.is_empty() {
                None
            } else {
                Some(pages.len() as u64)
            };
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

    /// A screen that keeps everything — isolates the orchestration from the live
    /// precision pass (the fail-closed policy itself is unit-tested in `sensitivity`).
    struct KeepAllScreen;
    #[async_trait::async_trait]
    impl SensitivityScreen for KeepAllScreen {
        async fn screen(&self, texts: &[&str]) -> Result<Vec<bool>> {
            Ok(vec![true; texts.len()])
        }
    }

    /// A screen that drops everything — proves the precision pass gates ingest.
    struct DropAllScreen;
    #[async_trait::async_trait]
    impl SensitivityScreen for DropAllScreen {
        async fn screen(&self, texts: &[&str]) -> Result<Vec<bool>> {
            Ok(vec![false; texts.len()])
        }
    }

    #[allow(clippy::await_holding_lock)] // current-thread test; HOME isolation held across await
    #[tokio::test]
    async fn a_full_walk_reports_pages_window_and_reaching_the_floor() {
        let _lock = crate::config::ENV_TEST_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let dir = tempfile::TempDir::new().unwrap();
        let prev = std::env::var("HOME").ok();
        unsafe {
            std::env::set_var("HOME", dir.path());
        }

        // Two backward pages with distinct ts (newest 300 → oldest 100); the
        // source drains (next_cursor None) → the whole window was walked.
        let source = ScriptedSource {
            pages: Mutex::new(
                vec![
                    vec![obs_ts(
                        "gmail:1",
                        "I work with Priya on the atlas project",
                        300,
                    )],
                    vec![obs_ts(
                        "gcal:1",
                        "standup with Sam about the harbor app",
                        100,
                    )],
                ]
                .into(),
            ),
        };
        let report = run_backfill(
            &source,
            &KeepAllScreen,
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

        assert_eq!(report.pages, 2, "two backward pages walked");
        assert_eq!(report.newest_ts, 300);
        assert_eq!(report.oldest_ts, 100, "the oldest observation reached");
        assert!(
            report.reached_floor,
            "history exhausted under the floor → the WHOLE window was walked"
        );
        assert!(
            report.entities >= 2,
            "the real entity total spans the window (Priya, atlas, Sam, harbor)"
        );

        unsafe {
            match prev.as_deref() {
                Some(v) => std::env::set_var("HOME", v),
                None => std::env::remove_var("HOME"),
            }
        }
    }

    #[allow(clippy::await_holding_lock)] // current-thread test; HOME isolation held across await
    #[tokio::test]
    async fn stopping_at_the_cap_has_not_reached_the_floor() {
        let _lock = crate::config::ENV_TEST_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let dir = tempfile::TempDir::new().unwrap();
        let prev = std::env::var("HOME").ok();
        unsafe {
            std::env::set_var("HOME", dir.path());
        }

        // Two pages available, but the cap stops after one → more history remains.
        let source = ScriptedSource {
            pages: Mutex::new(
                vec![
                    vec![obs_ts("gmail:1", "note about the atlas project", 300)],
                    vec![obs_ts("gcal:1", "note about the harbor app", 100)],
                ]
                .into(),
            ),
        };
        let report = run_backfill(
            &source,
            &KeepAllScreen,
            &MockReflect,
            None,
            BackfillOptions {
                since: 0,
                max_observations: 1, // cap at one observation
                page_size: 100,
                reflect_batch: 200,
            },
        )
        .await
        .unwrap();

        assert_eq!(report.fetched, 1, "stopped at the cap");
        assert!(
            !report.reached_floor,
            "the cap (not the floor) stopped it → more history remains"
        );

        unsafe {
            match prev.as_deref() {
                Some(v) => std::env::set_var("HOME", v),
                None => std::env::remove_var("HOME"),
            }
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
            &KeepAllScreen,
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

    #[allow(clippy::await_holding_lock)] // current-thread test; HOME isolation held across await
    #[tokio::test]
    async fn the_precision_screen_gates_ingest_fail_closed() {
        // FAIL-CLOSED launch gate: when the screen drops everything (an error, a
        // malformed reply, or a genuine sensitive verdict), NOTHING is ingested — even
        // a benign-looking observation. You can't leak what you never store.
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
                vec![vec![obs(
                    "gmail:1",
                    "I work with Priya on the atlas project",
                )]]
                .into(),
            ),
        };
        let report = run_backfill(
            &source,
            &DropAllScreen,
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
        assert_eq!(report.fetched, 1);
        assert_eq!(
            report.ingested, 0,
            "the precision screen gated it → nothing ingested"
        );
        assert_eq!(report.screened_out, 1, "counted as a precision drop");

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
