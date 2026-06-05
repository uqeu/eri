//! `grep` + `glob` tools for the agentic loop -- gitignore-aware, read-only.
//!
//! These give structured search without needing the shell (`bash` is opt-in),
//! matching Claude Code's Grep/Glob. Both honor `.gitignore` and skip the usual
//! noise dirs via the `ignore` crate's walker; results are capped so one call
//! can't flood the context.

use std::path::Path;

use globset::{Glob, GlobSetBuilder};
use ignore::WalkBuilder;
use regex::RegexBuilder;
use serde_json::Value;

/// Result of a search tool: rendered text + whether it's an error.
pub struct SearchOut {
    pub content: String,
    pub is_error: bool,
}

fn out(content: String) -> SearchOut {
    SearchOut {
        content,
        is_error: false,
    }
}
fn err(content: String) -> SearchOut {
    SearchOut {
        content,
        is_error: true,
    }
}

const DEFAULT_MAX: usize = 200;
const MAX_OUTPUT_BYTES: usize = 64 * 1024;

/// Resolve an optional workspace-relative subpath; refuse escapes.
fn subroot(root: &Path, rel: Option<&str>) -> Result<std::path::PathBuf, String> {
    match rel.map(str::trim).filter(|s| !s.is_empty() && *s != ".") {
        None => Ok(root.to_path_buf()),
        Some(r) => {
            let p = Path::new(r);
            if p.is_absolute()
                || p.components()
                    .any(|c| matches!(c, std::path::Component::ParentDir))
            {
                return Err(format!("path '{r}' rejected: must be workspace-relative"));
            }
            Ok(root.join(p))
        }
    }
}

fn clamp_max(input: &Value) -> usize {
    input
        .get("max_results")
        .and_then(Value::as_u64)
        .map(|n| (n as usize).clamp(1, 2000))
        .unwrap_or(DEFAULT_MAX)
}

