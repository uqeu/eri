//! `eri/brain/plan` JSON-RPC handler.
//!
//! Wraps [`eri_inference::brain::Brain`] in a `Mutex` so the sidecar can call
//! `plan()` from multiple in-flight RPCs without losing the budgeter cache.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::Mutex;

use eri_caveman::BudgetPart;
use eri_inference::brain::{Brain, BrainPlan};
use eri_router::{Intent, ModelChoice, PromptContext, ReasoningLevel};

use crate::DispatchError;
use crate::services::Services;

/// Shared brain instance held inside `Services`. Lazily constructed on first
/// call so we don't pay router/env init costs at sidecar startup.
pub type SharedBrain = Mutex<Option<Brain>>;

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct PromptContextWire {
    language: Option<String>,
    open_files: Vec<String>,
    linter_errors_count: usize,
    voice_input: bool,
    prompt_token_estimate: usize,
}

impl From<PromptContextWire> for PromptContext {
    fn from(w: PromptContextWire) -> Self {
        PromptContext {
            language: w.language,
            open_files: w.open_files,
            linter_errors_count: w.linter_errors_count,
            voice_input: w.voice_input,
            prompt_token_estimate: w.prompt_token_estimate,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BudgetPartWire {
    label: String,
    priority: i32,
    text: String,
    #[serde(default)]
    min_keep_tokens: Option<usize>,
}

impl From<BudgetPartWire> for BudgetPart {
    fn from(w: BudgetPartWire) -> Self {
        BudgetPart {
            label: w.label,
            priority: w.priority,
            text: w.text,
            min_keep_tokens: w.min_keep_tokens,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlanParams {
    prompt: String,
    #[serde(default)]
    context: PromptContextWire,
    #[serde(default)]
    parts: Vec<BudgetPartWire>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlanResult {
    intent: &'static str,
    model: ModelWire,
    temperature: f32,
    reasoning: &'static str,
    budgeted_prompt: BudgetedPromptWire,
    estimated_tokens_in: usize,
    estimated_tokens_out: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelWire {
    vendor: &'static str,
    id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BudgetedPromptWire {
    system: String,
    user: String,
    dropped_parts: Vec<String>,
}

/// `eri/brain/plan` handler.
pub async fn plan(
    params: Value,
    services: &std::sync::Arc<Services>,
) -> Result<Value, DispatchError> {
    let wire: PlanParams = serde_json::from_value(params)
        .map_err(|err| DispatchError::BadParams(format!("eri/brain/plan: {err}")))?;

    let parts: Vec<BudgetPart> = wire.parts.into_iter().map(BudgetPart::from).collect();
    let prompt_ctx: PromptContext = wire.context.into();

    let plan = {
        let mut guard = services.brain.lock().await;
        let brain = guard.get_or_insert_with(Brain::new);
        brain
            .plan(&wire.prompt, &prompt_ctx, parts)
            .map_err(|err| DispatchError::Other(anyhow::anyhow!(err)))?
    };

    Ok(serde_json::to_value(plan_to_wire(plan)).map_err(|err| {
        DispatchError::Other(anyhow::anyhow!("serialise BrainPlan: {err}"))
    })?)
}

fn plan_to_wire(plan: BrainPlan) -> PlanResult {
    PlanResult {
        intent: intent_str(plan.intent),
        model: model_to_wire(&plan.model),
        temperature: plan.temperature,
        reasoning: reasoning_str(plan.reasoning),
        budgeted_prompt: BudgetedPromptWire {
            system: plan.budgeted_prompt.system,
            user: plan.budgeted_prompt.user,
            dropped_parts: plan.budgeted_prompt.dropped_parts,
        },
        estimated_tokens_in: plan.estimated_tokens_in,
        estimated_tokens_out: plan.estimated_tokens_out,
    }
}

fn intent_str(intent: Intent) -> &'static str {
    match intent {
        Intent::Chat => "chat",
        Intent::Explain => "explain",
        Intent::Edit => "edit",
        Intent::Build => "build",
        Intent::Refactor => "refactor",
        Intent::Debug => "debug",
        Intent::Search => "search",
        Intent::Voice => "voice",
        Intent::Unknown => "unknown",
    }
}

fn reasoning_str(level: ReasoningLevel) -> &'static str {
    match level {
        ReasoningLevel::None => "none",
        ReasoningLevel::Light => "light",
        ReasoningLevel::Deep => "deep",
    }
}

fn model_to_wire(choice: &ModelChoice) -> ModelWire {
    ModelWire {
        vendor: choice.vendor(),
        id: choice.model_id().to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn plan_returns_a_chat_response_for_short_prompt() {
        let services = Services::new();
        let prompt = "i'm chatting through some long ambiguous thoughts \
                      about distributed consensus and curious where you'd \
                      land between raft and paxos for a real production deployment \
                      that has to survive flaky regional links and partial outages";
        let params = serde_json::json!({
            "prompt": prompt,
            "context": { "openFiles": [] },
            "parts": [
                { "label": "system:base", "priority": 0, "text": "You are eri." },
                { "label": "user:prompt", "priority": 0, "text": prompt }
            ]
        });
        let value = plan(params, &services).await.expect("plan ok");
        assert_eq!(value["intent"], "chat");
        assert_eq!(value["model"]["vendor"], "claude");
        assert!(value["budgetedPrompt"]["user"]
            .as_str()
            .unwrap()
            .contains("consensus"));
    }

    #[tokio::test]
    async fn plan_routes_build_prompt_to_mercury() {
        let services = Services::new();
        let params = serde_json::json!({
            "prompt": "build me a coffee shop landing page",
            "parts": [
                { "label": "user:prompt", "priority": 0, "text": "build me a coffee shop landing page" }
            ]
        });
        let value = plan(params, &services).await.expect("plan ok");
        assert_eq!(value["intent"], "build");
        assert_eq!(value["model"]["vendor"], "mercury");
        assert_eq!(value["reasoning"], "deep");
    }

    #[tokio::test]
    async fn plan_reports_bad_params_for_missing_prompt() {
        let services = Services::new();
        let params = serde_json::json!({});
        let err = plan(params, &services).await.expect_err("should fail");
        assert!(matches!(err, DispatchError::BadParams(_)));
    }
}
