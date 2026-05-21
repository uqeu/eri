//! Background bug-finder pass.
//!
//! The user can say "find bugs" / "audit my code" / "what's broken" and eri
//! shells out to Claude Code CLI with the active `index.html` plus a focused
//! audit prompt. Claude returns a JSON list of `{severity, line, message,
//! suggested_fix?}` records which the panel renders as actionable rows in a
//! "Bugs" card. Bugs that ship with a `suggested_fix` (an Aider-style
//! search/replace block) can be applied directly via
//! [`crate::apply_search_replace_blocks`] without another Claude round-trip;
//! the ones without one are queued through Mercury Edit 2 with the bug
//! message as the instruction.
//!
//! Two surfaces here, mirroring [`crate::social`]:
//!
//! 1. [`build_bug_finder_prompt`] — pure builder, no I/O. Called by
//!    [`crate::ClaudeCliBackend::run_bug_finder`] and unit-tested.
//! 2. [`Bug`] + [`parse_bug_finder_response`] — Claude is asked for a strict
//!    JSON shape, but the parser is tolerant: code-fenced JSON, leading
//!    prose, and outright malformed output all degrade to a single
//!    `Severity::Medium` bug carrying the raw stdout so the user still has
//!    something to act on instead of an opaque error.

use serde::{Deserialize, Serialize};

/// Severity rating for a bug surfaced by the bug-finder pass. Maps to a
/// color in the panel render and orders the list (Critical first).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Critical,
    High,
    Medium,
    Low,
}

impl Severity {
    /// Parse a free-form severity word from Claude's JSON. Unknown values
    /// fall through to `Medium` so a typo on Claude's side doesn't drop the
    /// row entirely.
    pub fn parse(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "critical" | "blocker" | "fatal" => Severity::Critical,
            "high" | "major" | "important" => Severity::High,
            "low" | "minor" | "nit" | "info" => Severity::Low,
            _ => Severity::Medium,
        }
    }

    /// Short tag rendered in the panel row ("[HIGH]"). Uppercase so it stands
    /// out against the surrounding muted text.
    pub fn tag(self) -> &'static str {
        match self {
            Severity::Critical => "CRITICAL",
            Severity::High => "HIGH",
            Severity::Medium => "MEDIUM",
            Severity::Low => "LOW",
        }
    }

    /// Sort key — Critical sorts first, Low last. Used by
    /// [`parse_bug_finder_response`] to stabilise the list ordering.
    pub fn order(self) -> u8 {
        match self {
            Severity::Critical => 0,
            Severity::High => 1,
            Severity::Medium => 2,
            Severity::Low => 3,
        }
    }
}

/// One audit finding. `id` is assigned by the parser at parse time (1-based)
/// so the panel and the "fix bug N" voice command share a stable index.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Bug {
    pub id: u32,
    pub severity: Severity,
    pub line: Option<u32>,
    pub message: String,
    /// Optional Aider-style `<<<<<<< SEARCH ... ======= ... >>>>>>> REPLACE`
    /// block. When present, the panel can apply the fix directly via
    /// [`crate::apply_search_replace_blocks`]; when absent, the panel falls
    /// back to a Mercury Edit 2 call using `message` as the instruction.
    pub suggested_fix: Option<String>,
}

/// Hard cap on how many bugs we render. Past this the panel becomes noisy and
/// the brain summary ("found 47 issues") loses meaning. Claude is asked to
/// stay within this limit in the prompt; the parser truncates defensively.
pub const BUG_FINDER_MAX_BUGS: usize = 20;

