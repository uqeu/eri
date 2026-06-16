//! The **Recall** remote turn (architecture review candidate A).
//!
//! Deep memory is Tier-B — E2E-encrypted with `K_user`, readable only on the
//! user's computer (ADR-0001). So when phone eri needs to *look something up*,
//! it dispatches a `recall` command to the computer (the same queue as control),
//! and this module answers it: open the local store, run real recall (hybrid or
//! bi-temporal point-in-time), and return the formatted memories as the text
//! relayed back to the phone.
//!
//! This is the terminal adapter the relay was missing: a recall command is NOT
//! handed to the control/actuation agent (which has only computer tools and would
//! flail), it runs a pure recall here — cheaper, deterministic, and with no
//! control gate or risky-action surface.

use serde::Deserialize;

use eri_inference::memory::{MemoryStore, Observation};

use crate::config;

/// The structured payload of a `recall` command (the queue `goal` for kind
/// `recall` is this JSON, not prose — the cloud builds it from the tool input).
#[derive(Debug, Deserialize)]
pub struct RecallSpec {
    pub query: String,
    /// Optional natural-language time scope ("last month", "3 days ago"). Mapped
    /// to a bi-temporal instant via [`parse_relative_ms`]; unparseable → recall
    /// the current belief.
    #[serde(default)]
    pub as_of: Option<String>,
}

const DAY_MS: u64 = 24 * 60 * 60 * 1000;
/// How many memories a phone recall surfaces — a glance, not a dump.
const RECALL_LIMIT: usize = 8;

/// Map a small, unambiguous set of relative time phrases to a unix-ms instant
/// (for bi-temporal `recall_as_of`). Deliberately bounded + deterministic — no
/// calendar library, no weekday math; an unrecognized phrase returns `None` so
/// the caller falls back to current-belief recall rather than guessing a date.
pub fn parse_relative_ms(as_of: &str, now_ms: u64) -> Option<u64> {
    let s = as_of.trim().to_lowercase();
    if s.is_empty() {
        return None;
    }
    let ago = |n: u64, unit: u64| now_ms.saturating_sub(n.saturating_mul(unit));
    match s.as_str() {
        "yesterday" => return Some(ago(1, DAY_MS)),
        "last week" | "a week ago" => return Some(ago(7, DAY_MS)),
        "last month" | "a month ago" => return Some(ago(30, DAY_MS)),
        "last year" | "a year ago" => return Some(ago(365, DAY_MS)),
        _ => {}
    }
    // "N days/weeks/months/years ago"
    let parts: Vec<&str> = s.split_whitespace().collect();
    if parts.len() == 3
        && parts[2] == "ago"
        && let Ok(n) = parts[0].parse::<u64>()
    {
        let unit = match parts[1].trim_end_matches('s') {
            "day" => DAY_MS,
            "week" => 7 * DAY_MS,
            "month" => 30 * DAY_MS,
            "year" => 365 * DAY_MS,
            _ => return None,
        };
        return Some(ago(n, unit));
    }
    None
}

/// Format recalled observations as a short, plain-text answer for the phone.
/// An empty result is an honest "nothing on that" — never a fabricated memory.
/// Pure + tested.
pub fn format_recall(query: &str, hits: &[Observation]) -> String {
    if hits.is_empty() {
        return format!("I don't have anything in memory about \u{201c}{query}\u{201d} yet.");
    }
    let mut out = format!("Here's what I remember about \u{201c}{query}\u{201d}:");
    for o in hits {
        let line = o.body.lines().next().unwrap_or("").trim();
        if !line.is_empty() {
            out.push_str(&format!("\n\u{2022} {line}"));
        }
    }
    out
}

