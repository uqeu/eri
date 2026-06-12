//! Proactive layer — eri's "learns about you" moat.
//!
//! Cursor/ChatGPT wait to be asked. eri's edge is *anticipation*: from the trail
//! of what you've actually done (the [`crate::action_log`] history + remembered
//! goals), surface what you'll likely want next — before you ask.
//!
//! Two signals, both pure + testable:
//!   - **Sequential** — "after X, you usually do Y" (the strongest signal).
//!   - **Frequency** — "you often do X" (the fallback when there's no context).
//!
//! The hard part of a proactive feature isn't finding patterns — it's *not being
//! annoying*. So suggestions are gated on BOTH a minimum number of observations
//! (don't nudge on a coincidence) and a confidence floor (don't nudge on a
//! coin-flip). Below either bar, eri stays quiet.

use std::collections::HashMap;

/// A confidence floor below which eri keeps quiet (a suggestion must be more
/// likely than not to be worth interrupting for).
pub const MIN_CONFIDENCE: f32 = 0.5;
/// Minimum times a pattern must have been seen before eri trusts it.
pub const MIN_OBSERVATIONS: usize = 2;

/// Something eri proactively offers, with why + how sure it is.
#[derive(Clone, Debug, PartialEq)]
pub struct Suggestion {
    /// What eri offers to do, phrased as the recorded action ("open Spotify").
    pub action: String,
    /// Plain-language justification ("you usually do this after …").
    pub reason: String,
    /// 0.0–1.0 — how often this followed the trigger / dominated the history.
    pub confidence: f32,
}

/// "After `current`, you usually do X." Counts the successors of `current` in the
/// ordered `history` and returns the dominant one — `None` if `current` was seen
/// followed by something too few times to trust.
pub fn suggest_after(history: &[String], current: &str, min_observations: usize) -> Option<Suggestion> {
    let mut successors: HashMap<&str, usize> = HashMap::new();
    for pair in history.windows(2) {
        if pair[0] == current {
            *successors.entry(pair[1].as_str()).or_insert(0) += 1;
        }
    }
    let total: usize = successors.values().sum();
    if total < min_observations {
        return None;
    }
    let (best, count) = successors.into_iter().max_by_key(|&(_, c)| c)?;
    let confidence = count as f32 / total as f32;
    Some(Suggestion {
        action: best.to_string(),
        reason: format!("you usually do this after \"{current}\" ({count}/{total} times)"),
        confidence,
    })
}

/// "You often do X." The most frequent entry in `history`, if it recurs at least
/// `min_count` times — `None` otherwise (a one-off isn't a pattern).
pub fn most_common(history: &[String], min_count: usize) -> Option<Suggestion> {
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for item in history {
        *counts.entry(item.as_str()).or_insert(0) += 1;
    }
    let total = history.len();
    let (best, count) = counts.into_iter().max_by_key(|&(_, c)| c)?;
    if count < min_count {
        return None;
    }
    let confidence = if total == 0 { 0.0 } else { count as f32 / total as f32 };
    Some(Suggestion {
        action: best.to_string(),
        reason: format!("you do this often ({count} of your last {total} actions)"),
        confidence,
    })
}

/// The best proactive suggestion eri is willing to make right now: the sequential
/// pattern after `current` if one clears both bars, else the frequency pattern,
/// else `None` (stay quiet). Never suggests repeating `current` itself.
pub fn proactive_suggestion(history: &[String], current: Option<&str>) -> Option<Suggestion> {
    if let Some(cur) = current
        && let Some(s) = suggest_after(history, cur, MIN_OBSERVATIONS)
        && s.confidence >= MIN_CONFIDENCE
        && s.action != cur
    {
        return Some(s);
    }
    most_common(history, MIN_OBSERVATIONS)
        .filter(|s| s.confidence >= MIN_CONFIDENCE && Some(s.action.as_str()) != current)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn h(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn suggest_after_finds_the_dominant_successor() {
        // After "open Cursor" the user opened Spotify twice, Slack once.
        let history = h(&[
            "open Cursor", "open Spotify",
            "open Cursor", "open Spotify",
            "open Cursor", "open Slack",
        ]);
        let s = suggest_after(&history, "open Cursor", MIN_OBSERVATIONS).unwrap();
        assert_eq!(s.action, "open Spotify");
        assert!((s.confidence - 2.0 / 3.0).abs() < 1e-6);
        assert!(s.reason.contains("after \"open Cursor\""));
    }

    #[test]
    fn suggest_after_stays_quiet_below_the_observation_floor() {
        // "open Cursor" → "open Spotify" happened only once: a coincidence.
        let history = h(&["open Cursor", "open Spotify"]);
        assert!(suggest_after(&history, "open Cursor", MIN_OBSERVATIONS).is_none());
    }

    #[test]
    fn most_common_finds_the_recurring_action() {
        let history = h(&["open Mail", "open Mail", "open Mail", "open Notes"]);
        let s = most_common(&history, MIN_OBSERVATIONS).unwrap();
        assert_eq!(s.action, "open Mail");
        assert!((s.confidence - 0.75).abs() < 1e-6);
    }

    #[test]
    fn most_common_ignores_one_offs() {
        let history = h(&["open Mail", "open Notes", "open Slack"]);
        assert!(most_common(&history, MIN_OBSERVATIONS).is_none());
    }

    #[test]
    fn proactive_prefers_a_confident_sequential_pattern() {
        let history = h(&[
            "open Cursor", "open Spotify",
            "open Cursor", "open Spotify",
        ]);
        let s = proactive_suggestion(&history, Some("open Cursor")).unwrap();
        assert_eq!(s.action, "open Spotify");
        assert!(s.confidence >= MIN_CONFIDENCE);
    }

    #[test]
    fn proactive_falls_back_to_frequency_without_a_confident_sequence() {
        // No strong successor of the current action, but a clear overall habit.
        let history = h(&["open Mail", "open Mail", "open Mail", "open Notes"]);
        let s = proactive_suggestion(&history, Some("something novel")).unwrap();
        assert_eq!(s.action, "open Mail");
    }

    #[test]
    fn proactive_stays_quiet_when_nothing_clears_the_bar() {
        // All distinct one-offs → no pattern worth interrupting for.
        let history = h(&["open A", "open B", "open C", "open D"]);
        assert!(proactive_suggestion(&history, Some("open A")).is_none());
    }

    #[test]
    fn proactive_never_suggests_repeating_the_current_action() {
        // The user just opened Spotify and usually... opens Spotify again in this
        // history — don't suggest the thing they just did.
        let history = h(&["open Spotify", "open Spotify", "open Spotify"]);
        assert!(proactive_suggestion(&history, Some("open Spotify")).is_none());
    }
}
