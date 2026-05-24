//! Brain layer — the single entry point that the sidecar's dispatch calls
//! before executing any model invocation.
//!
//! Given a prompt and labelled context parts, [`Brain::plan`] does three
//! things:
//!
//! 1. Classifies the user intent (chat / explain / edit / build / refactor /
//!    debug / search / voice / unknown) via [`eri_router::Router`].
//! 2. Routes that intent to a concrete [`ModelChoice`] (Mercury for
//!    diffusion-shaped work; a frontier reasoning model otherwise) and
//!    picks a [`ReasoningLevel`] + temperature.
//! 3. Budgets the prompt parts against the chosen model's context window
//!    using [`eri_caveman::Budgeter`], dropping or truncating lower-priority
//!    pieces until the prompt fits.
//!
//! The returned [`BrainPlan`] is everything the dispatch needs to execute:
//! intent, model, temperature, reasoning amendment, the budgeted prompt
//! halves (system + user), the input token estimate, and the labels of any
//! parts that didn't fit.
//!
//! The brain layer is deliberately decoupled from the [`crate::LlmProvider`]
//! trait — wiring brain → provider is a follow-up. Today the brain is a
//! pure callable component that any dispatch can drop in front of its
//! existing invocation paths.

use std::collections::HashMap;

use eri_caveman::{BudgetError, BudgetPart, Budgeter, ModelProfile, default_profile_for};
use eri_router::{Intent, ModelChoice, Plan, PromptContext, ReasoningLevel, Router};
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Final, executable plan for one prompt turn.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BrainPlan {
    pub intent: Intent,
    pub model: ModelChoice,
    pub temperature: f32,
    pub reasoning: ReasoningLevel,
    pub budgeted_prompt: BudgetedPrompt,
    pub estimated_tokens_in: usize,
    pub estimated_tokens_out: usize,
}

/// Concatenated system + user prompt after budgeting, with the labels of
/// any parts that didn't fit.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BudgetedPrompt {
    pub system: String,
    pub user: String,
    /// Labels of [`BudgetPart`]s that were dropped or fully truncated away
    /// during budgeting. Surfaced so the caller can warn the user / re-rank.
    pub dropped_parts: Vec<String>,
}

/// Errors the brain layer can produce.
#[derive(Debug, Error)]
pub enum BrainError {
    #[error("budgeting failed: {0}")]
    Budget(#[from] BudgetError),
}

/// Hint for partitioning [`BudgetPart`]s into the system vs user halves of
/// the prompt. Anything labelled `system:*` is appended to the system half;
/// everything else lands in the user half.
const SYSTEM_LABEL_PREFIX: &str = "system:";

/// Brain — reusable across many `plan` calls. Owns a `Router` and a small
/// cache of budgeters keyed by model id (re-resolving a profile is cheap,
/// but the budgeter clones easily so we cache).
pub struct Brain {
    router: Router,
    budgeter_cache: HashMap<String, Budgeter>,
}

impl Default for Brain {
    fn default() -> Self {
        Self::new()
    }
}

impl Brain {
    pub fn new() -> Self {
        Self {
            router: Router::from_env(),
            budgeter_cache: HashMap::new(),
        }
    }

    /// Build a brain with an explicit router (useful for tests).
    pub fn with_router(router: Router) -> Self {
        Self {
            router,
            budgeter_cache: HashMap::new(),
        }
    }

    /// Plan a single prompt turn.
    ///
    /// `parts` is the labelled set of prompt pieces to budget into the
    /// model's context window. Parts whose label starts with `system:` go
    /// into the system half of the prompt; everything else lands in the
    /// user half.
    pub fn plan(
        &mut self,
        prompt: &str,
        ctx: &PromptContext,
        parts: Vec<BudgetPart>,
    ) -> Result<BrainPlan, BrainError> {
        // 1. Classify + route.
        let Plan {
            intent,
            model,
            temperature,
            reasoning,
        } = self.router.decide(prompt, ctx);

        // 2. Pick a model profile and a budgeter.
        let profile = profile_for(&model);
        let estimated_tokens_out = profile.max_output;
        let budgeter = self
            .budgeter_cache
            .entry(profile.name.clone())
            .or_insert_with(|| Budgeter::new(profile.clone()))
            .clone();

        // 3. Fit the parts. Track which labels we asked for vs. what survived
        //    so we can report dropped labels back to the caller.
        let requested_labels: Vec<String> = parts.iter().map(|p| p.label.clone()).collect();
        let kept = budgeter.fit(parts)?;
        let kept_label_set: std::collections::HashSet<&str> =
            kept.iter().map(|p| p.label.as_str()).collect();
        let dropped_parts: Vec<String> = requested_labels
            .into_iter()
            .filter(|label| !kept_label_set.contains(label.as_str()))
            .collect();

        // 4. Assemble system / user halves.
        let mut system_buf = String::new();
        let mut user_buf = String::new();
        for part in kept {
            if part.label.starts_with(SYSTEM_LABEL_PREFIX) {
                push_with_separator(&mut system_buf, &part.text);
            } else {
                push_with_separator(&mut user_buf, &part.text);
            }
        }

        // 5. Apply reasoning amendment to the system half.
        if let Some(amendment) = reasoning_amendment(reasoning) {
            push_with_separator(&mut system_buf, amendment);
        }

        let estimated_tokens_in = budgeter.count(&system_buf) + budgeter.count(&user_buf);

        Ok(BrainPlan {
            intent,
            model,
            temperature,
            reasoning,
            budgeted_prompt: BudgetedPrompt {
                system: system_buf,
                user: user_buf,
                dropped_parts,
            },
            estimated_tokens_in,
            estimated_tokens_out,
        })
    }
}

fn push_with_separator(buf: &mut String, addition: &str) {
    if buf.is_empty() {
        buf.push_str(addition);
    } else {
        buf.push_str("\n\n");
        buf.push_str(addition);
    }
}

/// System-prompt amendment for a given reasoning level. `None` is intentional
/// — we don't want to pollute Light/None turns with extra tokens.
fn reasoning_amendment(level: ReasoningLevel) -> Option<&'static str> {
    match level {
        ReasoningLevel::Deep => Some(
            "Take your time. Think step by step. Consider multiple approaches \
             before responding.",
        ),
        ReasoningLevel::Light => Some("Be concise."),
        ReasoningLevel::None => None,
    }
}

