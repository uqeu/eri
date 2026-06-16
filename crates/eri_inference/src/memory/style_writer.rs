//! The style writer — eri *learning* how the user writes.
//!
//! `profile::distill_communication_style` already READS the newest
//! `communication_style` observation and the persona render injects it as
//! "How you write (mirror this): …". This module is the WRITER that produces
//! those observations: a pure analyzer over the user's own recent messages plus
//! a thin recorder that lands the derived register into the store via the
//! existing [`insert`](super::MemoryStore::insert) path (newest wins, so a
//! re-run simply updates the learned style).
//!
//! Two hard rules shape the analyzer:
//!   - **Derived adjectives only, never content.** The output is a register
//!     description ("lowercase, terse, uses emoji") — never a snippet of what the
//!     user wrote. The Tier-A profile is server-readable; message content could
//!     carry a secret, so it must not flow into the style string. (The distill
//!     path also keyword-screens, but we never rely on that downstream gate.)
//!   - **Mirror the person, not their mistakes.** We describe casing/brevity/
//!     emoji/punctuation/slang habits — we never echo a misspelling back into the
//!     description, so eri sounds like the user at their best, not their typos.
//!
//! Pure + deterministic (no I/O, no clock): the same messages always yield the
//! same phrase, so it is cheap and exhaustively unit-testable.

use std::path::Path;

use crate::memory::{MemoryStore, Observation};

/// The observation kind the writer emits and [`super::profile`] reads.
pub const COMMUNICATION_STYLE_KIND: &str = "communication_style";

/// Below this many of the user's own messages there isn't enough signal to
/// describe a register without guessing — return `None` so eri keeps mirroring
/// in-context instead of committing to a premature style.
const MIN_MESSAGES: usize = 3;

/// A message at or below this many words counts as a "one-liner" — the terseness
/// signal. ~8 words is a quick line; a real sentence runs longer.
const TERSE_WORD_CAP: usize = 8;

/// Fraction of messages that must be one-liners before we call the user terse.
const TERSE_RATIO: f32 = 0.6;

/// Fraction of messages whose first letter is lowercase before we call the
/// register lowercase-dominant. We look at the *opening* letter of each message
/// — not the global letter ratio (all prose is mostly lowercase letters, so that
/// would call everyone "lowercase"). A user who skips the capital at the start of
/// most messages genuinely writes lowercase.
const LOWERCASE_RATIO: f32 = 0.6;

/// Analyze the user's OWN recent messages into a short, human-readable register
/// description — the exact shape [`super::profile::distill_communication_style`]
/// returns and the persona render expects ("lowercase, terse, uses emoji,
/// casual").
///
/// Pass only the *user's* messages (never eri's), newest or oldest order — the
/// result is order-independent. Returns `None` when there's too little signal
/// (fewer than [`MIN_MESSAGES`] non-empty messages) so eri doesn't guess a style
/// prematurely.
///
/// Only derived register adjectives are emitted; message content never appears in
/// the output, so a secret in a message can't leak into the server-readable
/// profile.
pub fn analyze_communication_style(messages: &[&str]) -> Option<String> {
    // Blank/whitespace-only messages carry no register signal.
    let msgs: Vec<&str> = messages
        .iter()
        .map(|m| m.trim())
        .filter(|m| !m.is_empty())
        .collect();
    if msgs.len() < MIN_MESSAGES {
        return None;
    }

    let mut facets: Vec<&str> = Vec::new();

    // Casing: lowercase-dominant vs sentence-case. Measured over alphabetic
    // characters only so punctuation/numbers/emoji don't skew the ratio.
    match casing_facet(&msgs) {
        Casing::Lowercase => facets.push("lowercase"),
        Casing::SentenceCase => facets.push("sentence-case"),
        Casing::Unknown => {}
    }

    // Brevity: terse (mostly one-liners) vs longer-form.
    let one_liners = msgs
        .iter()
        .filter(|m| word_count(m) <= TERSE_WORD_CAP)
        .count();
    if ratio(one_liners, msgs.len()) >= TERSE_RATIO {
        facets.push("terse");
    } else {
        facets.push("full sentences");
    }

    // Emoji: any user reaching for emoji at all is a strong register signal.
    if msgs.iter().any(|m| contains_emoji(m)) {
        facets.push("uses emoji");
    }

    // Punctuation energy: frequent exclamation marks read as enthusiastic.
    let exclaimers = msgs.iter().filter(|m| m.contains('!')).count();
    if ratio(exclaimers, msgs.len()) >= 0.5 {
        facets.push("exclamation-heavy");
    }

    // Slang / abbreviations: chat shorthand ("lol", "u", "thx") is casual; its
    // absence with sentence-case + longer messages reads as formal. We detect
    // the *presence* of a shorthand habit, never reproduce the specific tokens.
    let has_slang = msgs.iter().any(|m| contains_slang(m));
    if has_slang {
        facets.push("casual");
    } else if facets.contains(&"sentence-case") && facets.contains(&"full sentences") {
        facets.push("formal");
    }

    if facets.is_empty() {
        return None;
    }
    Some(facets.join(", "))
}

