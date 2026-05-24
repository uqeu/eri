// Semantic router for eri. Picks the best model per request from a small
// deterministic policy layered on top of a keyword/intent table.
//
// The router is intentionally rules-based: it must run inline on every
// inference request without a network or model load. It is inspired by
// the vllm-project/semantic-router and R2-Router-RouterArena designs,
// but the implementation here is original.

use serde::{Deserialize, Serialize};

mod brain_router;

pub use brain_router::{Intent, ModelChoice, Plan, PromptContext, ReasoningLevel, Router};

/// Concrete model the sidecar can dispatch to. Wire up matches the
/// backends already implemented in `eri_inference`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Model {
    /// Local diffusion edit engine (Mercury 2 backed).
    EriEngine,
    /// Anthropic Claude Opus 4.7 — deep reasoning lane.
    ClaudeOpus47,
    /// Anthropic Claude Sonnet 4.6 — polish / compile-loop lane.
    ClaudeSonnet46,
    /// OpenAI GPT-5 — long-form planning lane.
    Gpt5,
    /// Google Gemini 2.5 Pro — multimodal lane.
    Gemini25Pro,
}

impl Model {
    pub fn as_str(self) -> &'static str {
        match self {
            Model::EriEngine => "eri-engine",
            Model::ClaudeOpus47 => "claude-opus-4.7",
            Model::ClaudeSonnet46 => "claude-sonnet-4.6",
            Model::Gpt5 => "gpt-5",
            Model::Gemini25Pro => "gemini-2.5-pro",
        }
    }
}

