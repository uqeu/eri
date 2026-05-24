// Minimal YAML-subset frontmatter parser for SKILL.md files.
//
// Recognised keys:
//   name:         scalar string
//   description:  scalar string (may include commas)
//   when:         comma-separated scalar OR inline list [a, b] OR block list `- a`
//
// Unknown keys are ignored. Comments (`# ...`) and blank lines are skipped.

#[derive(Debug, Default)]
pub(crate) struct ParsedFrontmatter {
    pub name: Option<String>,
    pub description: Option<String>,
    pub when: Vec<String>,
}

pub(crate) struct ParsedFile {
    pub frontmatter: ParsedFrontmatter,
    pub body: String,
}

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

    let fm = parse_frontmatter(&fm_lines);
    ParsedFile {
        frontmatter: fm,
        body: body_lines.join("\n"),
    }
}

fn parse_frontmatter(lines: &[&str]) -> ParsedFrontmatter {
    let mut out = ParsedFrontmatter::default();

    let mut i = 0;
    while i < lines.len() {
        let raw = lines[i].trim_end();
        if raw.trim().is_empty() || raw.trim_start().starts_with('#') {
            i += 1;
            continue;
        }

        if let Some((key, value)) = split_kv(raw) {
            match key.as_str() {
                "name" => out.name = Some(unquote(value)),
                "description" => out.description = Some(unquote(value)),
                "when" | "keywords" | "tags" => {
                    let v = value.trim();
                    if v.starts_with('[') {
                        out.when.extend(parse_inline_list(v));
                    } else if !v.is_empty() {
                        out.when.extend(parse_comma_list(&unquote(v)));
                    }
                    // peek block-list items
                    let mut j = i + 1;
                    while j < lines.len() {
                        let l = lines[j];
                        let ltrim = l.trim_start();
                        if ltrim.starts_with("- ") || ltrim.starts_with("-\t") {
                            out.when.push(unquote(ltrim.trim_start_matches('-').trim()));
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

    // Normalise: trim, drop empties, lowercase for matching consistency.
    out.when = out
        .when
        .into_iter()
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .collect();

    out
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

fn parse_inline_list(s: &str) -> Vec<String> {
    let s = s.trim();
    let inner = s.trim_start_matches('[').trim_end_matches(']');
    inner
        .split(',')
        .map(|p| unquote(p.trim()))
        .filter(|p| !p.is_empty())
        .collect()
}

fn parse_comma_list(s: &str) -> Vec<String> {
    s.split(',')
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .collect()
}
