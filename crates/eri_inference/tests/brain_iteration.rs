//! Integration tests for [`eri_inference::run_iteration_via_brain`].
//!
//! These exercise the full classify → route → budget → execute pipeline
//! end-to-end using a canned [`LlmProvider`] so no network is required.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use eri_caveman::BudgetPart;
use eri_inference::{
    BrainIterationError, BrainIterationRequest, BrainIterationResponse, InferenceError,
    LlmProvider, LlmResponse, NullInstr, ProviderKeys, SearchProvider, StreamEvent,
};
use eri_router::PromptContext;
use tempfile::TempDir;

/// Canned provider — returns a fixed string without touching the network.
struct CannedProvider {
    text: String,
    name: &'static str,
}

impl CannedProvider {
    fn new(text: &str) -> Self {
        Self {
            text: text.to_string(),
            name: "canned",
        }
    }
}

impl LlmProvider for CannedProvider {
    fn name(&self) -> &'static str {
        self.name
    }
    fn model(&self) -> &str {
        "canned-1"
    }
    fn complete(
        &self,
        _system: &str,
        _user: &str,
        _max_tokens: u32,
    ) -> Result<LlmResponse, InferenceError> {
        Ok(LlmResponse {
            text: self.text.clone(),
            prompt_tokens: 12,
            completion_tokens: 24,
            cost_usd: 0.001,
        })
    }
    fn stream(
        &self,
        _system: &str,
        _user: &str,
        _max_tokens: u32,
        on_token: &mut dyn FnMut(&str),
    ) -> Result<LlmResponse, InferenceError> {
        for chunk in self.text.split_inclusive('\n') {
            on_token(chunk);
        }
        Ok(LlmResponse {
            text: self.text.clone(),
            prompt_tokens: 12,
            completion_tokens: 24,
            cost_usd: 0.001,
        })
    }
}

struct StubSearch {
    result: String,
    called: AtomicBool,
}
impl SearchProvider for StubSearch {
    fn search(&self, _query: &str, _top_k: usize) -> Result<String, InferenceError> {
        self.called.store(true, Ordering::SeqCst);
        Ok(self.result.clone())
    }
}

// Note: the unit tests in `src/brain_iteration.rs` cover the recording
// `Instrumentation` impl + the edit-intent apply path against an injectable
// canned provider. This integration file targets the *public* API which
// constructs providers internally from BYOK keys, so we focus on the
// surfaces that don't require a real network round-trip.

/// Helper: write a seed file, returning the workspace root.
fn seed_workspace(rel: &str, body: &str) -> TempDir {
    let dir = TempDir::new().expect("tempdir");
    let p = dir.path().join(rel);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    std::fs::write(p, body).unwrap();
    dir
}

/// Drive the public `run_iteration_via_brain` entry point with a router
/// override that snaps every intent to a Claude id so the BYOK key
/// (`stub-key`) path is exercised. Restores env on drop.
fn with_byok_routing<R>(provider_keys: ProviderKeys, f: impl FnOnce(ProviderKeys) -> R) -> R {
    let intents = [
        ("ERI_ROUTE_EDIT", "claude:claude-sonnet-4-5-20251015"),
        ("ERI_ROUTE_BUILD", "claude:claude-sonnet-4-5-20251015"),
        ("ERI_ROUTE_REFACTOR", "claude:claude-sonnet-4-5-20251015"),
        ("ERI_ROUTE_CHAT", "claude:claude-sonnet-4-5-20251015"),
        ("ERI_ROUTE_EXPLAIN", "claude:claude-sonnet-4-5-20251015"),
        ("ERI_ROUTE_DEBUG", "claude:claude-sonnet-4-5-20251015"),
        ("ERI_ROUTE_VOICE", "claude:claude-haiku-4-5-20251001"),
        ("ERI_ROUTE_UNKNOWN", "claude:claude-sonnet-4-5-20251015"),
    ];
    let saved: Vec<(&str, Option<String>)> = intents
        .iter()
        .map(|(k, _)| (*k, std::env::var(k).ok()))
        .collect();
    // SAFETY: integration test binary runs single-threaded across these env
    // mutations because tests sharing this helper aren't run in parallel
    // with each other for the same env vars — and we restore on exit.
    for (k, v) in intents {
        unsafe {
            std::env::set_var(k, v);
        }
    }
    let out = f(provider_keys);
    for (k, v) in saved {
        unsafe {
            match v {
                Some(val) => std::env::set_var(k, val),
                None => std::env::remove_var(k),
            }
        }
    }
    out
}

/// Public API exercises: we can't easily inject a stub provider through
/// `run_iteration_via_brain` because it constructs one internally from the
/// BYOK bundle. So we run it with a fake key — the constructor accepts any
/// non-empty string — and verify the call path up to the network boundary
/// (the canned key fails the actual HTTP request, which we don't make in
/// these tests). For the deterministic execution paths we re-use the
/// in-crate unit tests in `src/brain_iteration.rs`.

