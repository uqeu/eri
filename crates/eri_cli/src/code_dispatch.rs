//! B2 — dispatch + wire + job identity for the cloud-primary CodeTurn path.
//!
//! B1 ([`crate::code_turn`]) fixed the DATA shapes. This module fixes the
//! CROSS-SURFACE wire: how the phone (TS, `website/`) kicks a job and reads its
//! progress when the harness runs CLOUD-SIDE (not on the desktop). The phone
//! cannot call a Rust [`crate::code_turn::CodeTurn`] directly, so:
//!
//!   - **dispatch** resolves a natural-language repo hint to ONE user-connected
//!     repo (single-principal — [`resolve_repo`]) and mints a [`CodeJobId`];
//!   - the **cloud worker** runs the CodeTurn and appends each
//!     [`crate::code_turn::CodeProgress`] to a [`CodeJobRecord`] — the durable
//!     job-status row the phone polls / subscribes to;
//!   - a **follow-up** ("for PR #123, rename X, re-run") routes back to the SAME
//!     job by its id (B4), because the record carries the id + the PR number.
//!
//! Transport recommendation: **durable job-status rows** (Supabase), the phone
//! polls or subscribes — serverless-robust and survives disconnects, unlike a
//! raw SSE stream held open by a serverless consumer. SSE is an optional lower-
//! latency add later; the frame is just one [`CodeProgress::wire`]. The table +
//! polling live in `website/`; this module is the row SHAPE + the resolution the
//! dispatch endpoint runs brain-side.
//!
//! `dead_code` is allowed module-wide (as in [`crate::code_turn`]) until the
//! dispatch endpoint + cloud worker consume these.
#![allow(dead_code)]

use serde_json::{Value, json};

use crate::code_turn::{CodeOutcome, CodeProgress};

/// Stable identity for one coding job across its whole lifecycle. Minted at
/// dispatch; a follow-up (B4) routes back to the SAME job by this id.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct CodeJobId(String);

impl CodeJobId {
    /// Wrap a caller-minted id (the dispatch endpoint supplies it — e.g. a UUID
    /// or the Supabase row id, generated where a clock/RNG lives, not here).
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// How a natural-language repo hint resolved against the user's connected repos.
/// Single-principal: eri codes ONLY in repos the authenticated user connected —
/// an unmatched hint is [`RepoResolution::NeedsConnect`] (→ the phone's P4
/// connect-flow), never a silent cross-user reach.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RepoResolution {
    /// Exactly one connected repo matched — run against it (`owner/name`).
    Resolved(String),
    /// The hint matched several connected repos — the phone disambiguates.
    Ambiguous(Vec<String>),
    /// No connected repo matched — the phone runs the connect-flow (P4).
    NeedsConnect(String),
    /// The task named no repo at all — the phone must ask which repo.
    NoHint,
}

/// Resolve a repo hint to ONE user-connected repo. Pure + single-principal: only
/// `connected` repos are eligible; matching is case-insensitive on the full
/// `owner/name` or the bare `name`, taken as a whole token of the hint (so
/// "fix the eri checkout test" resolves `eri` without matching substrings like
/// "america"). Brain-side — the dispatch endpoint calls this before minting a
/// job. Empty `connected` always yields [`RepoResolution::NeedsConnect`].
pub fn resolve_repo(hint: &str, connected: &[String]) -> RepoResolution {
    let hint = hint.trim();
    // Tokenise the hint into `owner/name`- and `name`-shaped chunks (keep `/`
    // and `-`, split on everything else) so matching is whole-token, not
    // substring — "america" must not resolve a repo named `eri`.
    let tokens: Vec<String> = hint
        .to_ascii_lowercase()
        .split(|c: char| !(c.is_ascii_alphanumeric() || c == '-' || c == '/'))
        .filter(|t| !t.is_empty())
        .map(str::to_string)
        .collect();
    if tokens.is_empty() {
        return RepoResolution::NoHint;
    }
    let matches: Vec<String> = connected
        .iter()
        .filter(|repo| {
            let repo_lc = repo.to_ascii_lowercase();
            let bare = repo_lc.rsplit('/').next().unwrap_or(&repo_lc);
            tokens.iter().any(|t| t == &repo_lc || t == bare)
        })
        .cloned()
        .collect();
    match matches.len() {
        0 => RepoResolution::NeedsConnect(hint.to_string()),
        1 => RepoResolution::Resolved(matches.into_iter().next().unwrap_or_default()),
        _ => RepoResolution::Ambiguous(matches),
    }
}

/// The lifecycle phase of a dispatched job.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum JobPhase {
    /// Dispatched and running; events are still streaming in.
    Running,
    /// Settled with a terminal [`CodeOutcome`].
    Settled,
}

impl JobPhase {
    pub fn as_str(self) -> &'static str {
        match self {
            JobPhase::Running => "running",
            JobPhase::Settled => "settled",
        }
    }
}

/// The durable job-status row the phone polls / subscribes to. The cloud worker
/// creates it `running` on dispatch, appends each [`CodeProgress`] as the job
/// streams, then [`CodeJobRecord::settle`]s it with a [`CodeOutcome`]. Carries
/// the id + PR number so B4/P3 can address the job for a follow-up.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CodeJobRecord {
    pub id: CodeJobId,
    pub repo: String,
    pub phase: JobPhase,
    pub events: Vec<CodeProgress>,
    pub outcome: Option<CodeOutcome>,
}

