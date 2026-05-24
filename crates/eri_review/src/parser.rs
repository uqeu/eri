//! Tiny unified-diff parser. Hand-rolled to avoid a dependency.
//!
//! Handles the standard `diff --git` / `--- a/...` / `+++ b/...` / `@@` shape
//! emitted by `git diff` and by every forge API's "patch" endpoint. Doesn't
//! attempt to parse binary diffs or rename-only diffs without hunks — those
//! show up as `FileDiff { hunks: vec![] }`.

use std::path::PathBuf;

use anyhow::{Result, anyhow};

use crate::diff::{ChangeKind, DiffHunk, FileDiff, infer_language};

/// Parse a unified diff into per-file `FileDiff`s.
pub fn parse_unified_diff(input: &str) -> Result<Vec<FileDiff>> {
    let mut files: Vec<FileDiff> = Vec::new();
    let mut iter = input.lines().peekable();

    while let Some(&line) = iter.peek() {
        if line.starts_with("diff --git ") {
            let file = parse_file_block(&mut iter)?;
            files.push(file);
        } else if line.starts_with("--- ") {
            // `git diff` without the `diff --git` header (e.g. raw patches).
            let file = parse_file_block(&mut iter)?;
            files.push(file);
        } else {
            iter.next();
        }
    }

    Ok(files)
}

/// Consume one file block: the `diff --git` (optional) + headers + hunks.
fn parse_file_block<'a, I>(iter: &mut std::iter::Peekable<I>) -> Result<FileDiff>
where
    I: Iterator<Item = &'a str>,
{
    let mut from_path: Option<String> = None;
    let mut to_path: Option<String> = None;
    let mut change_kind = ChangeKind::Modified;
    let mut rename_from: Option<String> = None;

    // Header section — everything before the first `@@` hunk header.
    while let Some(&line) = iter.peek() {
        if line.starts_with("@@") {
            break;
        }
        // Another file's block starts.
        if line.starts_with("diff --git ") && (from_path.is_some() || to_path.is_some()) {
            break;
        }
        iter.next();

        if let Some(rest) = line.strip_prefix("diff --git ") {
            let (a, b) = split_two_paths(rest);
            from_path = Some(strip_prefix("a/", &a));
            to_path = Some(strip_prefix("b/", &b));
        } else if line == "new file mode 100644" || line.starts_with("new file mode") {
            change_kind = ChangeKind::Added;
        } else if line.starts_with("deleted file mode") {
            change_kind = ChangeKind::Deleted;
        } else if let Some(rest) = line.strip_prefix("rename from ") {
            rename_from = Some(rest.to_string());
        } else if let Some(rest) = line.strip_prefix("rename to ") {
            to_path = Some(rest.to_string());
            change_kind = ChangeKind::Renamed {
                from: PathBuf::from(rename_from.clone().unwrap_or_default()),
            };
        } else if let Some(rest) = line.strip_prefix("--- ") {
            if rest != "/dev/null" {
                from_path = Some(strip_prefix("a/", rest));
            } else {
                change_kind = ChangeKind::Added;
            }
        } else if let Some(rest) = line.strip_prefix("+++ ") {
            if rest != "/dev/null" {
                to_path = Some(strip_prefix("b/", rest));
            } else {
                change_kind = ChangeKind::Deleted;
            }
        }
    }

    // Hunks.
    let mut hunks: Vec<DiffHunk> = Vec::new();
    while let Some(&line) = iter.peek() {
        if !line.starts_with("@@") {
            break;
        }
        // Next file block already started — stop.
        if line.starts_with("diff --git ") {
            break;
        }
        let header = iter.next().unwrap_or("");
        let (old_range, new_range) = parse_hunk_header(header)?;

        let mut body = String::new();
        while let Some(&l) = iter.peek() {
            if l.starts_with("@@") || l.starts_with("diff --git ") {
                break;
            }
            // Tolerate `\ No newline at end of file` and stop on blank header lines.
            iter.next();
            body.push_str(l);
            body.push('\n');
        }
        hunks.push(DiffHunk {
            old_range,
            new_range,
            content: body,
        });
    }

    let path_str = to_path
        .or(from_path)
        .ok_or_else(|| anyhow!("diff block missing both --- and +++ paths"))?;
    let path = PathBuf::from(path_str);
    let language = infer_language(&path);

    Ok(FileDiff {
        path,
        change_kind,
        hunks,
        language,
    })
}

