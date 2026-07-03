//! The ingest privacy PRECISION pass (ADR-0012 + ADR-0010 §5) — the Claude
//! "exclude if unsure" gate ABOVE the deterministic keyword floor.
//!
//! Auto-indexed observations must clear BOTH screens: the keyword floor
//! (`profile::looks_sensitive`, fast + deterministic, in `eri_inference`) AND this
//! pass. It exists because the keyword list is a FLOOR, not exhaustive — real inbox
//! phrasing ("Interac e-Transfer $1,500 deposited", a health note) slips it. This
//! pass is the launch gate for indexing real inboxes.
//!
//! It is **FAIL-CLOSED**: anything the screen can't confidently clear — an error, a
//! malformed reply, a wrong-length reply, an over-quota deferral, or a literal
//! "unsure" — is treated as SENSITIVE and DROPPED. You cannot leak what you never
//! ingest.

use anyhow::Result;

/// Cheap/fast — a binary SAFE/SENSITIVE classification, not generation.
const SCREEN_MODEL: &str = "claude-haiku-4-5-20251001";
/// Generous so a full page of verdicts is never truncated — a cut-off array parses
/// as wrong-length and (fail-closed) drops the whole page, so this must fit
/// `page_size` verdicts with margin (~8 tokens each).
const SCREEN_MAX_TOKENS: u32 = 2048;

/// A privacy screen over observation texts. `screen(texts)` returns one keep-flag per
/// text, in order: `true` = SAFE to keep, `false` = DROP (sensitive OR unsure). A
/// seam so the fail-closed policy is testable with a mock (prod =
/// [`ClaudeSensitivityScreen`]).
#[async_trait::async_trait]
pub trait SensitivityScreen: Send + Sync {
    async fn screen(&self, texts: &[&str]) -> Result<Vec<bool>>;
}

/// The classification instruction — exclude-if-unsure, JSON-array output.
fn screen_system_prompt() -> &'static str {
    "You are eri's privacy screen for a personal AI assistant. You will receive a \
     numbered list of short observations drawn from someone's email and calendar. For \
     EACH observation, decide whether it contains or references SENSITIVE personal \
     information — any of:\n\
     - credentials or secrets (passwords, API keys, tokens, 2FA codes)\n\
     - financial (money amounts, transactions, transfers, balances, banking, invoices, \
     salary, investments, account or card numbers)\n\
     - health or medical (conditions, diagnoses, medications, appointments, results)\n\
     - intimate or sexual\n\
     When in doubt, answer SENSITIVE (exclude if unsure). Respond with ONLY a JSON \
     object mapping each observation's number (as a STRING key) to its verdict \
     (\"SAFE\" or \"SENSITIVE\") — e.g. {\"1\":\"SAFE\",\"2\":\"SENSITIVE\"}. Include \
     EVERY number from 1 to the count. No prose, no fences."
}

/// The numbered observations as the user message (1-based, matching the reply order).
fn screen_user_message(texts: &[&str]) -> String {
    let mut s = String::new();
    for (i, t) in texts.iter().enumerate() {
        s.push_str(&format!("{}. {}\n", i + 1, t.trim()));
    }
    s
}

/// Parse the model's index-keyed reply into per-text keep flags. **FAIL-CLOSED** and
/// index-keyed so a miscount can never misalign: each observation `i` (1-based) is
/// KEPT only if its own key maps to a case-insensitive `"safe"`. A missing key, any
/// other verdict, or an unparseable reply → DROP (`false`). So a model that omits or
/// mangles a few keys drops exactly those, never the whole page.
fn parse_verdicts(reply: &str, n: usize) -> Vec<bool> {
    use std::collections::HashMap;
    // Robust to ```json fences / stray prose — extract the JSON object.
    let obj = match (reply.find('{'), reply.rfind('}')) {
        (Some(a), Some(b)) if b > a => &reply[a..=b],
        _ => return vec![false; n],
    };
    let Ok(map) = serde_json::from_str::<HashMap<String, String>>(obj) else {
        return vec![false; n];
    };
    (1..=n)
        .map(|i| {
            map.get(&i.to_string())
                .is_some_and(|v| v.trim().eq_ignore_ascii_case("safe"))
        })
        .collect()
}

/// Production screen: one batched Claude call per page via the shared inference seam.
pub struct ClaudeSensitivityScreen;

#[async_trait::async_trait]
impl SensitivityScreen for ClaudeSensitivityScreen {
    async fn screen(&self, texts: &[&str]) -> Result<Vec<bool>> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }
        let system = screen_system_prompt();
        let user = screen_user_message(texts);
        // Over quota (None) → FAIL-CLOSED: we can't screen, so we keep nothing.
        match crate::inference::call(SCREEN_MODEL, SCREEN_MAX_TOKENS, system, &user).await? {
            Some(reply) => {
                let keep = parse_verdicts(&reply, texts.len());
                if std::env::var("ERI_DEBUG").is_ok() {
                    let kept = keep.iter().filter(|k| **k).count();
                    eprintln!(
                        "eri: privacy screen — batch {} · kept {} · dropped {}",
                        texts.len(),
                        kept,
                        texts.len() - kept
                    );
                }
                Ok(keep)
            }
            None => Ok(vec![false; texts.len()]),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_well_formed_reply_maps_safe_to_keep_sensitive_to_drop() {
        let keep = parse_verdicts(r#"{"1":"SAFE","2":"SENSITIVE","3":"safe"}"#, 3);
        assert_eq!(keep, vec![true, false, true]);
    }

    #[test]
    fn a_missing_key_drops_only_that_item_not_the_whole_page() {
        // The model omitted key "2" (a real miscount) — index-keyed, so ONLY item 2
        // fails closed; items 1 and 3 are still classified. This is why the page
        // isn't lost to a single miscount (the bug the positional array had).
        let keep = parse_verdicts(r#"{"1":"SAFE","3":"SAFE"}"#, 3);
        assert_eq!(keep, vec![true, false, true]);
    }

    #[test]
    fn a_malformed_reply_fails_closed() {
        assert_eq!(parse_verdicts("not json at all", 2), vec![false; 2]);
        assert_eq!(parse_verdicts("", 2), vec![false; 2]);
    }

    #[test]
    fn a_fenced_or_prose_wrapped_object_is_still_parsed() {
        // haiku wraps the object in a ```json fence despite the instruction — the
        // brace-extraction handles it.
        assert_eq!(
            parse_verdicts("```json\n{\"1\":\"SAFE\",\"2\":\"SENSITIVE\"}\n```", 2),
            vec![true, false]
        );
    }

    #[test]
    fn anything_that_is_not_exactly_safe_is_dropped() {
        // "unsure", empty, missing, or any non-SAFE token → drop (exclude if unsure).
        let keep = parse_verdicts(r#"{"1":"unsure","2":"","3":"SAFE"}"#, 4);
        assert_eq!(keep, vec![false, false, true, false]);
    }

    #[test]
    fn the_user_message_numbers_observations_in_order() {
        let m = screen_user_message(&["email from a", "lunch with b"]);
        assert_eq!(m, "1. email from a\n2. lunch with b\n");
    }
}
