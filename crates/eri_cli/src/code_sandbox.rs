//! B2 — the harness-in-sandbox adapter: the cloud-primary [`CodeTurn`].
//!
//! Runs the eri-code harness against an ALREADY-CLONED working tree (cloning is
//! infra/I0, not here — the dispatch worker supplies `job.working_tree`), loops
//! **edit → test until green**, and is **FAIL-CLOSED**: a PR is opened only
//! after [`pr_gate`] passes, never on red. The live harness, test runner,
//! committer, and PR author are dependency-injected **seams**, so the whole
//! orchestration is TDD-tested with no network, no container, and no GitHub:
//!
//!   - [`Harness`] — one edit pass over the tree (real impl wraps
//!     `build_agent::run_build_agent`; lands with the worker).
//!   - [`TestRunner`] — run the repo's test command, capture pass/fail. A real
//!     [`ShellTestRunner`] ships here (test-capture is what fail-closed hinges
//!     on).
//!   - [`Committer`] — commit the green tree (real impl wraps `eri_git`).
//!   - [`PrAuthor`] — open the PR (B3 implements via the GitHub API; called ONLY
//!     after [`pr_gate`]).
//!
//! `dead_code` allowed module-wide (as in [`crate::code_turn`]) until the
//! dispatch worker wires the live seams.
#![allow(dead_code)]

use std::path::Path;

use anyhow::Result;
use async_trait::async_trait;

use crate::code_turn::{CodeJob, CodeOutcome, CodeProgress, CodeProgressSink, CodeTurn, pr_gate};

/// The result of one harness edit pass. `Edited` carries the changed files;
/// `Refused` is the absolute boundary handing back (injected instructions /
/// secrets in repo content); `Halted` is a recoverable stop (quota/capacity)
/// surfaced from the build loop.
pub enum HarnessAttempt {
    Edited {
        files: Vec<String>,
        summary: String,
        tokens: u64,
    },
    Refused(String),
    Halted(String),
}

/// Runs the eri-code harness once against a working tree, optionally with the
/// previous test failure as `feedback` so a retry can fix what broke.
#[async_trait]
pub trait Harness: Send + Sync {
    async fn attempt(
        &self,
        task: &str,
        working_tree: &Path,
        feedback: Option<&str>,
    ) -> Result<HarnessAttempt>;
}

/// The outcome of running the repo's test command.
pub struct TestReport {
    pub command: String,
    pub passed: bool,
    pub summary: String,
}

/// Runs the repo's test command against the working tree and reports pass/fail.
#[async_trait]
pub trait TestRunner: Send + Sync {
    async fn run(&self, working_tree: &Path) -> Result<TestReport>;
}

/// Commits the (green) working tree; returns the new commit sha.
#[async_trait]
pub trait Committer: Send + Sync {
    async fn commit(&self, working_tree: &Path, message: &str) -> Result<String>;
}

/// A reference to a pull request.
pub struct PrRef {
    pub number: u64,
    pub url: String,
    pub title: String,
}

/// What the terminal PR step did. `newly_opened` distinguishes a **fresh** PR
/// (B3, `Opened` outcome) from a **follow-up** push to an EXISTING PR (B4 review
/// loop, `Updated` outcome) — so the phone says "opened PR #123" vs "pushed
/// another commit to PR #123", never the wrong one.
pub struct PrOutcome {
    pub pr: PrRef,
    pub newly_opened: bool,
}

/// Finalises a green, committed job into a pull request. B3's `GitHubPrAuthor`
/// opens a fresh PR; B4's follow-up author pushes another commit to an existing
/// one. B2 injects a stub. Called ONLY after [`pr_gate`] passes. `progress` is
/// the full emitted event stream so the author can build an eri-voice summary +
/// the passing-test evidence into the PR body.
#[async_trait]
pub trait PrAuthor: Send + Sync {
    async fn open(
        &self,
        job: &CodeJob,
        commit_sha: &str,
        progress: &[CodeProgress],
    ) -> Result<PrOutcome>;
}

