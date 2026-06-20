//! The **predict** step of the predict→gate→act cycle (ADR-0007 §4).
//!
//! v1 reads the base engine's per-action confidence forecast. The model
//! self-reports a `confidence` in each tool call — informed by the world-model
//! context injected into its prompt (Key People / Active Projects + recalled
//! memory), so the forecast is "over the world model" — and it rides in the
//! call's input, surfaced via [`TurnOutput`](crate::control_turn::TurnOutput).
//! We extract + clamp it here. Missing or invalid → a conservative fallback
//! BELOW the auto-execute floor, so an unforecast action asks rather than
//! auto-runs. Deterministic + token-frugal (no extra base-engine call).

use serde_json::Value;

/// Confidence used when the model gave no (or an invalid) forecast — deliberately
/// below [`crate::control_envelope::DEFAULT_CONFIDENCE_FLOOR`], so an unforecast
/// action never auto-executes; eri asks instead.
pub const UNFORECAST_CONFIDENCE: f32 = 0.5;

/// The base engine's confidence that a tool call achieves its intent, read from
/// the call's `confidence` field and clamped to `[0,1]`. Missing or non-numeric
/// → [`UNFORECAST_CONFIDENCE`].
pub fn forecast_confidence(call_input: &Value) -> f32 {
    match call_input.get("confidence").and_then(Value::as_f64) {
        Some(c) => (c as f32).clamp(0.0, 1.0),
        None => UNFORECAST_CONFIDENCE,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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
}