impl CodeJobRecord {
    /// A fresh `running` record for a just-dispatched job.
    pub fn running(id: CodeJobId, repo: impl Into<String>) -> Self {
        Self {
            id,
            repo: repo.into(),
            phase: JobPhase::Running,
            events: Vec::new(),
            outcome: None,
        }
    }

    /// Append one progress event (the worker calls this as the job streams).
    pub fn push(&mut self, event: CodeProgress) {
        self.events.push(event);
    }

    /// Settle the record with its terminal outcome (phase → `settled`).
    pub fn settle(&mut self, outcome: CodeOutcome) {
        self.phase = JobPhase::Settled;
        self.outcome = Some(outcome);
    }

    /// The PR number once opened — for B4 follow-up routing / the P3 reply.
    /// Reads the settled outcome first, else the last `PrOpened` event.
    pub fn pr_number(&self) -> Option<u64> {
        if let Some(CodeOutcome::Opened { number, .. }) = &self.outcome {
            return Some(*number);
        }
        self.events.iter().rev().find_map(|e| match e {
            CodeProgress::PrOpened { number, .. } => Some(*number),
            _ => None,
        })
    }

    /// The wire payload the phone reads: id, repo, phase, PR number, each event
    /// envelope, and the settled outcome envelope. THIS is the poll shape.
    pub fn wire(&self) -> Value {
        json!({
            "job_id": self.id.as_str(),
            "repo": self.repo,
            "phase": self.phase.as_str(),
            "pr_number": self.pr_number(),
            "events": self.events.iter().map(CodeProgress::wire).collect::<Vec<_>>(),
            "outcome": self.outcome.as_ref().map(CodeOutcome::wire),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn connected() -> Vec<String> {
        vec!["eri-labs/eri".into(), "eri-labs/website".into()]
    }

    // ── resolve_repo: single-principal repo resolution ──

    #[test]
    fn resolves_a_bare_name_token_in_the_hint() {
        // "fix the eri checkout test" → the bare name `eri` matches eri-labs/eri.
        assert_eq!(
            resolve_repo("fix the eri checkout test", &connected()),
            RepoResolution::Resolved("eri-labs/eri".into())
        );
    }

    #[test]
    fn resolves_a_full_owner_name_hint() {
        assert_eq!(
            resolve_repo("eri-labs/website", &connected()),
            RepoResolution::Resolved("eri-labs/website".into())
        );
    }

    #[test]
    fn unmatched_hint_needs_the_connect_flow() {
        // Not a connected repo → P4 connect-flow, never a cross-user reach.
        assert_eq!(
            resolve_repo("someone-else/private", &connected()),
            RepoResolution::NeedsConnect("someone-else/private".into())
        );
    }

    #[test]
    fn empty_connected_set_always_needs_connect() {
        // Single-principal: with nothing connected, eri can reach no repo.
        assert_eq!(
            resolve_repo("eri", &[]),
            RepoResolution::NeedsConnect("eri".into())
        );
    }

    #[test]
    fn no_repo_token_is_no_hint() {
        assert_eq!(resolve_repo("   ", &connected()), RepoResolution::NoHint);
    }

    #[test]
    fn an_ambiguous_bare_name_is_flagged_not_guessed() {
        let two = vec!["eri-labs/api".to_string(), "other-org/api".to_string()];
        match resolve_repo("update the api", &two) {
            RepoResolution::Ambiguous(mut repos) => {
                repos.sort();
                assert_eq!(repos, vec!["eri-labs/api", "other-org/api"]);
            }
            other => panic!("expected Ambiguous, got {other:?}"),
        }
    }

    // ── CodeJobRecord: the poll row ──

    #[test]
    fn a_fresh_record_is_running_with_no_outcome() {
        let r = CodeJobRecord::running(CodeJobId::new("job-1"), "eri-labs/eri");
        assert_eq!(r.phase, JobPhase::Running);
        assert!(r.outcome.is_none());
        assert_eq!(r.wire()["phase"], "running");
        assert_eq!(r.wire()["job_id"], "job-1");
    }

    #[test]
    fn pr_number_surfaces_from_the_opened_event_and_outcome() {
        let mut r = CodeJobRecord::running(CodeJobId::new("job-2"), "eri-labs/eri");
        assert_eq!(r.pr_number(), None, "no PR yet");
        r.push(CodeProgress::PrOpened {
            number: 123,
            url: "u".into(),
            title: "t".into(),
        });
        assert_eq!(r.pr_number(), Some(123), "from the PrOpened event");
        r.settle(CodeOutcome::Opened {
            number: 123,
            url: "u".into(),
        });
        assert_eq!(r.pr_number(), Some(123), "from the settled outcome");
    }

    #[test]
    fn wire_row_carries_events_outcome_and_pr_number() {
        let mut r = CodeJobRecord::running(CodeJobId::new("job-3"), "eri-labs/eri");
        r.push(CodeProgress::Planned {
            summary: "on it".into(),
        });
        r.push(CodeProgress::PrOpened {
            number: 7,
            url: "https://github.com/eri-labs/eri/pull/7".into(),
            title: "Fix".into(),
        });
        r.settle(CodeOutcome::Opened {
            number: 7,
            url: "https://github.com/eri-labs/eri/pull/7".into(),
        });
        let w = r.wire();
        assert_eq!(w["phase"], "settled");
        assert_eq!(w["pr_number"], 7);
        assert_eq!(w["events"].as_array().unwrap().len(), 2);
        assert_eq!(w["events"][0]["stage"], "plan");
        assert_eq!(w["outcome"]["kind"], "opened");
    }
}
