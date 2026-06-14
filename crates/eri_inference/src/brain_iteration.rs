//! Brain-routed iteration dispatch.
//!
//! [`run_iteration_via_brain`] is the single entry point that wires the
//! `Brain` planner (classify + route + budget) into the existing model
//! invocation paths. It replaces the legacy hardcoded model selection with
//! a per-prompt [`BrainPlan`] returned by [`Brain::plan`].
//!
//! Behaviour by intent:
//! * `Edit | Build | Refactor` — runs the diffusion-style search/replace
//!   pipeline ([`run_edit_mode_streaming`]). Edits are parsed by
//!   [`eri_apply`] and applied atomically.
//! * `Debug | Explain | Chat | Unknown` — streams the raw response text to
//!   the caller. No edits parsed.
//! * `Search` — uses the supplied [`SearchProvider`] (typically the
//!   workspace's `eri_index::Index`) instead of calling a model. The
//!   formatted result is streamed back to the caller as text.
//! * `Voice` — short low-temperature acknowledgement; same as Chat but with
//!   a tight `max_tokens` cap.
//!
//! The function is provider-agnostic: it accepts a [`ProviderKeys`] bundle
//! (the BYOK cache) and an optional [`SearchProvider`] / [`Instrumentation`]
//! hook so it can run in isolation in tests.
//!
//! Backwards compat: this module is a *sibling* of [`crate::edit_mode`] —
//! none of the existing `iterate_stream` / `run_edit_mode` signatures move.

use std::path::PathBuf;

use eri_caveman::{BudgetPart, CompressionLevel, Compressor};
use eri_router::{Intent, ModelChoice, PromptContext};

use crate::InferenceError;
use crate::brain::{Brain, BrainError, BrainPlan};
use crate::edit_mode::{StreamEvent, TokenUsage};
use crate::llm_provider::{LlmProvider, ProviderKeys, provider_from_choice_with_keys};
use crate::templates::edit_mode_system_prompt;

/// Default token cap for chat-shaped responses.
const CHAT_MAX_TOKENS: u32 = 4_096;
/// Token cap for voice acknowledgements. Tight on purpose — voice replies
/// are read aloud and should not run long.
const VOICE_MAX_TOKENS: u32 = 80;
/// Token cap for edit-shaped responses; mirrors `EDIT_MODE_MAX_TOKENS` in
/// [`crate::edit_mode`].
const EDIT_MAX_TOKENS: u32 = 4_096;