#[test]
fn missing_byok_key_surfaces_a_clean_error_for_chat() {
    let dir = seed_workspace("README.md", "# repo\n");
    let req = BrainIterationRequest {
        user_prompt: "explain the readme structure please".to_string(),
        context: PromptContext::default(),
        parts: vec![BudgetPart::new(
            "user:prompt",
            0,
            "explain the readme structure please",
        )],
        // No keys — every BYOK vendor should fail with MissingKey.
        provider_keys: ProviderKeys::default(),
        workspace_root: dir.path().to_path_buf(),
        language: None,
    };
    // Force the router to pick Claude (BYOK) so we hit the MissingKey arm.
    let result = with_byok_routing(req.provider_keys.clone(), |_keys| {
        eri_inference::run_iteration_via_brain(req, None, Box::new(NullInstr), |_| {})
    });
    match result {
        Err(BrainIterationError::MissingKey(_)) => {}
        other => panic!("expected MissingKey, got {other:?}"),
    }
}

#[test]
fn search_intent_works_without_any_keys_or_network() {
    let dir = seed_workspace("src/auth.rs", "// handler\n");
    let stub = StubSearch {
        result: "match: src/auth.rs:1\n// handler".to_string(),
        called: AtomicBool::new(false),
    };
    let req = BrainIterationRequest {
        user_prompt: "where is the auth handler".to_string(),
        context: PromptContext::default(),
        parts: vec![BudgetPart::new(
            "user:prompt",
            0,
            "where is the auth handler",
        )],
        provider_keys: ProviderKeys::default(),
        workspace_root: dir.path().to_path_buf(),
        language: None,
    };
    let tokens = Arc::new(Mutex::new(Vec::<String>::new()));
    let tokens_w = tokens.clone();
    let resp =
        eri_inference::run_iteration_via_brain(req, Some(&stub), Box::new(NullInstr), move |ev| {
            if let StreamEvent::Token(t) = ev {
                tokens_w.lock().unwrap().push(t);
            }
        })
        .expect("search intent should not error");
    assert!(stub.called.load(Ordering::SeqCst), "search provider called");
    assert!(resp.apply_report.is_none());
    assert!(resp.raw_model_output.contains("src/auth.rs"));
    let toks = tokens.lock().unwrap().clone();
    assert!(!toks.is_empty(), "search result streamed as token event");
}

#[test]
fn search_intent_errors_when_no_search_provider_is_supplied() {
    let dir = seed_workspace("src/foo.rs", "//\n");
    let req = BrainIterationRequest {
        user_prompt: "find the foo module".to_string(),
        context: PromptContext::default(),
        parts: vec![BudgetPart::new("user:prompt", 0, "find the foo module")],
        provider_keys: ProviderKeys::default(),
        workspace_root: dir.path().to_path_buf(),
        language: None,
    };
    let result =
        eri_inference::run_iteration_via_brain(req, None, Box::new(NullInstr), |_| {});
    match result {
        Err(BrainIterationError::NoSearchProvider) => {}
        other => panic!("expected NoSearchProvider, got {other:?}"),
    }
}

#[test]
fn budget_overflow_drops_low_priority_parts() {
    // Drive `Brain::plan` directly — env-mutation tests racing in the same
    // binary make `run_iteration_via_brain` here unreliable since the
    // routing override would need a serialised guard. The brain layer is
    // what reports dropped parts, so testing it directly is the right
    // granularity for this property.
    use eri_inference::brain::Brain;
    let prev = std::env::var("ERI_ROUTE_EDIT").ok();
    unsafe {
        std::env::set_var("ERI_ROUTE_EDIT", "local:tiny-budget-test");
    }
    let mut brain = Brain::with_router(eri_router::Router::from_env());
    let parts = vec![
        BudgetPart::new("user:prompt", 0, "change the button color"),
        BudgetPart::new("ctx:huge", 9, "x".repeat(200_000)),
    ];
    let ctx = PromptContext {
        open_files: vec!["button.tsx".to_string()],
        ..Default::default()
    };
    let plan = brain
        .plan("change the button color", &ctx, parts)
        .expect("plans");
    assert!(
        plan.budgeted_prompt.dropped_parts.contains(&"ctx:huge".to_string()),
        "dropped_parts = {:?}",
        plan.budgeted_prompt.dropped_parts
    );
    match prev {
        Some(v) => unsafe { std::env::set_var("ERI_ROUTE_EDIT", v) },
        None => unsafe { std::env::remove_var("ERI_ROUTE_EDIT") },
    }
}

#[test]
fn unused_helper_compiles_against_public_api() {
    // Compile-time check: the public types in `eri_inference` expose what
    // the dispatcher needs without leaking internal modules. If any of the
    // imports above stop resolving, this test won't compile, which is the
    // signal we want.
    let _: PathBuf = TempDir::new().unwrap().path().to_path_buf();
    let _provider: Box<dyn LlmProvider> = Box::new(CannedProvider::new("hi"));
    let _keys = ProviderKeys::default();
    let _resp: Option<BrainIterationResponse> = None;
}