/// Build the audit prompt sent to Claude Code CLI. The HTML is embedded
/// verbatim so Claude can cite line numbers; the JSON schema is described in
/// prose because Claude follows shape descriptions more reliably than
/// inlined JSON-schema examples.
pub fn build_bug_finder_prompt(html: &str) -> String {
    format!(
        r#"You are eri's background bug-finder. The user is building a single-file HTML site and wants a focused audit of the CURRENT BUILD. Find real, fixable issues — do NOT invent problems just to fill the list.

Audit focus (in priority order):
1. ACCESSIBILITY — missing `alt` on images, missing `<label for>` on form inputs, insufficient color contrast, missing `aria-*` on icon-only buttons, missing `lang` on `<html>`, headings out of order.
2. SECURITY — inline event handlers wired to untrusted strings, raw `innerHTML` writes, unsanitized URL params, `target="_blank"` without `rel="noopener noreferrer"`, mixed-content `http://` resources.
3. PERFORMANCE — unoptimized images (no `loading="lazy"`, no `width`/`height`), render-blocking `<script>` in `<head>` without `defer`/`async`, layout-thrashing CSS, large embedded data URIs.
4. SEO — missing `<title>`, missing meta description, missing Open Graph tags, missing `viewport` meta, headings hierarchy issues.

Output FORMAT (strict JSON, no prose outside the JSON, no code fences):

{{
  "bugs": [
    {{
      "severity": "critical" | "high" | "medium" | "low",
      "line": <integer 1-based line number in the HTML, or null if not line-specific>,
      "message": "<one sentence describing the bug and why it matters>",
      "suggested_fix": "<<<<<<< SEARCH\n<exact substring of the current HTML to replace, with enough surrounding context to be unique>\n=======\n<replacement text>\n>>>>>>> REPLACE"
    }}
  ]
}}

Rules:
- `suggested_fix` is OPTIONAL. Include it when a single search/replace block can fix the bug; omit it when the fix needs human judgement.
- Each `search` block must appear EXACTLY ONCE in the current HTML — pad with context lines if you have to.
- Return at most {max} bugs. Prioritise critical/high. If everything looks clean, return `{{"bugs": []}}`.
- Do NOT wrap the JSON in markdown fences. Do NOT prefix with "Here are the bugs:". The first character of your reply MUST be `{{` and the last must be `}}`.

CURRENT HTML:
```html
{html}
```
"#,
        max = BUG_FINDER_MAX_BUGS,
        html = html,
    )
}

/// Parse Claude's reply into a [`Vec<Bug>`]. Tries strict JSON first, then
/// peels a fenced JSON object, then falls back to a single `Severity::Medium`
/// bug carrying the raw stdout so the panel never crashes on a malformed
/// response. Bugs are sorted by severity ascending (Critical first), then by
/// line number ascending; the `id` field is assigned post-sort so it matches
/// the rendered order.
pub fn parse_bug_finder_response(response: &str) -> Vec<Bug> {
    let trimmed = response.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    if let Some(parsed) = try_parse_json(trimmed) {
        return parsed;
    }
    if let Some(extracted) = extract_first_json_object(trimmed) {
        if let Some(parsed) = try_parse_json(extracted) {
            return parsed;
        }
    }
    fallback_single_bug(trimmed)
}

fn try_parse_json(text: &str) -> Option<Vec<Bug>> {
    #[derive(Deserialize)]
    struct Raw {
        #[serde(default)]
        bugs: Vec<RawBug>,
    }
    #[derive(Deserialize)]
    struct RawBug {
        #[serde(default)]
        severity: String,
        #[serde(default)]
        line: Option<u32>,
        #[serde(default)]
        message: String,
        #[serde(default)]
        suggested_fix: Option<String>,
    }
    let raw: Raw = serde_json::from_str(text).ok()?;
    let mut bugs: Vec<Bug> = raw
        .bugs
        .into_iter()
        .filter_map(|r| {
            let message = r.message.trim().to_string();
            if message.is_empty() {
                return None;
            }
            let suggested_fix = r
                .suggested_fix
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
            Some(Bug {
                id: 0,
                severity: Severity::parse(&r.severity),
                line: r.line,
                message,
                suggested_fix,
            })
        })
        .collect();
    bugs.sort_by_key(|b| (b.severity.order(), b.line.unwrap_or(u32::MAX)));
    if bugs.len() > BUG_FINDER_MAX_BUGS {
        bugs.truncate(BUG_FINDER_MAX_BUGS);
    }
    for (index, bug) in bugs.iter_mut().enumerate() {
        bug.id = (index as u32).saturating_add(1);
    }
    Some(bugs)
}

