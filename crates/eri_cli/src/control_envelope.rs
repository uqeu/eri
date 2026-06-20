//! The confirmation envelope (ADR-0006, ADR-0007 §4, grill Q17) — the
//! deterministic **gate** of the predict→gate→act cycle.
//!
//! Each predicted action is judged on three independent axes:
//!   1. **Reversibility** — a static taxonomy: reversible actions (open / click /
//!      type / scroll) are eligible for auto-execution; irreversible ones
//!      (delete / quit / send / purchase / overwrite) — or simply unrecognized
//!      ones — always confirm.
//!   2. **Confidence + familiarity** — the base engine's clamped confidence and
//!      whether the action matches a learned pattern or standing grant.
//!   3. **Refusal** — the absolute boundary ([`control_safety::classify_refusal`]),
//!      checked LAST and INDEPENDENTLY so it overrides any auto/confirm.
//!
//! Auto-execute requires ALL of: reversible + confident + known. Anything
//! irreversible, novel, or low-confidence asks first; the refusal list is never
//! crossed. Additive — wraps `control_safety`; it does not replace the loop.

use crate::control_safety::{self, RefusalKind};

/// How undoable an action is — the deterministic safety axis of the envelope.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reversibility {
    /// Trivially undoable (open / click / type / scroll / focus) — auto-eligible.
    Reversible,
    /// Hard or impossible to undo (delete / quit / send / buy / overwrite), or
    /// simply unrecognized (conservative default) — always confirm.
    Irreversible,
}

/// One predicted action awaiting the gate: what executing it is forecast to be.
/// The forecast is produced upstream (base engine over the world model) and
/// mocked in tests; the gate itself is deterministic.
#[derive(Clone, Copy, Debug)]
pub struct Prediction {
    pub reversibility: Reversibility,
    /// Calibrated confidence the action achieves the goal, in [0,1].
    pub confidence: f32,
    /// Whether the action matches a learned successful pattern or standing grant.
    pub known: bool,
}

/// What the envelope decides for a predicted action.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Decision {
    /// Reversible + confident + known: do it, tell the user, keep undo.
    AutoExecute,
    /// Irreversible / novel / low-confidence: ask first.
    Confirm,
    /// Absolute boundary: hand back to the user, never execute.
    Refuse(RefusalKind),
}

/// The minimum confidence for an auto-execute (below it, eri asks). A standing
/// default; per-tier tuning + a learned router can adjust it later.
pub const DEFAULT_CONFIDENCE_FLOOR: f32 = 0.8;

/// Apply the confirmation envelope to a predicted action described by
/// `action_text`. The refusal list is the independent final axis (ADR-0006): it
/// overrides any auto/confirm the reversibility+confidence envelope returns.
pub fn gate(action_text: &str, prediction: &Prediction, confidence_floor: f32) -> Decision {
    let envelope = envelope_decision(prediction, confidence_floor);
    match control_safety::classify_refusal(action_text) {
        Some(kind) => Decision::Refuse(kind),
        None => envelope,
    }
}

/// The reversibility + confidence + familiarity envelope, before the independent
/// refusal axis is applied. Auto-execute is the *only* unprompted path and needs
/// all three to hold.
fn envelope_decision(prediction: &Prediction, floor: f32) -> Decision {
    match prediction.reversibility {
        Reversibility::Reversible if prediction.confidence >= floor && prediction.known => {
            Decision::AutoExecute
        }
        _ => Decision::Confirm,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reversible(confidence: f32, known: bool) -> Prediction {
        Prediction {
            reversibility: Reversibility::Reversible,
            confidence,
            known,
        }
    }

    fn irreversible(confidence: f32, known: bool) -> Prediction {
        Prediction {
            reversibility: Reversibility::Irreversible,
            confidence,
            known,
        }
    }

    #[test]
    fn a_reversible_confident_known_action_auto_executes() {
        let decision = gate(
            "click the Save button",
            &reversible(0.95, true),
            DEFAULT_CONFIDENCE_FLOOR,
        );
        assert_eq!(decision, Decision::AutoExecute);
    }

    #[test]
    fn an_irreversible_action_always_confirms_even_when_confident_and_known() {
        let d = gate(
            "delete the project folder",
            &irreversible(0.99, true),
            DEFAULT_CONFIDENCE_FLOOR,
        );
        assert_eq!(d, Decision::Confirm);
    }

    #[test]
    fn a_reversible_action_confirms_when_unsure_or_novel() {
        // Low confidence asks.
        assert_eq!(
            gate(
                "click Save",
                &reversible(0.4, true),
                DEFAULT_CONFIDENCE_FLOOR
            ),
            Decision::Confirm
        );
        // Confident but novel (no known pattern / grant) asks.
        assert_eq!(
            gate(
                "click Save",
                &reversible(0.95, false),
                DEFAULT_CONFIDENCE_FLOOR
            ),
            Decision::Confirm
        );
    }

    #[test]
    fn the_refusal_list_overrides_even_a_safe_looking_action() {
        // A reversible, confident, known action whose TEXT crosses the absolute
        // boundary is refused — the refusal axis is independent and final.
        let d = gate(
            "type my password into the field",
            &reversible(0.99, true),
            DEFAULT_CONFIDENCE_FLOOR,
        );
        assert_eq!(d, Decision::Refuse(RefusalKind::Credential));
    }
}
