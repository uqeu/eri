//! `eri_review` — forge-neutral PR review surface for the eri sidecar.
//!
//! Loads a unified diff from one of several sources (local git ranges,
//! GitHub / GitLab / Forgejo PRs via their CLI, or a raw patch), sends each
//! file through a `ReviewBackend` (wired to the inference layer by the
//! sidecar), and returns a `ReviewReport` of structured findings.
//!
//! On-demand only — there is no background bot. The sidecar invokes us when
//! the user runs an `eri/review/*` JSON-RPC method.

pub mod diff;
pub mod findings;
pub mod loaders;
pub mod parser;
pub mod pipeline;
pub mod prompts;

pub use diff::{ChangeKind, DiffBundle, DiffHunk, DiffSource, FileDiff};
pub use findings::{FindingCategory, ReviewFinding, ReviewReport, Severity};
pub use loaders::{
    DiffLoader, ForgejoApiLoader, GithubApiLoader, GitlabApiLoader, LocalGitLoader, PatchLoader,
    loader_for,
};
pub use pipeline::{Effort, ReviewBackend, ReviewOptions, Reviewer};

#[cfg(any(test, feature = "testkit"))]
pub use pipeline::testkit::MockReviewBackend;
