//! Structured review findings — the output of the review pipeline.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// Severity rank. `Critical` blocks merge, `Info` is FYI only.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Critical,
    High,
    Medium,
    Low,
    Info,
}

impl Severity {
    /// Higher is worse. Used by the dedup step to pick the worst severity
    /// when collapsing duplicate findings.
    pub fn rank(&self) -> u8 {
        match self {
            Severity::Critical => 4,
            Severity::High => 3,
            Severity::Medium => 2,
            Severity::Low => 1,
            Severity::Info => 0,
        }
    }
}

/// Bucket the finding fits in. Used for filtering (`ReviewOptions.focus`)
/// and for the report's per-category summary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FindingCategory {
    Security,
    Logic,
    Performance,
    Style,
    Test,
    Docs,
    Other,
}

/// One structured review comment. The IDE renders this in the tree view.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewFinding {
    pub severity: Severity,
    pub category: FindingCategory,
    pub file: PathBuf,
    /// `(start_line, end_line)` in the **post-image** (new file). 1-based,
    /// inclusive.
    pub line_range: (u32, u32),
    /// One-line summary used for tree-view labels.
    pub title: String,
    /// 2-4 sentence explanation rendered in the webview detail panel.
    pub description: String,
    /// Optional search/replace block ready to feed to `eri_apply::parse`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggested_fix: Option<String>,
    /// Model confidence, 0.0..=1.0. Findings with `< 0.3` are dropped by the
    /// pipeline unless effort=High.
    pub confidence: f32,
}

/// Aggregated report returned by `Reviewer::review`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewReport {
    pub findings: Vec<ReviewFinding>,
    pub total_files: usize,
    pub elapsed_ms: u64,
    pub model: String,
}

impl ReviewReport {
    /// Count of findings at or above the given severity.
    pub fn count_at_least(&self, min: Severity) -> usize {
        self.findings
            .iter()
            .filter(|f| f.severity.rank() >= min.rank())
            .count()
    }

    /// Per-severity counts as a `[critical, high, medium, low, info]` array.
    /// Stable order, useful for audit logs.
    pub fn severity_breakdown(&self) -> [usize; 5] {
        let mut out = [0usize; 5];
        for f in &self.findings {
            let idx = match f.severity {
                Severity::Critical => 0,
                Severity::High => 1,
                Severity::Medium => 2,
                Severity::Low => 3,
                Severity::Info => 4,
            };
            out[idx] += 1;
        }
        out
    }
}
