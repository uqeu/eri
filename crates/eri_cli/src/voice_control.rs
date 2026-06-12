//! Voice → computer-control routing.
//!
//! Capture + transcription already exist (eri_voice's whisper pipeline and the
//! macOS app's speech recognizer). The missing piece for *hands-free control* is
//! the bit in between: a transcript arrives — is it a wake, a stop, a goal to
//! actuate, or just noise? — and, after eri acts, a reply short enough to speak
//! back. Both are pure + tested here; the audio I/O wires around them.
//!
//! Safety-first ordering: a retraction ("stop", "never mind") is recognised
//! BEFORE anything else, so the voice path can never keep pursuing something the
//! user just took back — the same boundary [`crate::control_safety`] enforces
//! for typed goals.

/// What a spoken utterance resolved to.
#[derive(Clone, Debug, PartialEq)]
pub enum VoiceIntent {
    /// A bare wake phrase ("hey eri") — acknowledge + listen, no goal yet.
    Wake,
    /// A retraction ("stop", "never mind") — cancel whatever's in flight.
    Stop,
    /// A goal to drive the computer toward (wake prefix already stripped).
    Control(String),
    /// Nothing actionable (empty, a single stray word, a known mis-hear).
    /// Carries a short reason for logs.
    Ignore(&'static str),
}

/// Leading wake phrases eri strips before treating the rest as a command.
const WAKE_PREFIXES: &[&str] = &["hey eri", "ok eri", "okay eri", "hi eri", "eri"];

/// Route a transcript to a [`VoiceIntent`]. Order is deliberate: empty → stop →
/// wake(+command) → command → ignore-noise.
pub fn classify_utterance(transcript: &str) -> VoiceIntent {
    let trimmed = transcript.trim();
    if trimmed.is_empty() {
        return VoiceIntent::Ignore("empty");
    }
    // Retraction wins over everything (safety boundary).
    if crate::control_safety::is_cancellation(trimmed) {
        return VoiceIntent::Stop;
    }
    let lower = trimmed.to_lowercase();
    if let Some(rest) = strip_wake_prefix(&lower) {
        let rest = rest.trim();
        if rest.is_empty() {
            return VoiceIntent::Wake;
        }
        // Re-derive the command span from the ORIGINAL casing so app/file names
        // survive ("hey eri Open Spotify" → "Open Spotify").
        let start = trimmed.len() - rest.len();
        return VoiceIntent::Control(trimmed[start..].trim().to_string());
    }
    // No wake word: a lone word is almost always a mis-hear, not a command.
    if trimmed.split_whitespace().count() < 2 {
        return VoiceIntent::Ignore("too short to be a command");
    }
    VoiceIntent::Control(trimmed.to_string())
}

/// If `lower` starts with a wake phrase (optionally followed by a comma), return
/// the remainder; else `None`. Longest prefix first so "okay eri" beats "eri".
fn strip_wake_prefix(lower: &str) -> Option<&str> {
    let mut best: Option<&str> = None;
    for w in WAKE_PREFIXES {
        if let Some(rest) = lower.strip_prefix(w) {
            // The wake word must be a whole token, not a prefix of one
            // ("erica" is not "eri").
            if rest.is_empty() || rest.starts_with([' ', ',']) {
                let rest = rest.trim_start_matches([' ', ',']);
                if best.is_none_or(|b| rest.len() < b.len()) {
                    best = Some(rest);
                }
            }
        }
    }
    best
}

/// Condense eri's (possibly markdown-y, multi-line) control summary into one
/// short line suitable for text-to-speech: strip markdown + emoji noise,
/// collapse whitespace, keep the first sentence, cap the length.
pub fn spoken_reply(summary: &str) -> String {
    let cleaned: String = summary
        .chars()
        .filter(|c| !is_markdown_or_emoji_noise(*c))
        .collect();
    // Collapse whitespace/newlines into single spaces.
    let flat = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    // First sentence (up to . ! ? or newline).
    let first = flat
        .split(['.', '!', '?'])
        .find(|s| !s.trim().is_empty())
        .unwrap_or(&flat)
        .trim()
        .to_string();
    cap_chars(&first, 160)
}

fn is_markdown_or_emoji_noise(c: char) -> bool {
    matches!(c, '*' | '#' | '`' | '_' | '>' | '|') || (c as u32) >= 0x1F000
}

fn cap_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let head: String = s.chars().take(max.saturating_sub(1)).collect();
    format!("{}…", head.trim_end())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bare_wake_word_just_wakes() {
        assert_eq!(classify_utterance("hey eri"), VoiceIntent::Wake);
        assert_eq!(classify_utterance("Eri"), VoiceIntent::Wake);
    }

    #[test]
    fn wake_plus_command_strips_the_wake_and_keeps_original_casing() {
        assert_eq!(
            classify_utterance("hey eri, open Spotify"),
            VoiceIntent::Control("open Spotify".to_string())
        );
        assert_eq!(
            classify_utterance("okay eri quit Cursor"),
            VoiceIntent::Control("quit Cursor".to_string())
        );
    }

    #[test]
    fn a_retraction_is_stop_even_with_a_wake_word() {
        assert_eq!(classify_utterance("stop"), VoiceIntent::Stop);
        assert_eq!(classify_utterance("no, never mind"), VoiceIntent::Stop);
    }

    #[test]
    fn a_plain_command_without_a_wake_word_still_routes_to_control() {
        // Continuous-listening mode: no wake word needed every utterance.
        assert_eq!(
            classify_utterance("open my calendar"),
            VoiceIntent::Control("open my calendar".to_string())
        );
    }

    #[test]
    fn lone_words_and_empties_are_ignored_as_noise() {
        assert!(matches!(classify_utterance(""), VoiceIntent::Ignore(_)));
        assert!(matches!(classify_utterance("   "), VoiceIntent::Ignore(_)));
        assert!(matches!(classify_utterance("um"), VoiceIntent::Ignore(_)));
    }

    #[test]
    fn wake_word_is_a_whole_token_not_a_prefix() {
        // "erica" must NOT be treated as the wake word "eri".
        assert_eq!(
            classify_utterance("erica said hi"),
            VoiceIntent::Control("erica said hi".to_string())
        );
    }

    #[test]
    fn spoken_reply_condenses_markdown_into_one_speakable_line() {
        let summary = "**Done!** I opened Safari.\n\n- searched lofi\n- played the first result 🎶";
        let spoken = spoken_reply(summary);
        assert!(!spoken.contains('*'));
        assert!(!spoken.contains('#'));
        assert!(!spoken.contains('🎶'));
        assert_eq!(spoken, "Done");
    }

    #[test]
    fn spoken_reply_caps_a_very_long_summary() {
        let long = "a ".repeat(200);
        let spoken = spoken_reply(&long);
        assert!(spoken.chars().count() <= 160);
    }
}