fn parse_hunk_header(header: &str) -> Result<((u32, u32), (u32, u32))> {
    // `@@ -<old_start>[,<old_len>] +<new_start>[,<new_len>] @@ [optional context]`
    let trimmed = header.trim_start_matches('@').trim();
    let mut parts = trimmed.split_whitespace();
    let old = parts
        .next()
        .ok_or_else(|| anyhow!("hunk header missing old range: {header:?}"))?;
    let new = parts
        .next()
        .ok_or_else(|| anyhow!("hunk header missing new range: {header:?}"))?;
    let old_range = parse_range(old.trim_start_matches('-'))?;
    let new_range = parse_range(new.trim_start_matches('+'))?;
    Ok((old_range, new_range))
}

fn parse_range(s: &str) -> Result<(u32, u32)> {
    let mut iter = s.split(',');
    let start: u32 = iter
        .next()
        .ok_or_else(|| anyhow!("empty range"))?
        .parse()
        .map_err(|e| anyhow!("invalid range start {s:?}: {e}"))?;
    let length: u32 = match iter.next() {
        Some(s) => s
            .parse()
            .map_err(|e| anyhow!("invalid range length {s:?}: {e}"))?,
        None => 1,
    };
    Ok((start, length))
}

fn split_two_paths(s: &str) -> (String, String) {
    // `a/foo.rs b/foo.rs` — split on the last space that separates two paths.
    let s = s.trim();
    // Common case: same path on both sides, separator is the middle space.
    if let Some(mid) = s.rfind(' ') {
        let (a, b) = s.split_at(mid);
        return (a.trim().to_string(), b.trim().to_string());
    }
    (s.to_string(), s.to_string())
}

fn strip_prefix(prefix: &str, s: &str) -> String {
    s.strip_prefix(prefix).unwrap_or(s).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SIMPLE_DIFF: &str = "\
diff --git a/src/foo.rs b/src/foo.rs
index 1234..5678 100644
--- a/src/foo.rs
+++ b/src/foo.rs
@@ -1,3 +1,4 @@
 fn main() {
-    println!(\"old\");
+    println!(\"new\");
+    println!(\"extra\");
 }
";

    #[test]
    fn parses_single_modified_file() {
        let files = parse_unified_diff(SIMPLE_DIFF).expect("parse");
        assert_eq!(files.len(), 1);
        let file = &files[0];
        assert_eq!(file.path, PathBuf::from("src/foo.rs"));
        assert_eq!(file.change_kind, ChangeKind::Modified);
        assert_eq!(file.hunks.len(), 1);
        assert_eq!(file.hunks[0].old_range, (1, 3));
        assert_eq!(file.hunks[0].new_range, (1, 4));
        assert_eq!(file.added_lines(), 2);
        assert_eq!(file.removed_lines(), 1);
        assert_eq!(file.language.as_deref(), Some("rust"));
    }

    #[test]
    fn parses_added_file() {
        let diff = "\
diff --git a/new.rs b/new.rs
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/new.rs
@@ -0,0 +1,2 @@
+fn x() {}
+
";
        let files = parse_unified_diff(diff).expect("parse");
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].change_kind, ChangeKind::Added);
        assert_eq!(files[0].path, PathBuf::from("new.rs"));
    }

    #[test]
    fn parses_multiple_files() {
        let second = SIMPLE_DIFF.replace("src/foo.rs", "src/bar.rs");
        let diff = format!("{SIMPLE_DIFF}{second}");
        let files = parse_unified_diff(&diff).expect("parse");
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].path, PathBuf::from("src/foo.rs"));
        assert_eq!(files[1].path, PathBuf::from("src/bar.rs"));
    }

    #[test]
    fn hunk_header_with_default_length() {
        let (old, new) = parse_hunk_header("@@ -5 +5,2 @@").expect("parse");
        assert_eq!(old, (5, 1));
        assert_eq!(new, (5, 2));
    }
}
