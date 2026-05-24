//! Prompt construction for the review pipeline.

use crate::diff::FileDiff;

/// Shared system prompt prefix used for every review pass. The model must
/// return findings as a JSON array conforming to `ReviewFinding`.
pub const SYSTEM_BASE: &str = "\
You are reviewing a pull request. For each issue you find, emit one JSON object \
with these fields: severity (\"critical\"|\"high\"|\"medium\"|\"low\"|\"info\"), \
category (\"security\"|\"logic\"|\"performance\"|\"style\"|\"test\"|\"docs\"|\"other\"), \
file (path), line_range ([start,end]), title (one line), description (2-4 sentences), \
suggested_fix (optional eri-apply search/replace block), confidence (0.0-1.0). \
Wrap the array in ```json ... ``` fences. If there are no findings, emit []. \
Be concrete: cite the exact line numbers from the diff's post-image. Do NOT flag style nitpicks \
unless they cause real bugs.";

/// Pass-specific suffix used when effort=High. Default effort sends only the
/// base prompt.
pub enum FocusPass {
    Security,
    Logic,
    Performance,
}

impl FocusPass {
    pub fn suffix(&self) -> &'static str {
        match self {
            FocusPass::Security => {
                " Focus this pass on security: injection, authn/authz, secrets, unsafe casts, path traversal, deserialization."
            }
            FocusPass::Logic => {
                " Focus this pass on logic and correctness: off-by-one, null/None handling, error swallowing, race conditions, control flow."
            }
            FocusPass::Performance => {
                " Focus this pass on performance: N+1 queries, unnecessary allocations, blocking I/O on hot paths, missing pagination."
            }
        }
    }
}

/// Build the user-side prompt for one file. Includes the unified diff and a
/// minimal header so the model knows the path and language.
pub fn build_file_prompt(file: &FileDiff, extra_rules: Option<&str>) -> String {
    let mut buf = String::new();
    buf.push_str("File: ");
    buf.push_str(&file.path.to_string_lossy());
    buf.push('\n');
    if let Some(lang) = &file.language {
        buf.push_str("Language: ");
        buf.push_str(lang);
        buf.push('\n');
    }
    buf.push_str("Change kind: ");
    buf.push_str(match &file.change_kind {
        crate::diff::ChangeKind::Added => "added",
        crate::diff::ChangeKind::Modified => "modified",
        crate::diff::ChangeKind::Deleted => "deleted",
        crate::diff::ChangeKind::Renamed { .. } => "renamed",
    });
    buf.push_str("\n\n");

    if let Some(rules) = extra_rules {
        if !rules.is_empty() {
            buf.push_str("Project rules:\n");
            buf.push_str(rules);
            buf.push_str("\n\n");
        }
    }

    buf.push_str("Unified diff:\n```diff\n");
    for hunk in &file.hunks {
        buf.push_str(&format!(
            "@@ -{},{} +{},{} @@\n",
            hunk.old_range.0, hunk.old_range.1, hunk.new_range.0, hunk.new_range.1
        ));
        buf.push_str(&hunk.content);
    }
    buf.push_str("```\n");
    buf
}
