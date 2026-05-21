//! Message parsing for the eri Discord bot.
//!
//! Two trigger styles are supported:
//!
//! * `<@bot-id> build me a coffee shop landing page` — Discord's native
//!   mention syntax. The mention token may also appear as `<@!bot-id>` for
//!   nickname mentions on older clients, and may be preceded by whitespace.
//! * `!eri build me a coffee shop landing page` — case-insensitive prefix,
//!   the leading `!` is required so the bot only reacts when it's clearly
//!   addressed.
//!
//! Both forms also strip a leading `build`, `build me a`, `make` (etc.) so
//! the downstream Mercury prompt stays clean. We intentionally keep the
//! grammar permissive: anything that looks like a request is forwarded as-is
//! and Mercury handles the natural-language understanding.

#[derive(Debug, PartialEq, Eq)]
pub enum ParsedPrompt {
    /// User addressed the bot but didn't ask for anything (e.g. just
    /// `@eri`). We surface this to nudge them rather than silently no-op.
    Empty,
    /// Cleaned prompt body, ready to forward to Mercury 2.
    Build(String),
}

/// Returns `None` if the message doesn't address the bot at all. Returns
/// `Some(Empty)` if it does but contains no prompt body. Returns
/// `Some(Build(prompt))` with the cleaned, trimmed body otherwise.
pub fn parse_mention_prompt(content: &str, bot_id: u64) -> Option<ParsedPrompt> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return None;
    }

    let remainder = strip_bot_mention(trimmed, bot_id)
        .or_else(|| strip_bang_prefix(trimmed))?;

    let cleaned = strip_build_verb(remainder).trim();
    if cleaned.is_empty() {
        Some(ParsedPrompt::Empty)
    } else {
        Some(ParsedPrompt::Build(cleaned.to_string()))
    }
}

/// Match `<@id>` or `<@!id>` at the very start of the message. Returns the
/// remainder after the mention, or `None` if the message does not start with
/// a mention of this bot.
fn strip_bot_mention(content: &str, bot_id: u64) -> Option<&str> {
    let plain = format!("<@{bot_id}>");
    let nick = format!("<@!{bot_id}>");
    if let Some(rest) = content.strip_prefix(&plain) {
        return Some(rest.trim_start());
    }
    if let Some(rest) = content.strip_prefix(&nick) {
        return Some(rest.trim_start());
    }
    None
}

/// Match the `!eri` prefix case-insensitively, followed by whitespace or
/// end-of-string. Returns the remainder after the prefix. Refuses to match
/// `!eric`, `!erica` etc. by requiring a word boundary.
fn strip_bang_prefix(content: &str) -> Option<&str> {
    let lower = content.to_ascii_lowercase();
    let stripped = lower.strip_prefix("!eri")?;
    // Must be the whole token: either followed by whitespace or end of string.
    let next_char = stripped.chars().next();
    match next_char {
        None => Some(""),
        Some(c) if c.is_whitespace() => {
            let consumed = content.len() - stripped.len();
            Some(content[consumed..].trim_start())
        }
        Some(_) => None,
    }
}

/// Drop a leading conversational verb so a prompt like
/// "build me a coffee shop" becomes "a coffee shop landing page" before it
/// reaches Mercury. We're permissive: anything we don't recognize is left
/// alone.
fn strip_build_verb(input: &str) -> &str {
    const VERBS: &[&str] = &[
        "build me a ",
        "build me an ",
        "build a ",
        "build an ",
        "build ",
        "make me a ",
        "make me an ",
        "make a ",
        "make an ",
        "make ",
        "create a ",
        "create an ",
        "create ",
        "generate a ",
        "generate an ",
        "generate ",
    ];
    let lower = input.to_ascii_lowercase();
    for verb in VERBS {
        if lower.starts_with(verb) {
            return input[verb.len()..].trim_start();
        }
    }
    input
}

#[cfg(test)]
mod tests {
    use super::*;

    const BOT_ID: u64 = 1234567890;

    #[test]
    fn mention_then_build_verb_strips_to_subject() {
        let content = format!("<@{BOT_ID}> build me a coffee shop landing page");
        let parsed = parse_mention_prompt(&content, BOT_ID).expect("should parse");
        assert_eq!(
            parsed,
            ParsedPrompt::Build("coffee shop landing page".to_string())
        );
    }

    #[test]
    fn nickname_mention_form_also_parses() {
        let content = format!("<@!{BOT_ID}> make a portfolio site");
        let parsed = parse_mention_prompt(&content, BOT_ID).expect("should parse");
        assert_eq!(parsed, ParsedPrompt::Build("portfolio site".to_string()));
    }

    #[test]
    fn bang_eri_prefix_with_build_verb() {
        let parsed = parse_mention_prompt("!eri build me a pricing page", BOT_ID)
            .expect("should parse");
        assert_eq!(parsed, ParsedPrompt::Build("pricing page".to_string()));
    }

    #[test]
    fn bang_eri_case_insensitive() {
        let parsed = parse_mention_prompt("!ERI build a landing page for cats", BOT_ID)
            .expect("should parse");
        assert_eq!(
            parsed,
            ParsedPrompt::Build("landing page for cats".to_string())
        );
    }

    #[test]
    fn bang_eric_does_not_match() {
        let parsed = parse_mention_prompt("!eric build me a thing", BOT_ID);
        assert_eq!(parsed, None);
    }

    #[test]
    fn unaddressed_message_returns_none() {
        let parsed = parse_mention_prompt("just chatting about builds", BOT_ID);
        assert_eq!(parsed, None);
    }

    #[test]
    fn empty_mention_yields_empty_variant() {
        let content = format!("<@{BOT_ID}>");
        let parsed = parse_mention_prompt(&content, BOT_ID).expect("should parse");
        assert_eq!(parsed, ParsedPrompt::Empty);
    }

    #[test]
    fn bang_eri_alone_yields_empty_variant() {
        let parsed = parse_mention_prompt("!eri", BOT_ID).expect("should parse");
        assert_eq!(parsed, ParsedPrompt::Empty);
    }

    #[test]
    fn mention_without_verb_passes_through_intact() {
        let content = format!("<@{BOT_ID}> a haiku about cats in HTML");
        let parsed = parse_mention_prompt(&content, BOT_ID).expect("should parse");
        assert_eq!(
            parsed,
            ParsedPrompt::Build("a haiku about cats in HTML".to_string())
        );
    }

    #[test]
    fn mention_for_other_bot_does_not_match() {
        let parsed = parse_mention_prompt("<@999999> hey", BOT_ID);
        assert_eq!(parsed, None);
    }

    #[test]
    fn leading_whitespace_does_not_block_match() {
        let content = format!("   <@{BOT_ID}>   make a saas landing page  ");
        let parsed = parse_mention_prompt(&content, BOT_ID).expect("should parse");
        assert_eq!(
            parsed,
            ParsedPrompt::Build("saas landing page".to_string())
        );
    }
}