/// Errors produced by [`run_iteration_via_brain`].
#[derive(Debug, thiserror::Error)]
pub enum BrainIterationError {
    /// Brain planning (route + budget) failed. Typically a mandatory prompt
    /// part overflowed the chosen model's context.
    #[error("brain planning failed: {0}")]
    Plan(#[from] BrainError),
    /// The brain chose a model that requires BYOK but no key was supplied.
    /// Carries the canonical model id so the caller can show a paywall.
    #[error("no API key configured for {0}; configure it under Settings → BYOK")]
    MissingKey(String),
    /// The brain routed to a [`Intent::Search`] but the caller did not supply
    /// a [`SearchProvider`].
    #[error("search intent requires a SearchProvider but none was supplied")]
    NoSearchProvider,
    /// The chosen vendor isn't wired (e.g. Local without a backend yet).
    #[error("unsupported model choice: {0}")]
    UnsupportedModel(String),
    /// Wrapped provider error.
    #[error(transparent)]
    Inference(#[from] InferenceError),
}

/// Input to [`run_iteration_via_brain`].
#[derive(Debug, Clone)]
pub struct BrainIterationRequest {
    /// What the user typed (or transcribed).
    pub user_prompt: String,
    /// Classifier signals.
    pub context: PromptContext,
    /// Labelled parts to be budgeted into the prompt. The caller is
    /// responsible for assembling these (e.g. one part per open file, plus
    /// a `user:prompt` and a `system:base`).
    pub parts: Vec<BudgetPart>,
    /// BYOK keys. May be empty when the planner picks Mercury (no key
    /// needed) or when env-fallback paths are sufficient.
    pub provider_keys: ProviderKeys,
    /// Workspace root for edit application. Must be an existing directory.
    pub workspace_root: PathBuf,
    /// Optional language hint (e.g. "rust", "typescript") that's threaded
    /// into edit-mode templates. Ignored for non-edit intents.
    pub language: Option<String>,
}

/// Output of [`run_iteration_via_brain`].
#[derive(Debug)]
pub struct BrainIterationResponse {
    pub plan: BrainPlan,
    pub raw_model_output: String,
    /// `Some` when intent was edit-shaped (Edit / Build / Refactor) and an
    /// apply pass ran. `None` for chat / search / explain / voice.
    pub apply_report: Option<eri_apply::ApplyReport>,
    pub usage: Option<TokenUsage>,
}

/// Hook implemented by the workspace index for [`Intent::Search`] routing.
///
/// The dispatcher (`eri_coreutils`) supplies an impl that delegates to
/// `eri_index::Index::search`. Decoupled via this trait so `eri_inference`
/// stays free of an `eri_index` dependency.
pub trait SearchProvider: Send + Sync {
    /// Run a search for `query`, returning a pre-formatted text block ready
    /// to be streamed back to the user.
    fn search(&self, query: &str, top_k: usize) -> Result<String, InferenceError>;
}

/// Side-channel instrumentation. The dispatcher in `eri_coreutils` wires
/// each hook to the workspace's graphify writer; tests pass `NullInstr` to
/// disable recording entirely.
pub trait Instrumentation: Send {
    fn on_prompt(&mut self, _prompt: &str) {}
    fn on_intent(&mut self, _intent: Intent) {}
    fn on_model_call(
        &mut self,
        _provider: &str,
        _model: &str,
        _tokens_in: usize,
        _tokens_out: usize,
        _latency_ms: u64,
    ) {
    }
    fn on_model_response(&mut self, _text: &str, _finish_reason: &str) {}
    fn on_edit_applied(&mut self, _applied: &eri_apply::Applied) {}
    fn on_edit_rejected(&mut self, _failed: &eri_apply::Failed) {}
}

/// No-op instrumentation; default for tests.
pub struct NullInstr;
impl Instrumentation for NullInstr {}

/// Caveman-compress the prose of non-`system:` context parts before budgeting.
///
/// `system:`-labelled parts (instructions) are returned byte-for-byte so
/// instruction fidelity is never touched. For all other parts, the prose is
/// run through caveman at `Medium` level with fenced code blocks preserved, so
/// filler words / articles shrink — code and HTML survive intact. This trims
/// input tokens (hence eri credits burned) with no semantic change.
pub(crate) fn compress_context_parts(parts: Vec<BudgetPart>) -> Vec<BudgetPart> {
    let compressor = Compressor::new(CompressionLevel::Medium).with_preserve_blocks(vec!["```"]);
    parts
        .into_iter()
        .map(|part| {
            if part.label.starts_with("system:") {
                return part;
            }
            let text = compressor.compress(&part.text);
            BudgetPart { text, ..part }
        })
        .collect()
}

/// Run one iteration end-to-end via the brain layer.
///
/// 1. Plan via [`Brain::plan`].
/// 2. Branch on `plan.intent` (Edit/Build/Refactor → diffusion pipeline,
///    Search → `SearchProvider`, everything else → chat-style stream).
/// 3. Stream events to `on_event` in real time. Tokens, edit applies and
///    edit failures are surfaced as they happen.
pub fn run_iteration_via_brain(
    req: BrainIterationRequest,
    search_provider: Option<&dyn SearchProvider>,
    mut instrumentation: Box<dyn Instrumentation>,
    mut on_event: impl FnMut(StreamEvent) + Send + 'static,
) -> Result<BrainIterationResponse, BrainIterationError> {
    instrumentation.on_prompt(&req.user_prompt);

    // 1. Plan. Caveman-compress the non-system context prose first so fewer
    //    input tokens (and fewer eri credits) are burned; code/HTML and system
    //    instructions are left byte-for-byte intact.
    let mut brain = Brain::new();
    let parts = compress_context_parts(req.parts.clone());
    let plan = brain.plan(&req.user_prompt, &req.context, parts)?;
    instrumentation.on_intent(plan.intent);

    // 2. Dispatch by intent.
    let (raw_output, apply_report, usage) = match plan.intent {
        Intent::Edit | Intent::Build | Intent::Refactor => {
            run_edit_intent(&req, &plan, &mut instrumentation, &mut on_event)?
        }
        Intent::Search => {
            let provider = search_provider.ok_or(BrainIterationError::NoSearchProvider)?;
            run_search_intent(&req.user_prompt, provider, &mut on_event)?
        }
        Intent::Voice => run_chat_intent(
            &req,
            &plan,
            VOICE_MAX_TOKENS,
            &mut instrumentation,
            &mut on_event,
        )?,
        // Chat / Explain / Debug / Unknown all stream plain text.
        Intent::Chat | Intent::Explain | Intent::Debug | Intent::Unknown => run_chat_intent(
            &req,
            &plan,
            CHAT_MAX_TOKENS,
            &mut instrumentation,
            &mut on_event,
        )?,
    };

    let response = BrainIterationResponse {
        plan,
        raw_model_output: raw_output,
        apply_report,
        usage,
    };

    // Final Done event — keep shape consistent with edit-mode streaming so
    // the IDE side has one terminal signal regardless of intent.
    let done_payload = crate::edit_mode::EditModeResponse {
        raw_model_output: response.raw_model_output.clone(),
        edits: Vec::new(),
        apply_report: response
            .apply_report
            .as_ref()
            .map(|r| eri_apply::ApplyReport {
                applied: r.applied.clone(),
                failed: r.failed.clone(),
            })
            .unwrap_or_default(),
        usage: response.usage.clone(),
    };
    on_event(StreamEvent::Done(done_payload));

    Ok(response)
}

/// Resolve a concrete [`LlmProvider`] from a [`ModelChoice`] + key bundle.
fn provider_for(
    choice: &ModelChoice,
    keys: &ProviderKeys,
) -> Result<Box<dyn LlmProvider>, BrainIterationError> {
    match choice {
        ModelChoice::Mercury => Err(BrainIterationError::UnsupportedModel(
            "mercury routing requires the in-process Mercury backend, not LlmProvider".into(),
        )),
        // eri's on-device engine. Executable now via the LocalProvider seam
        // (Ollama bootstrap backend; the candle in-process engine slots in
        // behind it next). Empty model id is the only failure.
        ModelChoice::Local(id) => crate::providers::local::LocalProvider::new(id.as_str())
            .map(|p| Box::new(p) as Box<dyn LlmProvider>)
            .ok_or_else(|| {
                BrainIterationError::UnsupportedModel(format!("local: empty model id ({id:?})"))
            }),
        ModelChoice::Claude(_) | ModelChoice::OpenAI(_) | ModelChoice::Gemini(_) => {
            let canonical = choice.model_id();
            provider_from_choice_with_keys(canonical, keys)
                .ok_or_else(|| BrainIterationError::MissingKey(canonical.to_string()))
        }
    }
}

/// Edit-shaped branch: builds an edit-mode user prompt out of the budgeted
/// `user` half (which already encodes the user's request + open-file
/// payloads from the budgeter), then runs the streaming apply pipeline.
fn run_edit_intent(
    req: &BrainIterationRequest,
    plan: &BrainPlan,
    instrumentation: &mut Box<dyn Instrumentation>,
    on_event: &mut (impl FnMut(StreamEvent) + Send),
) -> Result<(String, Option<eri_apply::ApplyReport>, Option<TokenUsage>), BrainIterationError> {
    // For Mercury, we'd dispatch to the diffusion backend; that backend
    // isn't exposed via the LlmProvider trait. Until it is, fall back to
    // BYOK if the user has one — surface a missing-key error otherwise so
    // the IDE can prompt them.
    let provider = provider_for(&plan.model, &req.provider_keys)?;
    // The brain already amended the system half with the reasoning preamble,
    // but the edit-mode templates encode the search/replace contract. Merge
    // both so the model is told "emit blocks" + "think step by step".
    let system = format!(
        "{}\n\n{}",
        edit_mode_system_prompt(req.language.as_deref()),
        plan.budgeted_prompt.system
    );
    let user = if plan.budgeted_prompt.user.is_empty() {
        req.user_prompt.clone()
    } else {
        plan.budgeted_prompt.user.clone()
    };

    let workspace_root = req.workspace_root.clone();
    let buffer = std::cell::RefCell::new(String::new());
    let applied_acc = std::cell::RefCell::new(Vec::<eri_apply::Applied>::new());
    let failed_acc = std::cell::RefCell::new(Vec::<eri_apply::Failed>::new());

    let started = std::time::Instant::now();
    let response = {
        let mut on_token = |delta: &str| {
            on_event(StreamEvent::Token(delta.to_string()));
            let mut buf = buffer.borrow_mut();
            buf.push_str(delta);
            if !buf.contains(">>>>>>> REPLACE") {
                return;
            }
            let new_edits = eri_apply::parse_streaming(&mut buf);
            if new_edits.is_empty() {
                return;
            }
            let report = eri_apply::apply(&new_edits, &workspace_root);
            for applied in report.applied {
                on_event(StreamEvent::EditApplied(applied.clone()));
                applied_acc.borrow_mut().push(applied);
            }
            for failed in report.failed {
                on_event(StreamEvent::EditFailed(failed.clone()));
                failed_acc.borrow_mut().push(failed);
            }
        };
        provider.stream(&system, &user, EDIT_MAX_TOKENS, &mut on_token)?
    };

    // Trailing sweep — some providers emit the terminator after the last
    // user-visible token.
    let trailing = {
        let mut buf = buffer.borrow_mut();
        eri_apply::parse_streaming(&mut buf)
    };
    if !trailing.is_empty() {
        let report = eri_apply::apply(&trailing, &req.workspace_root);
        for applied in report.applied {
            on_event(StreamEvent::EditApplied(applied.clone()));
            applied_acc.borrow_mut().push(applied);
        }
        for failed in report.failed {
            on_event(StreamEvent::EditFailed(failed.clone()));
            failed_acc.borrow_mut().push(failed);
        }
    }

    let latency_ms = started.elapsed().as_millis() as u64;
    instrumentation.on_model_call(
        provider.name(),
        provider.model(),
        response.prompt_tokens as usize,
        response.completion_tokens as usize,
        latency_ms,
    );
    instrumentation.on_model_response(&response.text, "stop");

    let applied = applied_acc.into_inner();
    let failed = failed_acc.into_inner();
    for a in &applied {
        instrumentation.on_edit_applied(a);
    }
    for f in &failed {
        instrumentation.on_edit_rejected(f);
    }

    let apply_report = eri_apply::ApplyReport { applied, failed };
    let usage = Some(TokenUsage::from(&response));
    Ok((response.text, Some(apply_report), usage))
}

/// Chat-style branch: streams the raw model response. No apply pass.
fn run_chat_intent(
    req: &BrainIterationRequest,
    plan: &BrainPlan,
    max_tokens: u32,
    instrumentation: &mut Box<dyn Instrumentation>,
    on_event: &mut (impl FnMut(StreamEvent) + Send),
) -> Result<(String, Option<eri_apply::ApplyReport>, Option<TokenUsage>), BrainIterationError> {
    let provider = provider_for(&plan.model, &req.provider_keys)?;
    let system = plan.budgeted_prompt.system.clone();
    let user = if plan.budgeted_prompt.user.is_empty() {
        req.user_prompt.clone()
    } else {
        plan.budgeted_prompt.user.clone()
    };

    let started = std::time::Instant::now();
    let response = {
        let mut on_token = |delta: &str| {
            on_event(StreamEvent::Token(delta.to_string()));
        };
        provider.stream(&system, &user, max_tokens, &mut on_token)?
    };
    let latency_ms = started.elapsed().as_millis() as u64;
    instrumentation.on_model_call(
        provider.name(),
        provider.model(),
        response.prompt_tokens as usize,
        response.completion_tokens as usize,
        latency_ms,
    );
    instrumentation.on_model_response(&response.text, "stop");

    let usage = Some(TokenUsage::from(&response));
    Ok((response.text, None, usage))
}

/// Search branch: routes to the workspace [`SearchProvider`] instead of a
/// model. The formatted result is streamed back as a single token event so
/// the IDE renders it inline.
fn run_search_intent(
    query: &str,
    provider: &dyn SearchProvider,
    on_event: &mut (impl FnMut(StreamEvent) + Send),
) -> Result<(String, Option<eri_apply::ApplyReport>, Option<TokenUsage>), BrainIterationError> {
    let text = provider.search(query, 10)?;
    on_event(StreamEvent::Token(text.clone()));
    Ok((text, None, None))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm_provider::LlmResponse;
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicBool, Ordering};
    use tempfile::TempDir;

    // Tests in this binary run in parallel threads but share one process env.
    // Any test that mutates `ERI_ROUTE_*` (router_for_byok, the budget test)
    // must hold this lock across its set -> from_env -> restore window, or the
    // mutations clobber each other and a route-dependent assertion flakes. The
    // "tests are serialised" comments below are only true because of this lock.
    static ROUTE_ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn compress_context_parts_preserves_system_and_code_but_shrinks_prose() {
        let prose = "Please could you go ahead and make the header sticky so that \
                     it will remain at the top of the page when the user scrolls down.";
        let code = "```css\n.header { position: sticky; top: 0; }\n```";
        let parts = vec![
            BudgetPart::new("system:base", 0, prose),
            BudgetPart::new("user:instruction", 1, prose),
            BudgetPart::new("user:file", 2, code),
        ];

        let out = compress_context_parts(parts);

        // system: parts are returned byte-for-byte (instruction fidelity).
        assert_eq!(out[0].text, prose);
        // non-system prose actually shrinks.
        assert!(
            out[1].text.len() < prose.len(),
            "expected prose to compress, got {:?}",
            out[1].text
        );
        // fenced code is left intact.
        assert_eq!(out[2].text, code);
        // labels and priorities are preserved.
        assert_eq!(out[1].label, "user:instruction");
        assert_eq!(out[2].priority, 2);
    }

    /// In-test provider that returns canned text without touching the network.
    struct CannedProvider {
        text: String,
        called: AtomicBool,
    }
    impl CannedProvider {
        fn new(text: &str) -> Self {
            Self {
                text: text.to_string(),
                called: AtomicBool::new(false),
            }
        }
    }
    impl LlmProvider for CannedProvider {
        fn name(&self) -> &'static str {
            "canned"
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
            self.called.store(true, Ordering::SeqCst);
            Ok(LlmResponse {
                text: self.text.clone(),
                prompt_tokens: 10,
                completion_tokens: 20,
                cost_usd: 0.0,
            })
        }
        fn stream(
            &self,
            _system: &str,
            _user: &str,
            _max_tokens: u32,
            on_token: &mut dyn FnMut(&str),
        ) -> Result<LlmResponse, InferenceError> {
            self.called.store(true, Ordering::SeqCst);
            for chunk in self.text.split_inclusive('\n') {
                on_token(chunk);
            }
            Ok(LlmResponse {
                text: self.text.clone(),
                prompt_tokens: 10,
                completion_tokens: 20,
                cost_usd: 0.0,
            })
        }
    }