/// Search file contents for a regex. Returns `path:line: text` lines.
pub fn grep(root: &Path, input: &Value) -> SearchOut {
    let pattern = input.get("pattern").and_then(Value::as_str).unwrap_or("");
    if pattern.trim().is_empty() {
        return err("grep: pattern is empty".to_string());
    }
    let case_insensitive = input
        .get("case_insensitive")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let re = match RegexBuilder::new(pattern)
        .case_insensitive(case_insensitive)
        .build()
    {
        Ok(r) => r,
        Err(e) => return err(format!("grep: invalid regex: {e}")),
    };
    let start = match subroot(root, input.get("path").and_then(Value::as_str)) {
        Ok(p) => p,
        Err(e) => return err(e),
    };
    let globset = match input.get("glob").and_then(Value::as_str) {
        Some(g) if !g.trim().is_empty() => match Glob::new(g) {
            Ok(glob) => {
                let mut b = GlobSetBuilder::new();
                b.add(glob);
                b.build().ok()
            }
            Err(e) => return err(format!("grep: invalid glob: {e}")),
        },
        _ => None,
    };

    let max = clamp_max(input);
    let mut lines: Vec<String> = Vec::new();
    let mut hits = 0usize;
    'walk: for dent in WalkBuilder::new(&start)
        .hidden(false)
        .require_git(false)
        .build()
        .flatten()
    {
        if !dent.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let path = dent.path();
        let rel = path.strip_prefix(root).unwrap_or(path);
        if globset.as_ref().is_some_and(|gs| !gs.is_match(rel)) {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(path) else {
            continue;
        };
        for (i, line) in text.lines().enumerate() {
            if re.is_match(line) {
                hits += 1;
                let shown = if line.len() > 240 { &line[..240] } else { line };
                lines.push(format!("{}:{}: {}", rel.display(), i + 1, shown.trim_end()));
                if lines.len() >= max {
                    break 'walk;
                }
            }
        }
    }
    if lines.is_empty() {
        return out(format!("no matches for /{pattern}/"));
    }
    let mut body = lines.join("\n");
    if body.len() > MAX_OUTPUT_BYTES {
        body.truncate(MAX_OUTPUT_BYTES);
        body.push_str("\n…[truncated]");
    }
    out(format!("{hits} match(es):\n{body}"))
}

/// Find files by glob pattern (e.g. `**/*.rs`). Returns relative paths.
pub fn glob(root: &Path, input: &Value) -> SearchOut {
    let pattern = input.get("pattern").and_then(Value::as_str).unwrap_or("");
    if pattern.trim().is_empty() {
        return err("glob: pattern is empty".to_string());
    }
    let glob = match Glob::new(pattern) {
        Ok(g) => g,
        Err(e) => return err(format!("glob: invalid pattern: {e}")),
    };
    let mut gb = GlobSetBuilder::new();
    gb.add(glob);
    let gs = match gb.build() {
        Ok(g) => g,
        Err(e) => return err(format!("glob: {e}")),
    };
    let start = match subroot(root, input.get("path").and_then(Value::as_str)) {
        Ok(p) => p,
        Err(e) => return err(e),
    };

    let max = clamp_max(input);
    // (mtime, relpath) so we can sort newest-first like Claude's Glob.
    let mut matches: Vec<(std::time::SystemTime, String)> = Vec::new();
    for dent in WalkBuilder::new(&start)
        .hidden(false)
        .require_git(false)
        .build()
        .flatten()
    {
        if !dent.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let path = dent.path();
        let rel = path.strip_prefix(root).unwrap_or(path);
        if gs.is_match(rel) {
            let mtime = dent
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .unwrap_or(std::time::UNIX_EPOCH);
            matches.push((mtime, rel.display().to_string()));
        }
    }
    if matches.is_empty() {
        return out(format!("no files match {pattern}"));
    }
    matches.sort_by_key(|m| std::cmp::Reverse(m.0));
    let total = matches.len();
    let shown: Vec<String> = matches.into_iter().take(max).map(|(_, p)| p).collect();
    let mut body = shown.join("\n");
    if total > shown.len() {
        body.push_str(&format!("\n…[{} more]", total - shown.len()));
    }
    out(body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::TempDir;

    fn ws() -> TempDir {
        let d = TempDir::new().unwrap();
        std::fs::create_dir_all(d.path().join("src")).unwrap();
        std::fs::write(
            d.path().join("src/main.rs"),
            "fn main() {\n    let x = 42;\n}\n",
        )
        .unwrap();
        std::fs::write(d.path().join("README.md"), "# hello\nthe answer is 42\n").unwrap();
        std::fs::write(d.path().join(".gitignore"), "ignored.txt\n").unwrap();
        std::fs::write(d.path().join("ignored.txt"), "42 secret").unwrap();
        d
    }

    #[test]
    fn grep_finds_matches_with_line_numbers() {
        let d = ws();
        let r = grep(d.path(), &json!({ "pattern": "42" }));
        assert!(!r.is_error);
        assert!(r.content.contains("main.rs:2"));
        assert!(r.content.contains("README.md:2"));
        // .gitignore'd file is skipped.
        assert!(!r.content.contains("ignored.txt"));
    }

    #[test]
    fn grep_glob_filter_and_invalid_regex() {
        let d = ws();
        let only_rs = grep(d.path(), &json!({ "pattern": "42", "glob": "**/*.rs" }));
        assert!(only_rs.content.contains("main.rs"));
        assert!(!only_rs.content.contains("README.md"));
        assert!(grep(d.path(), &json!({ "pattern": "(" })).is_error);
    }

    #[test]
    fn glob_matches_and_sorts() {
        let d = ws();
        let r = glob(d.path(), &json!({ "pattern": "**/*.rs" }));
        assert!(!r.is_error);
        assert!(r.content.contains("src/main.rs"));
        assert!(!r.content.contains("README.md"));
    }

    #[test]
    fn grep_no_match_is_ok() {
        let d = ws();
        let r = grep(d.path(), &json!({ "pattern": "zzzznotfound" }));
        assert!(!r.is_error);
        assert!(r.content.contains("no matches"));
    }
}