/// Resolve a model profile from a [`ModelChoice`]. Mercury and Local-family
/// models don't have an entry in [`default_profile_for`], so we fall back to
/// reasonable defaults here.
fn profile_for(choice: &ModelChoice) -> ModelProfile {
    match choice {
        ModelChoice::Mercury => ModelProfile {
            name: "mercury-2".to_string(),
            context_window: 64_000,
            max_output: 8_192,
            tokenizer: eri_caveman::TokenizerKind::Cl100k,
        },
        ModelChoice::Claude(id) | ModelChoice::OpenAI(id) | ModelChoice::Gemini(id) => {
            default_profile_for(id)
        }
        ModelChoice::Local(id) => ModelProfile {
            name: id.clone(),
            context_window: 32_000,
            max_output: 4_096,
            tokenizer: eri_caveman::TokenizerKind::Llama3,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pc(open_files: &[&str]) -> PromptContext {
        PromptContext {
            open_files: open_files.iter().map(|s| (*s).to_string()).collect(),
            ..Default::default()
        }
    }

    #[test]
    fn plan_builds_a_simple_chat_prompt() {
        let mut brain = Brain::with_router(Router::default());
        let parts = vec![
            BudgetPart::new("system:base", 0, "You are a careful assistant."),
            BudgetPart::new("user:prompt", 0, "What's a vector in linear algebra?"),
        ];
        let plan = brain
            .plan("What's a vector in linear algebra?", &pc(&[]), parts)
            .expect("plans");
        assert!(plan.budgeted_prompt.system.contains("careful assistant"));
        assert!(plan.budgeted_prompt.user.contains("vector"));
        // Reasoning amendment landed in the system half.
        assert!(
            plan.budgeted_prompt
                .system
                .to_lowercase()
                .contains("concise")
                || plan
                    .budgeted_prompt
                    .system
                    .to_lowercase()
                    .contains("step by step"),
            "expected reasoning amendment in system: {}",
            plan.budgeted_prompt.system
        );
        assert!(plan.estimated_tokens_in > 0);
    }

    #[test]
    fn dropped_parts_are_reported() {
        // Build a Router that overrides Edit to a tiny Local model so the
        // budget check is fast (Local uses the char-based estimate — no
        // tiktoken encoding of a multi-MB string).
        let prev = std::env::var("ERI_ROUTE_EDIT").ok();
        // SAFETY: we restore the previous value at the end of the test.
        unsafe {
            std::env::set_var("ERI_ROUTE_EDIT", "local:tiny-test");
        }
        let router = Router::from_env();
        let mut brain = Brain::with_router(router);
        let parts = vec![
            BudgetPart::new("system:base", 0, "sys"),
            BudgetPart::new("user:prompt", 0, "tiny"),
            // 50k chars at priority 9 — Local profile has 32k context, so
            // this can't fit.
            BudgetPart::new("ctx:huge", 9, "x".repeat(200_000)),
        ];
        let pc = pc(&["foo.ts"]);
        let plan = brain
            .plan("change the button color", &pc, parts)
            .expect("plans");
        assert!(
            plan.budgeted_prompt
                .dropped_parts
                .contains(&"ctx:huge".to_string()),
            "expected ctx:huge dropped, got {:?}",
            plan.budgeted_prompt.dropped_parts
        );
        match prev {
            Some(v) => unsafe { std::env::set_var("ERI_ROUTE_EDIT", v) },
            None => unsafe { std::env::remove_var("ERI_ROUTE_EDIT") },
        }
    }
}