/// The harness-in-sandbox [`CodeTurn`]. Orchestrates plan → (edit → test)* →
/// fail-closed → commit → PR over the injected seams.
pub struct SandboxCodeTurn {
    harness: Box<dyn Harness>,
    tests: Box<dyn TestRunner>,
    committer: Box<dyn Committer>,
    pr_author: Box<dyn PrAuthor>,
    /// Hard cap on edit→test attempts before giving up red (a runaway backstop).
    max_attempts: usize,
}

impl SandboxCodeTurn {
    pub fn new(
        harness: Box<dyn Harness>,
        tests: Box<dyn TestRunner>,
        committer: Box<dyn Committer>,
        pr_author: Box<dyn PrAuthor>,
        max_attempts: usize,
    ) -> Self {
        Self {
            harness,
            tests,
            committer,
            pr_author,
            max_attempts: max_attempts.max(1),
        }
    }

    /// Emit one event to the sink AND record it locally, so [`pr_gate`] can be
    /// enforced over the exact sequence the phone saw.
    fn emit(sink: &dyn CodeProgressSink, events: &mut Vec<CodeProgress>, ev: CodeProgress) {
        sink.emit(&ev);
        events.push(ev);
    }
}

#[async_trait]
impl CodeTurn for SandboxCodeTurn {
    fn engine(&self) -> &'static str {
        "sandbox"
    }

    async fn run(&self, job: &CodeJob, sink: &dyn CodeProgressSink) -> Result<CodeOutcome> {
        let wt = job.working_tree.as_path();
        let mut events: Vec<CodeProgress> = Vec::new();

        Self::emit(
            sink,
            &mut events,
            CodeProgress::Planned {
                summary: format!("on it — {}", headline(&job.task)),
            },
        );

        let mut spent_tokens: u64 = 0;
        let mut feedback: Option<String> = None;
        let mut green = false;

        for _attempt in 1..=self.max_attempts {
            // Budget check BEFORE each pass — a stuck edit→test loop can't run
            // away. (Wall-clock is enforced by the worker's deadline; the token
            // ceiling is enforced here.)
            if let Some(reason) = job.budget.exceeded(spent_tokens, 0) {
                return Ok(CodeOutcome::Halted { reason });
            }

            match self
                .harness
                .attempt(&job.task, wt, feedback.as_deref())
                .await?
            {
                HarnessAttempt::Refused(reason) => return Ok(CodeOutcome::Refused { reason }),
                HarnessAttempt::Halted(reason) => return Ok(CodeOutcome::Halted { reason }),
                HarnessAttempt::Edited {
                    files,
                    summary,
                    tokens,
                } => {
                    spent_tokens = spent_tokens.saturating_add(tokens);
                    Self::emit(sink, &mut events, CodeProgress::Edited { files, summary });
                }
            }

            let report = self.tests.run(wt).await?;
            let passed = report.passed;
            let failure = report.summary.clone();
            Self::emit(
                sink,
                &mut events,
                CodeProgress::Tested {
                    command: report.command,
                    passed,
                    summary: report.summary,
                },
            );
            if passed {
                green = true;
                break;
            }
            // Feed the failing test's output back so the next pass fixes it.
            feedback = Some(failure);
        }

        if !green {
            let summary = last_test_summary(&events)
                .unwrap_or_else(|| "tests did not reach green".to_string());
            return Ok(CodeOutcome::TestsRed { summary });
        }

        // FAIL-CLOSED: the ONE PR gate. Reaching here implies the last test was
        // green, so this passes — but it is the contract's single enforcement
        // point, so a PR is never opened around it.
        if let Err(reason) = pr_gate(&events) {
            return Ok(CodeOutcome::TestsRed { summary: reason });
        }

        let message = commit_message(&job.task);
        let sha = self.committer.commit(wt, &message).await?;
        Self::emit(
            sink,
            &mut events,
            CodeProgress::Committed {
                sha: sha.clone(),
                message,
            },
        );

        let done = self.pr_author.open(job, &sha, &events).await?;
        let (number, url) = (done.pr.number, done.pr.url.clone());
        if done.newly_opened {
            // A fresh PR — stream the PrOpened milestone + the Opened outcome.
            Self::emit(
                sink,
                &mut events,
                CodeProgress::PrOpened {
                    number,
                    url: done.pr.url,
                    title: done.pr.title,
                },
            );
            Ok(CodeOutcome::Opened { number, url })
        } else {
            // A follow-up (B4): the PR already existed; the pushed commit updated
            // it. The Committed event already streamed; settle as Updated.
            Ok(CodeOutcome::Updated { number, url })
        }
    }
}