/// Coarse intent the router believes the request expresses. The same
/// intent can be served by different models depending on signal-level
/// hints (image present, file count, voice override, etc.).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum IntentKind {
    /// Local single-function or short-region edit — diffusion lane.
    DiffusionEdit,
    /// Lint / compile / import / typo style polish.
    Polish,
    /// Multi-file or long-spec planning.
    LongFormPlanning,
    /// Architectural redesign, refactor, deep reasoning.
    DeepReasoning,
    /// Image / screenshot / vision in the prompt.
    Multimodal,
    /// Very short request, single line.
    QuickFix,
    /// Mid-size architecture conversation turn.
    ArchitectureTurn,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct RouteRequest {
    pub prompt: String,
    pub has_image: bool,
    pub has_long_context: bool,
    pub file_count: usize,
    pub language: Option<String>,
    pub voice_override: Option<Model>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RouteDecision {
    pub model: Model,
    pub intent: IntentKind,
    pub confidence: f32,
    pub reasoning: &'static str,
    pub fallback: Option<Model>,
}

// Static keyword → intent → confidence table. Order matters: earlier
// matches dominate. We keep this small on purpose; a fancier classifier
// is out of scope for the deterministic baseline.
const INTENT_TABLE: &[(&str, IntentKind, f32)] = &[
    // Deep reasoning first — these words are rare and load-bearing.
    ("redesign", IntentKind::DeepReasoning, 0.92),
    ("rewrite", IntentKind::DeepReasoning, 0.88),
    ("re-architect", IntentKind::DeepReasoning, 0.95),
    ("architecture", IntentKind::DeepReasoning, 0.85),
    ("refactor", IntentKind::DeepReasoning, 0.80),
    ("design the", IntentKind::DeepReasoning, 0.78),
    // Long-form planning.
    ("plan ", IntentKind::LongFormPlanning, 0.75),
    ("spec ", IntentKind::LongFormPlanning, 0.78),
    ("specification", IntentKind::LongFormPlanning, 0.80),
    ("migrate", IntentKind::LongFormPlanning, 0.70),
    // Polish / compile loop.
    ("fix the imports", IntentKind::Polish, 0.95),
    ("fix imports", IntentKind::Polish, 0.95),
    ("lint", IntentKind::Polish, 0.90),
    ("compile", IntentKind::Polish, 0.88),
    ("type error", IntentKind::Polish, 0.90),
    ("typo", IntentKind::Polish, 0.88),
    ("format", IntentKind::Polish, 0.70),
    // Multimodal cues in the prompt itself.
    ("screenshot", IntentKind::Multimodal, 0.85),
    ("this image", IntentKind::Multimodal, 0.90),
    ("the design mock", IntentKind::Multimodal, 0.85),
];

fn classify_intent(prompt_lower: &str) -> (IntentKind, f32) {
    for (needle, intent, conf) in INTENT_TABLE {
        if prompt_lower.contains(needle) {
            return (*intent, *conf);
        }
    }
    // No keyword hit — guess from length.
    let approx_tokens = prompt_lower.split_whitespace().count();
    if approx_tokens <= 12 {
        (IntentKind::QuickFix, 0.55)
    } else if approx_tokens <= 80 {
        (IntentKind::DiffusionEdit, 0.60)
    } else {
        (IntentKind::ArchitectureTurn, 0.55)
    }
}

fn approx_token_count(s: &str) -> usize {
    // Rough heuristic: 4 chars per token. Avoids pulling in a tokenizer
    // crate just for routing.
    (s.len() / 4).max(s.split_whitespace().count())
}

/// Pick a model for the given request. Layered policy:
///   1. Voice override always wins.
///   2. Image present → Gemini.
///   3. Large multi-file work → GPT-5 with Opus fallback.
///   4. Intent table maps keywords to (intent, model).
///   5. Length-based fallback to eri Engine.
pub fn route(req: &RouteRequest) -> RouteDecision {
    if let Some(model) = req.voice_override {
        return RouteDecision {
            model,
            intent: IntentKind::ArchitectureTurn,
            confidence: 1.0,
            reasoning: "voice override honored",
            fallback: None,
        };
    }

    if req.has_image {
        return RouteDecision {
            model: Model::Gemini25Pro,
            intent: IntentKind::Multimodal,
            confidence: 0.95,
            reasoning: "image attached — multimodal lane",
            fallback: Some(Model::ClaudeOpus47),
        };
    }

    let prompt_lower = req.prompt.to_lowercase();
    let (intent, intent_confidence) = classify_intent(&prompt_lower);
    let tokens = approx_token_count(&req.prompt);

    if req.file_count > 50 || req.has_long_context {
        // Big planning job: GPT-5 leads, Opus is the deep-reasoning
        // fallback (router picks one primary, surfaces the other).
        let intent = if matches!(intent, IntentKind::DeepReasoning) {
            IntentKind::DeepReasoning
        } else {
            IntentKind::LongFormPlanning
        };
        return RouteDecision {
            model: Model::Gpt5,
            intent,
            confidence: 0.88,
            reasoning: "many files / long context — GPT-5 plans, Opus follows",
            fallback: Some(Model::ClaudeOpus47),
        };
    }

    match intent {
        IntentKind::DeepReasoning => RouteDecision {
            model: Model::ClaudeOpus47,
            intent,
            confidence: intent_confidence,
            reasoning: "deep reasoning / refactor keywords — Opus",
            fallback: Some(Model::Gpt5),
        },
        IntentKind::LongFormPlanning => RouteDecision {
            model: Model::Gpt5,
            intent,
            confidence: intent_confidence,
            reasoning: "long-form planning keywords — GPT-5",
            fallback: Some(Model::ClaudeOpus47),
        },
        IntentKind::Polish => RouteDecision {
            model: Model::ClaudeSonnet46,
            intent,
            confidence: intent_confidence,
            reasoning: "compile / lint / imports — Sonnet polish lane",
            fallback: Some(Model::EriEngine),
        },
        IntentKind::Multimodal => RouteDecision {
            model: Model::Gemini25Pro,
            intent,
            confidence: intent_confidence,
            reasoning: "vision cue in prompt — Gemini",
            fallback: Some(Model::ClaudeOpus47),
        },
        IntentKind::QuickFix | IntentKind::DiffusionEdit => RouteDecision {
            model: Model::EriEngine,
            intent,
            confidence: intent_confidence.max(0.65),
            reasoning: "short local edit — eri Engine diffusion",
            fallback: Some(Model::ClaudeSonnet46),
        },
        IntentKind::ArchitectureTurn => {
            // Mid-size conversation turns: prefer eri Engine when small,
            // Sonnet when medium, Opus when verbose.
            let (model, fallback, reasoning) = if tokens < 200 {
                (
                    Model::EriEngine,
                    Some(Model::ClaudeSonnet46),
                    "short architecture turn — eri Engine",
                )
            } else if tokens < 1500 {
                (
                    Model::ClaudeSonnet46,
                    Some(Model::ClaudeOpus47),
                    "medium architecture turn — Sonnet",
                )
            } else {
                (
                    Model::ClaudeOpus47,
                    Some(Model::Gpt5),
                    "long architecture turn — Opus",
                )
            };
            RouteDecision {
                model,
                intent,
                confidence: intent_confidence,
                reasoning,
                fallback,
            }
        }
    }
}

/// Convenience helper for the JSON-RPC sidecar. The sidecar passes the
/// raw `params` JSON of an `eri/inference/iterate` request; we parse the
/// fields we care about (best-effort), route, and hand back a JSON value
/// the sidecar can splice into its response.
pub fn route_for_sidecar(json: &str) -> serde_json::Value {
    let parsed: serde_json::Value = match serde_json::from_str(json) {
        Ok(v) => v,
        Err(err) => {
            return serde_json::json!({
                "error": format!("invalid json: {err}"),
            });
        }
    };

    let req = RouteRequest {
        prompt: parsed
            .get("prompt")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        has_image: parsed
            .get("has_image")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        has_long_context: parsed
            .get("has_long_context")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        file_count: parsed
            .get("file_count")
            .and_then(|v| v.as_u64())
            .map(|n| n as usize)
            .unwrap_or(0),
        language: parsed
            .get("language")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        voice_override: parsed
            .get("voice_override")
            .and_then(|v| v.as_str())
            .and_then(parse_model_str),
    };

    let decision = route(&req);
    serde_json::json!({
        "model": decision.model.as_str(),
        "intent": format!("{:?}", decision.intent),
        "confidence": decision.confidence,
        "reasoning": decision.reasoning,
        "fallback": decision.fallback.map(|m| m.as_str()),
    })
}

fn parse_model_str(s: &str) -> Option<Model> {
    match s {
        "eri-engine" => Some(Model::EriEngine),
        "claude-opus-4.7" => Some(Model::ClaudeOpus47),
        "claude-sonnet-4.6" => Some(Model::ClaudeSonnet46),
        "gpt-5" => Some(Model::Gpt5),
        "gemini-2.5-pro" => Some(Model::Gemini25Pro),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quick_fix_defaults_to_eri_engine() {
        let decision = route(&RouteRequest {
            prompt: "rename x to y".into(),
            ..Default::default()
        });
        assert_eq!(decision.model, Model::EriEngine);
    }

    #[test]
    fn sidecar_helper_round_trips() {
        let json = r#"{"prompt":"fix the imports","file_count":1}"#;
        let value = route_for_sidecar(json);
        assert_eq!(value["model"], "claude-sonnet-4.6");
    }
}