/// Build a `communication_style` [`Observation`] (PURE) from an already-derived
/// register `text` + a transaction timestamp `ts_ms`. Exposed so a caller that
/// owns its own store/clock can record it on whatever seam fits; most callers
/// use [`record_communication_style`] instead.
///
/// `text` must already be the derived register phrase (e.g. the output of
/// [`analyze_communication_style`]) — never raw message content.
pub fn style_observation(text: &str, ts_ms: u64) -> Observation {
    Observation {
        id: format!("style_{ts_ms:013x}"),
        ts_ms,
        kind: COMMUNICATION_STYLE_KIND.to_string(),
        // Global like `fact`: the writing register isn't scoped to one workspace.
        workspace_hash: String::new(),
        body: text.to_string(),
        embedding: Vec::new(),
        valid_from: None,
        visibility: crate::memory::Visibility::Active,
    }
}

/// Analyze the user's own recent `messages` and, if there's enough signal,
/// record the derived register into `store` as a `communication_style`
/// observation (newest wins, so a re-run updates the learned style). Returns the
/// phrase that was recorded, or `None` when there wasn't enough signal to learn
/// a style yet (nothing is written in that case).
///
/// A thin wrapper over [`analyze_communication_style`] + the store's existing
/// [`insert`](MemoryStore::insert) record path — it never duplicates store logic
/// (id/embedding/cap/save are all the store's job).
pub fn record_communication_style(
    store: &mut MemoryStore,
    workspace: &Path,
    messages: &[&str],
) -> std::io::Result<Option<String>> {
    let Some(style) = analyze_communication_style(messages) else {
        return Ok(None);
    };
    store.insert(COMMUNICATION_STYLE_KIND, workspace, &style)?;
    Ok(Some(style))
}

#[derive(Debug, PartialEq)]
enum Casing {
    /// Almost no uppercase — the user skips capitalisation.
    Lowercase,
    /// Ordinary capitalisation (sentence starts, proper nouns).
    SentenceCase,
    /// Not enough alphabetic signal to decide.
    Unknown,
}

/// Classify casing by how each message *opens*. A message that starts with a
/// lowercase letter is a user skipping the capital; one that starts uppercase is
/// ordinary sentence-case. Counting opening letters (not the global letter ratio)
/// is what separates the two — normal prose is mostly lowercase letters either
/// way, so a global ratio would call everyone "lowercase". Messages that open
/// with a non-letter (emoji, digit) cast no casing vote.
fn casing_facet(msgs: &[&str]) -> Casing {
    let mut lower_starts = 0usize;
    let mut letter_starts = 0usize;
    for m in msgs {
        if let Some(c) = m.chars().find(|c| c.is_alphabetic()) {
            letter_starts += 1;
            if c.is_lowercase() {
                lower_starts += 1;
            }
        }
    }
    if letter_starts == 0 {
        return Casing::Unknown;
    }
    if ratio(lower_starts, letter_starts) >= LOWERCASE_RATIO {
        Casing::Lowercase
    } else {
        Casing::SentenceCase
    }
}

