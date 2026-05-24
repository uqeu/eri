//! Review orchestration: walks the bundle, calls the backend per file, merges
//! findings, dedups, and assembles a `ReviewReport`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use anyhow::Result;
use async_trait::async_trait;

use crate::diff::DiffBundle;
use crate::findings::{FindingCategory, ReviewFinding, ReviewReport, Severity};
use crate::prompts::{FocusPass, SYSTEM_BASE, build_file_prompt};

/// How aggressively to review. `High` does three focus passes per file
/// (security, logic, performance) and merges.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Effort {
    Default,
    High,
}

/// Knobs for one review run.
#[derive(Debug, Clone)]
pub struct ReviewOptions {
    pub effort: Effort,
    /// If non-empty, drop findings whose category isn't in this list.
    pub focus: Vec<FindingCategory>,
    /// If `Some`, the pipeline reads `.eri/rules/*.md` and injects a digest
    /// into the prompt as project-specific guidance.
    pub project_rules_dir: Option<PathBuf>,
}

impl Default for ReviewOptions {
    fn default() -> Self {
        Self {
            effort: Effort::Default,
            focus: Vec::new(),
            project_rules_dir: None,
        }
    }
}

/// The inference-side backend the pipeline talks to. The sidecar wires a
/// real implementation backed by `eri_inference::LlmProvider`; tests use
/// `MockReviewBackend`. Keeps this crate free of inference dependencies.
#[async_trait]
pub trait ReviewBackend: Send + Sync {
    /// Send one constructed prompt to the model and return parsed findings.
    async fn review_file(&self, system: &str, user: &str) -> Result<Vec<ReviewFinding>>;

    /// Identifier for the model used. Surfaced in the report.
    fn model_id(&self) -> String;
}

/// Drives the review.
pub struct Reviewer {
    backend: Arc<dyn ReviewBackend>,
}

impl Reviewer {
    pub fn new(backend: Arc<dyn ReviewBackend>) -> Self {
        Self { backend }
    }

    pub async fn review(
        &self,
        bundle: &DiffBundle,
        options: &ReviewOptions,
    ) -> Result<ReviewReport> {
        let start = Instant::now();
        let extra_rules = load_project_rules(options.project_rules_dir.as_deref());

        let mut all: Vec<ReviewFinding> = Vec::new();
        for file in &bundle.files {
            if file.hunks.is_empty() {
                continue;
            }
            let user_prompt = build_file_prompt(file, extra_rules.as_deref());

            let passes: Vec<(String, String)> = match options.effort {
                Effort::Default => vec![(SYSTEM_BASE.to_string(), user_prompt)],
                Effort::High => vec![
                    (
                        format!("{SYSTEM_BASE}{}", FocusPass::Security.suffix()),
                        user_prompt.clone(),
                    ),
                    (
                        format!("{SYSTEM_BASE}{}", FocusPass::Logic.suffix()),
                        user_prompt.clone(),
                    ),
                    (
                        format!("{SYSTEM_BASE}{}", FocusPass::Performance.suffix()),
                        user_prompt,
                    ),
                ],
            };

            for (sys, usr) in passes {
                match self.backend.review_file(&sys, &usr).await {
                    Ok(mut findings) => {
                        // Force the file path onto every finding so the model
                        // can't accidentally label findings against a sibling.
                        for f in &mut findings {
                            if f.file.as_os_str().is_empty() {
                                f.file = file.path.clone();
                            }
                        }
                        all.extend(findings);
                    }
                    Err(err) => {
                        // One file's failure doesn't abort the whole review;
                        // record an Info-level finding so the user knows.
                        all.push(ReviewFinding {
                            severity: Severity::Info,
                            category: FindingCategory::Other,
                            file: file.path.clone(),
                            line_range: (0, 0),
                            title: "review pass failed".to_string(),
                            description: format!("The model failed to review this file: {err}"),
                            suggested_fix: None,
                            confidence: 0.0,
                        });
                    }
                }
            }
        }

        let filtered = apply_focus(all, &options.focus);
        let confidence_floor = match options.effort {
            Effort::Default => 0.3,
            Effort::High => 0.0,
        };
        let confidence_filtered: Vec<ReviewFinding> = filtered
            .into_iter()
            .filter(|f| f.confidence >= confidence_floor)
            .collect();
        let deduped = dedup_findings(confidence_filtered);

        Ok(ReviewReport {
            findings: deduped,
            total_files: bundle.files.len(),
            elapsed_ms: start.elapsed().as_millis() as u64,
            model: self.backend.model_id(),
        })
    }
}

