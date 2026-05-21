//! Minimal HTML scanner. This is intentionally not a full parser: we walk the
//! source forward, recognize a handful of semantic tags, and capture their byte
//! ranges plus any child components we care about (named buttons, named forms,
//! images, stylesheet links). Unknown tags are skipped — the scanner never
//! tries to build a complete DOM.

use crate::NodeKind;

const SECTION_TAGS: &[&str] = &[
    "section", "header", "main", "footer", "nav", "article", "aside", "form",
];

const COMPONENT_TAGS: &[&str] = &["button", "input", "textarea", "select"];

#[derive(Debug, Clone)]
pub struct HtmlBlock {
    pub kind: NodeKind,
    pub name: String,
    pub start: usize,
    pub end: usize,
    pub summary: String,
    pub children: Vec<HtmlBlock>,
}

/// Scan `source` and return interesting blocks in document order. Sections may
/// nest other sections via [`HtmlBlock::children`].
pub fn scan(source: &str) -> Vec<HtmlBlock> {
    scan_range(source, 0, source.len())
}

fn scan_range(source: &str, start: usize, end: usize) -> Vec<HtmlBlock> {
    let bytes = source.as_bytes();
    let limit = end.min(bytes.len());
    let mut out: Vec<HtmlBlock> = Vec::new();
    let mut cursor = start;
    while cursor < limit {
        let lt = match memchr(b'<', bytes, cursor) {
            Some(i) if i < limit => i,
            _ => break,
        };
        let gt = match memchr(b'>', bytes, lt + 1) {
            Some(i) if i < limit => i,
            _ => break,
        };
        let tag_text = &source[lt + 1..gt];
        if tag_text.starts_with('!') || tag_text.starts_with('/') || tag_text.starts_with('?') {
            cursor = gt + 1;
            continue;
        }
        let (tag_name, attrs) = split_tag(tag_text);
        let tag_lower = tag_name.to_ascii_lowercase();

        if tag_lower == "script" {
            let close = find_close(source, "script", gt + 1).unwrap_or(limit);
            out.push(HtmlBlock {
                kind: NodeKind::Script,
                name: attr_value(attrs, "src").unwrap_or_else(|| "inline".to_string()),
                start: lt,
                end: close,
                summary: String::new(),
                children: Vec::new(),
            });
            cursor = close;
            continue;
        }
        if tag_lower == "style" {
            let close = find_close(source, "style", gt + 1).unwrap_or(limit);
            out.push(HtmlBlock {
                kind: NodeKind::Style,
                name: "inline".to_string(),
                start: lt,
                end: close,
                summary: String::new(),
                children: Vec::new(),
            });
            cursor = close;
            continue;
        }
        if tag_lower == "link" {
            if attr_value(attrs, "rel")
                .map(|v| v.eq_ignore_ascii_case("stylesheet"))
                .unwrap_or(false)
            {
                let name = attr_value(attrs, "href").unwrap_or_else(|| "stylesheet".to_string());
                out.push(HtmlBlock {
                    kind: NodeKind::Asset,
                    name,
                    start: lt,
                    end: gt + 1,
                    summary: String::new(),
                    children: Vec::new(),
                });
            }
            cursor = gt + 1;
            continue;
        }
        if tag_lower == "img" {
            let name = attr_value(attrs, "alt")
                .or_else(|| attr_value(attrs, "src"))
                .unwrap_or_else(|| "image".to_string());
            out.push(HtmlBlock {
                kind: NodeKind::Asset,
                name,
                start: lt,
                end: gt + 1,
                summary: String::new(),
                children: Vec::new(),
            });
            cursor = gt + 1;
            continue;
        }
        if SECTION_TAGS.contains(&tag_lower.as_str()) {
            let close = find_close(source, &tag_lower, gt + 1).unwrap_or(limit);
            let name = section_name(attrs, &tag_lower);
            let inner_start = gt + 1;
            let inner_end = close.min(limit);
            let mut children = scan_range(source, inner_start, inner_end);
            // Pull in direct component descendants that scan_range skipped.
            let extras = find_components(source, inner_start, inner_end);
            for extra in extras {
                if !children.iter().any(|c| c.start == extra.start) {
                    children.push(extra);
                }
            }
            children.sort_by_key(|b| b.start);
            children.dedup_by(|a, b| a.start == b.start && a.end == b.end);
            out.push(HtmlBlock {
                kind: NodeKind::Section,
                name,
                start: lt,
                end: close,
                summary: String::new(),
                children,
            });
            cursor = close;
            continue;
        }
        cursor = gt + 1;
    }
    out
}