/// Words in a message — whitespace-split, non-empty tokens.
fn word_count(m: &str) -> usize {
    m.split_whitespace().filter(|w| !w.is_empty()).count()
}

/// `numerator / denominator` as an f32, 0.0 when the denominator is 0 (so an
/// empty corpus never panics and never trips a threshold).
fn ratio(numerator: usize, denominator: usize) -> f32 {
    if denominator == 0 {
        return 0.0;
    }
    numerator as f32 / denominator as f32
}

/// Whether `m` contains an emoji (or other pictographic symbol). A conservative
/// range check over the common emoji blocks — enough to spot the *habit* without
/// pulling in a unicode-segmentation dependency.
fn contains_emoji(m: &str) -> bool {
    m.chars().any(|c| {
        matches!(c as u32,
            0x1F300..=0x1FAFF   // symbols & pictographs, emoticons, supplemental, extended-A
            | 0x2600..=0x27BF   // misc symbols + dingbats (☀ ✨ ➡)
            | 0x2190..=0x21FF   // arrows often used decoratively
            | 0xFE00..=0xFE0F   // variation selectors (emoji presentation)
            | 0x1F1E6..=0x1F1FF // regional indicators (flags)
        )
    })
}

/// Common chat shorthand / abbreviations. Matched on whole lowercased word
/// tokens so "u" matches the standalone pronoun but not the "u" inside "but".
/// We only check for *presence of the habit*; the specific tokens are never put
/// into the description (and certainly never any misspelling).
fn contains_slang(m: &str) -> bool {
    const SLANG: &[&str] = &[
        "lol", "lmao", "omg", "idk", "imo", "tbh", "btw", "thx", "pls", "plz", "u", "ur", "ya",
        "yeah", "yep", "nope", "gonna", "wanna", "gotta", "kinda", "dunno", "ok", "okay", "hey",
        "yo", "sup", "rn", "ngl", "fr", "af", "lemme", "gimme",
    ];
    m.split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .any(|t| {
            let lower = t.to_lowercase();
            SLANG.contains(&lower.as_str())
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memory::profile::distill;
    use tempfile::TempDir;

    #[test]
    fn lowercase_terse_emoji_user_is_described_as_such() {
        let msgs = ["ship it 🚀", "yeah lgtm", "can u fix the header", "thx 🙏"];
        let style = analyze_communication_style(&msgs).expect("enough signal");
        assert!(style.contains("lowercase"), "style: {style}");
        assert!(style.contains("terse"), "style: {style}");
        assert!(style.contains("uses emoji"), "style: {style}");
        assert!(style.contains("casual"), "style: {style}");
    }

    #[test]
    fn formal_user_is_described_as_formal_full_sentences() {
        let msgs = [
            "Could you please review the latest changes to the authentication module?",
            "I would prefer that we keep the existing interface contract intact.",
            "Thank you for taking the time to look into this thoroughly.",
        ];
        let style = analyze_communication_style(&msgs).expect("enough signal");
        assert!(style.contains("sentence-case"), "style: {style}");
        assert!(style.contains("full sentences"), "style: {style}");
        assert!(style.contains("formal"), "style: {style}");
        assert!(!style.contains("uses emoji"), "no emoji here: {style}");
        assert!(!style.contains("casual"), "no slang here: {style}");
    }

    #[test]
    fn too_few_messages_yields_none() {
        assert!(analyze_communication_style(&["hey", "yo"]).is_none());
        assert!(analyze_communication_style(&[]).is_none());
        // blank/whitespace-only messages don't count toward the threshold
        assert!(analyze_communication_style(&["  ", "ok", "", "\t"]).is_none());
    }

    #[test]
    fn exclamation_heavy_user_is_flagged() {
        let msgs = ["this is awesome!", "love it!", "let's go!!", "great work!"];
        let style = analyze_communication_style(&msgs).expect("enough signal");
        assert!(style.contains("exclamation-heavy"), "style: {style}");
    }

    #[test]
    fn description_never_echoes_message_content_or_typos() {
        // A misspelling and a unique content word must NOT appear in the register
        // description — we mirror the person, not their typos, and never leak
        // content into the server-readable tier.
        let msgs = [
            "teh authentication is borked rofl",
            "lemme chekc the databse",
            "k thx",
        ];
        let style = analyze_communication_style(&msgs).expect("enough signal");
        for leak in ["teh", "borked", "chekc", "databse", "authentication"] {
            assert!(
                !style.contains(leak),
                "content/typo '{leak}' leaked into style: {style}"
            );
        }
        // it still derived a register (the adjectives), proving we describe, not copy
        assert!(!style.is_empty());
    }

    #[test]
    fn does_not_leak_a_secret_phrase_into_the_description() {
        let msgs = [
            "my password is hunter2",
            "the api key is sk-abc123",
            "anyway ship it",
        ];
        let style = analyze_communication_style(&msgs).expect("enough signal");
        assert!(!style.contains("hunter2"), "secret leaked: {style}");
        assert!(!style.contains("sk-abc123"), "secret leaked: {style}");
        assert!(!style.contains("password"), "secret word leaked: {style}");
    }

    #[test]
    fn style_observation_is_a_well_formed_communication_style_record() {
        let o = style_observation("lowercase, terse, uses emoji", 1_234);
        assert_eq!(o.kind, COMMUNICATION_STYLE_KIND);
        assert_eq!(o.ts_ms, 1_234);
        assert_eq!(o.body, "lowercase, terse, uses emoji");
        assert!(o.workspace_hash.is_empty(), "style is global, not scoped");
    }

    fn open_temp() -> (TempDir, MemoryStore) {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("memory.json");
        let store = MemoryStore::open_at(path).unwrap();
        (dir, store)
    }

    #[test]
    fn recorded_style_flows_through_distill_to_the_profile() {
        let (dir, mut store) = open_temp();
        let ws = dir.path();
        let recorded = record_communication_style(
            &mut store,
            ws,
            &["ship it 🚀", "yeah lgtm", "can u fix the header", "thx 🙏"],
        )
        .unwrap()
        .expect("enough signal to record");

        // The recorded observation must distill straight into the profile facet
        // (the exact path the persona render reads).
        let now = 9_999_999_999;
        let profile = distill(&store.snapshot(), now);
        assert_eq!(
            profile.communication_style.as_deref(),
            Some(recorded.as_str()),
            "the learned style must populate Profile.communication_style"
        );
    }

    #[test]
    fn re_running_updates_the_learned_style_newest_wins() {
        let (dir, mut store) = open_temp();
        let ws = dir.path();
        // First the user writes formally…
        record_communication_style(
            &mut store,
            ws,
            &[
                "Could you please review the changes?",
                "I would prefer the existing contract.",
                "Thank you for your time.",
            ],
        )
        .unwrap()
        .expect("first style recorded");
        // …later they loosen up.
        let casual =
            record_communication_style(&mut store, ws, &["yo ship it 🚀", "lgtm tbh", "thx 🙏"])
                .unwrap()
                .expect("second style recorded");

        let profile = distill(&store.snapshot(), 9_999_999_999);
        assert_eq!(
            profile.communication_style.as_deref(),
            Some(casual.as_str()),
            "newest observation wins — distill takes the latest style"
        );
        assert!(
            casual.contains("uses emoji"),
            "latest is the casual one: {casual}"
        );
    }

    #[test]
    fn too_little_signal_records_nothing() {
        let (dir, mut store) = open_temp();
        let ws = dir.path();
        let out = record_communication_style(&mut store, ws, &["hey", "yo"]).unwrap();
        assert!(out.is_none(), "no style learned");
        assert!(
            store.snapshot().is_empty(),
            "nothing should be written when there's too little signal"
        );
    }
}