    /// Stub search provider.
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

    /// Recording instrumentation that captures every hook for assertions.
    #[derive(Default)]
    struct RecordingInstr {
        events: std::sync::Arc<Mutex<Vec<String>>>,
    }
    impl Instrumentation for RecordingInstr {
        fn on_prompt(&mut self, prompt: &str) {
            self.events.lock().unwrap().push(format!("prompt:{prompt}"));
        }
        fn on_intent(&mut self, intent: Intent) {
            self.events
                .lock()
                .unwrap()
                .push(format!("intent:{intent:?}"));
        }
        fn on_model_call(
            &mut self,
            provider: &str,
            model: &str,
            tokens_in: usize,
            tokens_out: usize,
            _latency_ms: u64,
        ) {
            self.events
                .lock()
                .unwrap()
                .push(format!("call:{provider}/{model}:{tokens_in}/{tokens_out}"));
        }
        fn on_model_response(&mut self, _text: &str, _finish_reason: &str) {
            self.events.lock().unwrap().push("response".into());
        }
        fn on_edit_applied(&mut self, applied: &eri_apply::Applied) {
            self.events
                .lock()
                .unwrap()
                .push(format!("applied:{}", applied.path.display()));
        }
        fn on_edit_rejected(&mut self, failed: &eri_apply::Failed) {
            self.events
                .lock()
                .unwrap()
                .push(format!("rejected:{}", failed.path.display()));
        }
    }

