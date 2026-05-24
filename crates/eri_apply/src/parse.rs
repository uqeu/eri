use std::path::PathBuf;

use crate::Edit;

const SEARCH_MARKER: &str = "<<<<<<< SEARCH";
const DIVIDER: &str = "=======";
const REPLACE_MARKER: &str = ">>>>>>> REPLACE";
const BOM: char = '\u{FEFF}';

/// Extract every complete search/replace block from arbitrary text.
///
/// Edits are returned in source order. Prose and partial blocks are silently
/// ignored. Tolerant of BOM, fenced code blocks, and leading whitespace on
/// marker lines.
pub fn parse(input: &str) -> Vec<Edit> {
    let stripped = input.strip_prefix(BOM).unwrap_or(input);
    let mut edits = Vec::new();
    let mut cursor = 0usize;
    while let Some(edit) = next_block(stripped, &mut cursor) {
        edits.push(edit);
    }
    edits
}

/// Streaming variant: consume only complete blocks from `buffer`, leave any
/// partial trailing block in place so the next chunk can complete it.
pub fn parse_streaming(buffer: &mut String) -> Vec<Edit> {
    // WHY: strip BOM once up-front so partial-block detection isn't confused.
    if buffer.starts_with(BOM) {
        buffer.drain(..BOM.len_utf8());
    }
    let mut edits = Vec::new();
    let mut cursor = 0usize;
    let mut last_complete = 0usize;
    while let Some(edit) = next_block(buffer, &mut cursor) {
        edits.push(edit);
        last_complete = cursor;
    }
    // If there's an in-progress block past last_complete, keep it; otherwise
    // drop the consumed prefix to keep the buffer bounded.
    if let Some(partial_start) = find_marker(buffer, SEARCH_MARKER, last_complete) {
        buffer.drain(..partial_start);
    } else {
        buffer.drain(..last_complete);
    }
    edits
}

fn next_block(input: &str, cursor: &mut usize) -> Option<Edit> {
    let start = find_marker(input, SEARCH_MARKER, *cursor)?;
    let header_end = input[start..].find('\n').map(|n| start + n)?;
    let header_line = &input[start..header_end];
    let path = extract_path(header_line)?;

    let body_start = header_end + 1;
    let divider_start = find_marker(input, DIVIDER, body_start)?;
    let divider_end = input[divider_start..]
        .find('\n')
        .map(|n| divider_start + n)?;
    // Divider line must be its own line — no extra content after `=======`.
    let divider_line = input[divider_start..divider_end].trim_end();
    if divider_line.trim_start() != DIVIDER {
        // Recover: move cursor forward to keep scanning.
        *cursor = divider_end + 1;
        return next_block(input, cursor);
    }

    let replace_start = divider_end + 1;
    let close_start = find_marker(input, REPLACE_MARKER, replace_start)?;
    let close_end = input[close_start..]
        .find('\n')
        .map(|n| close_start + n)
        .unwrap_or(input.len());

    let search = strip_trailing_newline(&input[body_start..divider_start]);
    let replace = strip_trailing_newline(&input[replace_start..close_start]);
    *cursor = (close_end + 1).min(input.len());

    Some(Edit {
        path: PathBuf::from(path),
        search: search.to_string(),
        replace: replace.to_string(),
    })
}

fn find_marker(haystack: &str, marker: &str, from: usize) -> Option<usize> {
    let mut search_from = from;
    while search_from <= haystack.len() {
        let idx = haystack[search_from..].find(marker)?;
        let abs = search_from + idx;
        if is_line_start(haystack, abs) {
            return Some(abs);
        }
        search_from = abs + marker.len();
    }
    None
}

fn is_line_start(s: &str, idx: usize) -> bool {
    // Allow leading horizontal whitespace before the marker on its line.
    if idx == 0 {
        return true;
    }
    let prefix = &s[..idx];
    let line_start = prefix.rfind('\n').map(|n| n + 1).unwrap_or(0);
    s[line_start..idx].chars().all(|c| c == ' ' || c == '\t')
}

