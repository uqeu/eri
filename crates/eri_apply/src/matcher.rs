use strsim::normalized_levenshtein;

/// Outcome of locating SEARCH inside a file's contents.
#[derive(Debug)]
pub(crate) enum MatchOutcome {
    /// Exactly one byte-range was located. Indentation shift (if any) has
    /// already been baked into `replacement`.
    Unique {
        start: usize,
        end: usize,
        replacement: String,
    },
    NotFound,
    Ambiguous,
}

pub(crate) fn locate(haystack: &str, search: &str, replace: &str) -> MatchOutcome {
    // 1. Exact match.
    let exact = all_occurrences(haystack, search);
    match exact.len() {
        1 => {
            let (start, end) = exact[0];
            return MatchOutcome::Unique {
                start,
                end,
                replacement: replace.to_string(),
            };
        }
        n if n > 1 => return MatchOutcome::Ambiguous,
        _ => {}
    }

    // 2. Whitespace-tolerant match (collapse runs of horizontal whitespace).
    if let Some(outcome) = whitespace_tolerant(haystack, search, replace) {
        return outcome;
    }

    // 3. Indentation-shifted match — model emitted same code at a different
    //    indent level than the file actually uses.
    if let Some(outcome) = indentation_shifted(haystack, search, replace) {
        return outcome;
    }

    // 4. Fuzzy line-window match.
    fuzzy_line_window(haystack, search, replace)
}

fn all_occurrences(haystack: &str, needle: &str) -> Vec<(usize, usize)> {
    if needle.is_empty() {
        return Vec::new();
    }
    let mut hits = Vec::new();
    let mut from = 0;
    while let Some(idx) = haystack[from..].find(needle) {
        let abs = from + idx;
        hits.push((abs, abs + needle.len()));
        from = abs + needle.len().max(1);
    }
    hits
}

fn collapse_horizontal_ws(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut last_ws = false;
    for c in s.chars() {
        if c == ' ' || c == '\t' {
            if !last_ws {
                out.push(' ');
            }
            last_ws = true;
        } else {
            out.push(c);
            last_ws = false;
        }
    }
    out
}

fn whitespace_tolerant(haystack: &str, search: &str, replace: &str) -> Option<MatchOutcome> {
    let needle = collapse_horizontal_ws(search);
    if needle.trim().is_empty() {
        return None;
    }
    // Walk byte ranges in haystack whose collapsed form == needle. We do this
    // line-anchored: for each candidate start line, scan forward growing the
    // window until its collapsed form matches.
    let line_starts = line_start_indices(haystack);
    let mut matches = Vec::new();
    for &start in &line_starts {
        // The needle's collapsed length is a lower bound; cap window growth.
        // Walk to subsequent line boundaries (and end-of-file).
        let mut window_ends: Vec<usize> = line_starts
            .iter()
            .filter(|&&e| e > start)
            .copied()
            .collect();
        window_ends.push(haystack.len());
        for end in window_ends {
            let slice = &haystack[start..end];
            // Strip trailing newline so collapsed comparison ignores the line
            // separator at the window boundary.
            let stripped = slice.strip_suffix('\n').unwrap_or(slice);
            if collapse_horizontal_ws(stripped) == needle {
                matches.push((start, start + stripped.len()));
                break;
            }
            // Cheap upper bound: if collapsed slice is already longer than
            // needle, no extension will help.
            if collapse_horizontal_ws(stripped).len() > needle.len() + 1 {
                break;
            }
        }
    }
    match matches.len() {
        0 => None,
        1 => {
            let (start, end) = matches[0];
            Some(MatchOutcome::Unique {
                start,
                end,
                replacement: replace.to_string(),
            })
        }
        _ => Some(MatchOutcome::Ambiguous),
    }
}

fn line_start_indices(s: &str) -> Vec<usize> {
    let mut starts = vec![0usize];
    for (i, c) in s.char_indices() {
        if c == '\n' && i + 1 < s.len() {
            starts.push(i + 1);
        }
    }
    starts
}

fn detect_common_indent(s: &str) -> &str {
    let mut common: Option<&str> = None;
    for line in s.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let indent: &str = &line[..line.len() - line.trim_start().len()];
        common = Some(match common {
            None => indent,
            Some(existing) => longest_common_prefix(existing, indent),
        });
    }
    common.unwrap_or("")
}

fn longest_common_prefix<'a>(a: &'a str, b: &'a str) -> &'a str {
    let end = a
        .as_bytes()
        .iter()
        .zip(b.as_bytes().iter())
        .take_while(|(x, y)| x == y)
        .count();
    &a[..end]
}