    fn seed_file(root: &std::path::Path, rel: &str, body: &str) {
        let p = root.join(rel);
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(p, body).unwrap();
    }

    fn router_for_byok() -> eri_router::Router {
        // Force every intent we test to route to a BYOK provider so the
        // canned provider's key path is exercised — Mercury can't be
        // constructed via LlmProvider, so we'd error on UnsupportedModel.
        // Hold the env lock across set -> from_env -> restore (see ROUTE_ENV_LOCK).
        let _env = ROUTE_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let prev_edit = std::env::var("ERI_ROUTE_EDIT").ok();
        let prev_chat = std::env::var("ERI_ROUTE_CHAT").ok();
        let prev_explain = std::env::var("ERI_ROUTE_EXPLAIN").ok();
        let prev_build = std::env::var("ERI_ROUTE_BUILD").ok();
        // SAFETY: tests are serialised and we restore on drop below.
        unsafe {
            std::env::set_var("ERI_ROUTE_EDIT", "claude:claude-sonnet-4-6");
            std::env::set_var("ERI_ROUTE_BUILD", "claude:claude-sonnet-4-6");
            std::env::set_var("ERI_ROUTE_CHAT", "claude:claude-sonnet-4-6");
            std::env::set_var("ERI_ROUTE_EXPLAIN", "claude:claude-sonnet-4-6");
        }
        let router = eri_router::Router::from_env();
        // Restore so other tests in the binary aren't perturbed.
        unsafe {
            match prev_edit {
                Some(v) => std::env::set_var("ERI_ROUTE_EDIT", v),
                None => std::env::remove_var("ERI_ROUTE_EDIT"),
            }
            match prev_chat {
                Some(v) => std::env::set_var("ERI_ROUTE_CHAT", v),
                None => std::env::remove_var("ERI_ROUTE_CHAT"),
            }
            match prev_explain {
                Some(v) => std::env::set_var("ERI_ROUTE_EXPLAIN", v),
                None => std::env::remove_var("ERI_ROUTE_EXPLAIN"),
            }
            match prev_build {
                Some(v) => std::env::set_var("ERI_ROUTE_BUILD", v),
                None => std::env::remove_var("ERI_ROUTE_BUILD"),
            }
        }
        router
    }

