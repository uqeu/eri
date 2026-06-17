//! Tier-A personalization profile — the small, **server-readable** projection of
//! the user's memory that phone eri injects to sound like the user's eri
//! (ADR-0001). It is a *projection*, never the raw observation log or secrets:
//!
//!   - **static** — durable facts (`/remember`) + behaviour rollups (the "who you
//!     are" that rarely changes), and
//!   - **dynamic** — a live temporal slice ("today you did X"), the bi-temporal
//!     "now" that keeps phone eri current.
//!
//! Pure + deterministic (`now_ms` is injected, not read), so it's fully testable
//! and cheap to recompute. The sync layer (`memory::sync`) is what encrypts it
//! with `K_server` and uploads it; a Claude sensitivity pass gates what reaches
//! it. Bounded in size so the injected context never bloats the prompt.

use serde::{Deserialize, Serialize};

use crate::memory::Observation;
use crate::memory::consolidation::SEMANTIC_KIND;

/// Hard caps so the whole profile stays small (~≤32KB target) — phone eri
/// injects this verbatim, so it must never balloon the token budget.
const MAX_FACTS: usize = 50;
const MAX_FACT_CHARS: usize = 280;
const MAX_DYNAMIC_ITEMS: usize = 12;
const MAX_DYNAMIC_CHARS: usize = 1_200;
const DAY_MS: u64 = 24 * 60 * 60 * 1000;

/// The Tier-A profile. Serializable so it round-trips through the cloud
/// `personalization_profiles` store.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Profile {
    /// Durable, user-authored facts (`/remember`) — the stable "who you are".
    pub facts: Vec<String>,
    /// Behaviour rollups learned from outcomes ("accepts most edits").
    pub preferences: Vec<String>,
    /// The live temporal slice — "today you did X". Refreshed each distill.
    pub dynamic_context: String,
    /// Learned description of how this user writes — casing, brevity, emoji,
    /// slang, warmth. Injected so eri mirrors *their* register (the "responds
    /// like them" half of the human-voice persona). Newest observation wins.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub communication_style: Option<String>,
}

impl Profile {
    pub fn is_empty(&self) -> bool {
        self.facts.is_empty()
            && self.preferences.is_empty()
            && self.dynamic_context.is_empty()
            && self.communication_style.is_none()
    }
}

/// Build the Tier-A profile from the visible observations. Pure: pass `now_ms`
/// (the bi-temporal "now") so "today" is deterministic. Caps every section.
pub fn distill(observations: &[Observation], now_ms: u64) -> Profile {
    Profile {
        facts: distill_facts(observations),
        preferences: distill_preferences(observations),
        dynamic_context: distill_dynamic_context(observations, now_ms),
        communication_style: distill_communication_style(observations),
    }
}

/// The user's writing register — the single newest `communication_style`
/// observation (the learn-loop rewrites it as it observes more), trimmed and
/// capped. Returns `None` until eri has learned a style, so the persona simply
/// falls back to mirroring in-context. Sensitivity-screened like every other
/// section that reaches the server-readable Tier-A profile.
fn distill_communication_style(observations: &[Observation]) -> Option<String> {
    observations
        .iter()
        .rev()
        .filter(|o| o.kind == "communication_style" && !looks_sensitive(&o.body))
        .map(|o| truncate(o.body.trim(), MAX_FACT_CHARS))
        .find(|s| !s.is_empty())
}

/// Durable facts — newest first, deduped, capped, **sensitivity-screened**.
fn distill_facts(observations: &[Observation]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut facts: Vec<String> = Vec::new();
    // newest first so the cap keeps the most recent facts
    for o in observations.iter().rev() {
        if o.kind != "fact" {
            continue;
        }
        // Tier-A is server-readable, so a fact like "my password is …" must
        // never reach it. The ADR's full gate is a Claude sensitivity pass; this
        // keyword screen is the always-on Phase-0 floor beneath it (security: L-1).
        if looks_sensitive(&o.body) {
            continue;
        }
        let text = truncate(o.body.trim(), MAX_FACT_CHARS);
        if text.is_empty() || !seen.insert(text.clone()) {
            continue;
        }
        facts.push(text);
        if facts.len() >= MAX_FACTS {
            break;
        }
    }
    facts
}

