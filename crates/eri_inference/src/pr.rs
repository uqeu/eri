//! Cursor-style "AI-generated commit messages + PR description" prompts.
//!
//! Two builders, one parser. The builders produce focused Claude CLI prompts
//! and are pure functions over their inputs so they unit-test cleanly without
//! a Claude subprocess. The parser splits Claude's structured response into a
//! `(title, body)` pair the caller can hand straight to `gh pr create`.
//!
//! These prompts deliberately echo the rules from eri's repo-root `CLAUDE.md`:
//! imperative-mood commit messages, ≤72 character commit subjects, PR titles
//! ≤70 characters with no conventional-commit prefix, no trailing punctuation,
//! and a `Release Notes:` section as the last block of the PR body.

/// Compact summary of one git commit handed to the PR description builder.
/// Carries just enough to give Claude context without dragging the full diff
/// of every iteration — the recent diff is included separately so the bulk of
/// the prompt's signal-per-token comes from there.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CommitSummary {
    pub hash: String,
    pub message: String,
}

/// Parsed output of the PR-description prompt. `title` is the first line
/// (sanitised — no trailing punctuation, no conventional-commit prefix), and
/// `body` is everything else, ready to feed straight to `gh pr create --body`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GeneratedPr {
    pub title: String,
    pub body: String,
}

/// Build the commit-message prompt. The recent intent list (typically the
/// last 3-5 user prompts since the previous commit) anchors Claude on what
/// the user *meant* to do, even when the diff is messy or the user typed
/// across multiple iterations.
///
/// The prompt asks Claude for:
///   1. A single imperative-mood subject line ≤72 characters.
///   2. An optional 2-3 line body separated from the subject by a blank line.
///
/// We pin the imperative-mood and 72-char rules explicitly because Claude
/// otherwise drifts into conventional-commit prefixes (`feat:`, `fix:`) — eri's
/// `CLAUDE.md` forbids them in PR titles, and we want the same hygiene on
/// commit messages so the two never disagree.
pub fn build_commit_message_prompt(diff: &str, recent_intents: &[String]) -> String {
    let mut prompt = String::new();
    prompt.push_str(
        "You are eri's commit-message author. Write a single git commit message \
         that summarises the staged diff below.\n\n\
         RULES (MUST follow all):\n\
         - Subject line: imperative mood (\"Add\", \"Fix\", \"Refactor\" — NOT \"Added\" or \"Adds\").\n\
         - Subject line: 72 characters maximum.\n\
         - Subject line: no trailing period, no conventional-commit prefix (no `feat:`, `fix:`, `docs:`, etc.).\n\
         - Subject line: capitalised first word.\n\
         - Optional body: 2-3 short lines explaining the WHY, separated from the subject by ONE blank line.\n\
         - Do NOT wrap the output in code fences or quotes. Print the message and nothing else.\n\n",
    );
    if !recent_intents.is_empty() {
        prompt.push_str("RECENT USER INTENTS (most recent first):\n");
        for intent in recent_intents.iter().take(8) {
            let trimmed = intent.trim();
            if trimmed.is_empty() {
                continue;
            }
            prompt.push_str("- ");
            prompt.push_str(trimmed);
            prompt.push('\n');
        }
        prompt.push('\n');
    }
    prompt.push_str("STAGED DIFF:\n");
    prompt.push_str("```diff\n");
    prompt.push_str(diff);
    if !diff.ends_with('\n') {
        prompt.push('\n');
    }
    prompt.push_str("```\n");
    prompt
}