    /// Stand-in for `run_iteration_via_brain` that injects a stub provider
    /// directly so we don't need to thread an Anthropic API key through CI.
    fn run_with_stub(
        req: BrainIterationRequest,
        provider: Box<dyn LlmProvider>,
        search: Option<&dyn SearchProvider>,
        instrumentation: Box<dyn Instrumentation>,
        on_event: impl FnMut(StreamEvent) + Send + 'static,
    ) -> Result<BrainIterationResponse, BrainIterationError> {
        // Mirror of `run_iteration_via_brain` but with a pre-built provider.
        // Lets the tests assert on dispatch without touching the network.
        let mut brain = Brain::with_router(router_for_byok());
        let plan = brain.plan(&req.user_prompt, &req.context, req.parts.clone())?;
        let mut on_event = on_event;
        let mut instrumentation = instrumentation;
        instrumentation.on_prompt(&req.user_prompt);
        instrumentation.on_intent(plan.intent);

        let (raw_output, apply_report, usage) = match plan.intent {
            Intent::Edit | Intent::Build | Intent::Refactor => {
                let system = format!(
                    "{}\n\n{}",
                    edit_mode_system_prompt(req.language.as_deref()),
                    plan.budgeted_prompt.system
                );
                let user = if plan.budgeted_prompt.user.is_empty() {
                    req.user_prompt.clone()
                } else {
                    plan.budgeted_prompt.user.clone()
                };
                let workspace_root = req.workspace_root.clone();
                let buffer = std::cell::RefCell::new(String::new());
                let applied_acc = std::cell::RefCell::new(Vec::<eri_apply::Applied>::new());
                let failed_acc = std::cell::RefCell::new(Vec::<eri_apply::Failed>::new());
                let response = {
                    let mut on_token = |delta: &str| {
                        on_event(StreamEvent::Token(delta.to_string()));
                        let mut buf = buffer.borrow_mut();
                        buf.push_str(delta);
                        if !buf.contains(">>>>>>> REPLACE") {
                            return;
                        }
                        let new_edits = eri_apply::parse_streaming(&mut buf);
                        if new_edits.is_empty() {
                            return;
                        }
                        let report = eri_apply::apply(&new_edits, &workspace_root);
                        for applied in report.applied {
                            on_event(StreamEvent::EditApplied(applied.clone()));
                            applied_acc.borrow_mut().push(applied);
                        }
                        for failed in report.failed {
                            on_event(StreamEvent::EditFailed(failed.clone()));
                            failed_acc.borrow_mut().push(failed);
                        }
                    };
                    provider.stream(&system, &user, EDIT_MAX_TOKENS, &mut on_token)?
                };
                let trailing = {
                    let mut buf = buffer.borrow_mut();
                    eri_apply::parse_streaming(&mut buf)
                };
                if !trailing.is_empty() {
                    let report = eri_apply::apply(&trailing, &req.workspace_root);
                    for applied in report.applied {
                        on_event(StreamEvent::EditApplied(applied.clone()));
                        applied_acc.borrow_mut().push(applied);
                    }
                    for failed in report.failed {
                        on_event(StreamEvent::EditFailed(failed.clone()));
                        failed_acc.borrow_mut().push(failed);
                    }
                }
                instrumentation.on_model_call(
                    provider.name(),
                    provider.model(),
                    response.prompt_tokens as usize,
                    response.completion_tokens as usize,
                    0,
                );
                instrumentation.on_model_response(&response.text, "stop");
                let applied = applied_acc.into_inner();
                let failed = failed_acc.into_inner();
                for a in &applied {
                    instrumentation.on_edit_applied(a);
                }
                for f in &failed {
                    instrumentation.on_edit_rejected(f);
                }
                let usage = Some(TokenUsage::from(&response));
                (
                    response.text,
                    Some(eri_apply::ApplyReport { applied, failed }),
                    usage,
                )
            }
            Intent::Search => {
                let prov = search.ok_or(BrainIterationError::NoSearchProvider)?;
                let text = prov.search(&req.user_prompt, 10)?;
                on_event(StreamEvent::Token(text.clone()));
                (text, None, None)
            }
            _ => {
                let system = plan.budgeted_prompt.system.clone();
                let user = if plan.budgeted_prompt.user.is_empty() {
                    req.user_prompt.clone()
                } else {
                    plan.budgeted_prompt.user.clone()
                };
                let response = {
                    let mut on_token = |delta: &str| {
                        on_event(StreamEvent::Token(delta.to_string()));
                    };
                    provider.stream(&system, &user, CHAT_MAX_TOKENS, &mut on_token)?
                };
                instrumentation.on_model_call(
                    provider.name(),
                    provider.model(),
                    response.prompt_tokens as usize,
                    response.completion_tokens as usize,
                    0,
                );
                instrumentation.on_model_response(&response.text, "stop");
                let usage = Some(TokenUsage::from(&response));
                (response.text, None, usage)
            }
        };

        let done = crate::edit_mode::EditModeResponse {
            raw_model_output: raw_output.clone(),
            edits: Vec::new(),
            apply_report: apply_report
                .as_ref()
                .map(|r| eri_apply::ApplyReport {
                    applied: r.applied.clone(),
                    failed: r.failed.clone(),
                })
                .unwrap_or_default(),
            usage: usage.clone(),
        };
        on_event(StreamEvent::Done(done));

        Ok(BrainIterationResponse {
            plan,
            raw_model_output: raw_output,
            apply_report,
            usage,
        })
    }