fn fallback_single_bug(raw: &str) -> Vec<Bug> {
    let message_chars: String = raw.chars().take(400).collect();
    let message = if message_chars.trim().is_empty() {
        "Bug finder returned malformed output.".to_string()
    } else {
        format!("Bug finder returned malformed output: {message_chars}")
    };
    vec![Bug {
        id: 1,
        severity: Severity::Medium,
        line: None,
        message,
        suggested_fix: None,
    }]
}

/// Find and return the substring covering the first balanced `{ ... }` JSON
/// object in `text`. Mirrors the helper in [`crate::social`] — kept private
/// here to avoid a cross-module dependency for a 25-line function.
fn extract_first_json_object(text: &str) -> Option<&str> {
    let bytes = text.as_bytes();
    let start = bytes.iter().position(|&b| b == b'{')?;
    let mut depth: i32 = 0;
    let mut in_string = false;
    let mut escape = false;
    for (idx, &byte) in bytes.iter().enumerate().skip(start) {
        if escape {
            escape = false;
            continue;
        }
        match byte {
            b'\\' if in_string => escape = true,
            b'"' => in_string = !in_string,
            b'{' if !in_string => depth += 1,
            b'}' if !in_string => {
                depth -= 1;
                if depth == 0 {
                    return Some(&text[start..=idx]);
                }
            }
            _ => {}
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bug_finder_parses_three_bugs_with_severities() {
        let response = r#"{
            "bugs": [
                {"severity": "high", "line": 12, "message": "missing alt text on hero image", "suggested_fix": "<<<<<<< SEARCH\n<img src=\"hero.jpg\">\n=======\n<img src=\"hero.jpg\" alt=\"Coffee on a wooden table\">\n>>>>>>> REPLACE"},
                {"severity": "critical", "line": 4, "message": "missing viewport meta tag"},
                {"severity": "low", "line": null, "message": "consider adding Open Graph tags"}
            ]
        }"#;
        let bugs = parse_bug_finder_response(response);
        assert_eq!(bugs.len(), 3);
        // Sorted Critical → High → Low; ids are 1-based.
        assert_eq!(bugs[0].id, 1);
        assert_eq!(bugs[0].severity, Severity::Critical);
        assert_eq!(bugs[0].line, Some(4));
        assert_eq!(bugs[1].id, 2);
        assert_eq!(bugs[1].severity, Severity::High);
        assert_eq!(bugs[1].line, Some(12));
        assert!(bugs[1].suggested_fix.as_deref().unwrap().contains("SEARCH"));
        assert_eq!(bugs[2].id, 3);
        assert_eq!(bugs[2].severity, Severity::Low);
        assert_eq!(bugs[2].line, None);
        assert!(bugs[2].suggested_fix.is_none());
    }

    #[test]
    fn bug_finder_falls_back_to_single_bug_on_malformed_json() {
        let response = "Sorry, I can't audit this right now.";
        let bugs = parse_bug_finder_response(response);
        assert_eq!(bugs.len(), 1);
        assert_eq!(bugs[0].id, 1);
        assert_eq!(bugs[0].severity, Severity::Medium);
        assert!(bugs[0].message.contains("Sorry"));
        assert!(bugs[0].suggested_fix.is_none());
    }

    #[test]
    fn bug_finder_peels_fenced_json_block() {
        let response = "Here are the bugs:\n```json\n{\"bugs\": [{\"severity\": \"high\", \"message\": \"missing alt\"}]}\n```";
        let bugs = parse_bug_finder_response(response);
        assert_eq!(bugs.len(), 1);
        assert_eq!(bugs[0].severity, Severity::High);
        assert_eq!(bugs[0].message, "missing alt");
    }

    #[test]
    fn bug_finder_returns_empty_for_clean_audit() {
        let bugs = parse_bug_finder_response("{\"bugs\": []}");
        assert!(bugs.is_empty());
    }

    #[test]
    fn bug_finder_prompt_embeds_html_and_schema() {
        let prompt = build_bug_finder_prompt("<html><body><h1>Hi</h1></body></html>");
        assert!(prompt.contains("<h1>Hi</h1>"));
        assert!(prompt.contains("suggested_fix"));
        assert!(prompt.contains("ACCESSIBILITY"));
    }
}
