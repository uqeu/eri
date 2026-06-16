//! Event-time extraction — the producer that makes [`valid_from`] real.
//!
//! When you tell eri "**two years ago** I founded a startup that failed", eri
//! *learns* it today but it *happened* two years ago. This module reads that time
//! expression out of the fact's prose and returns the instant it became true, so
//! `recall_as_of` can answer about the event timeline ("what was going on back
//! then"), not just the ingestion timeline. Pure + deterministic (`now_ms` is
//! injected), zero model tokens — a hand-rolled scan, no calendar dependency.
//!
//! Deliberately conservative: it only **back-dates** (never forward-dates in v1)
//! and returns `None` when no clear expression is present, so a fact with no time
//! cue simply keeps `valid_from = learned_at`.
//!
//! [`valid_from`]: super::Observation::valid_from

const DAY_MS: u64 = 24 * 60 * 60 * 1000;
const WEEK_MS: u64 = 7 * DAY_MS;
/// Approximate, calendar-free month/year — fine for "what was true when"
/// granularity (we're dating memories, not scheduling).
const MONTH_MS: u64 = 30 * DAY_MS;
const YEAR_MS: u64 = 365 * DAY_MS;

/// Kinds whose body is user-narrated prose, so a time cue can be extracted from
/// it. Today only explicit `fact`s; listed here explicitly so a future prose kind
/// (a `preference`, a `goal`) opts in at one place instead of being silently
/// skipped by a hard-coded `== "fact"` at the call site (review g).
pub fn is_prose_kind(kind: &str) -> bool {
    matches!(kind, "fact")
}

/// Extract the instant a fact *became true* from its prose, or `None` when there's
/// no clear time cue. Recognizes:
///   - `<n> <unit> ago` — n a digit or word-number (`a`/`an`/`one`…`twelve`,
///     `couple`, `few`), unit day/week/month/year (singular or plural)
///   - `yesterday`, `last week|month|year`
///   - `in <YYYY>` / `back in <YYYY>` (1900–2099)
///
/// Returns the first match scanning left-to-right. Future instants are dropped
/// (v1 only back-dates), so the result is always `<= now_ms`.
pub fn extract_valid_from(body: &str, now_ms: u64) -> Option<u64> {
    let lower = body.to_lowercase();
    let tokens: Vec<&str> = lower
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|t| !t.is_empty())
        .collect();

    let mut found: Option<u64> = None;
    for i in 0..tokens.len() {
        let instant = match_at(&tokens, i, now_ms);
        if let Some(ms) = instant {
            found = Some(ms);
            break;
        }
    }
    // v1 only remembers the past — never forward-date a memory.
    found.filter(|&ms| ms <= now_ms)
}

/// Try every recognized pattern anchored at token `i`.
fn match_at(tokens: &[&str], i: usize, now_ms: u64) -> Option<u64> {
    // "<n> <unit> ago"
    if i + 2 < tokens.len()
        && tokens[i + 2] == "ago"
        && let (Some(n), Some(unit)) = (parse_count(tokens[i]), unit_ms(tokens[i + 1]))
    {
        return Some(now_ms.saturating_sub(n.saturating_mul(unit)));
    }
    // "yesterday"
    if tokens[i] == "yesterday" {
        return Some(now_ms.saturating_sub(DAY_MS));
    }
    // "last week|month|year"
    if tokens[i] == "last"
        && let Some(next) = tokens.get(i + 1)
        && let Some(unit) = unit_ms(next)
    {
        return Some(now_ms.saturating_sub(unit));
    }
    // "in <YYYY>" / "back in <YYYY>"
    if tokens[i] == "in"
        && let Some(next) = tokens.get(i + 1)
        && let Some(ms) = year_to_ms(next)
    {
        return Some(ms);
    }
    None
}

/// A leading count: digits, the article `a`/`an`, the word-numbers one–twelve,
/// or the fuzzy `couple`/`few` (rounded). `None` if not a count.
fn parse_count(tok: &str) -> Option<u64> {
    if let Ok(n) = tok.parse::<u64>() {
        return Some(n);
    }
    Some(match tok {
        "a" | "an" | "one" => 1,
        "two" | "couple" => 2,
        "three" | "few" | "several" => 3,
        "four" => 4,
        "five" => 5,
        "six" => 6,
        "seven" => 7,
        "eight" => 8,
        "nine" => 9,
        "ten" => 10,
        "eleven" => 11,
        "twelve" => 12,
        _ => return None,
    })
}