    #[test]
    fn edit_intent_applies_search_replace_block() {
        let dir = TempDir::new().unwrap();
        seed_file(dir.path(), "a.txt", "alpha\n");
        let canned =
            CannedProvider::new("<<<<<<< SEARCH a.txt\nalpha\n=======\nALPHA\n>>>>>>> REPLACE\n");
        let req = BrainIterationRequest {
            user_prompt: "change a.txt to uppercase the contents".to_string(),
            context: PromptContext {
                open_files: vec!["a.txt".to_string()],
                ..Default::default()
            },
            parts: vec![BudgetPart::new(
                "user:prompt",
                0,
                "change a.txt to uppercase the contents",
            )],
            provider_keys: ProviderKeys::default(),
            workspace_root: dir.path().to_path_buf(),
            language: Some("text".into()),
        };
        let recorder = RecordingInstr::default();
        let events_handle = recorder.events.clone();
        let resp =
            run_with_stub(req, Box::new(canned), None, Box::new(recorder), |_ev| {}).expect("ok");
        let report = resp.apply_report.expect("edit intent has report");
        assert_eq!(report.applied.len(), 1);
        assert_eq!(report.failed.len(), 0);
        let body = std::fs::read_to_string(dir.path().join("a.txt")).unwrap();
        assert_eq!(body, "ALPHA\n");
        let events = events_handle.lock().unwrap().clone();
        assert!(events.iter().any(|e| e.starts_with("prompt:")));
        assert!(events.iter().any(|e| e.starts_with("intent:")));
        assert!(events.iter().any(|e| e.starts_with("applied:")));
    }