/// First line of the task, clipped — the human headline for the `Planned` bubble.
fn headline(task: &str) -> String {
    task.lines()
        .next()
        .unwrap_or("")
        .trim()
        .chars()
        .take(80)
        .collect()
}

/// A commit message from the task (its first line), with a generic fallback.
fn commit_message(task: &str) -> String {
    let first = task.lines().next().unwrap_or("").trim();
    if first.is_empty() {
        "eri: automated change".to_string()
    } else {
        first.to_string()
    }
}

/// The summary of the most recent `Tested` event, if any.
fn last_test_summary(events: &[CodeProgress]) -> Option<String> {
    events.iter().rev().find_map(|e| match e {
        CodeProgress::Tested { summary, .. } => Some(summary.clone()),
        _ => None,
    })
}

// ---------------------------------------------------------------------------
// A real TestRunner — shell the repo's test command and capture pass/fail. This
// is the test-capture fail-closed depends on, so it ships (and is tested) now.
// ---------------------------------------------------------------------------

/// Runs a fixed shell command in the working tree; `passed` is the process exit
/// status. Captures a tail of the output as the summary. The real cloud path
/// wraps this behind a timeout (the job budget); the capture itself is here.
pub struct ShellTestRunner {
    command: String,
}

impl ShellTestRunner {
    pub fn new(command: impl Into<String>) -> Self {
        Self {
            command: command.into(),
        }
    }
}

#[async_trait]
impl TestRunner for ShellTestRunner {
    async fn run(&self, working_tree: &Path) -> Result<TestReport> {
        use tokio::process::Command;
        let output = Command::new("sh")
            .arg("-c")
            .arg(&self.command)
            .current_dir(working_tree)
            .output()
            .await?;
        let passed = output.status.success();
        // The failure tail is what a retry needs; prefer stderr, fall back to stdout.
        let mut text = String::from_utf8_lossy(&output.stderr).into_owned();
        if text.trim().is_empty() {
            text = String::from_utf8_lossy(&output.stdout).into_owned();
        }
        Ok(TestReport {
            command: self.command.clone(),
            passed,
            summary: tail(&text, 2_000),
        })
    }
}

