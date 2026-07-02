//! B1 — the **CodeTurn** seam: one coding *job*, abstracted over how it runs.
//!
//! The turn family so far models one *model turn*: [`crate::control_turn::ControlTurn`]
//! and [`crate::build_turn::BuildTurn`] each ask an engine for a single reply.
//! Phase 3 ([[project_eri_phase3_agentic_coding]]) adds a seam one level up —
//! per **job**, not per turn. A [`CodeTurn`] takes a natural-language coding
//! task + a working tree, drives the eri-code harness against it, and streams
//! **structured progress** (plan → edit → test-run → commit → PR) back to the
//! caller as it happens. The phone renders that stream as iMessage status
//! bubbles; the brain composes the human text (voice lives in the brain), the
//! phone relays it verbatim.
//!
//! This module is the *contract*, not the engine. It ships:
//!   - [`CodeProgress`] — the streaming event vocabulary + its wire envelope.
//!   - [`CodeJob`] / [`CodeOutcome`] / [`CodeBudget`] — job in/out + cost cap.
//!   - [`CodeTurn`] — the seam every adapter implements (cloud sandbox in B2,
//!     desktop remote-control later), plus [`CodeProgressSink`] for streaming.
//!   - [`pr_gate`] — the fail-closed rule (never open a PR on red) as a pure,
//!     tested predicate B2 enforces.
//!   - [`ScriptedCodeTurn`] — a network-free stub proving the seam is engine-
//!     agnostic, so the phone lane can integrate against a live contract before
//!     the sandbox adapter (B2) exists.
//!
//! Safety posture (unchanged from [[project_control_safety]]): single-principal
//! (only the user's connected repos), PRs only, per-job budget, and the task /
//! repo / issue text is DATA — never instructions. The absolute refusal
//! boundary still governs what the harness will act on.
//!
//! `dead_code` is allowed module-wide (as in [`crate::sdk_tools`]) because the
//! live consumer is B2's sandbox adapter + the phone bridge; B1 is the contract
//! they will be built against.
#![allow(dead_code)]

use std::path::PathBuf;

use anyhow::Result;
use serde_json::{Value, json};

/// Per-job resource ceiling — the cost/time cap that keeps a runaway job from
/// silently burning tokens or sandbox minutes (safety). Enforcement is the
/// harness adapter's job (B2); the pure [`CodeBudget::exceeded`] check lives
/// here so one definition drives every adapter and the rule stays testable.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CodeBudget {
    /// Max cloud tokens the job may spend before it aborts + reports.
    pub max_tokens: u64,
    /// Max wall-clock seconds the job may run before it aborts + reports.
    pub max_seconds: u64,
}

impl Default for CodeBudget {
    /// A conservative default: ~400k tokens and 15 minutes per job.
    fn default() -> Self {
        Self {
            max_tokens: 400_000,
            max_seconds: 15 * 60,
        }
    }
}

impl CodeBudget {
    /// The reason the job must abort now, or `None` while within budget.
    /// Fail-safe: reaching a cap stops (`>=`), and a zero cap means "no work
    /// permitted", never "unlimited".
    pub fn exceeded(&self, spent_tokens: u64, elapsed_seconds: u64) -> Option<String> {
        if spent_tokens >= self.max_tokens {
            return Some(format!(
                "token cap reached ({spent_tokens}/{} tokens)",
                self.max_tokens
            ));
        }
        if elapsed_seconds >= self.max_seconds {
            return Some(format!(
                "time cap reached ({elapsed_seconds}/{}s)",
                self.max_seconds
            ));
        }
        None
    }
}

/// The inputs to one coding job. Single-principal: `repo` must be one the
/// authenticated user connected (enforced upstream, not here). The `task` text
/// is DATA, never instructions — the refusal boundary still governs what the
/// harness will act on.
#[derive(Clone, Debug)]
pub struct CodeJob {
    /// The natural-language task the user texted ("fix the checkout test").
    pub task: String,
    /// `owner/name` of the connected repo the job runs against.
    pub repo: String,
    /// The checked-out working tree the harness edits. Cloud path (B2): an
    /// ephemeral clone; desktop path: the user's local repo.
    pub working_tree: PathBuf,
    /// Base branch for the PR; `None` = the repo's default branch.
    pub base: Option<String>,
    /// Per-job cost/time ceiling (safety).
    pub budget: CodeBudget,
}