/// Conservative keyword screen for secrets that must never enter the
/// server-readable Tier-A profile. Deliberately broad (a false positive just
/// keeps a fact local); the Claude sensitivity pass is the precise gate above it.
fn looks_sensitive(text: &str) -> bool {
    const NEEDLES: &[&str] = &[
        "password",
        "passphrase",
        "secret",
        "api key",
        "api_key",
        "apikey",
        "access token",
        "access_token",
        "private key",
        "private_key",
        "credit card",
        "card number",
        "cvv",
        "ssn",
        "social security",
        "routing number",
        "account number",
        "seed phrase",
        "mnemonic",
        "eri_sk_",
    ];
    let hay = text.to_lowercase();
    NEEDLES.iter().any(|n| hay.contains(n))
}

/// Behaviour rollups: the accept/reject ratio on edits, plus the durable
/// `semantic` patterns distilled by consolidation ("Frequently accepts edits in
/// `src/components`"). Extensible: new observation kinds become new rollups
/// without touching callers.
fn distill_preferences(observations: &[Observation]) -> Vec<String> {
    let mut prefs = Vec::new();

    let accepted = observations
        .iter()
        .filter(|o| o.kind == "edit_accepted")
        .count();
    let rejected = observations
        .iter()
        .filter(|o| o.kind == "edit_rejected")
        .count();
    let total = accepted + rejected;
    // checked_div yields None when there are no edits yet — no preference to state.
    if let Some(pct) = (accepted * 100).checked_div(total) {
        prefs.push(format!(
            "Accepts {pct}% of eri's edits ({accepted} of {total} recent)"
        ));
    }

    // Consolidated semantic rollups, newest first, deduped + capped so the
    // server-readable profile stays small.
    let mut seen = std::collections::HashSet::new();
    for o in observations.iter().rev() {
        if o.kind != SEMANTIC_KIND || looks_sensitive(&o.body) {
            continue;
        }
        let text = truncate(o.body.trim(), MAX_FACT_CHARS);
        if text.is_empty() || !seen.insert(text.clone()) {
            continue;
        }
        prefs.push(text);
        if prefs.len() >= MAX_FACTS {
            break;
        }
    }

    prefs
}

