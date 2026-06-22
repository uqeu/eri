//! The **predict** step of the predict→gate→act cycle (ADR-0007 §4).
//!
//! The forecast has two sources, blended into the single confidence the
//! confirmation envelope gates on:
//!
//! 1. **The base engine's self-report.** The model emits a `confidence` per tool
//!    call — informed by the world-model context injected into its prompt (Key
//!    People / Active Projects + recalled memory) — riding in the call's input.
//!    [`forecast_confidence`] extracts + clamps it; missing/invalid → a
//!    conservative fallback below the auto floor, so an unforecast action asks.
//!
//! 2. **A real read of the world model** ([`anticipate`]). Over the one user
//!    graph (ADR-0007), eri checks whether the action is an *established next
//!    step* after the previous one (the proactive **chain**) and whether it
//!    *names a known entity* (the **entity** model). [`forecast`] lets that
//!    corroboration *raise* the confidence the envelope sees — and only raise
//!    it: the world model vouches for what it anticipates, it never lowers the
//!    engine's own number, and grounding alone (a known target in a novel
//!    sequence) is never a reason to act unprompted.
//!
//! Deterministic + token-frugal (no extra base-engine call). The reversibility
//! and refusal axes of the envelope are independent and untouched by this step.

use serde_json::Value;

use eri_inference::memory::world_recall::WorldModel;

use crate::control_agent::ControlAction;

/// Confidence used when the model gave no (or an invalid) forecast — deliberately
/// below [`crate::control_envelope::DEFAULT_CONFIDENCE_FLOOR`], so an unforecast
/// action never auto-executes; eri asks instead.
pub const UNFORECAST_CONFIDENCE: f32 = 0.5;

/// Confidence an **established chain step** is vouched at — just over the
/// auto-execute floor, so a reversible+known step the world model anticipates
/// can run without asking even when the engine itself was only lukewarm.
pub const EXPECTED_FLOOR: f32 = 0.83;

/// ...and higher when that step **also names a known entity** (chain × entity):
/// the strongest world-model corroboration, leaving headroom over
/// [`EXPECTED_FLOOR`] for stricter per-tier floors to distinguish the two.
pub const EXPECTED_GROUNDED_FLOOR: f32 = 0.90;

// Invariants the blend relies on, enforced at compile time: both world-model
// vouches clear the auto-execute floor (an anticipated reversible+known step is
// auto-eligible), and grounding strictly strengthens an expected step.
const _: () = assert!(EXPECTED_FLOOR >= crate::control_envelope::DEFAULT_CONFIDENCE_FLOOR);
const _: () = assert!(EXPECTED_GROUNDED_FLOOR > EXPECTED_FLOOR);

/// The base engine's confidence that a tool call achieves its intent, read from
/// the call's `confidence` field and clamped to `[0,1]`. Missing or non-numeric
/// → [`UNFORECAST_CONFIDENCE`].
pub fn forecast_confidence(call_input: &Value) -> f32 {
    match call_input.get("confidence").and_then(Value::as_f64) {
        Some(c) => (c as f32).clamp(0.0, 1.0),
        None => UNFORECAST_CONFIDENCE,
    }
}

/// Blend the engine's `model_confidence` with what the world model anticipates
/// (`expected` = an established chain step, `grounded` = names a known entity).
/// The world model can only **raise** confidence — it vouches for an action it
/// anticipates, never lowering the engine's own number. Grounding alone yields
/// no vouch (recognizing *what* an action touches is not anticipating *that* it
/// should run). This is the only number that changes; the envelope's
/// reversibility and refusal axes are independent.
pub fn forecast(model_confidence: f32, expected: bool, grounded: bool) -> f32 {
    model_confidence
        .clamp(0.0, 1.0)
        .max(world_vouch(expected, grounded))
}

/// The confidence floor the world model is willing to vouch for, given what it
/// anticipates about the action.
fn world_vouch(expected: bool, grounded: bool) -> f32 {
    match (expected, grounded) {
        (true, true) => EXPECTED_GROUNDED_FLOOR,
        (true, false) => EXPECTED_FLOOR,
        // Not an established step (grounded or not) → no vouch; the engine's own
        // confidence stands.
        _ => 0.0,
    }
}

/// Read the world model's anticipation of `action` following `prev` through the
/// run's opened [`WorldModel`] handle — is it an established chain step, and does
/// it name a known entity. Joins the proactive chain with the entity model over
/// the one user graph. Returns `(expected, grounded)` for [`forecast`]; no world
/// model (signed-out) yields `(false, false)` (no corroboration, no IO).
pub fn anticipate(
    world: Option<&WorldModel>,
    prev: Option<&str>,
    action: &ControlAction,
) -> (bool, bool) {
    match world {
        Some(w) => {
            let e = w.anticipate(prev, &action.describe(), action.target_app());
            (e.expected, e.grounded)
        }
        None => (false, false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::control_envelope::DEFAULT_CONFIDENCE_FLOOR;
    use serde_json::json;

    #[test]
    fn reads_the_models_confidence_clamped_to_unit_range() {
        assert!((forecast_confidence(&json!({"confidence": 0.9})) - 0.9).abs() < 1e-6);
        assert_eq!(forecast_confidence(&json!({"confidence": 1.5})), 1.0);
        assert_eq!(forecast_confidence(&json!({"confidence": -2.0})), 0.0);
    }

    #[test]
    fn falls_back_to_the_conservative_default_when_unforecast_or_invalid() {
        // UNFORECAST_CONFIDENCE (0.5) is below the envelope's auto floor (0.8), so
        // an unforecast action asks rather than auto-runs — see the integration
        // test `envelope_confidence_comes_from_the_models_per_action_forecast`.
        assert_eq!(forecast_confidence(&json!({})), UNFORECAST_CONFIDENCE);
        assert_eq!(
            forecast_confidence(&json!({"confidence": "high"})),
            UNFORECAST_CONFIDENCE
        );
    }

    #[test]
    fn world_corroboration_only_raises_confidence_never_lowers_it() {
        // No corroboration → the engine's own confidence stands, untouched.
        assert_eq!(forecast(0.5, false, false), 0.5);
        assert_eq!(forecast(0.95, false, false), 0.95);
        // An established chain step lifts a lukewarm engine over the auto floor
        // (EXPECTED_FLOOR ≥ the floor is a compile-time invariant above).
        assert_eq!(forecast(0.5, true, false), EXPECTED_FLOOR);
        // ...and a step that also names a known entity (chain × entity) lifts higher.
        assert_eq!(forecast(0.5, true, true), EXPECTED_GROUNDED_FLOOR);
        // The world model never lowers a confident engine below its own number.
        assert_eq!(forecast(0.99, true, true), 0.99);
    }

    #[test]
    fn grounding_alone_is_not_a_reason_to_act_unprompted() {
        // A known target in a NOVEL sequence (not an established step) gets no
        // vouch: recognizing what an action touches ≠ anticipating it should run.
        assert_eq!(forecast(0.5, false, true), 0.5);
        assert!(forecast(0.5, false, true) < DEFAULT_CONFIDENCE_FLOOR);
    }

    #[test]
    fn forecast_stays_in_unit_range() {
        assert_eq!(forecast(1.5, false, false), 1.0);
        assert_eq!(forecast(-1.0, true, true), EXPECTED_GROUNDED_FLOOR);
    }
}