fn find_components(source: &str, start: usize, end: usize) -> Vec<HtmlBlock> {
    let bytes = source.as_bytes();
    let limit = end.min(bytes.len());
    let mut out: Vec<HtmlBlock> = Vec::new();
    let mut cursor = start;
    // Track nested section ranges so we don't descend into them — those
    // components belong to the nested section, not to us.
    let mut skip_sections: Vec<(usize, usize)> = Vec::new();
    while cursor < limit {
        let lt = match memchr(b'<', bytes, cursor) {
            Some(i) if i < limit => i,
            _ => break,
        };
        if let Some((_, skip_end)) = skip_sections.iter().find(|(s, e)| *s <= lt && lt < *e) {
            cursor = *skip_end;
            continue;
        }
        let gt = match memchr(b'>', bytes, lt + 1) {
            Some(i) if i < limit => i,
            _ => break,
        };
        let tag_text = &source[lt + 1..gt];
        if tag_text.starts_with('!') || tag_text.starts_with('/') || tag_text.starts_with('?') {
            cursor = gt + 1;
            continue;
        }
        let (tag_name, attrs) = split_tag(tag_text);
        let tag_lower = tag_name.to_ascii_lowercase();
        if SECTION_TAGS.contains(&tag_lower.as_str()) {
            let close = find_close(source, &tag_lower, gt + 1).unwrap_or(limit);
            skip_sections.push((lt, close));
            cursor = gt + 1;
            continue;
        }
        if tag_lower == "img" {
            cursor = gt + 1;
            continue;
        }
        if COMPONENT_TAGS.contains(&tag_lower.as_str()) {
            let close = find_close(source, &tag_lower, gt + 1).unwrap_or(gt + 1);
            let inner = if close > gt + 1 && close <= limit {
                &source[gt + 1..close]
            } else {
                ""
            };
            let label = first_text(inner);
            let id = attr_value(attrs, "id").unwrap_or_default();
            let aria = attr_value(attrs, "aria-label").unwrap_or_default();
            let name = if !id.is_empty() {
                id
            } else if !aria.is_empty() {
                aria
            } else if !label.is_empty() {
                shorten(&label, 32)
            } else {
                tag_lower.clone()
            };
            out.push(HtmlBlock {
                kind: NodeKind::Component,
                name,
                start: lt,
                end: close,
                summary: shorten(&label, 48),
                children: Vec::new(),
            });
            cursor = close;
            continue;
        }
        cursor = gt + 1;
    }
    out
}

fn section_name(attrs: &str, tag: &str) -> String {
    if let Some(id) = attr_value(attrs, "id") {
        if !id.is_empty() {
            return id;
        }
    }
    if let Some(role) = attr_value(attrs, "data-section") {
        if !role.is_empty() {
            return role;
        }
    }
    if let Some(cls) = attr_value(attrs, "class") {
        if let Some(first) = cls.split_whitespace().next() {
            if !first.is_empty() {
                return first.to_string();
            }
        }
    }
    tag.to_string()
}

fn split_tag(tag_text: &str) -> (&str, &str) {
    let trimmed = tag_text.trim_end_matches('/').trim();
    match trimmed.find(char::is_whitespace) {
        Some(i) => (&trimmed[..i], trimmed[i..].trim()),
        None => (trimmed, ""),
    }
}

fn attr_value(attrs: &str, key: &str) -> Option<String> {
    let key_lower = key.to_ascii_lowercase();
    let bytes = attrs.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        let start = i;
        while i < bytes.len() && bytes[i] != b'=' && !bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if start == i {
            break;
        }
        let name = &attrs[start..i];
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= bytes.len() || bytes[i] != b'=' {
            if name.eq_ignore_ascii_case(&key_lower) {
                return Some(String::new());
            }
            continue;
        }
        i += 1; // skip '='
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= bytes.len() {
            break;
        }
        let quote = bytes[i];
        let value = if quote == b'"' || quote == b'\'' {
            i += 1;
            let value_start = i;
            while i < bytes.len() && bytes[i] != quote {
                i += 1;
            }
            let v = &attrs[value_start..i.min(bytes.len())];
            if i < bytes.len() {
                i += 1;
            }
            v
        } else {
            let value_start = i;
            while i < bytes.len() && !bytes[i].is_ascii_whitespace() {
                i += 1;
            }
            &attrs[value_start..i]
        };
        if name.eq_ignore_ascii_case(&key_lower) {
            return Some(value.to_string());
        }
    }
    None
}

fn find_close(source: &str, tag: &str, from: usize) -> Option<usize> {
    let bytes = source.as_bytes();
    let lower = tag.to_ascii_lowercase();
    let mut cursor = from;
    let mut depth = 1i32;
    while cursor < bytes.len() {
        let lt = memchr(b'<', bytes, cursor)?;
        let gt = memchr(b'>', bytes, lt + 1)?;
        let inner = &source[lt + 1..gt];
        let is_close = inner.starts_with('/');
        let name_start = if is_close { 1 } else { 0 };
        let name_end = inner[name_start..]
            .find(|c: char| c.is_whitespace() || c == '/' || c == '>')
            .map(|i| i + name_start)
            .unwrap_or(inner.len());
        let name = inner[name_start..name_end].to_ascii_lowercase();
        if name == lower {
            if is_close {
                depth -= 1;
                if depth == 0 {
                    return Some(gt + 1);
                }
            } else if !inner.trim_end().ends_with('/') {
                depth += 1;
            }
        }
        cursor = gt + 1;
    }
    None
}

fn first_text(inner: &str) -> String {
    let mut buf = String::new();
    let mut in_tag = false;
    let mut last_space = true;
    for ch in inner.chars() {
        if ch == '<' {
            in_tag = true;
            continue;
        }
        if ch == '>' {
            in_tag = false;
            continue;
        }
        if in_tag {
            continue;
        }
        if ch.is_whitespace() {
            if !last_space && !buf.is_empty() {
                buf.push(' ');
                last_space = true;
            }
        } else {
            buf.push(ch);
            last_space = false;
        }
        if buf.len() >= 80 {
            break;
        }
    }
    buf.trim().to_string()
}

fn shorten(text: &str, max: usize) -> String {
    let trimmed = text.trim();
    if trimmed.len() <= max {
        trimmed.to_string()
    } else {
        let mut cut = max;
        while cut > 0 && !trimmed.is_char_boundary(cut) {
            cut -= 1;
        }
        trimmed[..cut].to_string()
    }
}

fn memchr(needle: u8, haystack: &[u8], from: usize) -> Option<usize> {
    if from >= haystack.len() {
        return None;
    }
    haystack[from..].iter().position(|b| *b == needle).map(|i| i + from)
}
