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
const SCREEN_MAX_TOKENS: u32 = 512;

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
     Answer SAFE or SENSITIVE for each, in order. When in doubt, answer SENSITIVE \
     (exclude if unsure). Respond with ONLY a JSON array of strings, exactly one per \
     observation in order, each either \"SAFE\" or \"SENSITIVE\". No prose, no fences."
}

/// The numbered observations as the user message (1-based, matching the reply order).
fn screen_user_message(texts: &[&str]) -> String {
    let mut s = String::new();
    for (i, t) in texts.iter().enumerate() {
        s.push_str(&format!("{}. {}\n", i + 1, t.trim()));
    }
    s
}

/// Parse the model's reply into per-text keep flags. **FAIL-CLOSED**: only a
/// well-formed JSON array of exactly `n` verdicts is trusted; a parse failure or a
/// wrong length DROPS everything (all `false`). Per element, ONLY a case-insensitive
/// `"safe"` keeps; anything else (SENSITIVE, "unsure", unknown) drops.
fn parse_verdicts(reply: &str, n: usize) -> Vec<bool> {
    let Ok(verdicts) = serde_json::from_str::<Vec<String>>(reply.trim()) else {
        return vec![false; n];
    };
    if verdicts.len() != n {
        return vec![false; n];
    }
    verdicts
        .iter()
        .map(|v| v.trim().eq_ignore_ascii_case("safe"))
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
            Some(reply) => Ok(parse_verdicts(&reply, texts.len())),
            None => Ok(vec![false; texts.len()]),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_well_formed_reply_maps_safe_to_keep_sensitive_to_drop() {
        let keep = parse_verdicts(r#"["SAFE","SENSITIVE","safe"]"#, 3);
        assert_eq!(keep, vec![true, false, true]);
    }

    #[test]
    fn a_wrong_length_reply_fails_closed_dropping_everything() {
        // The model returned 2 verdicts for 3 observations — we can't trust the
        // alignment, so DROP all (never guess which is which).
        assert_eq!(parse_verdicts(r#"["SAFE","SAFE"]"#, 3), vec![false; 3]);
    }

    #[test]
    fn a_malformed_reply_fails_closed() {
        assert_eq!(parse_verdicts("not json at all", 2), vec![false; 2]);
        assert_eq!(parse_verdicts("", 2), vec![false; 2]);
    }

    #[test]
    fn anything_that_is_not_exactly_safe_is_dropped() {
        // "unsure", empty, or any non-SAFE token → drop (exclude if unsure).
        let keep = parse_verdicts(r#"["unsure","","SAFE","maybe"]"#, 4);
        assert_eq!(keep, vec![false, false, true, false]);
    }

    #[test]
    fn the_user_message_numbers_observations_in_order() {
        let m = screen_user_message(&["email from a", "lunch with b"]);
        assert_eq!(m, "1. email from a\n2. lunch with b\n");
    }
}