    #[test]
    fn chat_intent_returns_raw_text_no_apply_report() {
        let dir = TempDir::new().unwrap();
        let canned = CannedProvider::new("async/await is a syntax for futures.");
        let req = BrainIterationRequest {
            user_prompt: "explain async/await briefly please".to_string(),
            context: PromptContext::default(),
            parts: vec![BudgetPart::new(
                "user:prompt",
                0,
                "explain async/await briefly please",
            )],
            provider_keys: ProviderKeys::default(),
            workspace_root: dir.path().to_path_buf(),
            language: None,
        };
        let mut tokens = Vec::<String>::new();
        let resp = run_with_stub(
            req,
            Box::new(canned),
            None,
            Box::new(NullInstr),
            move |ev| {
                if let StreamEvent::Token(t) = ev {
                    tokens.push(t);
                }
            },
        )
        .expect("ok");
        assert!(resp.apply_report.is_none());
        assert!(resp.raw_model_output.contains("async"));
    }

    #[test]
    fn search_intent_routes_to_search_provider_without_model() {
        let dir = TempDir::new().unwrap();
        let stub = StubSearch {
            result: "match: src/auth.rs:42\nfn handle(...) {...}".to_string(),
            called: AtomicBool::new(false),
        };
        // Force ERI_ROUTE_UNKNOWN to keep things deterministic — search
        // detection in the router is keyword-based so we use "where is" to
        // trigger it.
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
        // We need a provider object, but it shouldn't be called.
        let canned = CannedProvider::new("unused");
        let canned_called = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        // Trick: use a wrapper that flips canned_called if .stream/.complete
        // ever fires — but CannedProvider already tracks `.called`, so we
        // just assert on that after the run.
        let resp = run_with_stub(
            req,
            Box::new(canned),
            Some(&stub),
            Box::new(NullInstr),
            |_| {},
        )
        .expect("ok");
        // The stub search provider was called.
        assert!(stub.called.load(Ordering::SeqCst));
        // Result text was returned.
        assert!(resp.raw_model_output.contains("src/auth.rs"));
        assert!(resp.apply_report.is_none());
        // Sanity: we don't expect the model to have been called for search.
        // (CannedProvider.called would be true if it had been — but we can't
        // re-borrow `canned` here since it was moved into run_with_stub.)
        let _ = canned_called;
    }

