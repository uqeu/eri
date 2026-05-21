//! Recording → Twitter/X thread generator.
//!
//! Wires the existing `start recording` voice flow into Claude Code CLI so a
//! user can say "post about this" right after a demo and walk away with a
//! ready-to-paste viral thread. The prompt sent to Claude bundles three
//! signals: the user's iteration intents (what they asked eri to build), the
//! deploy URL when one is known, and the on-disk path of the recording so
//! Claude knows the user has video to attach.
//!
//! Two surfaces here:
//!
//! 1. [`build_social_thread_prompt`] — pure builder, no I/O. Used directly by
//!    [`crate::ClaudeCliBackend::run_social_thread`]; also unit-tested for the
//!    "deploy URL present" / "no recording" branches.
//! 2. [`SocialThread`] + [`parse_social_thread`] — Claude's reply is asked for
//!    in a strict JSON shape; the parser is forgiving (falls back to a single
//!    tweet when Claude wraps the JSON in code fences or adds prose) so the
//!    panel never crashes on a malformed response.
//!
//! Per-tweet length cap leaves room for media + URL (X counts a t.co URL as
//! 23 chars regardless of length).

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::InferenceError;

/// Best-effort Twitter/X per-tweet char budget. The hard limit is 280; we
/// leave room for a media attachment indicator and a t.co URL so the panel
/// can paste each tweet as-is.
pub const SOCIAL_THREAD_TWEET_CHAR_BUDGET: usize = 270;

/// Minimum number of tweets we ask Claude to write. Below this the thread
/// feels like a single post and loses the "build in public" cadence we want.
pub const SOCIAL_THREAD_MIN_TWEETS: usize = 6;

/// Maximum number of tweets in a generated thread. Past this people stop
/// reading and the deploy URL in tweet 1 gets buried.
pub const SOCIAL_THREAD_MAX_TWEETS: usize = 8;

/// Waitlist URL we ask Claude to plug in the closing tweet. Lives in code
/// rather than as a runtime config so the prompt is fully self-contained for
/// the unit tests.
pub const ERI_WAITLIST_URL: &str = "https://eri.dev";

/// Suggested posting window the prompt requests. Tech audiences on X cluster
/// activity early-week mornings in US Eastern; the brain's fallback
/// "best_time" matches this when Claude's reply is malformed.
pub const SOCIAL_THREAD_BEST_TIME: &str = "Mon–Wed, 9–11am ET";

/// One parsed thread ready to render in the panel. Tweets are in posting
/// order. `alt_text` is the suggestion for the attached recording (if any);
/// `best_time` is a human-readable posting window.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SocialThread {
    pub thread: Vec<String>,
    pub alt_text: String,
    pub best_time: String,
}

impl SocialThread {
    /// Join tweets with a blank line between them so the clipboard payload
    /// can be pasted into a Twitter/X composer or into a Notion doc without
    /// extra reformatting.
    pub fn join_for_clipboard(&self) -> String {
        self.thread.join("\n\n")
    }

    /// Total tweet count, capped at `SOCIAL_THREAD_MAX_TWEETS` so the panel
    /// can render a "1/N" header without doing math.
    pub fn len(&self) -> usize {
        self.thread.len()
    }

    pub fn is_empty(&self) -> bool {
        self.thread.is_empty()
    }
}