/// Milliseconds in a time unit (singular or plural), or `None` if not a unit.
fn unit_ms(tok: &str) -> Option<u64> {
    Some(match tok {
        "day" | "days" => DAY_MS,
        "week" | "weeks" => WEEK_MS,
        "month" | "months" => MONTH_MS,
        "year" | "years" => YEAR_MS,
        _ => return None,
    })
}

/// A 4-digit year (1900–2099) → the approximate epoch-ms at its start. Calendar-
/// free: 365-day years plus a leap day every 4th year since 1970. `None` if not a
/// plausible year.
fn year_to_ms(tok: &str) -> Option<u64> {
    let year: u64 = tok.parse().ok()?;
    if !(1900..=2099).contains(&year) || year < 1970 {
        return None;
    }
    let years_since_epoch = year - 1970;
    let leap_days = years_since_epoch / 4;
    Some(years_since_epoch * YEAR_MS + leap_days * DAY_MS)
}

#[cfg(test)]
mod tests {
    use super::*;

    // A fixed "now" well past 1970 so back-dating stays positive.
    const NOW: u64 = 1_800_000_000_000; // ~2027

    #[test]
    fn extracts_n_units_ago_with_word_numbers() {
        assert_eq!(
            extract_valid_from("two years ago I founded a startup that failed", NOW),
            Some(NOW - 2 * YEAR_MS)
        );
        assert_eq!(
            extract_valid_from("I shipped it three weeks ago", NOW),
            Some(NOW - 3 * WEEK_MS)
        );
        assert_eq!(
            extract_valid_from("moved here 5 months ago", NOW),
            Some(NOW - 5 * MONTH_MS)
        );
    }

    #[test]
    fn extracts_the_expression_anywhere_in_the_sentence() {
        // The cue isn't at the start — scan finds it mid-sentence.
        let got = extract_valid_from("I created the company two years ago in a garage", NOW);
        assert_eq!(got, Some(NOW - 2 * YEAR_MS));
    }

    #[test]
    fn extracts_article_and_relative_phrases() {
        assert_eq!(extract_valid_from("a year ago", NOW), Some(NOW - YEAR_MS));
        assert_eq!(
            extract_valid_from("yesterday I quit", NOW),
            Some(NOW - DAY_MS)
        );
        assert_eq!(
            extract_valid_from("last month was rough", NOW),
            Some(NOW - MONTH_MS)
        );
    }

    #[test]
    fn extracts_absolute_year() {
        // "in 2021" → roughly 2021's start, comfortably before NOW.
        let got = extract_valid_from("I started this back in 2021", NOW).unwrap();
        let approx_2021 = (2021 - 1970) * YEAR_MS + ((2021 - 1970) / 4) * DAY_MS;
        assert_eq!(got, approx_2021);
        assert!(got < NOW);
    }

    #[test]
    fn no_time_cue_returns_none() {
        assert_eq!(extract_valid_from("I prefer dark mode and tabs", NOW), None);
        assert_eq!(extract_valid_from("I have 3 cats", NOW), None); // 3 not followed by a unit+ago
        assert_eq!(extract_valid_from("", NOW), None);
    }

    #[test]
    fn bare_numbers_are_not_mistaken_for_dates() {
        // A 4-digit number is only a date when "in" directly precedes it — so
        // object ids / model years / counts don't get mistaken for valid_from
        // (review f). The "<n> <unit> ago" form likewise needs the unit + "ago".
        assert_eq!(extract_valid_from("I drive a 2015 model car", NOW), None);
        assert_eq!(extract_valid_from("my desk is in room 2048", NOW), None);
        assert_eq!(extract_valid_from("I bought 5 monitors", NOW), None);
        // But a genuine "in <year>" cue still resolves.
        assert!(extract_valid_from("I started the company in 2021", NOW).is_some());
    }

    #[test]
    fn never_forward_dates_in_v1() {
        // A future year is dropped — "remember" is about the past.
        assert_eq!(extract_valid_from("in 2099 I plan to retire", NOW), None);
    }
}
