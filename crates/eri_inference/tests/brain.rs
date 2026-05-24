//! Integration tests for the brain layer. These exercise the full
//! classify → route → budget pipeline end-to-end on representative prompts.

use eri_caveman::BudgetPart;
use eri_inference::brain::{Brain, BrainPlan};
use eri_router::{Intent, ModelChoice, PromptContext, ReasoningLevel, Router};

fn empty_ctx() -> PromptContext {
    PromptContext::default()
}

fn ctx_with_files(files: &[&str]) -> PromptContext {
    PromptContext {
        open_files: files.iter().map(|s| (*s).to_string()).collect(),
        ..Default::default()
    }
}

fn small_parts(prompt: &str) -> Vec<BudgetPart> {
    vec![
        BudgetPart::new(
            "system:base",
            0,
            "You are eri, a careful coding assistant.",
        ),
        BudgetPart::new("user:prompt", 0, prompt),
    ]
}

fn plan_for(prompt: &str, ctx: &PromptContext) -> BrainPlan {
    // Always use a fresh default Router so env overrides don't leak between
    // tests in the same binary.
    let mut brain = Brain::with_router(Router::default());
    brain
        .plan(prompt, ctx, small_parts(prompt))
        .expect("brain plans")
}

#[test]
fn build_a_coffee_shop_picks_mercury_with_deep_reasoning() {
    let plan = plan_for("build me a coffee shop landing page", &empty_ctx());
    assert_eq!(plan.intent, Intent::Build);
    assert!(matches!(plan.model, ModelChoice::Mercury));
    assert_eq!(plan.reasoning, ReasoningLevel::Deep);
    assert!(plan.estimated_tokens_in > 0);
    // Deep reasoning amendment should appear in the system half.
    assert!(
        plan.budgeted_prompt
            .system
            .to_lowercase()
            .contains("step by step"),
        "missing deep reasoning amendment: {:?}",
        plan.budgeted_prompt.system
    );
}

#[test]
fn explain_with_open_file_picks_claude_with_light_reasoning() {
    let plan = plan_for(
        "what does this function do",
        &ctx_with_files(&["src/auth.ts"]),
    );
    assert_eq!(plan.intent, Intent::Explain);
    assert!(matches!(plan.model, ModelChoice::Claude(_)));
    assert_eq!(plan.reasoning, ReasoningLevel::Light);
    assert!(
        plan.budgeted_prompt
            .system
            .to_lowercase()
            .contains("concise"),
        "missing light reasoning amendment: {:?}",
        plan.budgeted_prompt.system
    );
}

#[test]
fn debug_with_linter_errors_picks_claude_with_deep_reasoning() {
    let mut ctx = ctx_with_files(&["src/parser.ts"]);
    ctx.linter_errors_count = 4;
    let plan = plan_for("fix this error", &ctx);
    assert_eq!(plan.intent, Intent::Debug);
    assert!(matches!(plan.model, ModelChoice::Claude(_)));
    assert_eq!(plan.reasoning, ReasoningLevel::Deep);
}

#[test]
fn low_priority_parts_drop_when_budget_overflows() {
    // Route Edit to a Local profile so the budget caps at 32k tokens — well
    // below the 100k-token padding we attach below.
    let prev = std::env::var("ERI_ROUTE_EDIT").ok();
    // SAFETY: we restore prev after the test.
    unsafe {
        std::env::set_var("ERI_ROUTE_EDIT", "local:tiny-test");
    }
    let router = Router::from_env();
    let mut brain = Brain::with_router(router);

    let mut parts = small_parts("change the button color to teal");
    // 200k chars at priority 9 — over the Local 32k-token budget.
    parts.push(BudgetPart::new("ctx:padding", 9, "x".repeat(200_000)));
    let plan = brain
        .plan(
            "change the button color to teal",
            &ctx_with_files(&["src/app.tsx"]),
            parts,
        )
        .expect("plans");
    assert!(
        plan.budgeted_prompt
            .dropped_parts
            .contains(&"ctx:padding".to_string()),
        "expected ctx:padding dropped, got {:?}",
        plan.budgeted_prompt.dropped_parts
    );

    match prev {
        Some(v) => unsafe { std::env::set_var("ERI_ROUTE_EDIT", v) },
        None => unsafe { std::env::remove_var("ERI_ROUTE_EDIT") },
    }
}