/// Build the Claude prompt that turns a build session into a Twitter/X
/// thread. The prompt is deliberately strict: we ask for a JSON object with
/// `thread`, `alt_text`, and `best_time` so the panel can parse the reply
/// without a flaky regex pass over prose. When Claude inevitably wraps the
/// JSON in a `json` code fence, [`parse_social_thread`] strips it.
pub fn build_social_thread_prompt(
    project_name: &str,
    intents: &[String],
    deployed_url: Option<&str>,
    recording_path: Option<&Path>,
    iteration_count: u64,
) -> String {
    let mut intent_block = String::new();
    if intents.is_empty() {
        intent_block.push_str("(no intents recorded — speak from the build itself.)\n");
    } else {
        for (i, intent) in intents.iter().enumerate() {
            let trimmed = intent.trim();
            if trimmed.is_empty() {
                continue;
            }
            intent_block.push_str(&format!("{}. {}\n", i + 1, trimmed));
        }
        if intent_block.is_empty() {
            intent_block.push_str("(no non-empty intents recorded.)\n");
        }
    }

    let url_line = match deployed_url {
        Some(url) if !url.trim().is_empty() => {
            format!("DEPLOYED URL: {}\nUse this URL verbatim in tweet 1.", url.trim())
        }
        _ => "DEPLOYED URL: (none yet — do not invent one; the first tweet's hook should focus on what was built instead of where to visit.)".to_string(),
    };

    let recording_line = match recording_path {
        Some(path) => format!(
            "RECORDING: {}\nAssume the user will attach this video to tweet 1; write `alt_text` as a vivid 1-sentence description of a screen recording of the build.",
            path.display()
        ),
        None => "RECORDING: (none — the user did not record a demo this session. Write a text-only thread and set `alt_text` to an empty string.)".to_string(),
    };

    let project_display = project_name.trim();
    let project_line = if project_display.is_empty() {
        "PROJECT: (unnamed build session)".to_string()
    } else {
        format!("PROJECT: {project_display}")
    };

    format!(
        "You are eri's SOCIAL THREAD pass. The user just finished a voice-driven build session in eri (an AI IDE that builds web apps from voice intents while you watch). They want a Twitter/X thread that captures the build, points at the live URL when there is one, and drives signups to the eri waitlist at {waitlist}.\n\n\
         {project_line}\n\
         ITERATION COUNT: {iteration_count}\n\
         {url_line}\n\
         {recording_line}\n\n\
         The user's iteration intents, in spoken order:\n{intent_block}\n\
         RULES:\n\
         - Output ONLY a single JSON object. No prose before or after. No code fences.\n\
         - JSON shape: {{\"thread\": [\"tweet 1\", \"tweet 2\", ...], \"alt_text\": \"...\", \"best_time\": \"...\"}}\n\
         - The thread MUST have between {min_tweets} and {max_tweets} tweets.\n\
         - Every tweet MUST be at most {budget} characters (X allows 280, but we leave room for a media attachment and a t.co URL).\n\
         - Tweet 1: hook the reader, name what was built, and include the DEPLOYED URL verbatim if one was provided. If no URL, lead with the build itself.\n\
         - Middle tweets: walk through 2-3 of the most interesting voice intents above and the result. Quote the user's intent in plain English, do not paraphrase into corporate-speak.\n\
         - Final tweet: invite replies, drop the eri waitlist URL {waitlist}, and tease that the user built this by talking to their computer.\n\
         - Do not use hashtags. Do not use emojis except a maximum of one in tweet 1.\n\
         - `alt_text`: a single sentence describing the recording for screen-reader users. Empty string if no recording.\n\
         - `best_time`: a short window like \"{best_time}\". Always recommend Mon–Wed mornings US Eastern for tech audiences unless the intents clearly target a non-tech audience.\n\
         ",
        waitlist = ERI_WAITLIST_URL,
        project_line = project_line,
        iteration_count = iteration_count,
        url_line = url_line,
        recording_line = recording_line,
        intent_block = intent_block,
        min_tweets = SOCIAL_THREAD_MIN_TWEETS,
        max_tweets = SOCIAL_THREAD_MAX_TWEETS,
        budget = SOCIAL_THREAD_TWEET_CHAR_BUDGET,
        best_time = SOCIAL_THREAD_BEST_TIME,
    )
}

/// Parse Claude's reply into a [`SocialThread`]. Tries strict JSON first,
/// then peels a fenced `json` block, then falls back to a single-tweet
/// thread carrying whatever Claude wrote so the user can still copy
/// something to the clipboard rather than seeing an opaque parse error.
pub fn parse_social_thread(raw: &str) -> Result<SocialThread, InferenceError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(InferenceError::Transport(
            "social thread: claude returned empty stdout".into(),
        ));
    }
    if let Some(parsed) = try_parse_json(trimmed) {
        return Ok(parsed);
    }
    if let Some(extracted) = extract_first_json_object(trimmed) {
        if let Some(parsed) = try_parse_json(extracted) {
            return Ok(parsed);
        }
    }
    // Fall back: stuff the whole stdout into a single tweet (truncated to
    // the per-tweet budget). The panel will surface this as a degraded
    // experience but the user still gets something pasteable.
    let fallback_text = trimmed
        .chars()
        .take(SOCIAL_THREAD_TWEET_CHAR_BUDGET)
        .collect::<String>();
    Ok(SocialThread {
        thread: vec![fallback_text],
        alt_text: String::new(),
        best_time: SOCIAL_THREAD_BEST_TIME.to_string(),
    })
}