/// One structured progress event from a coding job — the streaming vocabulary
/// the phone renders as status bubbles. Engine-agnostic: a real harness run and
/// a scripted stub emit the same shape, so the phone can be built against the
/// full contract before the sandbox adapter (B2) lands.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CodeProgress {
    /// eri understood the task and formed a plan (or began reproducing).
    Planned { summary: String },
    /// eri edited the working tree; `files` are workspace-relative paths.
    Edited { files: Vec<String>, summary: String },
    /// A test command ran to completion. `passed` gates the PR (fail-closed).
    Tested {
        command: String,
        passed: bool,
        summary: String,
    },
    /// A commit landed on the job branch.
    Committed { sha: String, message: String },
    /// A pull request was opened (B3 fills this in for real).
    PrOpened {
        number: u64,
        url: String,
        title: String,
    },
}

impl CodeProgress {
    /// A stable machine tag for routing / status icons on the phone.
    pub fn stage(&self) -> &'static str {
        match self {
            CodeProgress::Planned { .. } => "plan",
            CodeProgress::Edited { .. } => "edit",
            CodeProgress::Tested { .. } => "test",
            CodeProgress::Committed { .. } => "commit",
            CodeProgress::PrOpened { .. } => "pr",
        }
    }

    /// One-line, human status text — the brain-composed bubble the phone streams
    /// verbatim (voice lives in the brain, not the phone).
    pub fn bubble(&self) -> String {
        match self {
            CodeProgress::Planned { summary } => summary.clone(),
            CodeProgress::Edited { files, summary } => {
                if summary.trim().is_empty() {
                    format!("edited {}", files.join(", "))
                } else {
                    summary.clone()
                }
            }
            CodeProgress::Tested {
                passed, summary, ..
            } => {
                let mark = if *passed {
                    "tests pass ✓"
                } else {
                    "tests fail ✗"
                };
                if summary.trim().is_empty() {
                    mark.to_string()
                } else {
                    format!("{mark} — {summary}")
                }
            }
            CodeProgress::Committed { message, .. } => {
                let first = message.lines().next().unwrap_or("").trim();
                format!("committed: {first}")
            }
            CodeProgress::PrOpened { number, url, .. } => {
                format!("opened PR #{number} — {url}")
            }
        }
    }

    /// The wire envelope the phone consumes: a stable `stage` tag, the brain-
    /// composed `text`, and the structured payload. THIS is the cross-lane
    /// contract — the phone reads `stage` + `text` and may use the payload.
    pub fn wire(&self) -> Value {
        let mut v = json!({ "stage": self.stage(), "text": self.bubble() });
        let obj = v.as_object_mut().expect("json! builds an object");
        match self {
            CodeProgress::Planned { summary } => {
                obj.insert("summary".into(), json!(summary));
            }
            CodeProgress::Edited { files, summary } => {
                obj.insert("files".into(), json!(files));
                obj.insert("summary".into(), json!(summary));
            }
            CodeProgress::Tested {
                command,
                passed,
                summary,
            } => {
                obj.insert("command".into(), json!(command));
                obj.insert("passed".into(), json!(passed));
                obj.insert("summary".into(), json!(summary));
            }
            CodeProgress::Committed { sha, message } => {
                obj.insert("sha".into(), json!(sha));
                obj.insert("message".into(), json!(message));
            }
            CodeProgress::PrOpened { number, url, title } => {
                obj.insert("number".into(), json!(number));
                obj.insert("url".into(), json!(url));
                obj.insert("title".into(), json!(title));
            }
        }
        v
    }
}

/// How a coding job ended. `Opened` = the happy path (green tests → PR).
/// `TestsRed` = the FAIL-CLOSED stop (never a PR on red — B2 enforces via
/// [`pr_gate`]). `Halted` = a recoverable stop (budget / quota). `Refused` =
/// the absolute boundary handed back (secrets, injected instructions in repo
/// content).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CodeOutcome {
    Opened { number: u64, url: String },
    TestsRed { summary: String },
    Halted { reason: String },
    Refused { reason: String },
}