fn extract_path(header_line: &str) -> Option<String> {
    let after = header_line.trim_start().strip_prefix(SEARCH_MARKER)?;
    let trimmed = after.trim();
    if trimmed.is_empty() {
        None
    } else {
        // Strip optional surrounding backticks: `<<<<<<< SEARCH `src/foo.rs``
        let unquoted = trimmed.trim_matches('`').trim_matches('"').trim();
        if unquoted.is_empty() {
            None
        } else {
            Some(unquoted.to_string())
        }
    }
}

fn strip_trailing_newline(s: &str) -> &str {
    if let Some(stripped) = s.strip_suffix("\r\n") {
        stripped
    } else if let Some(stripped) = s.strip_suffix('\n') {
        stripped
    } else {
        s
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_single_block() {
        let input = "<<<<<<< SEARCH src/foo.rs\nold\n=======\nnew\n>>>>>>> REPLACE\n";
        let edits = parse(input);
        assert_eq!(edits.len(), 1);
        assert_eq!(edits[0].path, PathBuf::from("src/foo.rs"));
        assert_eq!(edits[0].search, "old");
        assert_eq!(edits[0].replace, "new");
    }

    #[test]
    fn parses_multiple_blocks_in_source_order() {
        let input = "prose here\n\
            <<<<<<< SEARCH a.rs\n1\n=======\n2\n>>>>>>> REPLACE\n\
            more prose\n\
            <<<<<<< SEARCH b.rs\n3\n=======\n4\n>>>>>>> REPLACE\n";
        let edits = parse(input);
        assert_eq!(edits.len(), 2);
        assert_eq!(edits[0].path, PathBuf::from("a.rs"));
        assert_eq!(edits[1].path, PathBuf::from("b.rs"));
    }

    #[test]
    fn ignores_partial_block() {
        let input = "<<<<<<< SEARCH a.rs\nold\n=======\nnew\n";
        assert!(parse(input).is_empty());
    }

    #[test]
    fn strips_bom() {
        let mut s = String::from("\u{FEFF}");
        s.push_str("<<<<<<< SEARCH x.rs\na\n=======\nb\n>>>>>>> REPLACE\n");
        let edits = parse(&s);
        assert_eq!(edits.len(), 1);
    }

    #[test]
    fn allows_empty_search_block() {
        let input = "<<<<<<< SEARCH new.rs\n=======\nbody\n>>>>>>> REPLACE\n";
        let edits = parse(input);
        assert_eq!(edits.len(), 1);
        assert_eq!(edits[0].search, "");
        assert_eq!(edits[0].replace, "body");
    }

    #[test]
    fn allows_empty_replace_block() {
        let input = "<<<<<<< SEARCH x.rs\nstuff\n=======\n>>>>>>> REPLACE\n";
        let edits = parse(input);
        assert_eq!(edits.len(), 1);
        assert_eq!(edits[0].search, "stuff");
        assert_eq!(edits[0].replace, "");
    }

    #[test]
    fn streaming_holds_back_partial_block() {
        let mut buf = String::from(
            "<<<<<<< SEARCH x.rs\nold\n=======\nnew\n>>>>>>> REPLACE\n<<<<<<< SEARCH y.rs\npartial",
        );
        let edits = parse_streaming(&mut buf);
        assert_eq!(edits.len(), 1);
        assert!(buf.starts_with("<<<<<<< SEARCH y.rs"));
    }

    #[test]
    fn streaming_drains_when_no_partial() {
        let mut buf = String::from(
            "prose\n<<<<<<< SEARCH x.rs\nold\n=======\nnew\n>>>>>>> REPLACE\ntrailing prose\n",
        );
        let edits = parse_streaming(&mut buf);
        assert_eq!(edits.len(), 1);
        assert!(!buf.contains("<<<<<<<"));
    }

    #[test]
    fn strips_backticks_around_path() {
        let input = "<<<<<<< SEARCH `src/foo.rs`\nold\n=======\nnew\n>>>>>>> REPLACE\n";
        let edits = parse(input);
        assert_eq!(edits[0].path, PathBuf::from("src/foo.rs"));
    }
}
