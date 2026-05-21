//! Message parsing for the eri Slack bot.
//!
//! Slack mention syntax differs from Discord — user IDs are alphanumeric and
//! prefixed with `U` (or `W` for enterprise) and the mention token can include
//! an optional display label: `<@U12345>` or `<@U12345|name>`. We only match
//! mentions whose ID equals the bot's own ID.
//!
//! As with the Discord bot, conversational verbs like "build me a" are
//! stripped so the downstream Mercury prompt stays clean.

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
pub fn parse_mention_prompt(content: &str, bot_user_id: &str) -> Option<ParsedPrompt> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return None;
    }

    let remainder = strip_bot_mention(trimmed, bot_user_id)?;
    let cleaned = strip_build_verb(remainder).trim();
    if cleaned.is_empty() {
        Some(ParsedPrompt::Empty)
    } else {
        Some(ParsedPrompt::Build(cleaned.to_string()))
    }
}

/// Match `<@USERID>` or `<@USERID|label>` at the very start of the message.
/// Returns the remainder after the mention, or `None` if the message does not
/// start with a mention of this bot.
fn strip_bot_mention<'a>(content: &'a str, bot_user_id: &str) -> Option<&'a str> {
    let rest = content.strip_prefix("<@")?;
    // The mention ends at the first '>'. Inside, an optional '|label' may follow the id.
    let close = rest.find('>')?;
    let inside = &rest[..close];
    let id = match inside.find('|') {
        Some(bar) => &inside[..bar],
        None => inside,
    };
    if id != bot_user_id {
        return None;
    }
    Some(rest[close + 1..].trim_start())
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

    const BOT_ID: &str = "U0BOTID42";

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
    fn mention_with_label_also_parses() {
        let content = format!("<@{BOT_ID}|eri> make a portfolio site");
        let parsed = parse_mention_prompt(&content, BOT_ID).expect("should parse");
        assert_eq!(parsed, ParsedPrompt::Build("portfolio site".to_string()));
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
    fn mention_for_other_user_does_not_match() {
        let parsed = parse_mention_prompt("<@U9999999> hey", BOT_ID);
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

    #[test]
    fn case_insensitive_build_verb() {
        let content = format!("<@{BOT_ID}> BUILD a landing page for cats");
        let parsed = parse_mention_prompt(&content, BOT_ID).expect("should parse");
        assert_eq!(
            parsed,
            ParsedPrompt::Build("landing page for cats".to_string())
        );
    }

    #[test]
    fn malformed_mention_without_closing_bracket_returns_none() {
        let parsed = parse_mention_prompt("<@U12345 build me a thing", BOT_ID);
        assert_eq!(parsed, None);
    }

    #[test]
    fn enterprise_w_prefixed_id_matches_when_equal() {
        // Enterprise Grid users have IDs that start with `W` instead of `U`;
        // the parser is agnostic to the prefix, it just matches the literal id.
        let parsed = parse_mention_prompt("<@W12ABCD> build a thing", "W12ABCD")
            .expect("should parse");
        // `build a ` is a recognised verb so it strips fully, leaving just `thing`.
        assert_eq!(parsed, ParsedPrompt::Build("thing".to_string()));
    }
}
