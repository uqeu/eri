//! eri_apply — deterministic Fast-Apply replacement.
//!
//! Parses aider-style `<<<<<<< SEARCH ... ======= ... >>>>>>> REPLACE` blocks out
//! of arbitrary model output and applies them atomically to files on disk. This
//! replaces the role of Cursor's trained Fast-Apply model with pure string ops:
//! no inference latency, fully provider-agnostic, deterministic.

use std::path::PathBuf;

mod apply;
mod matcher;
mod parse;

pub use apply::{Applied, ApplyKind, ApplyReport, Failed, FailureReason, apply};
pub use parse::{parse, parse_streaming};

/// A single search/replace edit extracted from model output.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Edit {
    pub path: PathBuf,
    pub search: String,
    pub replace: String,
}