/// The live "today" slice — recent (≤24h) non-fact activity, newest first,
/// capped in count + chars so it stays a glance, not a log.
fn distill_dynamic_context(observations: &[Observation], now_ms: u64) -> String {
    let cutoff = now_ms.saturating_sub(DAY_MS);
    let recent: Vec<String> = observations
        .iter()
        .rev()
        // Durable kinds (facts + consolidated rollups) belong in the static
        // sections, not "today"; dynamic context is live episodic activity.
        .filter(|o| o.ts_ms >= cutoff && o.kind != "fact" && o.kind != SEMANTIC_KIND)
        .take(MAX_DYNAMIC_ITEMS)
        .map(|o| truncate(o.body.trim(), 100))
        .filter(|s| !s.is_empty())
        .collect();
    if recent.is_empty() {
        return String::new();
    }
    truncate(&format!("Today: {}", recent.join("; ")), MAX_DYNAMIC_CHARS)
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let head: String = s.chars().take(max.saturating_sub(1)).collect();
    format!("{}…", head.trim_end())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memory::Visibility;

    fn o(kind: &str, ts_ms: u64, body: &str) -> Observation {
        Observation {
            id: format!("{kind}-{ts_ms}"),
            ts_ms,
            kind: kind.to_string(),
            workspace_hash: String::new(),
            body: body.to_string(),
            embedding: Vec::new(),
            valid_from: None,
            visibility: Visibility::Active,
            ..Default::default()
        }
    }

    const NOW: u64 = 1_000_000_000_000;

    #[test]
    fn distills_durable_facts_newest_first_deduped() {
        let obs = vec![
            o("fact", 10, "name is Khai"),
            o("fact", 20, "building eri"),
            o("fact", 30, "building eri"), // dup
            o("edit_accepted", 40, "header.tsx"),
        ];
        let p = distill(&obs, NOW);
        assert_eq!(p.facts, vec!["building eri", "name is Khai"]); // newest first, deduped
    }

    #[test]
    fn rolls_up_edit_preferences() {
        let obs = vec![
            o("edit_accepted", 1, "a"),
            o("edit_accepted", 2, "b"),
            o("edit_accepted", 3, "c"),
            o("edit_rejected", 4, "d"),
        ];
        let p = distill(&obs, NOW);
        assert_eq!(
            p.preferences,
            vec!["Accepts 75% of eri's edits (3 of 4 recent)"]
        );
    }

    #[test]
    fn dynamic_context_is_todays_activity_and_excludes_old_and_facts() {
        let obs = vec![
            o("fact", NOW, "a durable fact"),                  // facts excluded
            o("control_turn", NOW - 2 * DAY_MS, "old action"), // too old
            o("control_turn", NOW - 1000, "opened Safari"),    // today
            o("edit_accepted", NOW - 500, "header.tsx"),       // today
        ];
        let dc = distill(&obs, NOW).dynamic_context;
        assert!(dc.starts_with("Today:"));
        assert!(dc.contains("opened Safari"));
        assert!(dc.contains("header.tsx"));
        assert!(!dc.contains("old action"));
        assert!(!dc.contains("durable fact"));
    }

    #[test]
    fn sensitive_facts_are_screened_out_of_the_server_readable_tier() {
        let obs = vec![
            o("fact", 10, "name is Khai"),
            o("fact", 20, "my password is hunter2"),
            o("fact", 30, "my OpenAI api key is sk-abc"),
            o("fact", 40, "prefers dark mode"),
        ];
        let p = distill(&obs, NOW);
        assert!(p.facts.contains(&"name is Khai".to_string()));
        assert!(p.facts.contains(&"prefers dark mode".to_string()));
        assert!(
            !p.facts
                .iter()
                .any(|f| f.contains("hunter2") || f.contains("api key")),
            "secrets must never reach Tier-A; got {:?}",
            p.facts
        );
    }

    #[test]
    fn semantic_rollups_become_preferences_not_todays_activity() {
        let obs = vec![
            o("edit_accepted", NOW - 100, "header.tsx"),
            o(
                SEMANTIC_KIND,
                NOW - 50,
                "Frequently accepts edits in `src/components` (5×)",
            ),
        ];
        let p = distill(&obs, NOW);
        assert!(
            p.preferences
                .iter()
                .any(|pref| pref.contains("Frequently accepts edits")),
            "the rollup is a durable preference; got {:?}",
            p.preferences
        );
        assert!(
            !p.dynamic_context.contains("Frequently accepts"),
            "a durable rollup must not leak into today's activity; got {}",
            p.dynamic_context
        );
    }

    #[test]
    fn communication_style_takes_the_newest_observation() {
        let obs = vec![
            o("communication_style", 10, "formal, full sentences"),
            o("communication_style", 20, "lowercase, terse, uses emoji"),
            o("fact", 30, "name is Khai"),
        ];
        let p = distill(&obs, NOW);
        // newest wins; it is NOT mixed into facts or today's activity
        assert_eq!(
            p.communication_style.as_deref(),
            Some("lowercase, terse, uses emoji")
        );
        assert!(!p.facts.iter().any(|f| f.contains("emoji")));
        assert!(!p.dynamic_context.contains("emoji"));
    }

    #[test]
    fn communication_style_is_absent_until_learned_and_screened() {
        // none observed -> None (persona falls back to in-context mirroring)
        assert!(
            distill(&[o("fact", 1, "x")], NOW)
                .communication_style
                .is_none()
        );
        // a style note that somehow carries a secret is screened out like any
        // other section reaching the server-readable tier
        let leaky = vec![o(
            "communication_style",
            5,
            "casual; my password is hunter2",
        )];
        assert!(distill(&leaky, NOW).communication_style.is_none());
    }

    #[test]
    fn empty_observations_yield_an_empty_profile() {
        let p = distill(&[], NOW);
        assert!(p.is_empty());
    }

    #[test]
    fn facts_are_capped_to_stay_small() {
        let obs: Vec<Observation> = (0..MAX_FACTS + 20)
            .map(|i| o("fact", i as u64, &format!("fact number {i}")))
            .collect();
        let p = distill(&obs, NOW);
        assert_eq!(p.facts.len(), MAX_FACTS);
    }
}