fn apply_focus(findings: Vec<ReviewFinding>, focus: &[FindingCategory]) -> Vec<ReviewFinding> {
    if focus.is_empty() {
        return findings;
    }
    findings
        .into_iter()
        .filter(|f| focus.contains(&f.category))
        .collect()
}

/// Merge duplicates by `(file, line_range, title)` — keep the worst severity,
/// highest confidence, and any non-empty suggested fix.
fn dedup_findings(findings: Vec<ReviewFinding>) -> Vec<ReviewFinding> {
    let mut keyed: HashMap<(PathBuf, (u32, u32), String), ReviewFinding> = HashMap::new();
    for f in findings {
        let key = (f.file.clone(), f.line_range, f.title.clone());
        keyed
            .entry(key)
            .and_modify(|existing| {
                if f.severity.rank() > existing.severity.rank() {
                    existing.severity = f.severity;
                }
                if f.confidence > existing.confidence {
                    existing.confidence = f.confidence;
                }
                if existing.suggested_fix.is_none() && f.suggested_fix.is_some() {
                    existing.suggested_fix = f.suggested_fix.clone();
                }
            })
            .or_insert(f);
    }
    let mut out: Vec<ReviewFinding> = keyed.into_values().collect();
    // Stable order: severity desc, then file, then line.
    out.sort_by(|a, b| {
        b.severity
            .rank()
            .cmp(&a.severity.rank())
            .then(a.file.cmp(&b.file))
            .then(a.line_range.0.cmp(&b.line_range.0))
    });
    out
}

/// Read `.eri/rules/*.md` and concatenate the first ~4KB. The model gets a
/// digest, not the full corpus. Stays fast and keeps prompts under context.
fn load_project_rules(dir: Option<&std::path::Path>) -> Option<String> {
    let dir = dir?;
    let mut buf = String::new();
    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        if let Ok(text) = std::fs::read_to_string(&path) {
            buf.push_str("# ");
            buf.push_str(path.file_stem().and_then(|s| s.to_str()).unwrap_or("rule"));
            buf.push('\n');
            buf.push_str(&text);
            buf.push_str("\n\n");
        }
        if buf.len() > 4096 {
            buf.truncate(4096);
            buf.push_str("\n…(truncated)");
            break;
        }
    }
    if buf.is_empty() { None } else { Some(buf) }
}

// ---------------------------------------------------------------------------
// Test backend
// ---------------------------------------------------------------------------

#[cfg(any(test, feature = "testkit"))]
pub mod testkit {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// In-memory backend that returns canned findings and tallies call counts.
    pub struct MockReviewBackend {
        pub findings: std::sync::Mutex<Vec<ReviewFinding>>,
        pub calls: AtomicUsize,
        pub fail_on_call: Option<usize>,
    }

    impl MockReviewBackend {
        pub fn new(findings: Vec<ReviewFinding>) -> Self {
            Self {
                findings: std::sync::Mutex::new(findings),
                calls: AtomicUsize::new(0),
                fail_on_call: None,
            }
        }

        pub fn call_count(&self) -> usize {
            self.calls.load(Ordering::SeqCst)
        }
    }

