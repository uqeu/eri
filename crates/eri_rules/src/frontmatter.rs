use anyhow::{anyhow, Context, Result};

use crate::rule::Mode;

#[derive(Debug, Default)]
pub(crate) struct ParsedFrontmatter {
    pub name: Option<String>,
    pub description: Option<String>,
    pub priority: Option<i64>,
    pub mode: Option<Mode>,
}

pub(crate) struct ParsedFile {
    pub frontmatter: ParsedFrontmatter,
    pub body: String,
}

// Splits a `.mdc` file into optional YAML-style frontmatter and the markdown body.
// Frontmatter is delimited by leading `---` and trailing `---` lines.
pub(crate) fn split(content: &str) -> ParsedFile {
    let trimmed = content.trim_start_matches('\u{feff}');
    let mut lines = trimmed.lines();
    let Some(first) = lines.next() else {
        return ParsedFile {
            frontmatter: ParsedFrontmatter::default(),
            body: String::new(),
        };
    };
    if first.trim() != "---" {
        return ParsedFile {
            frontmatter: ParsedFrontmatter::default(),
            body: trimmed.to_string(),
        };
    }

    let mut fm_lines = Vec::new();
    let mut body_lines = Vec::new();
    let mut in_fm = true;
    for line in lines {
        if in_fm {
            if line.trim() == "---" {
                in_fm = false;
                continue;
            }
            fm_lines.push(line);
        } else {
            body_lines.push(line);
        }
    }

    let fm = parse_frontmatter(&fm_lines).unwrap_or_default();
    ParsedFile {
        frontmatter: fm,
        body: body_lines.join("\n"),
    }
}

// Minimal YAML subset parser: scalar `key: value` lines and a single
// list field `globs:` followed by `- "pattern"` items. Unknown keys are ignored.
fn parse_frontmatter(lines: &[&str]) -> Result<ParsedFrontmatter> {
    let mut out = ParsedFrontmatter::default();
    let mut globs: Vec<String> = Vec::new();
    let mut mode_str: Option<String> = None;

    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        let raw = line.trim_end();
        if raw.trim().is_empty() || raw.trim_start().starts_with('#') {
            i += 1;
            continue;
        }

        if let Some((key, value)) = split_kv(raw) {
            match key.as_str() {
                "name" => out.name = Some(unquote(value)),
                "description" => out.description = Some(unquote(value)),
                "priority" => {
                    let v = unquote(value);
                    out.priority = Some(
                        v.parse::<i64>()
                            .with_context(|| format!("priority must be integer, got {v:?}"))?,
                    );
                }
                "mode" | "type" | "activation" => mode_str = Some(unquote(value).to_lowercase()),
                "always" => {
                    if parse_bool(&unquote(value)) {
                        mode_str = Some("always".into());
                    }
                }
                "globs" => {
                    let v = value.trim();
                    if v.starts_with('[') {
                        globs.extend(parse_inline_list(v));
                    } else if !v.is_empty() {
                        // inline single glob
                        globs.push(unquote(v));
                    }
                    // peek block-list items
                    let mut j = i + 1;
                    while j < lines.len() {
                        let l = lines[j];
                        let ltrim = l.trim_start();
                        if ltrim.starts_with("- ") || ltrim.starts_with("-\t") {
                            globs.push(unquote(ltrim.trim_start_matches('-').trim()));
                            j += 1;
                        } else if ltrim.is_empty() {
                            j += 1;
                        } else {
                            break;
                        }
                    }
                    i = j;
                    continue;
                }
                _ => {}
            }
        }
        i += 1;
    }

    out.mode = match (mode_str.as_deref(), globs.is_empty()) {
        (Some("always") | Some("always_apply") | Some("always-apply"), _) => Some(Mode::Always),
        (Some("auto_attached") | Some("auto-attached") | Some("auto"), _) => {
            Some(Mode::AutoAttached { globs })
        }
        (Some("agent_requested") | Some("agent-requested") | Some("agent"), _) => {
            Some(Mode::AgentRequested)
        }
        (Some("manual"), _) => Some(Mode::Manual),
        (None, false) => Some(Mode::AutoAttached { globs }),
        (None, true) => None,
        (Some(other), _) => return Err(anyhow!("unknown rule mode {other:?}")),
    };

    Ok(out)
}

fn split_kv(line: &str) -> Option<(String, &str)> {
    let idx = line.find(':')?;
    let key = line[..idx].trim().to_string();
    let value = &line[idx + 1..];
    Some((key, value.trim()))
}

fn unquote(s: &str) -> String {
    let s = s.trim();
    if (s.starts_with('"') && s.ends_with('"') && s.len() >= 2)
        || (s.starts_with('\'') && s.ends_with('\'') && s.len() >= 2)
    {
        s[1..s.len() - 1].to_string()
    } else {
        s.to_string()
    }
}

fn parse_bool(s: &str) -> bool {
    matches!(s.to_ascii_lowercase().as_str(), "true" | "yes" | "on" | "1")
}

fn parse_inline_list(s: &str) -> Vec<String> {
    let s = s.trim();
    let inner = s.trim_start_matches('[').trim_end_matches(']');
    inner
        .split(',')
        .map(|p| unquote(p.trim()))
        .filter(|p| !p.is_empty())
        .collect()
}