fn try_parse_json(text: &str) -> Option<SocialThread> {
    #[derive(Deserialize)]
    struct Raw {
        thread: Vec<String>,
        #[serde(default)]
        alt_text: String,
        #[serde(default)]
        best_time: String,
    }
    let raw: Raw = serde_json::from_str(text).ok()?;
    let mut thread: Vec<String> = raw
        .thread
        .into_iter()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect();
    if thread.is_empty() {
        return None;
    }
    // Enforce per-tweet length defensively — Claude sometimes overshoots
    // even when the prompt asks for a hard cap. Truncate on a char
    // boundary so we never split a UTF-8 sequence.
    for tweet in thread.iter_mut() {
        if tweet.chars().count() > SOCIAL_THREAD_TWEET_CHAR_BUDGET {
            *tweet = tweet
                .chars()
                .take(SOCIAL_THREAD_TWEET_CHAR_BUDGET)
                .collect();
        }
    }
    if thread.len() > SOCIAL_THREAD_MAX_TWEETS {
        thread.truncate(SOCIAL_THREAD_MAX_TWEETS);
    }
    let best_time = if raw.best_time.trim().is_empty() {
        SOCIAL_THREAD_BEST_TIME.to_string()
    } else {
        raw.best_time.trim().to_string()
    };
    Some(SocialThread {
        thread,
        alt_text: raw.alt_text.trim().to_string(),
        best_time,
    })
}

/// Find and return the substring covering the first balanced `{ ... }` JSON
/// object in `text`. Used to peel away Claude's frequent ` ```json ... ``` `
/// wrapper or any leading "Here's the thread:" prose.
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
    use std::path::PathBuf;

    #[test]
    fn social_thread_prompt_includes_deployed_url_when_present() {
        let intents = vec![
            "build a coffee shop landing page".to_string(),
            "make the hero image rainy".to_string(),
        ];
        let recording = PathBuf::from("/tmp/eri-demos/abc.mp4");
        let prompt = build_social_thread_prompt(
            "coffee-shop",
            &intents,
            Some("https://coffee-shop.vercel.app"),
            Some(&recording),
            4,
        );
        assert!(prompt.contains("https://coffee-shop.vercel.app"));
        assert!(prompt.contains("Use this URL verbatim in tweet 1"));
        assert!(prompt.contains("/tmp/eri-demos/abc.mp4"));
        assert!(prompt.contains("PROJECT: coffee-shop"));
        assert!(prompt.contains("ITERATION COUNT: 4"));
        assert!(prompt.contains("build a coffee shop landing page"));
        assert!(prompt.contains(ERI_WAITLIST_URL));
    }

    #[test]
    fn social_thread_prompt_falls_back_when_no_recording() {
        let intents = vec!["build a pomodoro timer".to_string()];
        let prompt = build_social_thread_prompt(
            "pomodoro",
            &intents,
            None,
            None,
            1,
        );
        assert!(prompt.contains("RECORDING: (none"));
        assert!(prompt.contains("Write a text-only thread"));
        assert!(prompt.contains("DEPLOYED URL: (none yet"));
        assert!(!prompt.contains("Use this URL verbatim"));
    }

    #[test]
    fn parses_strict_json_reply() {
        let raw = r#"{"thread":["hook line","middle","close, https://eri.dev"],"alt_text":"a coffee shop landing page","best_time":"Tue 10am ET"}"#;
        let parsed = parse_social_thread(raw).expect("parse");
        assert_eq!(parsed.thread.len(), 3);
        assert_eq!(parsed.thread[0], "hook line");
        assert_eq!(parsed.alt_text, "a coffee shop landing page");
        assert_eq!(parsed.best_time, "Tue 10am ET");
    }

    #[test]
    fn parses_json_wrapped_in_code_fence() {
        let raw = "Here you go:\n```json\n{\"thread\":[\"t1\",\"t2\"],\"alt_text\":\"\",\"best_time\":\"\"}\n```\n";
        let parsed = parse_social_thread(raw).expect("parse");
        assert_eq!(parsed.thread, vec!["t1".to_string(), "t2".to_string()]);
        assert_eq!(parsed.best_time, SOCIAL_THREAD_BEST_TIME);
    }

    #[test]
    fn fallback_wraps_unparseable_stdout_in_single_tweet() {
        let parsed = parse_social_thread("claude couldn't be bothered to JSON today")
            .expect("fallback");
        assert_eq!(parsed.thread.len(), 1);
        assert!(parsed.thread[0].contains("claude couldn't be bothered"));
    }

    #[test]
    fn truncates_overlong_tweets_to_budget() {
        let long = "x".repeat(400);
        let raw = format!(r#"{{"thread":["{long}"],"alt_text":"","best_time":""}}"#);
        let parsed = parse_social_thread(&raw).expect("parse");
        assert_eq!(parsed.thread[0].chars().count(), SOCIAL_THREAD_TWEET_CHAR_BUDGET);
    }
}