/// Keep the last `max` chars of `s` (the tail is where a test failure prints).
fn tail(s: &str, max: usize) -> String {
    let s = s.trim();
    let n = s.chars().count();
    if n <= max {
        return s.to_string();
    }
    let skip = n - max;
    format!("…{}", s.chars().skip(skip).collect::<String>())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::path::PathBuf;
    use std::sync::Arc;
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use crate::code_turn::CodeBudget;

    // ── test doubles ──

    type FeedbackLog = Arc<Mutex<Vec<Option<String>>>>;

    struct ScriptedHarness {
        attempts: Mutex<VecDeque<HarnessAttempt>>,
        feedback_seen: FeedbackLog,
    }
    impl ScriptedHarness {
        fn new(attempts: Vec<HarnessAttempt>) -> Self {
            Self {
                attempts: Mutex::new(attempts.into_iter().collect()),
                feedback_seen: Arc::new(Mutex::new(Vec::new())),
            }
        }
        /// A handle to inspect the `feedback` argument of each attempt after the
        /// harness has been boxed into the turn.
        fn feedback_log(&self) -> FeedbackLog {
            Arc::clone(&self.feedback_seen)
        }
    }
    #[async_trait]
    impl Harness for ScriptedHarness {
        async fn attempt(
            &self,
            _task: &str,
            _wt: &Path,
            feedback: Option<&str>,
        ) -> Result<HarnessAttempt> {
            self.feedback_seen
                .lock()
                .unwrap()
                .push(feedback.map(str::to_string));
            Ok(self
                .attempts
                .lock()
                .unwrap()
                .pop_front()
                .expect("scripted harness ran out of attempts"))
        }
    }

    struct ScriptedTests {
        reports: Mutex<VecDeque<TestReport>>,
    }
    impl ScriptedTests {
        fn new(reports: Vec<TestReport>) -> Self {
            Self {
                reports: Mutex::new(reports.into_iter().collect()),
            }
        }
    }
    #[async_trait]
    impl TestRunner for ScriptedTests {
        async fn run(&self, _wt: &Path) -> Result<TestReport> {
            Ok(self
                .reports
                .lock()
                .unwrap()
                .pop_front()
                .expect("scripted tests ran out of reports"))
        }
    }

    struct StubCommitter {
        sha: String,
        calls: Mutex<Vec<String>>,
    }
    impl StubCommitter {
        fn new(sha: &str) -> Self {
            Self {
                sha: sha.to_string(),
                calls: Mutex::new(Vec::new()),
            }
        }
    }
    #[async_trait]
    impl Committer for StubCommitter {
        async fn commit(&self, _wt: &Path, message: &str) -> Result<String> {
            self.calls.lock().unwrap().push(message.to_string());
            Ok(self.sha.clone())
        }
    }

    struct CountingPrAuthor {
        number: u64,
        newly_opened: bool,
        calls: AtomicUsize,
    }
    impl CountingPrAuthor {
        fn new(number: u64) -> Self {
            Self {
                number,
                newly_opened: true,
                calls: AtomicUsize::new(0),
            }
        }
        /// A follow-up author: it pushed to an EXISTING PR (B4), didn't open one.
        fn follow_up(number: u64) -> Self {
            Self {
                number,
                newly_opened: false,
                calls: AtomicUsize::new(0),
            }
        }
        fn calls(&self) -> usize {
            self.calls.load(Ordering::SeqCst)
        }
    }
    #[async_trait]
    impl PrAuthor for CountingPrAuthor {
        async fn open(
            &self,
            _job: &CodeJob,
            _sha: &str,
            _progress: &[CodeProgress],
        ) -> Result<PrOutcome> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Ok(PrOutcome {
                pr: PrRef {
                    number: self.number,
                    url: format!("https://github.com/eri-labs/eri/pull/{}", self.number),
                    title: "Fix".into(),
                },
                newly_opened: self.newly_opened,
            })
        }
    }

    #[derive(Default)]
    struct RecordingSink {
        seen: Mutex<Vec<CodeProgress>>,
    }
    impl CodeProgressSink for RecordingSink {
        fn emit(&self, event: &CodeProgress) {
            self.seen.lock().unwrap().push(event.clone());
        }
    }

    fn edited(files: &[&str], tokens: u64) -> HarnessAttempt {
        HarnessAttempt::Edited {
            files: files.iter().map(|s| s.to_string()).collect(),
            summary: "made the change".into(),
            tokens,
        }
    }
    fn report(passed: bool, summary: &str) -> TestReport {
        TestReport {
            command: "cargo test".into(),
            passed,
            summary: summary.into(),
        }
    }
    fn job_with(budget: CodeBudget) -> CodeJob {
        CodeJob {
            task: "fix the checkout test".into(),
            repo: "eri-labs/eri".into(),
            working_tree: PathBuf::from("/tmp/clone"),
            base: None,
            budget,
        }
    }
    fn stages(sink: &RecordingSink) -> Vec<&'static str> {
        sink.seen
            .lock()
            .unwrap()
            .iter()
            .map(CodeProgress::stage)
            .collect()
    }

    // ── orchestration ──

    #[tokio::test]
    async fn green_first_attempt_commits_and_opens_a_pr() {
        let harness = ScriptedHarness::new(vec![edited(&["cart.rs"], 10)]);
        let tests = ScriptedTests::new(vec![report(true, "42 passed")]);
        let committer = StubCommitter::new("deadbeef");
        let pr = CountingPrAuthor::new(123);
        let turn = SandboxCodeTurn::new(
            Box::new(harness),
            Box::new(tests),
            Box::new(committer),
            Box::new(pr),
            3,
        );
        assert_eq!(turn.engine(), "sandbox");

        let sink = RecordingSink::default();
        let out = turn
            .run(&job_with(CodeBudget::default()), &sink)
            .await
            .unwrap();

        assert_eq!(
            out,
            CodeOutcome::Opened {
                number: 123,
                url: "https://github.com/eri-labs/eri/pull/123".into()
            }
        );
        assert_eq!(
            stages(&sink),
            vec!["plan", "edit", "test", "commit", "pr"],
            "the happy path streams plan→edit→test→commit→pr"
        );
    }

    #[tokio::test]
    async fn a_follow_up_updates_the_existing_pr_without_a_pr_event() {
        // B4: the terminal author reports newly_opened=false → the loop settles
        // Updated (not Opened) and emits no PrOpened, since nothing was opened.
        let harness = ScriptedHarness::new(vec![edited(&["cart.rs"], 10)]);
        let tests = ScriptedTests::new(vec![report(true, "green")]);
        let committer = StubCommitter::new("beef");
        let pr = CountingPrAuthor::follow_up(123);
        let turn = SandboxCodeTurn::new(
            Box::new(harness),
            Box::new(tests),
            Box::new(committer),
            Box::new(pr),
            3,
        );
        let sink = RecordingSink::default();
        let out = turn
            .run(&job_with(CodeBudget::default()), &sink)
            .await
            .unwrap();
        assert_eq!(
            out,
            CodeOutcome::Updated {
                number: 123,
                url: "https://github.com/eri-labs/eri/pull/123".into()
            }
        );
        let st = stages(&sink);
        assert!(st.contains(&"commit"), "a follow-up still commits");
        assert!(
            !st.contains(&"pr"),
            "a follow-up opens nothing → no PrOpened event"
        );
    }

    #[tokio::test]
    async fn red_then_green_retries_with_feedback_then_opens() {
        let harness =
            ScriptedHarness::new(vec![edited(&["cart.rs"], 10), edited(&["cart.rs"], 10)]);
        let feedback = harness.feedback_log(); // inspect the retry's feedback after the run
        let tests = ScriptedTests::new(vec![
            report(false, "1 failed: null cart"),
            report(true, "green"),
        ]);
        let committer = StubCommitter::new("cafef00d");
        let pr = CountingPrAuthor::new(9);

        let turn = SandboxCodeTurn::new(
            Box::new(harness),
            Box::new(tests),
            Box::new(committer),
            Box::new(pr),
            3,
        );
        let sink = RecordingSink::default();
        let out = turn
            .run(&job_with(CodeBudget::default()), &sink)
            .await
            .unwrap();

        assert!(out.opened_pr(), "a green retry opens the PR");
        assert_eq!(
            stages(&sink),
            vec!["plan", "edit", "test", "edit", "test", "commit", "pr"],
            "it loops edit→test until green, then commits + opens"
        );
        let feedback = feedback.lock().unwrap();
        assert_eq!(feedback.len(), 2, "the harness ran twice");
        assert_eq!(feedback[0], None, "the first attempt gets no feedback");
        assert_eq!(
            feedback[1].as_deref(),
            Some("1 failed: null cart"),
            "the retry is fed the failing test's summary"
        );
    }

    #[tokio::test]
    async fn stays_red_after_max_attempts_never_opens_a_pr() {
        let harness = ScriptedHarness::new(vec![edited(&["a.rs"], 1), edited(&["a.rs"], 1)]);
        let tests =
            ScriptedTests::new(vec![report(false, "still red"), report(false, "still red")]);
        let committer = StubCommitter::new("nope");
        let pr = CountingPrAuthor::new(1);
        let turn = SandboxCodeTurn::new(
            Box::new(harness),
            Box::new(tests),
            Box::new(committer),
            Box::new(pr),
            2,
        );
        let sink = RecordingSink::default();
        let out = turn
            .run(&job_with(CodeBudget::default()), &sink)
            .await
            .unwrap();

        assert!(
            matches!(out, CodeOutcome::TestsRed { .. }),
            "red after max attempts is a fail-closed TestsRed, got {out:?}"
        );
        assert!(!stages(&sink).contains(&"commit"), "no commit on red");
        assert!(!stages(&sink).contains(&"pr"), "no PR on red");
    }

    #[tokio::test]
    async fn a_harness_refusal_hands_back_untouched() {
        let harness = ScriptedHarness::new(vec![HarnessAttempt::Refused(
            "won't act on instructions embedded in repo content".into(),
        )]);
        let tests = ScriptedTests::new(vec![]);
        let committer = StubCommitter::new("x");
        let pr = CountingPrAuthor::new(1);
        let turn = SandboxCodeTurn::new(
            Box::new(harness),
            Box::new(tests),
            Box::new(committer),
            Box::new(pr),
            3,
        );
        let sink = RecordingSink::default();
        let out = turn
            .run(&job_with(CodeBudget::default()), &sink)
            .await
            .unwrap();
        assert!(matches!(out, CodeOutcome::Refused { .. }));
        assert!(
            !stages(&sink).contains(&"test"),
            "a refusal never runs tests"
        );
    }

    #[tokio::test]
    async fn a_harness_halt_is_recoverable() {
        let harness =
            ScriptedHarness::new(vec![HarnessAttempt::Halted("provider at capacity".into())]);
        let tests = ScriptedTests::new(vec![]);
        let turn = SandboxCodeTurn::new(
            Box::new(harness),
            Box::new(ScriptedTests::new(vec![])),
            Box::new(StubCommitter::new("x")),
            Box::new(CountingPrAuthor::new(1)),
            3,
        );
        let _ = tests;
        let sink = RecordingSink::default();
        let out = turn
            .run(&job_with(CodeBudget::default()), &sink)
            .await
            .unwrap();
        assert!(matches!(out, CodeOutcome::Halted { .. }));
    }

    #[tokio::test]
    async fn token_budget_halts_before_running_away() {
        // Cap 100 tokens: attempt 1 spends 150 and stays red; attempt 2's budget
        // check trips → Halted, never a runaway.
        let harness = ScriptedHarness::new(vec![edited(&["a.rs"], 150), edited(&["a.rs"], 150)]);
        let tests = ScriptedTests::new(vec![report(false, "red")]);
        let turn = SandboxCodeTurn::new(
            Box::new(harness),
            Box::new(tests),
            Box::new(StubCommitter::new("x")),
            Box::new(CountingPrAuthor::new(1)),
            5,
        );
        let sink = RecordingSink::default();
        let budget = CodeBudget {
            max_tokens: 100,
            max_seconds: 100_000,
        };
        let out = turn.run(&job_with(budget), &sink).await.unwrap();
        match out {
            CodeOutcome::Halted { reason } => assert!(reason.contains("token"), "reason: {reason}"),
            other => panic!("expected Halted on token cap, got {other:?}"),
        }
    }

    // ── the real ShellTestRunner: test-capture ──

    #[tokio::test]
    async fn shell_runner_reports_a_passing_command() {
        let r = ShellTestRunner::new("exit 0");
        let report = r.run(&std::env::temp_dir()).await.unwrap();
        assert!(report.passed);
        assert_eq!(report.command, "exit 0");
    }

    #[tokio::test]
    async fn shell_runner_reports_a_failing_command() {
        let r = ShellTestRunner::new("echo boom >&2; exit 1");
        let report = r.run(&std::env::temp_dir()).await.unwrap();
        assert!(!report.passed, "a non-zero exit is a red run (fail-closed)");
    }
}