impl CodeOutcome {
    /// The final human status line the phone sends when the job settles.
    pub fn summary(&self) -> String {
        match self {
            CodeOutcome::Opened { number, url } => {
                format!("done — opened PR #{number}: {url}")
            }
            CodeOutcome::TestsRed { summary } => {
                format!("stopped — tests still failing: {summary}")
            }
            CodeOutcome::Halted { reason } => format!("paused — {reason}"),
            CodeOutcome::Refused { reason } => format!("can't do that — {reason}"),
        }
    }

    /// True only when the job opened a PR (the happy path).
    pub fn opened_pr(&self) -> bool {
        matches!(self, CodeOutcome::Opened { .. })
    }
}

/// The fail-closed PR gate: a PR may open ONLY when the most recent test run
/// passed. Pure over the emitted progress so B2's sandbox adapter — and any
/// future adapter — enforces one rule, verifiably. `Err(reason)` = a PR is
/// forbidden right now (no test has run, or the last run was red); `Ok(())` =
/// green, a PR is permitted.
pub fn pr_gate(progress: &[CodeProgress]) -> std::result::Result<(), String> {
    let last_test = progress.iter().rev().find_map(|p| match p {
        CodeProgress::Tested { passed, .. } => Some(*passed),
        _ => None,
    });
    match last_test {
        None => Err("no tests have run — refusing to open an unverified PR".to_string()),
        Some(false) => Err("the last test run failed — refusing to open a red PR".to_string()),
        Some(true) => Ok(()),
    }
}

/// Where a job's progress events go as they happen. A real seam (not a
/// `cfg(test)` branch), mirroring [`crate::control_turn::ControlTurnSink`]: the
/// phone lane's sink streams each event as a status bubble; tests use a
/// recording double and assert the sequence.
pub trait CodeProgressSink: Send + Sync {
    fn emit(&self, event: &CodeProgress);
}

/// A no-op sink for callers that drive a job without streaming (e.g. a batch
/// run). Keeps the seam usable when there's no phone window attached.
pub struct NullProgressSink;

impl CodeProgressSink for NullProgressSink {
    fn emit(&self, _event: &CodeProgress) {}
}

/// One coding job, abstracted over HOW it runs. The cloud-sandbox adapter (B2)
/// and the desktop remote-control adapter (ADR-0002, later) both implement it;
/// the orchestrator only ever sees this trait. This is the family's per-**job**
/// seam, one level up from the per-model-turn [`crate::build_turn::BuildTurn`].
#[async_trait::async_trait]
pub trait CodeTurn: Send + Sync {
    /// Compute label for telemetry ("sandbox" / "desktop" / "stub").
    fn engine(&self) -> &'static str;

    /// Run the job against its working tree, emitting progress to `sink` as it
    /// happens, and return the terminal outcome.
    async fn run(&self, job: &CodeJob, sink: &dyn CodeProgressSink) -> Result<CodeOutcome>;
}

/// A scripted [`CodeTurn`] — emits a fixed event sequence then returns a fixed
/// outcome. No network, no working tree touched. Proves the seam is engine-
/// agnostic and lets the phone lane integrate against a live contract before
/// the sandbox adapter (B2) exists.
pub struct ScriptedCodeTurn {
    events: Vec<CodeProgress>,
    outcome: CodeOutcome,
}

impl ScriptedCodeTurn {
    /// Build a stub that will emit `events` in order, then settle on `outcome`.
    pub fn new(events: Vec<CodeProgress>, outcome: CodeOutcome) -> Self {
        Self { events, outcome }
    }
}