fn dedent(s: &str, indent: &str) -> String {
    if indent.is_empty() {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    for line in s.split_inclusive('\n') {
        if let Some(rest) = line.strip_prefix(indent) {
            out.push_str(rest);
        } else {
            out.push_str(line);
        }
    }
    out
}

fn reindent(s: &str, prefix: &str) -> String {
    if prefix.is_empty() {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len() + prefix.len());
    for line in s.split_inclusive('\n') {
        let trimmed = line.trim_end_matches('\n');
        if trimmed.is_empty() {
            out.push_str(line);
        } else {
            out.push_str(prefix);
            out.push_str(line);
        }
    }
    out
}

fn indentation_shifted(haystack: &str, search: &str, replace: &str) -> Option<MatchOutcome> {
    // Normalize SEARCH to zero indent, then try common file indent prefixes.
    let search_indent = detect_common_indent(search);
    let dedented_search = dedent(search, search_indent);
    let dedented_replace = dedent(replace, search_indent);

    let candidates = [
        "", " ", "  ", "   ", "    ", "      ", "        ", "\t", "\t\t",
    ];
    let mut matches: Vec<((usize, usize), &str)> = Vec::new();
    for prefix in candidates {
        // Skip the no-op case — it's just the exact match already tried.
        if prefix == search_indent {
            continue;
        }
        let candidate = reindent(&dedented_search, prefix);
        if candidate == search {
            continue;
        }
        let hits = all_occurrences(haystack, &candidate);
        for hit in hits {
            matches.push((hit, prefix));
        }
    }
    matches.sort_by_key(|((s, _), _)| *s);
    matches.dedup_by_key(|((s, e), _)| (*s, *e));
    match matches.len() {
        0 => None,
        1 => {
            let ((start, end), prefix) = matches[0];
            let final_replace = reindent(&dedented_replace, prefix);
            Some(MatchOutcome::Unique {
                start,
                end,
                replacement: final_replace,
            })
        }
        _ => Some(MatchOutcome::Ambiguous),
    }
}

fn fuzzy_line_window(haystack: &str, search: &str, replace: &str) -> MatchOutcome {
    let needle_lines: Vec<&str> = search.lines().collect();
    if needle_lines.is_empty() {
        return MatchOutcome::NotFound;
    }
    let hay_lines: Vec<&str> = haystack.lines().collect();
    if hay_lines.len() < needle_lines.len() {
        return MatchOutcome::NotFound;
    }
    let line_starts = compute_line_byte_starts(haystack);
    let window = needle_lines.len();
    let mut best: Option<(f64, usize)> = None;
    let mut second: f64 = 0.0;
    for i in 0..=(hay_lines.len() - window) {
        let slice = hay_lines[i..i + window].join("\n");
        let score = normalized_levenshtein(&slice, search);
        match best {
            None => best = Some((score, i)),
            Some((b, _)) if score > b => {
                second = b;
                best = Some((score, i));
            }
            Some(_) if score > second => second = score,
            _ => {}
        }
    }
    let (best_score, best_idx) = match best {
        Some(b) => b,
        None => return MatchOutcome::NotFound,
    };
    if best_score > 0.85 && second < 0.65 {
        let start = line_starts[best_idx];
        let end_line = best_idx + window;
        let end = if end_line < hay_lines.len() {
            // up to but not including the next line's start
            line_starts[end_line].saturating_sub(1)
        } else {
            haystack.len()
        };
        // Reslice to avoid trailing newline overshoot.
        let end = end.min(haystack.len());
        MatchOutcome::Unique {
            start,
            end,
            replacement: replace.to_string(),
        }
    } else {
        MatchOutcome::NotFound
    }
}

fn compute_line_byte_starts(s: &str) -> Vec<usize> {
    let mut starts = vec![0usize];
    for (i, b) in s.bytes().enumerate() {
        if b == b'\n' {
            starts.push(i + 1);
        }
    }
    starts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_match_unique() {
        let outcome = locate("foo\nbar\nbaz\n", "bar", "BAR");
        match outcome {
            MatchOutcome::Unique { replacement, .. } => assert_eq!(replacement, "BAR"),
            _ => panic!("expected unique exact match"),
        }
    }

    #[test]
    fn exact_match_ambiguous() {
        let outcome = locate("foo\nfoo\n", "foo", "FOO");
        assert!(matches!(outcome, MatchOutcome::Ambiguous));
    }

    #[test]
    fn whitespace_tolerant() {
        let hay = "fn   thing(  ) {\n    println!(\"hi\");\n}\n";
        let needle = "fn thing() {\n    println!(\"hi\");\n}";
        let outcome = locate(hay, needle, "REPLACED");
        assert!(matches!(outcome, MatchOutcome::Unique { .. }));
    }

    #[test]
    fn indentation_shifted() {
        let hay = "    fn x() {\n        a();\n    }\n";
        let needle = "fn x() {\n    a();\n}";
        let replace = "fn y() {\n    b();\n}";
        let outcome = locate(hay, needle, replace);
        match outcome {
            MatchOutcome::Unique { replacement, .. } => {
                assert!(replacement.contains("    fn y()"));
                assert!(replacement.contains("        b();"));
            }
            _ => panic!("expected indentation-shifted match"),
        }
    }

    #[test]
    fn fuzzy_match_high_similarity() {
        let hay = "alpha line one\nalpha line two\nalpha line three\n";
        let needle = "alpha line one\nalpha lne two\nalpha line three";
        let outcome = locate(hay, needle, "REPLACED");
        assert!(matches!(outcome, MatchOutcome::Unique { .. }));
    }

    #[test]
    fn fuzzy_rejects_low_similarity() {
        let hay = "totally unrelated content\nlive long and prosper\n";
        let needle = "alpha line one\nbeta line two\ngamma line three";
        let outcome = locate(hay, needle, "X");
        assert!(matches!(outcome, MatchOutcome::NotFound));
    }
}