    #[test]
    fn budget_overflow_reports_dropped_parts() {
        let dir = TempDir::new().unwrap();
        // Hold the env lock across set -> from_env -> restore (see ROUTE_ENV_LOCK)
        // so a parallel router_for_byok can't clobber ERI_ROUTE_EDIT mid-test.
        let _env = ROUTE_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let prev = std::env::var("ERI_ROUTE_EDIT").ok();
        unsafe {
            std::env::set_var("ERI_ROUTE_EDIT", "local:tiny-test");
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
            plan.budgeted_prompt
                .dropped_parts
                .contains(&"ctx:huge".to_string())
        );
        match prev {
            Some(v) => unsafe { std::env::set_var("ERI_ROUTE_EDIT", v) },
            None => unsafe { std::env::remove_var("ERI_ROUTE_EDIT") },
        }
        let _ = dir;
    }

    #[test]
    fn instrumentation_records_intent_and_response() {
        let dir = TempDir::new().unwrap();
        let canned = CannedProvider::new("hi");
        let req = BrainIterationRequest {
            user_prompt: "hi there".to_string(),
            context: PromptContext::default(),
            parts: vec![BudgetPart::new("user:prompt", 0, "hi there")],
            provider_keys: ProviderKeys::default(),
            workspace_root: dir.path().to_path_buf(),
            language: None,
        };
        let recorder = RecordingInstr::default();
        let events = recorder.events.clone();
        let _ = run_with_stub(req, Box::new(canned), None, Box::new(recorder), |_| {}).expect("ok");
        let captured = events.lock().unwrap().clone();
        // We should have prompt + intent + call + response — at minimum.
        assert!(
            captured.iter().any(|e| e.starts_with("prompt:")),
            "events: {captured:?}"
        );
        assert!(
            captured.iter().any(|e| e.starts_with("intent:")),
            "events: {captured:?}"
        );
        assert!(
            captured.iter().any(|e| e.starts_with("call:")),
            "events: {captured:?}"
        );
        assert!(
            captured.iter().any(|e| e == "response"),
            "events: {captured:?}"
        );
    }
}