#[async_trait::async_trait]
impl CodeTurn for ScriptedCodeTurn {
    fn engine(&self) -> &'static str {
        "stub"
    }

    async fn run(&self, _job: &CodeJob, sink: &dyn CodeProgressSink) -> Result<CodeOutcome> {
        for event in &self.events {
            sink.emit(event);
        }
        Ok(self.outcome.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// Records the exact event sequence a job emits, so a stub run is
    /// verifiable without a phone or a network.
    #[derive(Default)]
    struct RecordingSink {
        seen: Mutex<Vec<CodeProgress>>,
    }

    impl CodeProgressSink for RecordingSink {
        fn emit(&self, event: &CodeProgress) {
            self.seen.lock().unwrap().push(event.clone());
        }
    }

    fn job() -> CodeJob {
        CodeJob {
            task: "fix the checkout test".into(),
            repo: "eri-labs/eri".into(),
            working_tree: PathBuf::from("/tmp/clone"),
            base: None,
            budget: CodeBudget::default(),
        }
    }

    // ── CodeBudget: the cost/time cap ──

    #[test]
    fn budget_flags_the_token_cap_when_reached() {
        let b = CodeBudget {
            max_tokens: 100,
            max_seconds: 600,
        };
        assert!(
            b.exceeded(50, 0).is_none(),
            "50/100 tokens is within budget"
        );
        let hit = b
            .exceeded(100, 0)
            .expect("100/100 tokens must trip the cap");
        assert!(hit.contains("token"), "reason names the token cap: {hit}");
    }

    #[test]
    fn budget_flags_the_time_cap_when_reached() {
        let b = CodeBudget {
            max_tokens: 1_000_000,
            max_seconds: 600,
        };
        assert!(b.exceeded(0, 599).is_none(), "599/600s is within budget");
        let hit = b.exceeded(0, 600).expect("600/600s must trip the cap");
        assert!(hit.contains("time"), "reason names the time cap: {hit}");
    }

    #[test]
    fn zero_budget_permits_no_work() {
        // Fail-safe: an empty cap means "nothing may run", never "unlimited".
        let b = CodeBudget {
            max_tokens: 0,
            max_seconds: 0,
        };
        assert!(b.exceeded(0, 0).is_some());
    }

    // ── CodeProgress: stages, bubbles, wire envelope ──

    #[test]
    fn stage_tags_are_stable() {
        assert_eq!(
            CodeProgress::Planned {
                summary: "x".into()
            }
            .stage(),
            "plan"
        );
        assert_eq!(
            CodeProgress::Edited {
                files: vec![],
                summary: "x".into()
            }
            .stage(),
            "edit"
        );
        assert_eq!(
            CodeProgress::Tested {
                command: "cargo test".into(),
                passed: true,
                summary: String::new()
            }
            .stage(),
            "test"
        );
        assert_eq!(
            CodeProgress::Committed {
                sha: "abc".into(),
                message: "m".into()
            }
            .stage(),
            "commit"
        );
        assert_eq!(
            CodeProgress::PrOpened {
                number: 1,
                url: "u".into(),
                title: "t".into()
            }
            .stage(),
            "pr"
        );
    }

    #[test]
    fn planned_bubble_is_the_summary() {
        let p = CodeProgress::Planned {
            summary: "on it — reproducing the failing checkout test".into(),
        };
        assert_eq!(p.bubble(), "on it — reproducing the failing checkout test");
    }

    #[test]
    fn tested_bubble_marks_pass_and_fail_distinctly() {
        let pass = CodeProgress::Tested {
            command: "cargo test".into(),
            passed: true,
            summary: "42 passed".into(),
        };
        let fail = CodeProgress::Tested {
            command: "cargo test".into(),
            passed: false,
            summary: "1 failed".into(),
        };
        assert!(pass.bubble().to_lowercase().contains("pass"));
        assert!(fail.bubble().to_lowercase().contains("fail"));
        assert_ne!(pass.bubble(), fail.bubble());
    }

    #[test]
    fn pr_opened_bubble_carries_number_and_url() {
        let pr = CodeProgress::PrOpened {
            number: 123,
            url: "https://github.com/eri-labs/eri/pull/123".into(),
            title: "Fix null-cart case".into(),
        };
        let b = pr.bubble();
        assert!(b.contains("123"), "bubble names the PR number: {b}");
        assert!(b.contains("github.com"), "bubble carries the link: {b}");
    }

    #[test]
    fn wire_envelope_carries_stage_text_and_payload() {
        let ev = CodeProgress::Tested {
            command: "cargo test".into(),
            passed: false,
            summary: "1 failed".into(),
        };
        let w = ev.wire();
        assert_eq!(w["stage"], "test");
        assert_eq!(w["passed"], false);
        assert_eq!(w["command"], "cargo test");
        assert!(
            w["text"].as_str().is_some_and(|t| !t.is_empty()),
            "the wire envelope carries the brain-composed bubble text"
        );
    }

    // ── pr_gate: the fail-closed rule ──

    #[test]
    fn pr_gate_forbids_when_no_test_has_run() {
        let progress = vec![
            CodeProgress::Planned {
                summary: "p".into(),
            },
            CodeProgress::Edited {
                files: vec!["a.rs".into()],
                summary: "e".into(),
            },
        ];
        assert!(
            pr_gate(&progress).is_err(),
            "no test run → an unverified PR is forbidden"
        );
    }

    #[test]
    fn pr_gate_forbids_after_a_red_run() {
        let progress = vec![CodeProgress::Tested {
            command: "cargo test".into(),
            passed: false,
            summary: "1 failed".into(),
        }];
        assert!(pr_gate(&progress).is_err(), "last run red → no PR");
    }

    #[test]
    fn pr_gate_allows_after_a_green_run() {
        let progress = vec![CodeProgress::Tested {
            command: "cargo test".into(),
            passed: true,
            summary: "all green".into(),
        }];
        assert!(pr_gate(&progress).is_ok(), "last run green → PR permitted");
    }

    #[test]
    fn pr_gate_uses_only_the_most_recent_run() {
        // Green then red → forbidden; red then green → permitted. Only the last
        // run's colour matters (you can fix a failure and re-run to green).
        let green_then_red = vec![
            CodeProgress::Tested {
                command: "t".into(),
                passed: true,
                summary: String::new(),
            },
            CodeProgress::Tested {
                command: "t".into(),
                passed: false,
                summary: String::new(),
            },
        ];
        let red_then_green = vec![
            CodeProgress::Tested {
                command: "t".into(),
                passed: false,
                summary: String::new(),
            },
            CodeProgress::Tested {
                command: "t".into(),
                passed: true,
                summary: String::new(),
            },
        ];
        assert!(pr_gate(&green_then_red).is_err());
        assert!(pr_gate(&red_then_green).is_ok());
    }

    // ── CodeOutcome ──

    #[test]
    fn outcome_opened_pr_only_for_opened() {
        assert!(
            CodeOutcome::Opened {
                number: 1,
                url: "u".into()
            }
            .opened_pr()
        );
        assert!(
            !CodeOutcome::TestsRed {
                summary: "x".into()
            }
            .opened_pr()
        );
        assert!(!CodeOutcome::Halted { reason: "x".into() }.opened_pr());
        assert!(!CodeOutcome::Refused { reason: "x".into() }.opened_pr());
    }

    #[test]
    fn outcome_summaries_are_human_and_distinct() {
        let opened = CodeOutcome::Opened {
            number: 7,
            url: "https://github.com/x/y/pull/7".into(),
        }
        .summary();
        assert!(opened.contains('7'));
        let red = CodeOutcome::TestsRed {
            summary: "checkout still red".into(),
        }
        .summary();
        assert!(red.to_lowercase().contains("test"));
        assert_ne!(opened, red);
    }

    // ── the CodeTurn seam via the scripted stub ──

    #[tokio::test]
    async fn scripted_turn_streams_events_in_order_then_settles() {
        let events = vec![
            CodeProgress::Planned {
                summary: "reproducing".into(),
            },
            CodeProgress::Edited {
                files: vec!["cart.rs".into()],
                summary: "guard the null cart".into(),
            },
            CodeProgress::Tested {
                command: "cargo test".into(),
                passed: true,
                summary: "green".into(),
            },
            CodeProgress::Committed {
                sha: "deadbeef".into(),
                message: "fix null cart".into(),
            },
            CodeProgress::PrOpened {
                number: 123,
                url: "https://github.com/eri-labs/eri/pull/123".into(),
                title: "Fix null-cart case".into(),
            },
        ];
        let outcome = CodeOutcome::Opened {
            number: 123,
            url: "https://github.com/eri-labs/eri/pull/123".into(),
        };
        let turn = ScriptedCodeTurn::new(events.clone(), outcome.clone());
        assert_eq!(turn.engine(), "stub");

        let sink = RecordingSink::default();
        let got = turn
            .run(&job(), &sink)
            .await
            .expect("stub run is infallible");

        assert_eq!(got, outcome, "the stub returns its scripted outcome");
        assert_eq!(
            *sink.seen.lock().unwrap(),
            events,
            "the stub streams its scripted events, in order"
        );
    }
}
