//! Forge-neutral diff model.
//!
//! `DiffBundle` is the result of loading a diff from any source — local git,
//! a GitHub / GitLab / Forgejo PR, or a user-pasted patch. The review
//! pipeline only sees `DiffBundle`; loaders own forge specifics.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// Where the diff came from. Loaders consume this; the pipeline only reads it
/// for metadata (report header, audit log) and to know which CLI to drive.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DiffSource {
    /// Unstaged changes in the working tree (`git diff`).
    LocalUnstaged,
    /// Staged changes (`git diff --cached`).
    LocalStaged,
    /// Two-dot range (`git diff <base>..<head>`).
    LocalRange { base: String, head: String },
    /// GitHub PR fetched via the `gh` CLI.
    Github { owner: String, repo: String, pr: u32 },
    /// GitLab MR fetched via the `glab` CLI.
    Gitlab { project: String, mr: u32 },
    /// Forgejo / Gitea instance, fetched via plain HTTP via `curl`.
    Forgejo {
        instance_url: String,
        owner: String,
        repo: String,
        pr: u32,
    },
    /// Raw unified diff string supplied by the user (e.g. paste a patch).
    Patch { raw: String },
}

/// Whether a file was added, modified, deleted, or renamed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ChangeKind {
    Added,
    Modified,
    Deleted,
    Renamed { from: PathBuf },
}

/// One unified-diff hunk: the `@@` header ranges plus the body (lines with
/// `+`, `-`, or ` ` prefixes, header excluded).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffHunk {
    /// `(start, length)` of the hunk in the pre-image (old file).
    pub old_range: (u32, u32),
    /// `(start, length)` of the hunk in the post-image (new file).
    pub new_range: (u32, u32),
    /// Hunk body — every line including its `+ - <space>` prefix, newline-terminated.
    pub content: String,
}

/// One file's worth of changes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileDiff {
    pub path: PathBuf,
    pub change_kind: ChangeKind,
    pub hunks: Vec<DiffHunk>,
    /// Heuristic language id inferred from the extension. `None` if unknown.
    pub language: Option<String>,
}

impl FileDiff {
    /// Total number of `+` lines in this file's diff.
    pub fn added_lines(&self) -> usize {
        self.hunks
            .iter()
            .flat_map(|h| h.content.lines())
            .filter(|l| l.starts_with('+') && !l.starts_with("+++"))
            .count()
    }

    /// Total number of `-` lines in this file's diff.
    pub fn removed_lines(&self) -> usize {
        self.hunks
            .iter()
            .flat_map(|h| h.content.lines())
            .filter(|l| l.starts_with('-') && !l.starts_with("---"))
            .count()
    }
}

/// Result of loading a diff. The pipeline iterates over `files`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffBundle {
    pub files: Vec<FileDiff>,
    pub source: DiffSource,
    /// Optional list of commit messages that produced this diff. Forge loaders
    /// fill this in when available so the model can see intent.
    #[serde(default)]
    pub commit_messages: Vec<String>,
}

/// Best-effort language inference from file extension. Returned to the model
/// so it knows which patterns to flag.
pub fn infer_language(path: &PathBuf) -> Option<String> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    let lang = match ext.as_str() {
        "rs" => "rust",
        "ts" | "tsx" => "typescript",
        "js" | "jsx" | "mjs" | "cjs" => "javascript",
        "py" => "python",
        "go" => "go",
        "java" => "java",
        "kt" | "kts" => "kotlin",
        "swift" => "swift",
        "rb" => "ruby",
        "php" => "php",
        "cs" => "csharp",
        "cpp" | "cc" | "cxx" | "hpp" | "h" | "c" => "cpp",
        "sh" | "bash" => "shell",
        "sql" => "sql",
        "json" => "json",
        "yaml" | "yml" => "yaml",
        "toml" => "toml",
        "md" => "markdown",
        _ => return None,
    };
    Some(lang.to_string())
}