/// Build the PR-description prompt. The prompt asks Claude for a structured
/// response with a clearly delimited title and body so the parser can split
/// them deterministically. The body MUST end with a `Release Notes:` section
/// per eri's `CLAUDE.md`.
pub fn build_pr_description_prompt(branch: &str, base: &str, commits: &[CommitSummary]) -> String {
    let mut prompt = String::new();
    prompt.push_str(
        "You are eri's pull-request author. Write a polished pull-request title \
         and body that summarise the work between the base branch and the current \
         branch.\n\n\
         RULES (MUST follow all):\n\
         - Title: clear, imperative mood, ≤70 characters.\n\
         - Title: capitalised first word, no trailing punctuation (no period, no \"!\").\n\
         - Title: NO conventional-commit prefix (no `feat:`, `fix:`, `docs:`, etc.).\n\
         - Body MUST include these three sections, in this order, separated by blank lines:\n\
           ## Summary\n\
           A 2-4 sentence paragraph explaining what changed and why.\n\
           ## Test Plan\n\
           A markdown checklist (`- [ ] ...`) of concrete TODOs a reviewer can run.\n\
           Release Notes:\n\
           Exactly ONE bullet under this heading, of the form `- Added ...`, `- Fixed ...`, \
           `- Improved ...`, or `- N/A` for docs-only changes. Leave a blank line between \
           the `Release Notes:` heading and the bullet.\n\
         - Format the response EXACTLY like this, with no other prose, no code fences:\n\n\
           TITLE: <the title on a single line>\n\
           BODY:\n\
           <the body, including all three sections>\n\n",
    );
    prompt.push_str(&format!("BRANCH: {branch}\n"));
    prompt.push_str(&format!("BASE: {base}\n\n"));
    if commits.is_empty() {
        prompt.push_str("COMMITS: (none beyond the base — describe the working-tree changes)\n");
    } else {
        prompt.push_str("COMMITS (oldest first):\n");
        for commit in commits {
            let short = commit.hash.get(..7).unwrap_or(commit.hash.as_str());
            prompt.push_str(&format!("- {short} {}\n", commit.message));
        }
    }
    prompt
}

/// Parse the structured response produced by [`build_pr_description_prompt`].
///
/// Tolerant of:
/// - leading/trailing whitespace and code fences
/// - missing `BODY:` separator (everything after the title line is treated as body)
/// - conventional-commit prefixes in the title (stripped)
/// - trailing punctuation in the title (stripped)
///
/// Returns a `GeneratedPr` with an empty title only when the response is
/// entirely empty — callers should validate that the title is non-empty before
/// shelling out to `gh pr create`.
pub fn parse_pr_response(response: &str) -> GeneratedPr {
    let cleaned = strip_outer_code_fence(response.trim());
    let mut title = String::new();
    let mut body = String::new();
    let mut consumed_title = false;
    let mut body_started = false;

    for line in cleaned.lines() {
        if !consumed_title {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            if let Some(rest) = trimmed.strip_prefix("TITLE:") {
                title = rest.trim().to_string();
            } else {
                // No explicit TITLE: marker — first non-empty line is the title.
                title = trimmed.to_string();
            }
            consumed_title = true;
            continue;
        }
        if !body_started {
            let trimmed = line.trim();
            if let Some(rest) = trimmed.strip_prefix("BODY:") {
                let inline_rest = rest.trim_start();
                if !inline_rest.is_empty() {
                    body.push_str(inline_rest);
                    body.push('\n');
                }
                body_started = true;
                continue;
            }
            if trimmed.is_empty() {
                continue;
            }
            // No BODY: marker — treat the rest as body.
            body_started = true;
        }
        body.push_str(line);
        body.push('\n');
    }

    GeneratedPr {
        title: sanitize_title(&title),
        body: body.trim_end().to_string(),
    }
}

/// Strip conventional-commit prefix (`feat:`, `fix:`, etc.) and trailing
/// punctuation. Capitalises the first letter so titles always read cleanly
/// even when Claude slips a lowercase verb past the prompt rules.
fn sanitize_title(raw: &str) -> String {
    let mut title = raw.trim().to_string();
    // Strip a single leading conventional-commit prefix if present.
    if let Some((prefix, rest)) = title.split_once(':') {
        let prefix_trimmed = prefix.trim();
        if !prefix_trimmed.is_empty()
            && prefix_trimmed.len() <= 12
            && prefix_trimmed
                .chars()
                .all(|c| c.is_ascii_alphabetic() || c == '(' || c == ')' || c == '/' || c == '-')
            && is_conventional_commit_type(prefix_trimmed)
        {
            title = rest.trim().to_string();
        }
    }
    while let Some(last) = title.chars().last() {
        if matches!(last, '.' | '!' | '?' | ',' | ';' | ':') {
            title.pop();
        } else {
            break;
        }
    }
    // Capitalise first letter for consistency with eri's PR hygiene rules.
    let mut chars = title.chars();
    match chars.next() {
        Some(first) if first.is_ascii_lowercase() => {
            let upper = first.to_ascii_uppercase();
            let mut out = String::with_capacity(title.len());
            out.push(upper);
            out.extend(chars);
            out
        }
        _ => title,
    }
}