/// Run a recall command end-to-end: parse the spec, open the signed-in user's
/// local store, recall (bi-temporal when a time scope parses, else hybrid), and
/// format. Returns the queue triple `(status, result, confirm_prompt)` like the
/// control path — recall is never risky, so it's always `done`/`error`, never
/// `awaiting_confirm`. Sync (local file IO); called from the async daemon loop.
pub fn run_recall(goal_json: &str, now_ms: u64) -> (&'static str, Option<String>, Option<String>) {
    let spec: RecallSpec = match serde_json::from_str(goal_json) {
        Ok(s) => s,
        Err(_) => {
            return (
                "error",
                Some("that memory lookup was malformed".into()),
                None,
            );
        }
    };
    let user_id = config::load().ok().and_then(|c| c.user_id);
    let mut store = match MemoryStore::open_for(user_id.as_deref()) {
        Ok(s) => s,
        Err(_) => {
            return (
                "error",
                Some("couldn't open your memory store".into()),
                None,
            );
        }
    };
    let ws = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));

    let hits: Vec<Observation> = match spec
        .as_of
        .as_deref()
        .and_then(|a| parse_relative_ms(a, now_ms))
    {
        // A parsed time scope → bi-temporal point-in-time recall ("what was true then").
        Some(as_of_ms) => store.recall_as_of(&spec.query, &ws, RECALL_LIMIT, as_of_ms),
        // No (or unparseable) scope → current-belief hybrid recall, token-
        // budgeted so the phone reply can't balloon as the store grows. The
        // `RECALL_LIMIT` still caps the count after the budget trims by tokens.
        None => store
            .recall_hybrid_with_budget(&spec.query, &ws, crate::memory_tools::RECALL_TOKEN_BUDGET)
            .map(|v| v.into_iter().take(RECALL_LIMIT).map(|(o, _)| o).collect())
            .unwrap_or_default(),
    };
    ("done", Some(format_recall(&spec.query, &hits)), None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use eri_inference::memory::Visibility;

    const NOW: u64 = 1_000_000_000_000;

    #[test]
    fn parses_simple_relative_phrases() {
        assert_eq!(parse_relative_ms("yesterday", NOW), Some(NOW - DAY_MS));
        assert_eq!(parse_relative_ms("last week", NOW), Some(NOW - 7 * DAY_MS));
        assert_eq!(
            parse_relative_ms("last month", NOW),
            Some(NOW - 30 * DAY_MS)
        );
        assert_eq!(
            parse_relative_ms("Last Year", NOW),
            Some(NOW - 365 * DAY_MS)
        );
    }

    #[test]
    fn parses_n_units_ago() {
        assert_eq!(parse_relative_ms("3 days ago", NOW), Some(NOW - 3 * DAY_MS));
        assert_eq!(
            parse_relative_ms("2 weeks ago", NOW),
            Some(NOW - 14 * DAY_MS)
        );
        assert_eq!(
            parse_relative_ms("1 month ago", NOW),
            Some(NOW - 30 * DAY_MS)
        );
    }

    #[test]
    fn unrecognized_scope_returns_none_for_fallback() {
        // Weekdays + vague phrasing aren't dated (no calendar) → None → the caller
        // falls back to current recall rather than inventing an instant.
        assert_eq!(parse_relative_ms("last tuesday", NOW), None);
        assert_eq!(parse_relative_ms("a while back", NOW), None);
        assert_eq!(parse_relative_ms("", NOW), None);
    }

    fn obs(body: &str) -> Observation {
        Observation {
            id: "x".into(),
            ts_ms: 1,
            kind: "fact".into(),
            workspace_hash: String::new(),
            body: body.into(),
            embedding: Vec::new(),
            valid_from: None,
            visibility: Visibility::Active,
        }
    }

    #[test]
    fn format_recall_lists_memories() {
        let out = format_recall(
            "the deal",
            &[obs("closed the Henderson deal"), obs("price was 40k")],
        );
        assert!(out.contains("Here's what I remember"));
        assert!(out.contains("Henderson deal"));
        assert!(out.contains("40k"));
    }

    #[test]
    fn format_recall_empty_is_honest_not_fabricated() {
        let out = format_recall("unicorns", &[]);
        assert!(out.contains("don't have anything"));
        assert!(out.contains("unicorns"));
    }

    #[test]
    fn run_recall_rejects_malformed_json() {
        let (status, result, _) = run_recall("not json", NOW);
        assert_eq!(status, "error");
        assert!(result.unwrap().contains("malformed"));
    }
}
