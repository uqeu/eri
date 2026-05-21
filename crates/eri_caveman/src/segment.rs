//! Splits input into compressible prose and preserved regions.
//!
//! Preserved regions:
//!   * Fenced code blocks (``` and ~~~ fences, including indented fences).
//!   * Inline code spans (`...`).
//!   * HTML tags (`<...>`).
//!   * Template placeholders (`{{...}}`).
//!   * Quoted string literals (`"..."` and `'...'`, single-line only).
//!   * User-supplied literal substrings via `preserve_blocks`.
//!
//! The splitter walks the input once. Fenced blocks have priority — once a
//! fence opens, nothing inside it is treated as anything else until the
//! matching closing fence on its own line.

#[derive(Debug, Eq, PartialEq)]
pub(crate) enum Segment<'a> {
    Preserved(&'a str),
    Prose(&'a str),
}

pub(crate) fn split<'a>(input: &'a str, user_blocks: &[&'static str]) -> Vec<Segment<'a>> {
    let bytes = input.as_bytes();
    let mut out: Vec<Segment<'a>> = Vec::new();
    let mut prose_start = 0usize;
    let mut i = 0usize;

    while i < bytes.len() {
        // 1. Fenced code blocks at line start (allowing leading whitespace).
        if at_line_start(bytes, i) {
            if let Some((fence_start, fence_end)) = match_fence(input, i) {
                flush_prose(input, prose_start, fence_start, &mut out);
                out.push(Segment::Preserved(&input[fence_start..fence_end]));
                i = fence_end;
                prose_start = fence_end;
                continue;
            }
        }

        let ch = bytes[i];

        // 2. User-supplied literal preserve blocks (paired open/close not
        //    supported here — these are substring sentinels treated as
        //    inline atoms). Useful for callers who want to add their own
        //    "don't touch" tokens.
        if let Some(end) = match_user_block(input, i, user_blocks) {
            flush_prose(input, prose_start, i, &mut out);
            out.push(Segment::Preserved(&input[i..end]));
            i = end;
            prose_start = end;
            continue;
        }

        // 3. Inline backtick code spans.
        if ch == b'`' {
            if let Some(end) = match_inline_code(input, i) {
                flush_prose(input, prose_start, i, &mut out);
                out.push(Segment::Preserved(&input[i..end]));
                i = end;
                prose_start = end;
                continue;
            }
        }

        // 4. HTML tags.
        if ch == b'<' {
            if let Some(end) = match_html_tag(input, i) {
                flush_prose(input, prose_start, i, &mut out);
                out.push(Segment::Preserved(&input[i..end]));
                i = end;
                prose_start = end;
                continue;
            }
        }

        // 5. Template placeholders `{{...}}`.
        if ch == b'{' && bytes.get(i + 1) == Some(&b'{') {
            if let Some(end) = match_placeholder(input, i) {
                flush_prose(input, prose_start, i, &mut out);
                out.push(Segment::Preserved(&input[i..end]));
                i = end;
                prose_start = end;
                continue;
            }
        }

        // 6. Quoted string literals (single-line).
        if ch == b'"' || ch == b'\'' {
            if let Some(end) = match_quoted(input, i, ch) {
                flush_prose(input, prose_start, i, &mut out);
                out.push(Segment::Preserved(&input[i..end]));
                i = end;
                prose_start = end;
                continue;
            }
        }

        i += 1;
    }

    flush_prose(input, prose_start, bytes.len(), &mut out);
    out
}

fn flush_prose<'a>(input: &'a str, start: usize, end: usize, out: &mut Vec<Segment<'a>>) {
    if start < end {
        out.push(Segment::Prose(&input[start..end]));
    }
}

fn at_line_start(bytes: &[u8], i: usize) -> bool {
    if i == 0 {
        return true;
    }
    let mut j = i;
    while j > 0 {
        let prev = bytes[j - 1];
        if prev == b'\n' {
            return true;
        }
        if prev == b' ' || prev == b'\t' {
            j -= 1;
            continue;
        }
        return false;
    }
    true
}

/// Matches a fenced code block starting at or after `start`. Returns the
/// (open_offset, after_close_offset) pair where `open_offset` is the
/// position of the leading whitespace on the opening fence line and
/// `after_close_offset` is one past the trailing newline of the closing
/// fence line.
fn match_fence(input: &str, start: usize) -> Option<(usize, usize)> {
    let bytes = input.as_bytes();

    // Rewind through leading whitespace on the same line to capture indent.
    let mut line_start = start;
    while line_start > 0 && (bytes[line_start - 1] == b' ' || bytes[line_start - 1] == b'\t') {
        if line_start >= 1 && bytes[line_start - 1] == b'\n' {
            break;
        }
        line_start -= 1;
    }

    // Skip whitespace on opening line.
    let mut p = start;
    while p < bytes.len() && (bytes[p] == b' ' || bytes[p] == b'\t') {
        p += 1;
    }
    if p >= bytes.len() {
        return None;
    }
    let fence_char = bytes[p];
    if fence_char != b'`' && fence_char != b'~' {
        return None;
    }
    let mut fence_len = 0;
    while p + fence_len < bytes.len() && bytes[p + fence_len] == fence_char {
        fence_len += 1;
    }
    if fence_len < 3 {
        return None;
    }

    // Skip rest of the opening fence line.
    let mut q = p + fence_len;
    while q < bytes.len() && bytes[q] != b'\n' {
        q += 1;
    }
    if q >= bytes.len() {
        return None;
    }
    q += 1; // consume newline

    // Scan for closing fence: same char, >= fence_len, only whitespace on
    // either side of the run on its line.
    while q < bytes.len() {
        let line_start_inner = q;
        // Skip leading whitespace on the line.
        let mut r = q;
        while r < bytes.len() && (bytes[r] == b' ' || bytes[r] == b'\t') {
            r += 1;
        }
        if r < bytes.len() && bytes[r] == fence_char {
            let mut run = 0;
            while r + run < bytes.len() && bytes[r + run] == fence_char {
                run += 1;
            }
            if run >= fence_len {
                // Rest of line must be whitespace only.
                let mut s = r + run;
                let mut ok = true;
                while s < bytes.len() && bytes[s] != b'\n' {
                    if bytes[s] != b' ' && bytes[s] != b'\t' {
                        ok = false;
                        break;
                    }
                    s += 1;
                }
                if ok {
                    let end = if s < bytes.len() { s + 1 } else { s };
                    return Some((line_start, end));
                }
            }
        }
        // Advance to next line.
        while q < bytes.len() && bytes[q] != b'\n' {
            q += 1;
        }
        if q < bytes.len() {
            q += 1;
        }
        let _ = line_start_inner; // unused, kept for clarity
    }
    None
}

fn match_inline_code(input: &str, start: usize) -> Option<usize> {
    let bytes = input.as_bytes();
    let mut tick_count = 0;
    while start + tick_count < bytes.len() && bytes[start + tick_count] == b'`' {
        tick_count += 1;
    }
    if tick_count == 0 {
        return None;
    }
    // Find a matching run of the same length that does not extend past a
    // newline (inline spans don't cross blank lines; we just stop at \n\n).
    let mut p = start + tick_count;
    while p < bytes.len() {
        if bytes[p] == b'`' {
            let mut run = 0;
            while p + run < bytes.len() && bytes[p + run] == b'`' {
                run += 1;
            }
            if run == tick_count {
                return Some(p + run);
            }
            p += run;
            continue;
        }
        if bytes[p] == b'\n' && p + 1 < bytes.len() && bytes[p + 1] == b'\n' {
            return None;
        }
        p += 1;
    }
    None
}

fn match_html_tag(input: &str, start: usize) -> Option<usize> {
    let bytes = input.as_bytes();
    if bytes[start] != b'<' {
        return None;
    }
    // Reject "< " (likely a less-than comparison in prose).
    if start + 1 < bytes.len() && bytes[start + 1].is_ascii_whitespace() {
        return None;
    }
    // Reject if no plausible tag character follows.
    if start + 1 >= bytes.len() {
        return None;
    }
    let next = bytes[start + 1];
    let tag_like = next.is_ascii_alphabetic() || next == b'/' || next == b'!' || next == b'?';
    if !tag_like {
        return None;
    }
    let mut p = start + 1;
    let mut in_attr_quote: Option<u8> = None;
    while p < bytes.len() {
        let c = bytes[p];
        if let Some(q) = in_attr_quote {
            if c == q {
                in_attr_quote = None;
            }
        } else if c == b'"' || c == b'\'' {
            in_attr_quote = Some(c);
        } else if c == b'>' {
            return Some(p + 1);
        } else if c == b'\n' {
            // Tags can span lines, but a blank line definitely ends them.
            if p + 1 < bytes.len() && bytes[p + 1] == b'\n' {
                return None;
            }
        }
        p += 1;
    }
    None
}

fn match_placeholder(input: &str, start: usize) -> Option<usize> {
    let bytes = input.as_bytes();
    if !(bytes[start] == b'{' && bytes.get(start + 1) == Some(&b'{')) {
        return None;
    }
    let mut p = start + 2;
    while p + 1 < bytes.len() {
        if bytes[p] == b'}' && bytes[p + 1] == b'}' {
            return Some(p + 2);
        }
        if bytes[p] == b'\n' && p + 1 < bytes.len() && bytes[p + 1] == b'\n' {
            return None;
        }
        p += 1;
    }
    None
}

fn match_quoted(input: &str, start: usize, quote: u8) -> Option<usize> {
    let bytes = input.as_bytes();
    if bytes[start] != quote {
        return None;
    }
    let mut p = start + 1;
    while p < bytes.len() {
        let c = bytes[p];
        if c == b'\\' && p + 1 < bytes.len() {
            p += 2;
            continue;
        }
        if c == quote {
            return Some(p + 1);
        }
        if c == b'\n' {
            return None;
        }
        p += 1;
    }
    None
}

fn match_user_block(input: &str, start: usize, blocks: &[&'static str]) -> Option<usize> {
    for b in blocks {
        if b.is_empty() {
            continue;
        }
        if input[start..].starts_with(b) {
            return Some(start + b.len());
        }
    }
    None
}