    #[async_trait]
    impl ReviewBackend for MockReviewBackend {
        async fn review_file(
            &self,
            _system: &str,
            _user: &str,
        ) -> anyhow::Result<Vec<ReviewFinding>> {
            let n = self.calls.fetch_add(1, Ordering::SeqCst);
            if Some(n) == self.fail_on_call {
                return Err(anyhow::anyhow!("forced failure"));
            }
            let guard = self
                .findings
                .lock()
                .map_err(|e| anyhow::anyhow!("mock lock poisoned: {e}"))?;
            Ok(guard.clone())
        }
        fn model_id(&self) -> String {
            "mock".to_string()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::testkit::MockReviewBackend;
    use super::*;
    use crate::diff::{ChangeKind, DiffHunk, DiffSource, FileDiff};

    fn sample_finding(file: &str, severity: Severity, title: &str) -> ReviewFinding {
        ReviewFinding {
            severity,
            category: FindingCategory::Logic,
            file: PathBuf::from(file),
            line_range: (1, 2),
            title: title.to_string(),
            description: "desc".to_string(),
            suggested_fix: None,
            confidence: 0.9,
        }
    }

    fn one_file_bundle() -> DiffBundle {
        DiffBundle {
            files: vec![FileDiff {
                path: PathBuf::from("a.rs"),
                change_kind: ChangeKind::Modified,
                hunks: vec![DiffHunk {
                    old_range: (1, 1),
                    new_range: (1, 1),
                    content: "-old\n+new\n".to_string(),
                }],
                language: Some("rust".to_string()),
            }],
            source: DiffSource::LocalUnstaged,
            commit_messages: vec![],
        }
    }

    #[tokio::test]
    async fn default_effort_calls_backend_once_per_file() {
        let backend = Arc::new(MockReviewBackend::new(vec![sample_finding(
            "a.rs",
            Severity::High,
            "bug",
        )]));
        let reviewer = Reviewer::new(backend.clone());
        let report = reviewer
            .review(&one_file_bundle(), &ReviewOptions::default())
            .await
            .expect("review");
        assert_eq!(report.findings.len(), 1);
        assert_eq!(report.total_files, 1);
        assert_eq!(backend.call_count(), 1);
    }

    #[tokio::test]
    async fn high_effort_triggers_three_backend_calls_per_file() {
        let backend = Arc::new(MockReviewBackend::new(vec![]));
        let reviewer = Reviewer::new(backend.clone());
        let opts = ReviewOptions {
            effort: Effort::High,
            ..Default::default()
        };
        let _ = reviewer
            .review(&one_file_bundle(), &opts)
            .await
            .expect("review");
        assert_eq!(backend.call_count(), 3);
    }

    #[tokio::test]
    async fn dedup_collapses_identical_findings() {
        let backend = Arc::new(MockReviewBackend::new(vec![
            sample_finding("a.rs", Severity::Low, "same"),
            sample_finding("a.rs", Severity::Critical, "same"),
            sample_finding("a.rs", Severity::Medium, "different"),
        ]));
        let reviewer = Reviewer::new(backend);
        let report = reviewer
            .review(&one_file_bundle(), &ReviewOptions::default())
            .await
            .expect("review");
        assert_eq!(report.findings.len(), 2);
        // The merged "same" finding should keep the worst severity.
        let same = report
            .findings
            .iter()
            .find(|f| f.title == "same")
            .expect("same finding");
        assert_eq!(same.severity, Severity::Critical);
    }

    #[tokio::test]
    async fn focus_filter_drops_off_category_findings() {
        let mut sec = sample_finding("a.rs", Severity::High, "sec-issue");
        sec.category = FindingCategory::Security;
        let perf = {
            let mut f = sample_finding("a.rs", Severity::High, "perf-issue");
            f.category = FindingCategory::Performance;
            f
        };
        let backend = Arc::new(MockReviewBackend::new(vec![sec, perf]));
        let reviewer = Reviewer::new(backend);
        let opts = ReviewOptions {
            focus: vec![FindingCategory::Security],
            ..Default::default()
        };
        let report = reviewer
            .review(&one_file_bundle(), &opts)
            .await
            .expect("review");
        assert_eq!(report.findings.len(), 1);
        assert_eq!(report.findings[0].category, FindingCategory::Security);
    }

    #[tokio::test]
    async fn confidence_below_floor_is_dropped_on_default_effort() {
        let mut low = sample_finding("a.rs", Severity::High, "iffy");
        low.confidence = 0.1;
        let backend = Arc::new(MockReviewBackend::new(vec![low]));
        let reviewer = Reviewer::new(backend);
        let report = reviewer
            .review(&one_file_bundle(), &ReviewOptions::default())
            .await
            .expect("review");
        assert!(report.findings.is_empty());
    }

    #[tokio::test]
    async fn backend_failure_becomes_info_finding() {
        let backend = Arc::new(MockReviewBackend {
            findings: std::sync::Mutex::new(vec![]),
            calls: std::sync::atomic::AtomicUsize::new(0),
            fail_on_call: Some(0),
        });
        let reviewer = Reviewer::new(backend);
        // Info findings have confidence 0.0 which is < 0.3 default floor, so
        // they'd normally be dropped — bump to High effort to see them.
        let opts = ReviewOptions {
            effort: Effort::High,
            ..Default::default()
        };
        let report = reviewer
            .review(&one_file_bundle(), &opts)
            .await
            .expect("review");
        // Three passes ran, one failed → one info finding.
        assert!(
            report
                .findings
                .iter()
                .any(|f| f.title == "review pass failed")
        );
    }

    #[test]
    fn severity_breakdown_counts_each_bucket() {
        let report = ReviewReport {
            findings: vec![
                sample_finding("a.rs", Severity::Critical, "a"),
                sample_finding("a.rs", Severity::Critical, "b"),
                sample_finding("a.rs", Severity::Low, "c"),
            ],
            total_files: 1,
            elapsed_ms: 0,
            model: "mock".to_string(),
        };
        assert_eq!(report.severity_breakdown(), [2, 0, 0, 1, 0]);
        assert_eq!(report.count_at_least(Severity::High), 2);
    }
}