fn is_conventional_commit_type(prefix: &str) -> bool {
    // Strip optional scope `(foo)` before matching the type word.
    let bare = prefix.split('(').next().unwrap_or(prefix).trim();
    matches!(
        bare.to_ascii_lowercase().as_str(),
        "feat"
            | "fix"
            | "docs"
            | "style"
            | "refactor"
            | "perf"
            | "test"
            | "chore"
            | "ci"
            | "build"
            | "revert"
    )
}

fn strip_outer_code_fence(text: &str) -> &str {
    let trimmed = text.trim();
    if let Some(rest) = trimmed.strip_prefix("```") {
        // Drop the optional language tag on the opening fence.
        let after_fence = rest.split_once('\n').map(|x| x.1).unwrap_or(rest);
        if let Some(stripped) = after_fence.strip_suffix("```") {
            return stripped.trim_end_matches('\n');
        }
        if let Some(idx) = after_fence.rfind("```") {
            return after_fence[..idx].trim_end_matches('\n');
        }
    }
    trimmed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commit_message_prompt_asks_for_imperative_mood_and_72_char_limit() {
        let diff = "@@ -1 +1 @@\n-old\n+new\n";
        let intents = vec![
            "make the hero red".to_string(),
            "tighten spacing".to_string(),
        ];
        let prompt = build_commit_message_prompt(diff, &intents);

        assert!(
            prompt.contains("imperative mood"),
            "prompt must pin imperative mood: {prompt}"
        );
        assert!(
            prompt.contains("72 characters"),
            "prompt must pin 72-char subject cap: {prompt}"
        );
        assert!(
            prompt.contains("no conventional-commit prefix"),
            "prompt must forbid conventional-commit prefixes: {prompt}"
        );
        assert!(prompt.contains("make the hero red"), "intents are inlined");
        assert!(prompt.contains("```diff"), "diff is fenced");
    }

    #[test]
    fn pr_description_prompt_includes_release_notes_directive() {
        let commits = vec![
            CommitSummary {
                hash: "abc1234deadbeef".into(),
                message: "iter 0001: make a hero".into(),
            },
            CommitSummary {
                hash: "def5678cafef00d".into(),
                message: "iter 0002: tighten spacing".into(),
            },
        ];
        let prompt = build_pr_description_prompt("feature/hero", "main", &commits);

        assert!(
            prompt.contains("Release Notes:"),
            "Release Notes section required"
        );
        assert!(
            prompt.contains("- Added") && prompt.contains("- N/A"),
            "release-notes bullet examples must be present"
        );
        assert!(prompt.contains("## Summary"), "Summary section required");
        assert!(
            prompt.contains("## Test Plan"),
            "Test Plan section required"
        );
        assert!(
            prompt.contains("≤70 characters"),
            "70-char title cap must be present"
        );
        assert!(
            prompt.contains("NO conventional-commit prefix"),
            "conventional-commit prefix must be forbidden"
        );
        assert!(prompt.contains("abc1234"), "short hash inlined");
        assert!(prompt.contains("BRANCH: feature/hero"));
        assert!(prompt.contains("BASE: main"));
    }

    #[test]
    fn parse_pr_response_extracts_title_and_body() {
        let response = "TITLE: Add hero section to landing page\n\
                        BODY:\n\
                        ## Summary\n\
                        Adds a hero block with a CTA button.\n\
                        \n\
                        ## Test Plan\n\
                        - [ ] Open index.html and verify hero renders\n\
                        \n\
                        Release Notes:\n\
                        \n\
                        - Added hero section\n";
        let parsed = parse_pr_response(response);
        assert_eq!(parsed.title, "Add hero section to landing page");
        assert!(parsed.body.contains("## Summary"));
        assert!(parsed.body.contains("## Test Plan"));
        assert!(parsed.body.contains("Release Notes:"));
        assert!(parsed.body.contains("- Added hero section"));
    }

    #[test]
    fn parse_pr_response_strips_conventional_prefix_and_trailing_period() {
        let response = "TITLE: feat: add hero section.\nBODY:\nbody text\n";
        let parsed = parse_pr_response(response);
        assert_eq!(parsed.title, "Add hero section");
    }

    #[test]
    fn parse_pr_response_handles_missing_body_marker() {
        let response = "Add hero section\n\nsome body text\n";
        let parsed = parse_pr_response(response);
        assert_eq!(parsed.title, "Add hero section");
        assert!(parsed.body.contains("some body text"));
    }
}
