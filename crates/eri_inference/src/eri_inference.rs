use std::{
    cell::RefCell,
    env,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::Duration,
};

use eri_core::{CandidatePatch, GazeTarget, IterEvent, PromptCtx};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub mod brain;
pub mod brain_iteration;
pub mod bug_finder;
pub mod code_assist;
pub mod costs;
pub mod edit_mode;
pub mod goose_backend;
pub mod integrations;
pub mod intent;
pub mod llm_provider;
pub mod pr;
pub mod pr_workflow;
pub mod providers;
pub mod social;
pub mod templates;
pub use brain::{Brain, BrainError, BrainPlan, BudgetedPrompt};
pub use brain_iteration::{
    BrainIterationError, BrainIterationRequest, BrainIterationResponse, Instrumentation, NullInstr,
    SearchProvider, run_iteration_via_brain,
};
pub use bug_finder::{
    BUG_FINDER_MAX_BUGS, Bug, Severity as BugSeverity, build_bug_finder_prompt,
    parse_bug_finder_response,
};
pub use code_assist::{
    DocStyle, build_code_explainer_prompt, build_doc_generator_prompt, build_refactor_prompt,
    build_test_generation_prompt,
};
pub use edit_mode::{
    EditModeRequest, EditModeResponse, StreamEvent, TokenUsage, run_edit_mode,
    run_edit_mode_streaming, run_iteration_via_edit_blocks,
};
pub use goose_backend::{AgentBackend, AgentChoice, GooseCliBackend};
pub use integrations::{
    AuthProvider, DbProvider, build_auth0_setup_prompt, build_clerk_setup_prompt,
    build_neon_postgres_prompt, build_stripe_checkout_prompt, build_supabase_auth_setup_prompt,
    build_supabase_postgres_prompt,
};
pub use intent::{
    AdaptiveClassifier, HeuristicClassifier, HybridClassifier, Intent, IntentClassifier,
    IntentContext, IntentDecision,
};
pub use llm_provider::{
    LlmProvider, LlmResponse, ProviderKeys, canonical_model_id, list_providers,
    provider_from_choice, provider_from_choice_with_keys,
};
pub use pr::{
    CommitSummary, GeneratedPr, build_commit_message_prompt, build_pr_description_prompt,
    parse_pr_response,
};
pub use pr_workflow::{PrWorkflowError, open_pr_workflow};
pub use social::{
    ERI_WAITLIST_URL, SOCIAL_THREAD_BEST_TIME, SOCIAL_THREAD_MAX_TWEETS, SOCIAL_THREAD_MIN_TWEETS,
    SOCIAL_THREAD_TWEET_CHAR_BUDGET, SocialThread, build_social_thread_prompt, parse_social_thread,
};
pub use templates::{
    EDIT_MODE_EMBED_BUDGET_CHARS, TEMPLATES, Template, edit_mode_system_prompt,
    edit_mode_user_prompt, match_template, template_by_slug,
};

pub trait InferenceBackend {
    fn iterate(
        &self,
        prompt_ctx: &PromptCtx,
        request: IterationRequest,
    ) -> Result<Vec<IterEvent>, InferenceError>;

    /// Streaming variant: emits each [`IterEvent`] through `on_event` as soon
    /// as it's available, rather than buffering the whole `Vec`. Default impl
    /// calls `iterate()` and replays the batch through the callback — backends
    /// that support SSE (e.g. [`MercuryBackend`]) override this to feed
    /// `DraftToken` events incrementally for live-streaming UX.
    ///
    /// `on_partial_html` is invoked from the same thread as `on_event`, at
    /// most every ~150ms while the stream is active, with the latest
    /// accumulated text the model has produced (still possibly wrapped in a
    /// diff fence). Backends call this so callers can write the in-flight
    /// HTML to disk and let the preview repaint chunk-by-chunk instead of
    /// waiting for the full response. The default impl ignores it because
    /// the non-streaming `iterate()` has no intermediate state.
    fn iterate_stream(
        &self,
        prompt_ctx: &PromptCtx,
        request: IterationRequest,
        on_event: &mut dyn FnMut(IterEvent),
        _on_partial_html: &mut dyn FnMut(&str),
    ) -> Result<(), InferenceError> {
        let events = self.iterate(prompt_ctx, request)?;
        for event in events {
            on_event(event);
        }
        Ok(())
    }
}

/// A search/replace pair extracted from Mercury's surgical-iteration output.
/// `search` is an exact substring of the current draft (with surrounding
/// context so it's unique); `replace` is what eri substitutes in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchReplaceBlock {
    pub search: String,
    pub replace: String,
}

/// Parse Mercury's surgical-iteration output into a list of search/replace
/// blocks. The expected wire format is the Aider/Cursor convention:
///
/// ```text
/// <<<<<<< SEARCH
/// <existing lines>
/// =======
/// <replacement lines>
/// >>>>>>> REPLACE
/// ```
///
/// Tolerant of leading prose: scans the whole response for marker triples.
/// Returns an empty Vec if no well-formed blocks were found.
pub fn parse_search_replace_blocks(response: &str) -> Vec<SearchReplaceBlock> {
    const SEARCH_MARKER: &str = "<<<<<<< SEARCH";
    const DIVIDER: &str = "=======";
    const REPLACE_MARKER: &str = ">>>>>>> REPLACE";

    let mut blocks = Vec::new();
    let mut rest = response;
    while let Some(start) = rest.find(SEARCH_MARKER) {
        let after_marker = &rest[start + SEARCH_MARKER.len()..];
        let body_start = match after_marker.find('\n') {
            Some(n) => n + 1,
            None => break,
        };
        let body = &after_marker[body_start..];
        let Some(div_idx) = body.find(DIVIDER) else {
            break;
        };
        let search_part = &body[..div_idx];
        let after_div = &body[div_idx + DIVIDER.len()..];
        let after_div = after_div.strip_prefix('\n').unwrap_or(after_div);
        let Some(end_idx) = after_div.find(REPLACE_MARKER) else {
            break;
        };
        let replace_part = &after_div[..end_idx];
        // Trim only the single trailing newline that the marker convention
        // produces — preserving meaningful whitespace inside the block.
        let search = search_part
            .strip_suffix('\n')
            .unwrap_or(search_part)
            .to_string();
        let replace = replace_part
            .strip_suffix('\n')
            .unwrap_or(replace_part)
            .to_string();
        if !search.is_empty() {
            blocks.push(SearchReplaceBlock { search, replace });
        }
        rest = &after_div[end_idx + REPLACE_MARKER.len()..];
    }
    blocks
}

/// Apply a list of search/replace blocks to a draft. Each block's `search`
/// must appear EXACTLY ONCE in the current state — if it appears zero or
/// multiple times, that block is skipped (the caller may fall back to a
/// full-file path). Returns the modified draft plus a count of successfully
/// applied vs skipped blocks.
pub fn apply_search_replace_blocks(
    draft: &str,
    blocks: &[SearchReplaceBlock],
) -> (String, usize, usize) {
    let mut out = draft.to_string();
    let mut applied = 0usize;
    let mut skipped = 0usize;
    for block in blocks {
        if block.search.is_empty() {
            skipped += 1;
            continue;
        }
        let count = out.matches(&block.search).count();
        if count == 1 {
            out = out.replacen(&block.search, &block.replace, 1);
            applied += 1;
        } else {
            eprintln!(
                "[eri.surgical] skipping block (search occurs {} times): {:?}",
                count,
                block.search.chars().take(60).collect::<String>()
            );
            skipped += 1;
        }
    }
    (out, applied, skipped)
}

/// Tool spec for Mercury 2's surgical iteration path. The `edit_html` function
/// takes a JSON-schema-typed list of `{search, replace}` pairs, which we map
/// directly to [`SearchReplaceBlock`]. Mercury 2 supports OpenAI-style function
/// calling on `/v1/chat/completions`, so we get the parser benefits of a typed
/// schema without leaving the chat endpoint.
fn edit_html_tool_spec() -> ToolSpec<'static> {
    ToolSpec {
        kind: "function",
        function: ToolFunctionSpec {
            name: "edit_html",
            description: "Apply one or more surgical search/replace edits to the user's current HTML draft. Each edit's `search` must be a unique, byte-for-byte substring of the current draft. The `replace` text substitutes in. Touch ONLY the lines the user asked about — leave every other byte of the file alone.",
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "edits": {
                        "type": "array",
                        "description": "Ordered list of search/replace pairs to apply to the current HTML draft.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "search": {
                                    "type": "string",
                                    "description": "Unique substring of the current draft to find. Must appear EXACTLY ONCE in the draft (include 1-3 lines of surrounding context if needed to disambiguate)."
                                },
                                "replace": {
                                    "type": "string",
                                    "description": "Replacement text. Keep minimal — do not 'improve' unrelated styling, comments, or whitespace."
                                }
                            },
                            "required": ["search", "replace"]
                        }
                    }
                },
                "required": ["edits"]
            }),
        },
    }
}

#[derive(Deserialize)]
struct EditHtmlArguments {
    #[serde(default)]
    edits: Vec<EditHtmlEdit>,
}

#[derive(Deserialize)]
struct EditHtmlEdit {
    #[serde(default)]
    search: String,
    #[serde(default)]
    replace: String,
}

/// Parse the streaming tool-call arguments (a JSON string concatenated across
/// chunks) into search/replace blocks. Skips edits with empty `search` — those
/// are unactionable.
pub fn parse_edit_html_tool_arguments(
    arguments: &str,
) -> Result<Vec<SearchReplaceBlock>, serde_json::Error> {
    let parsed: EditHtmlArguments = serde_json::from_str(arguments)?;
    Ok(parsed
        .edits
        .into_iter()
        .filter(|edit| !edit.search.is_empty())
        .map(|edit| SearchReplaceBlock {
            search: edit.search,
            replace: edit.replace,
        })
        .collect())
}

/// Extract a best-effort renderable HTML body from a possibly partial,
/// possibly diff-fenced model response. Used during streaming so we can
/// write the in-flight HTML to disk for the preview window to repaint.
///
/// Strategy:
/// 1. If the text contains `<!DOCTYPE` or `<html`, return everything from
///    that anchor through the end (so `<head>` partials work too).
/// 2. Strip leading `+ ` / `+` markers that unified-diff `+++ b/index.html`
///    bodies use, line by line.
/// 3. Drop a trailing code-fence delimiter if the model already closed it.
pub fn extract_partial_html_body(text: &str) -> Option<String> {
    let anchor = text
        .find("<!DOCTYPE")
        .or_else(|| text.find("<!doctype"))
        .or_else(|| text.find("<html"))?;
    let body = &text[anchor..];
    // Strip leading `+` (unified-diff addition lines) so partial diffs render
    // as raw HTML. Lines that don't start with `+` or `-` are passed through.
    let mut out = String::with_capacity(body.len());
    for line in body.split_inclusive('\n') {
        let line = if let Some(rest) = line.strip_prefix("+ ") {
            rest
        } else if let Some(rest) = line.strip_prefix('+') {
            rest
        } else if line.starts_with("```") {
            // End of a diff/code fence — stop here.
            break;
        } else if line.starts_with("@@") || line.starts_with("---") || line.starts_with("+++") {
            // Diff hunk header — skip.
            continue;
        } else {
            line
        };
        out.push_str(line);
    }
    if out.trim().is_empty() {
        None
    } else {
        Some(out)
    }
}

/// Given the merged file Mercury Edit 2 returned for a rewrite_selection
/// call, slice out the rewritten replacement by stripping the verbatim
/// `prefix` and `suffix` from either end.
///
/// Mercury Edit 2 preserves prefix/suffix byte-for-byte (that's what makes
/// the apply path a "merge", not a "regeneration"), so the longest common
/// prefix + suffix between `merged` and `(prefix, suffix)` is the part that
/// did NOT change; whatever's in the middle is the new replacement text.
///
/// Returns `None` if the merged text doesn't start with `prefix` and end
/// with `suffix` — that signals a partial stream that hasn't yet reproduced
/// the surrounding context, in which case the caller usually wants to wait
/// for more chunks.
pub fn extract_replacement_between(merged: &str, prefix: &str, suffix: &str) -> Option<String> {
    if !merged.starts_with(prefix) {
        return None;
    }
    if !merged.ends_with(suffix) {
        return None;
    }
    let start = prefix.len();
    let end = merged.len().checked_sub(suffix.len())?;
    if start > end {
        return None;
    }
    Some(merged[start..end].to_string())
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct IterationRequest {
    pub denoising_steps: u32,
    pub current_draft: Option<String>,
}

impl IterationRequest {
    pub fn new(denoising_steps: u32, current_draft: Option<String>) -> Self {
        Self {
            denoising_steps,
            current_draft,
        }
    }
}

#[derive(Debug, Default)]
pub struct MockDiffusionBackend;

impl InferenceBackend for MockDiffusionBackend {
    fn iterate(
        &self,
        prompt_ctx: &PromptCtx,
        request: IterationRequest,
    ) -> Result<Vec<IterEvent>, InferenceError> {
        let mut events = vec![IterEvent::DenoisingStep {
            step: 1,
            total: request.denoising_steps,
        }];

        let mut transcript = prompt_ctx.transcript().join(" ");
        if let Some(partial_transcript) = prompt_ctx.partial_transcript() {
            transcript.push(' ');
            transcript.push_str(partial_transcript);
        }
        let transcript = transcript.to_ascii_lowercase();
        if transcript.contains("red") {
            events.push(IterEvent::DraftToken {
                text: "Preparing a red styling patch for the targeted preview element.".into(),
            });
        } else {
            events.push(IterEvent::DraftToken {
                text: "Waiting for a concrete edit intent.".into(),
            });
        }

        if let Some(patch) = red_button_patch(prompt_ctx, &transcript) {
            events.push(IterEvent::CandidatePatch { patch });
        }
        events.push(IterEvent::Done);
        Ok(events)
    }
}

fn red_button_patch(prompt_ctx: &PromptCtx, transcript: &str) -> Option<CandidatePatch> {
    if !(transcript.contains("red") && transcript.contains("button")) {
        return None;
    }

    let target_path = target_path(prompt_ctx)?;
    let file = prompt_ctx
        .open_files()
        .iter()
        .find(|file| file.path == target_path)?;
    let old_text = "button { background: blue; }";
    if !file.text.contains(old_text) {
        return None;
    }

    Some(CandidatePatch::replace_text(
        1,
        target_path,
        old_text,
        "button { background: red; }",
    ))
}

pub fn target_path(prompt_ctx: &PromptCtx) -> Option<PathBuf> {
    match prompt_ctx.gaze_target() {
        GazeTarget::Preview {
            source_hint: Some(source_hint),
            ..
        } => Some(source_hint.path.clone()),
        GazeTarget::Editor { path, .. } => Some(path.clone()),
        _ => prompt_ctx
            .editor_selection()
            .map(|selection| selection.path.clone())
            .or_else(|| {
                prompt_ctx
                    .open_files()
                    .first()
                    .map(|file| file.path.clone())
            }),
    }
}

pub trait SidecarTransport {
    fn post_json(&self, endpoint: &str, body: &str) -> Result<String, InferenceError>;

    /// Streaming POST: invokes `on_line` once per line of the response body
    /// (suitable for parsing SSE `data: {...}` chunks). Returns when the
    /// response stream closes. Default impl materializes the full body and
    /// splits into lines so transports that don't support streaming still
    /// work, just without incremental delivery.
    fn post_json_lines(
        &self,
        endpoint: &str,
        body: &str,
        on_line: &mut dyn FnMut(&str),
    ) -> Result<(), InferenceError> {
        let text = self.post_json(endpoint, body)?;
        for line in text.lines() {
            on_line(line);
        }
        Ok(())
    }

    fn last_request_body(&self) -> Option<String> {
        None
    }
}

#[derive(Debug)]
pub struct StaticSidecarTransport {
    response_body: String,
    last_request_body: RefCell<Option<String>>,
}

impl StaticSidecarTransport {
    pub fn responding_with(response_body: impl Into<String>) -> Self {
        Self {
            response_body: response_body.into(),
            last_request_body: RefCell::new(None),
        }
    }
}

impl SidecarTransport for StaticSidecarTransport {
    fn post_json(&self, _endpoint: &str, body: &str) -> Result<String, InferenceError> {
        self.last_request_body.replace(Some(body.to_string()));
        Ok(self.response_body.clone())
    }

    fn last_request_body(&self) -> Option<String> {
        self.last_request_body.borrow().clone()
    }
}

#[derive(Debug)]
pub struct DreamSidecarBackend<T> {
    base_url: String,
    transport: T,
    patch_id_seed: AtomicU64,
}

impl<T> DreamSidecarBackend<T> {
    pub fn new(base_url: impl Into<String>, transport: T) -> Self {
        Self {
            base_url: base_url.into().trim_end_matches('/').to_string(),
            transport,
            patch_id_seed: AtomicU64::new(1),
        }
    }

    pub fn endpoint(&self) -> String {
        format!("{}/iterate", self.base_url)
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }
}

impl<T: SidecarTransport> DreamSidecarBackend<T> {
    pub fn last_request_body(&self) -> Option<String> {
        self.transport.last_request_body()
    }
}

impl<T: SidecarTransport> InferenceBackend for DreamSidecarBackend<T> {
    fn iterate(
        &self,
        prompt_ctx: &PromptCtx,
        request: IterationRequest,
    ) -> Result<Vec<IterEvent>, InferenceError> {
        let payload = DreamIteratePayload {
            prompt_ctx,
            denoising_steps: request.denoising_steps,
            current_draft: request.current_draft.as_deref(),
        };
        let body = serde_json::to_string(&payload)?;
        let response = self.transport.post_json(&self.endpoint(), &body)?;
        let (mut events, envelope_draft) = match serde_json::from_str::<DreamResponse>(&response) {
            Ok(envelope) => (envelope.events.unwrap_or_default(), envelope.draft),
            Err(envelope_err) => match serde_json::from_str::<Vec<IterEvent>>(&response) {
                Ok(events) => (events, None),
                Err(_) => return Err(InferenceError::Json(envelope_err)),
            },
        };

        if events.is_empty()
            && let Some(text) = envelope_draft.clone()
            && !text.is_empty()
        {
            events.push(IterEvent::DraftToken { text });
        }

        let draft_text = collect_draft(&events).or(envelope_draft);
        if let Some(text) = draft_text.as_deref()
            && let Some(patch) = extract_diff_patch(text, prompt_ctx, self.next_patch_id())
            && !events
                .iter()
                .any(|event| matches!(event, IterEvent::CandidatePatch { .. }))
        {
            events.push(IterEvent::CandidatePatch { patch });
        }

        if !events
            .iter()
            .any(|event| matches!(event, IterEvent::Done | IterEvent::Error { .. }))
        {
            events.push(IterEvent::Done);
        }
        Ok(events)
    }
}

impl<T> DreamSidecarBackend<T> {
    fn next_patch_id(&self) -> u64 {
        self.patch_id_seed.fetch_add(1, Ordering::Relaxed)
    }
}

#[derive(Serialize)]
struct DreamIteratePayload<'a> {
    prompt_ctx: &'a PromptCtx,
    denoising_steps: u32,
    current_draft: Option<&'a str>,
}

#[derive(Deserialize)]
struct DreamResponse {
    #[serde(default)]
    draft: Option<String>,
    #[serde(default)]
    events: Option<Vec<IterEvent>>,
}

fn collect_draft(events: &[IterEvent]) -> Option<String> {
    let mut buf = String::new();
    for event in events {
        if let IterEvent::DraftToken { text } = event {
            buf.push_str(text);
        }
    }
    if buf.is_empty() { None } else { Some(buf) }
}

#[derive(Debug)]
pub struct HttpSidecarTransport {
    headers: Vec<(String, String)>,
    last_request_body: Mutex<Option<String>>,
    agent: ureq::Agent,
}

impl HttpSidecarTransport {
    pub fn new() -> Self {
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(5))
            .timeout(Duration::from_secs(300))
            .build();
        Self {
            headers: Vec::new(),
            last_request_body: Mutex::new(None),
            agent,
        }
    }

    pub fn with_header(mut self, name: impl Into<String>, value: impl Into<String>) -> Self {
        self.headers.push((name.into(), value.into()));
        self
    }
}

impl Default for HttpSidecarTransport {
    fn default() -> Self {
        Self::new()
    }
}

impl SidecarTransport for HttpSidecarTransport {
    fn post_json(&self, endpoint: &str, body: &str) -> Result<String, InferenceError> {
        if let Ok(mut slot) = self.last_request_body.lock() {
            *slot = Some(body.to_string());
        }
        let mut request = self
            .agent
            .post(endpoint)
            .set("content-type", "application/json");
        for (name, value) in &self.headers {
            request = request.set(name, value);
        }
        match request.send_string(body) {
            Ok(response) => response
                .into_string()
                .map_err(|error| InferenceError::Transport(error.to_string())),
            Err(ureq::Error::Status(status, response)) => {
                let body = response.into_string().unwrap_or_default();
                Err(InferenceError::Transport(format!(
                    "{endpoint} returned {status}: {body}"
                )))
            }
            Err(other) => Err(InferenceError::Transport(other.to_string())),
        }
    }

    fn post_json_lines(
        &self,
        endpoint: &str,
        body: &str,
        on_line: &mut dyn FnMut(&str),
    ) -> Result<(), InferenceError> {
        use std::io::BufRead;
        if let Ok(mut slot) = self.last_request_body.lock() {
            *slot = Some(body.to_string());
        }
        let mut request = self
            .agent
            .post(endpoint)
            .set("content-type", "application/json")
            .set("accept", "text/event-stream");
        for (name, value) in &self.headers {
            request = request.set(name, value);
        }
        let response = match request.send_string(body) {
            Ok(response) => response,
            Err(ureq::Error::Status(status, response)) => {
                let body = response.into_string().unwrap_or_default();
                return Err(InferenceError::Transport(format!(
                    "{endpoint} returned {status}: {body}"
                )));
            }
            Err(other) => return Err(InferenceError::Transport(other.to_string())),
        };
        let reader = std::io::BufReader::new(response.into_reader());
        for line in reader.lines() {
            let line = line.map_err(|err| InferenceError::Transport(err.to_string()))?;
            on_line(&line);
        }
        Ok(())
    }

    fn last_request_body(&self) -> Option<String> {
        self.last_request_body
            .lock()
            .ok()
            .and_then(|slot| slot.clone())
    }
}

#[derive(Debug, Clone)]
pub struct MercuryConfig {
    pub api_base: String,
    pub model: String,
    pub api_key: String,
    pub max_tokens: u32,
    pub temperature: f32,
    pub reasoning_effort: String,
    /// Separate model name for the surgical-edit path. Inception Labs bills
    /// `mercury-2` and `mercury-edit-2` as distinct lines on the dashboard;
    /// the edit model is optimized for small surgical patches with a much
    /// lower per-request cost. Falls back to the chat model if unset.
    pub edit_model: String,
}

impl MercuryConfig {
    pub fn from_env() -> Option<Self> {
        let _ = dotenvy::dotenv();
        let api_key = env::var("MERCURY_API_KEY")
            .or_else(|_| env::var("mercury_api_key"))
            .or_else(|_| env::var("INCEPTION_API_KEY"))
            .or_else(|_| env::var("inception_api_key"))
            .ok()
            .filter(|key| !key.trim().is_empty())?;
        let api_base = env::var("MERCURY_API_BASE")
            .unwrap_or_else(|_| "https://api.inceptionlabs.ai/v1".to_string())
            .trim_end_matches('/')
            .to_string();
        let model = env::var("MERCURY_MODEL").unwrap_or_else(|_| "mercury-2".to_string());
        // Mercury Edit 2's model param is literally "mercury-edit-2" (the docs
        // examples at /get-started/models#mercury-edit-2 spell it out). The
        // proper integration is `/v1/apply/completions` with the
        // <|original_code|> + <|update_snippet|> tagged format — that's a
        // separate task. For now `iterate_surgical_stream` still POSTs to
        // /v1/chat/completions; this default is only used once the surgical
        // path is upgraded to call the apply endpoint.
        let edit_model =
            env::var("MERCURY_EDIT_MODEL").unwrap_or_else(|_| "mercury-edit-2".to_string());
        let max_tokens = env::var("MERCURY_MAX_TOKENS")
            .ok()
            .and_then(|raw| raw.parse().ok())
            .unwrap_or(16384);
        // 0.85 yields more creative design than the docs default 0.75.
        let temperature = env::var("MERCURY_TEMPERATURE")
            .ok()
            .and_then(|raw| raw.parse().ok())
            .unwrap_or(0.85);
        // Reasoning effort: instant | low | medium | high. "high" produces
        // the best-looking output but spends 5-8s per build; "medium" is the
        // sweet spot for the "instant on sentence pause" feel (2-3s total)
        // while still respecting the system prompt's design rules.
        let reasoning_effort = env::var("MERCURY_REASONING_EFFORT")
            .ok()
            .filter(|value| matches!(value.as_str(), "instant" | "low" | "medium" | "high"))
            .unwrap_or_else(|| "medium".to_string());
        Some(Self {
            api_base,
            model,
            api_key,
            max_tokens,
            temperature,
            reasoning_effort,
            edit_model,
        })
    }

    pub fn build(self) -> MercuryBackend {
        MercuryBackend::new(self)
    }
}

pub struct MercuryBackend {
    config: MercuryConfig,
    transport: HttpSidecarTransport,
    patch_id_seed: AtomicU64,
    intent: Box<dyn IntentClassifier>,
    /// Optional project root for resolving `.eri/rules.md`. Held behind a
    /// `Mutex` so the UI layer can swap roots when the active project
    /// changes without rebuilding the entire backend. `None` means
    /// rules.md is not consulted on this iteration.
    project_root: Mutex<Option<PathBuf>>,
    /// MCP tools to surface to Mercury alongside `edit_html`. Populated by
    /// the panel when the user enables MCP via voice command; left empty
    /// by default so Mercury sees only the local tool.
    mcp_tools: Mutex<Vec<McpToolDescriptor>>,
    /// Optional dispatcher for MCP tool calls. When `Some` and `mcp_tools`
    /// is non-empty, the iteration loop forwards every non-`edit_html` tool
    /// call to this dispatcher and feeds the result back to Mercury as a
    /// `role: "tool"` follow-up message. Held in a Mutex so the UI layer
    /// can swap it out at runtime (e.g. when the user reloads the MCP
    /// config).
    mcp_dispatcher: Mutex<Option<Arc<dyn McpToolDispatcher>>>,
}

/// A tool descriptor that Mercury sees in the `tools` array. Mirrors the
/// shape `eri_mcp::NamespacedTool` produces but lives in this crate so
/// `eri_inference` doesn't have to take a hard dependency on `eri_mcp`.
/// The UI layer translates `NamespacedTool -> McpToolDescriptor` when
/// pushing tools into the backend.
#[derive(Debug, Clone)]
pub struct McpToolDescriptor {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

/// Dispatcher for MCP tool calls. Implemented by the UI layer (which owns
/// the `McpClientPool`) and handed to Mercury via
/// [`MercuryBackend::set_mcp_dispatcher`]. Calls are synchronous so the
/// backend can run them inline in the multi-turn loop without an async
/// runtime; the UI dispatches the whole `iterate_stream` on a background
/// task already.
pub trait McpToolDispatcher: Send + Sync + 'static {
    /// Dispatch a Mercury-issued tool call to its MCP server. Implementations
    /// MUST always return a `Value` — failures are wrapped as
    /// `{"error": "..."}` so Mercury sees the error in its next turn and
    /// can recover instead of stalling. The 30-second per-call timeout is
    /// the implementation's responsibility.
    fn call(&self, namespaced_name: &str, args: serde_json::Value) -> serde_json::Value;
}

/// Filename eri reads on every iteration to pick up project-specific rules.
pub const RULES_FILENAME: &str = "rules.md";
/// Subdirectory inside a project root that holds rules.md (and other future
/// per-project eri config).
pub const ERI_PROJECT_DIRNAME: &str = ".eri";

/// Starter scaffold written when a project has no `rules.md` yet. Every
/// rule is commented out so eri's prompt builder treats the file as
/// effectively empty until the user uncomments rules.
pub const RULES_SCAFFOLD: &str = "# Project rules\n\
#\n\
# Anything you write below this line is prepended to Mercury's system prompt\n\
# on EVERY iteration. Use it to pin style, library, or branding preferences\n\
# that should never drift.\n\
#\n\
# Examples (uncomment to enable):\n\
#\n\
# - Always use shadcn/ui buttons — never raw <button>.\n\
# - This project uses TypeScript, never plain JavaScript.\n\
# - The brand accent colour is #FF6B35.\n";

/// Resolve `<project_root>/.eri/rules.md` for a given project root.
pub fn rules_path_for(project_root: &Path) -> PathBuf {
    project_root.join(ERI_PROJECT_DIRNAME).join(RULES_FILENAME)
}

/// Read the active rules.md for a project root, returning `Ok(None)` when
/// the file does not exist (the common case for new projects) OR when the
/// file is entirely comments / whitespace (the scaffold's default state).
/// Any other I/O error propagates so the caller can surface it.
pub fn read_project_rules(project_root: &Path) -> std::io::Result<Option<String>> {
    let path = rules_path_for(project_root);
    match std::fs::read_to_string(&path) {
        Ok(body) => {
            // Strip leading `#`-only / blank lines so the scaffold's "all
            // comments" state collapses to None and Mercury never sees an
            // empty rules block. A line is "comment-only" if it's blank or
            // starts with `#` after trimming.
            let meaningful = body.lines().any(|line| {
                let trimmed = line.trim();
                !trimmed.is_empty() && !trimmed.starts_with('#')
            });
            if meaningful { Ok(Some(body)) } else { Ok(None) }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

/// Create `<project_root>/.eri/rules.md` with the starter scaffold if it
/// doesn't exist yet. Idempotent — leaves an existing file untouched.
pub fn ensure_rules_scaffold(project_root: &Path) -> std::io::Result<PathBuf> {
    let dir = project_root.join(ERI_PROJECT_DIRNAME);
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(RULES_FILENAME);
    if !path.exists() {
        std::fs::write(&path, RULES_SCAFFOLD)?;
    }
    Ok(path)
}

/// Format a rules.md body as a system message that prepends Mercury's normal
/// system prompt. Public so test code can assert exact formatting.
pub fn format_rules_system_prompt(rules_body: &str) -> String {
    format!(
        "# Project rules\nThis project has specific guidelines you MUST follow on every iteration:\n\n{}",
        rules_body.trim_end()
    )
}

impl std::fmt::Debug for MercuryBackend {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MercuryBackend")
            .field("config", &self.config)
            .field("transport", &self.transport)
            .field("patch_id_seed", &self.patch_id_seed)
            .finish()
    }
}

impl MercuryBackend {
    pub fn new(config: MercuryConfig) -> Self {
        let transport = HttpSidecarTransport::new()
            .with_header("authorization", format!("Bearer {}", config.api_key))
            .with_header("accept", "application/json");
        let backend = Self {
            config,
            transport,
            patch_id_seed: AtomicU64::new(1),
            intent: intent::classifier_from_env(),
            project_root: Mutex::new(None),
            mcp_tools: Mutex::new(Vec::new()),
            mcp_dispatcher: Mutex::new(None),
        };
        // Phase 5 pre-warm: fire one background TCP+TLS handshake to the
        // Mercury host so the connection is hot when the first real POST
        // lands. Saves ~50-200ms on the first iteration of the session. Done
        // on a detached thread because `new()` is called during eri startup
        // and we don't want to block the UI on a network round trip.
        backend.spawn_preflight();
        backend
    }

    /// Fire a cheap GET against the Mercury API host so the ureq agent's
    /// connection pool has a warm TCP+TLS connection ready for the first
    /// real iteration POST. Errors are swallowed: this is purely an
    /// optimization and the next real POST will reconnect if it failed.
    fn spawn_preflight(&self) {
        let endpoint = self.endpoint();
        std::thread::Builder::new()
            .name("eri-mercury-preflight".into())
            .spawn(move || {
                let agent = ureq::AgentBuilder::new()
                    .timeout_connect(Duration::from_secs(5))
                    .timeout(Duration::from_secs(5))
                    .build();
                // HEAD against /chat/completions returns 405 or 404 but
                // completes the handshake, which is all we need. The ureq
                // agent keeps the connection alive for subsequent calls.
                let start = std::time::Instant::now();
                let result = agent.request("HEAD", &endpoint).call();
                eprintln!(
                    "[eri.mercury] preflight {} -> {} in {}ms",
                    endpoint,
                    match &result {
                        Ok(r) => r.status().to_string(),
                        Err(e) => format!("err: {e}"),
                    },
                    start.elapsed().as_millis()
                );
            })
            .ok();
    }

    /// Override the intent classifier — useful for tests that want a
    /// deterministic backend, and for callers that want to opt into the
    /// hybrid or heuristic strategy without touching the env.
    pub fn with_intent_classifier(mut self, classifier: Box<dyn IntentClassifier>) -> Self {
        self.intent = classifier;
        self
    }

    /// Builder form for setting the project root that owns the active
    /// `.eri/rules.md`. Use this at construction time; for live updates
    /// after the backend is wrapped in `Arc`, prefer
    /// [`MercuryBackend::set_project_root`].
    pub fn with_project_root(self, project_root: impl Into<PathBuf>) -> Self {
        if let Ok(mut guard) = self.project_root.lock() {
            *guard = Some(project_root.into());
        }
        self
    }

    /// Live update of the project root. Called when the user opens a
    /// different project so the next Mercury fire picks up that project's
    /// rules.md instead of the previous one's.
    pub fn set_project_root(&self, project_root: Option<PathBuf>) {
        if let Ok(mut guard) = self.project_root.lock() {
            *guard = project_root;
        }
    }

    pub fn project_root(&self) -> Option<PathBuf> {
        self.project_root.lock().ok().and_then(|g| g.clone())
    }

    /// Builder form for seeding MCP tools at construction. Tools must already
    /// be namespaced as `<server>__<tool>` so Mercury's responses can be
    /// routed back to the originating MCP server.
    pub fn with_mcp_tools(self, tools: Vec<McpToolDescriptor>) -> Self {
        if let Ok(mut guard) = self.mcp_tools.lock() {
            *guard = tools;
        }
        self
    }

    /// Live update of the MCP tool list. Called when the user toggles MCP
    /// on/off via voice or when `ReloadMcpConfig` rebuilds the pool.
    pub fn set_mcp_tools(&self, tools: Vec<McpToolDescriptor>) {
        if let Ok(mut guard) = self.mcp_tools.lock() {
            *guard = tools;
        }
    }

    /// Snapshot the active MCP tool list. Returns an empty Vec when no tools
    /// are configured — the same state the constructor leaves the backend in.
    pub fn mcp_tools(&self) -> Vec<McpToolDescriptor> {
        self.mcp_tools
            .lock()
            .ok()
            .map(|g| g.clone())
            .unwrap_or_default()
    }

    /// Install the dispatcher that translates Mercury-issued tool calls into
    /// real MCP requests. The dispatcher is shared (Arc) because the same
    /// pool typically backs multiple Mercury fires across a session.
    pub fn set_mcp_dispatcher(&self, dispatcher: Option<Arc<dyn McpToolDispatcher>>) {
        if let Ok(mut guard) = self.mcp_dispatcher.lock() {
            *guard = dispatcher;
        }
    }

    fn mcp_dispatcher_clone(&self) -> Option<Arc<dyn McpToolDispatcher>> {
        self.mcp_dispatcher.lock().ok().and_then(|g| g.clone())
    }

    /// True when the backend has both MCP tools configured AND a dispatcher
    /// wired up. Both are required: tools without a dispatcher would let
    /// Mercury emit calls that go nowhere; a dispatcher without tools has
    /// nothing to dispatch.
    pub fn mcp_active(&self) -> bool {
        let dispatcher_present = self
            .mcp_dispatcher
            .lock()
            .ok()
            .map(|g| g.is_some())
            .unwrap_or(false);
        let has_tools = self
            .mcp_tools
            .lock()
            .ok()
            .map(|g| !g.is_empty())
            .unwrap_or(false);
        dispatcher_present && has_tools
    }

    pub fn model(&self) -> &str {
        &self.config.model
    }

    pub fn endpoint(&self) -> String {
        format!("{}/chat/completions", self.config.api_base)
    }

    /// Mercury Edit 2's apply endpoint. Takes a tagged `original_code` +
    /// `update_snippet` payload (snippet uses `// ... existing code ...`
    /// markers around the changed regions) and emits the merged full file.
    /// Faster + cheaper than re-emitting the full file via chat for large
    /// targeted iterations.
    pub fn apply_endpoint(&self) -> String {
        format!("{}/apply/completions", self.config.api_base)
    }

    fn next_patch_id(&self) -> u64 {
        self.patch_id_seed.fetch_add(1, Ordering::Relaxed)
    }

    fn classify_intent(&self, ctx: &PromptCtx, current_draft: Option<&str>) -> IntentDecision {
        let intent_ctx = IntentContext::from_prompt_ctx(ctx, current_draft);
        self.intent.classify(&intent_ctx)
    }

    fn looks_like_new_build_from_ctx(&self, ctx: &PromptCtx) -> bool {
        self.classify_intent(ctx, None).is_new_build()
    }

    /// Phase 4 surgical iteration via Mercury 2 tool calling. Instead of
    /// asking Mercury to emit `<<<<<<< SEARCH` markers as free-form text (and
    /// parsing them after the fact), we expose an `edit_html` function whose
    /// parameters are a structured array of `{search, replace}` pairs. Mercury
    /// must emit a tool call — there is no prose surface for it to drift into.
    /// The tool arguments stream chunk-by-chunk as a single JSON string we
    /// concatenate; on stream end we parse the JSON and reuse the existing
    /// `apply_search_replace_blocks` pipeline. Falls back to the marker parser
    /// over the assistant content if no tool call materialized (older Mercury
    /// behaviour or transient regression).
    fn iterate_surgical_stream(
        &self,
        prompt_ctx: &PromptCtx,
        request: IterationRequest,
        on_event: &mut dyn FnMut(IterEvent),
        on_partial_html: &mut dyn FnMut(&str),
    ) -> Result<(), InferenceError> {
        let current_draft = request.current_draft.as_deref().unwrap_or("");
        let messages = self.build_messages_surgical(prompt_ctx, Some(current_draft));
        // Surgical responses are bounded by a few small edits — 1500 tokens is
        // plenty for ~4-6 edit pairs. Lower cap forces Mercury to stay terse
        // and slashes per-request cost vs the 16384 chat-path cap.
        let max_tokens = 1500u32.min(self.config.max_tokens);
        // Mercury 2 supports OpenAI-style tool calling on
        // `/v1/chat/completions`. `mercury-edit-2` is a different endpoint
        // family (`/v1/apply/completions`) — for the tool-call path we stay on
        // the chat model so the same auth + transport applies.
        let tools = edit_html_tool_spec();
        let tool_choice = ToolChoice::Named {
            kind: "function",
            function: NamedFunction { name: "edit_html" },
        };
        let payload = ChatCompletionPayload {
            model: &self.config.model,
            messages: &messages,
            max_tokens,
            temperature: self.config.temperature,
            stream: true,
            reasoning_effort: &self.config.reasoning_effort,
            stream_options: Some(StreamOptions {
                include_usage: true,
            }),
            diffusing: None,
            tools: Some(std::slice::from_ref(&tools)),
            tool_choice: Some(tool_choice),
        };
        let body = serde_json::to_string(&payload)?;
        eprintln!(
            "[eri.mercury.surgical] POST {} tool=edit_html (max_tokens={}, prompt_chars={})",
            self.endpoint(),
            max_tokens,
            body.len()
        );

        on_event(IterEvent::DenoisingStep {
            step: 1,
            total: request.denoising_steps.max(1),
        });

        let start_time = std::time::Instant::now();
        let mut content_buf = String::new();
        let mut tool_args_buf = String::new();
        let mut chunk_count: u32 = 0;
        let mut final_finish_reason = String::new();
        let billing_model = self.config.model.clone();
        self.transport
            .post_json_lines(&self.endpoint(), &body, &mut |raw| {
                let trimmed = raw.trim_start();
                let Some(payload_str) = trimmed.strip_prefix("data:") else {
                    return;
                };
                let payload_str = payload_str.trim();
                if payload_str.is_empty() || payload_str == "[DONE]" {
                    return;
                }
                let Ok(chunk) = serde_json::from_str::<ChatCompletionChunk>(payload_str) else {
                    return;
                };
                if let Some(usage) = chunk.usage {
                    on_event(IterEvent::Usage {
                        model: billing_model.clone(),
                        prompt_tokens: usage.prompt_tokens,
                        completion_tokens: usage.completion_tokens,
                        reasoning_tokens: usage.reasoning_tokens.unwrap_or(0),
                        total_tokens: usage.total_tokens,
                    });
                }
                for choice in chunk.choices {
                    if let Some(reason) = choice.finish_reason {
                        final_finish_reason = reason;
                    }
                    let delta = choice.delta.unwrap_or_default();
                    if let Some(content) = delta.content
                        && !content.is_empty()
                    {
                        content_buf.push_str(&content);
                        chunk_count += 1;
                    }
                    if let Some(tool_calls) = delta.tool_calls {
                        for call in tool_calls {
                            if let Some(function) = call.function
                                && let Some(args) = function.arguments
                                && !args.is_empty()
                            {
                                tool_args_buf.push_str(&args);
                                chunk_count += 1;
                            }
                        }
                    }
                }
            })?;
        eprintln!(
            "[eri.mercury.surgical] stream done: {} chunks, content={} chars, tool_args={} chars, finish={}, total={}ms",
            chunk_count,
            content_buf.len(),
            tool_args_buf.len(),
            final_finish_reason,
            start_time.elapsed().as_millis()
        );

        let blocks = if !tool_args_buf.trim().is_empty() {
            match parse_edit_html_tool_arguments(&tool_args_buf) {
                Ok(blocks) => blocks,
                Err(err) => {
                    eprintln!(
                        "[eri.mercury.surgical] tool arguments failed to parse ({err}) — falling back to marker parser on assistant content"
                    );
                    parse_search_replace_blocks(&content_buf)
                }
            }
        } else {
            parse_search_replace_blocks(&content_buf)
        };

        if blocks.is_empty() {
            eprintln!(
                "[eri.mercury.surgical] no edits parsed from tool call or markers — falling through with raw content so chat-style diff extractor can try"
            );
            on_event(IterEvent::DraftToken {
                text: content_buf.clone(),
            });
            on_event(IterEvent::Done);
            return Ok(());
        }

        let (modified, applied, skipped) = apply_search_replace_blocks(current_draft, &blocks);
        eprintln!(
            "[eri.mercury.surgical] applied {}/{} edits ({} skipped)",
            applied,
            applied + skipped,
            skipped
        );

        let synthetic = format!(
            "```diff\n--- /dev/null\n+++ b/index.html\n@@\n{}\n```\n",
            modified
                .lines()
                .map(|l| format!("+{l}"))
                .collect::<Vec<_>>()
                .join("\n")
        );
        on_event(IterEvent::DraftToken { text: synthetic });
        on_partial_html(&modified);
        on_event(IterEvent::Done);
        Ok(())
    }

    /// Multi-turn MCP tool-call loop. Runs BEFORE the streaming edit path so
    /// Mercury can fetch outside facts (open PRs, calendar events, files in
    /// another repo) and fold them into the iteration's context. Each turn
    /// is a non-streaming chat completion with `tool_choice: "auto"` so
    /// Mercury can either emit a tool call OR a final assistant message.
    /// When it emits a tool call (matching one of the configured MCP tools),
    /// we dispatch via the panel's `McpToolDispatcher`, append a
    /// `role: "tool"` follow-up, and loop. When it emits content, the loop
    /// ends and we return the accumulated tool result blobs to the caller.
    ///
    /// Cap: 5 turns. Mercury can call multiple tools but cannot loop
    /// forever, and a runaway loop returns whatever results it gathered
    /// rather than failing the whole iteration.
    fn run_mcp_tool_loop(
        &self,
        prompt_ctx: &PromptCtx,
        current_draft: Option<&str>,
        on_event: &mut dyn FnMut(IterEvent),
    ) -> Result<Vec<String>, InferenceError> {
        const MAX_TURNS: usize = 5;
        let Some(dispatcher) = self.mcp_dispatcher_clone() else {
            return Ok(Vec::new());
        };
        let mcp_tools = self.mcp_tools();
        if mcp_tools.is_empty() {
            return Ok(Vec::new());
        }

        let mut messages = self.build_messages(prompt_ctx, current_draft, None);
        // Steer Mercury toward gathering facts first, NOT emitting HTML on
        // this turn — the streaming surgical path will handle the build.
        messages.push(ChatMessage::user(
            "Before answering, check if any of the available MCP tools would let you fetch facts the user implied. If yes, call the tool(s). When you have enough context, respond with the single word OK so the build can proceed.".to_string(),
        ));

        let edit_tool = edit_html_tool_spec();
        let mut tool_specs: Vec<ToolSpec> = Vec::with_capacity(mcp_tools.len() + 1);
        tool_specs.push(edit_tool);
        for tool in &mcp_tools {
            tool_specs.push(ToolSpec {
                kind: "function",
                function: ToolFunctionSpec {
                    name: &tool.name,
                    description: &tool.description,
                    parameters: tool.parameters.clone(),
                },
            });
        }

        let mut tool_blobs: Vec<String> = Vec::new();

        for turn in 0..MAX_TURNS {
            let payload = ChatCompletionPayload {
                model: &self.config.model,
                messages: &messages,
                max_tokens: 2048,
                temperature: self.config.temperature,
                stream: false,
                reasoning_effort: &self.config.reasoning_effort,
                stream_options: None,
                diffusing: None,
                tools: Some(&tool_specs),
                tool_choice: Some(ToolChoice::Auto("auto")),
            };
            let body = serde_json::to_string(&payload)?;
            let response = self.transport.post_json(&self.endpoint(), &body)?;
            let parsed: McpChatResponse = serde_json::from_str(&response).map_err(|err| {
                InferenceError::Transport(format!("MCP loop: bad chat response: {err}"))
            })?;
            let choice = match parsed.choices.into_iter().next() {
                Some(choice) => choice,
                None => break,
            };
            let calls = choice.message.tool_calls.unwrap_or_default();
            if calls.is_empty() {
                break;
            }

            // Echo Mercury's assistant turn (with its tool_calls) so the
            // protocol stays consistent across turns. OpenAI requires the
            // assistant message that requested the calls to precede each
            // tool result.
            messages.push(ChatMessage::assistant(
                choice.message.content.unwrap_or_default(),
            ));

            let mut dispatched_any = false;
            for call in calls {
                let name = call.function.name.unwrap_or_default();
                if name == "edit_html" || name.is_empty() {
                    // Mercury jumped straight to the edit; abort the
                    // gather-facts loop so the streaming surgical path can
                    // do its job.
                    return Ok(tool_blobs);
                }
                let args_str = call.function.arguments.unwrap_or_default();
                let args: serde_json::Value = if args_str.is_empty() {
                    serde_json::Value::Object(Default::default())
                } else {
                    serde_json::from_str(&args_str).unwrap_or(serde_json::Value::Null)
                };
                let id = call.id.unwrap_or_else(|| format!("call_{turn}"));
                let result = dispatcher.call(&name, args);
                let result_str = serde_json::to_string(&result)
                    .unwrap_or_else(|_| "\"<unserializable tool result>\"".to_string());
                let blob = format!("## {name}\n```json\n{result_str}\n```");
                tool_blobs.push(blob);
                on_event(IterEvent::DraftToken {
                    text: format!("[mcp] {name} → {} bytes\n", result_str.len()),
                });
                messages.push(ChatMessage::tool_result(id, name, result_str));
                dispatched_any = true;
            }
            if !dispatched_any {
                break;
            }
        }
        Ok(tool_blobs)
    }

    /// Mercury Edit 2 apply path (task #48). Two-step flow:
    ///   1. Mercury 2 chat produces a compact `update_snippet` with
    ///      `// ... existing code ...` markers around only the changed
    ///      regions (~300-600 chars typical).
    ///   2. Mercury Edit 2's `/v1/apply/completions` merges that snippet into
    ///      the full current file and streams the result back.
    ///
    /// Gated by `ERI_APPLY_ITERATE=1`. The existing tool-call surgical path
    /// remains the default for iterations under ~4kB; the apply path
    /// outperforms it on large files where regenerating the whole file via
    /// chat dominates the cost.
    fn iterate_apply_stream(
        &self,
        prompt_ctx: &PromptCtx,
        request: IterationRequest,
        on_event: &mut dyn FnMut(IterEvent),
        on_partial_html: &mut dyn FnMut(&str),
    ) -> Result<(), InferenceError> {
        let current_draft = request.current_draft.as_deref().unwrap_or("");
        if current_draft.is_empty() {
            return Err(InferenceError::Transport(
                "apply path requires a non-empty current draft".into(),
            ));
        }

        on_event(IterEvent::DenoisingStep {
            step: 1,
            total: request.denoising_steps.max(1),
        });

        let snippet = self.fetch_update_snippet(prompt_ctx, current_draft)?;
        if snippet.trim().is_empty() {
            eprintln!("[eri.mercury.apply] empty update snippet — falling back to surgical path");
            return self.iterate_surgical_stream(prompt_ctx, request, on_event, on_partial_html);
        }
        eprintln!(
            "[eri.mercury.apply] snippet generated: {} chars",
            snippet.len()
        );

        let payload = ApplyCompletionPayload {
            model: &self.config.edit_model,
            original_code: current_draft,
            update_snippet: &snippet,
            stream: true,
        };
        let body = serde_json::to_string(&payload)?;
        eprintln!(
            "[eri.mercury.apply] POST {} model={} original_chars={} snippet_chars={}",
            self.apply_endpoint(),
            self.config.edit_model,
            current_draft.len(),
            snippet.len()
        );

        let start_time = std::time::Instant::now();
        let mut accumulated = String::new();
        let mut chunk_count: u32 = 0;
        let mut final_finish_reason = String::new();
        let mut last_partial_write = std::time::Instant::now();
        let partial_write_min_gap = std::time::Duration::from_millis(150);
        let endpoint = self.apply_endpoint();
        let billing_model = self.config.edit_model.clone();
        self.transport
            .post_json_lines(&endpoint, &body, &mut |raw| {
                let trimmed = raw.trim_start();
                let Some(payload_str) = trimmed.strip_prefix("data:") else {
                    return;
                };
                let payload_str = payload_str.trim();
                if payload_str.is_empty() || payload_str == "[DONE]" {
                    return;
                }
                let Ok(chunk) = serde_json::from_str::<ChatCompletionChunk>(payload_str) else {
                    eprintln!(
                        "[eri.mercury.apply] failed to parse SSE chunk ({} chars)",
                        payload_str.len()
                    );
                    return;
                };
                if let Some(usage) = chunk.usage {
                    on_event(IterEvent::Usage {
                        model: billing_model.clone(),
                        prompt_tokens: usage.prompt_tokens,
                        completion_tokens: usage.completion_tokens,
                        reasoning_tokens: usage.reasoning_tokens.unwrap_or(0),
                        total_tokens: usage.total_tokens,
                    });
                }
                for choice in chunk.choices {
                    if let Some(reason) = choice.finish_reason {
                        final_finish_reason = reason;
                    }
                    let delta = choice.delta.unwrap_or_default();
                    if let Some(content) = delta.content
                        && !content.is_empty()
                    {
                        accumulated.push_str(&content);
                        chunk_count += 1;
                        on_event(IterEvent::DraftToken {
                            text: accumulated.clone(),
                        });
                        let now = std::time::Instant::now();
                        if now.duration_since(last_partial_write) >= partial_write_min_gap
                            && (accumulated.contains("</head>") || accumulated.contains("</HEAD>"))
                            && let Some(html) = extract_partial_html_body(&accumulated)
                        {
                            on_partial_html(&html);
                            last_partial_write = now;
                        }
                    }
                }
            })?;
        eprintln!(
            "[eri.mercury.apply] stream done: {} chunks, {} chars, finish={}, total={}ms",
            chunk_count,
            accumulated.len(),
            final_finish_reason,
            start_time.elapsed().as_millis()
        );

        let merged = extract_partial_html_body(&accumulated).unwrap_or_else(|| accumulated.clone());
        if !merged.trim().is_empty() {
            on_partial_html(&merged);
        }
        on_event(IterEvent::Done);
        Ok(())
    }

    /// Inline-rewrite path: take a file's full text, the byte range of the
    /// editor selection, and a natural-language instruction; return the
    /// REPLACEMENT text for the selection alone. Streams partial replacements
    /// so the panel can render Cursor-style ghost text as Mercury writes.
    ///
    /// Wire shape: this calls Mercury Edit 2's `/v1/apply/completions` with
    /// the full file as `original_code` and a tiny `update_snippet` that
    /// rebuilds the file as:
    ///   - prefix (everything before the selection), preserved verbatim
    ///   - `// ... existing code ...` markers around the prefix/suffix so the
    ///     model rewrites only the selection
    ///   - the user's instruction as an inline comment so Mercury knows what
    ///     to do with the selected lines
    ///
    /// Returns the rewritten REPLACEMENT for the selection. The caller (eri's
    /// panel) stitches it back into the buffer.
    ///
    /// Bounds-checked: `selection_start` and `selection_end` must be byte
    /// offsets inside `current_file` with `start <= end <= len`. Out-of-range
    /// inputs return an `InferenceError::Transport` rather than panicking on
    /// a slice.
    pub fn rewrite_selection_stream(
        &self,
        current_file: &str,
        selection_start: usize,
        selection_end: usize,
        instruction: &str,
        on_partial: &mut dyn FnMut(&str),
        on_usage: &mut dyn FnMut(IterEvent),
    ) -> Result<String, InferenceError> {
        if instruction.trim().is_empty() {
            return Err(InferenceError::Transport(
                "rewrite_selection_stream requires a non-empty instruction".into(),
            ));
        }
        if selection_end > current_file.len() || selection_start > selection_end {
            return Err(InferenceError::Transport(format!(
                "rewrite_selection_stream: selection {selection_start}..{selection_end} out of range for {} bytes",
                current_file.len()
            )));
        }
        if !current_file.is_char_boundary(selection_start)
            || !current_file.is_char_boundary(selection_end)
        {
            return Err(InferenceError::Transport(
                "rewrite_selection_stream: selection bounds must fall on UTF-8 character boundaries".into(),
            ));
        }

        let prefix = &current_file[..selection_start];
        let selection = &current_file[selection_start..selection_end];
        let suffix = &current_file[selection_end..];

        // Mercury Edit 2 expects:
        //   <original_code>   — the whole file as ground truth.
        //   <update_snippet>  — only what changes, surrounded by
        //                       `// ... existing code ...` markers.
        //
        // For an inline rewrite we tell the model exactly which region to
        // rewrite by quoting the SELECTION verbatim, sandwiched between two
        // "existing code" markers. The instruction rides as a comment.
        let update_snippet = format!(
            "// ... existing code ...\n// eri inline rewrite: {instruction}\n// Replace the following block:\n{selection}\n// ... existing code ...\n",
            instruction = instruction.trim(),
        );

        let payload = ApplyCompletionPayload {
            model: &self.config.edit_model,
            original_code: current_file,
            update_snippet: &update_snippet,
            stream: true,
        };
        let body = serde_json::to_string(&payload)?;
        eprintln!(
            "[eri.mercury.rewrite] POST {} model={} sel={}..{} file_chars={} instr={:?}",
            self.apply_endpoint(),
            self.config.edit_model,
            selection_start,
            selection_end,
            current_file.len(),
            instruction.chars().take(80).collect::<String>()
        );

        let start_time = std::time::Instant::now();
        let mut accumulated = String::new();
        let mut chunk_count: u32 = 0;
        let mut final_finish_reason = String::new();
        let endpoint = self.apply_endpoint();
        let billing_model = self.config.edit_model.clone();
        let prefix_owned = prefix.to_string();
        let suffix_owned = suffix.to_string();
        self.transport
            .post_json_lines(&endpoint, &body, &mut |raw| {
                let trimmed = raw.trim_start();
                let Some(payload_str) = trimmed.strip_prefix("data:") else {
                    return;
                };
                let payload_str = payload_str.trim();
                if payload_str.is_empty() || payload_str == "[DONE]" {
                    return;
                }
                let Ok(chunk) = serde_json::from_str::<ChatCompletionChunk>(payload_str) else {
                    eprintln!(
                        "[eri.mercury.rewrite] failed to parse SSE chunk ({} chars)",
                        payload_str.len()
                    );
                    return;
                };
                if let Some(usage) = chunk.usage {
                    on_usage(IterEvent::Usage {
                        model: billing_model.clone(),
                        prompt_tokens: usage.prompt_tokens,
                        completion_tokens: usage.completion_tokens,
                        reasoning_tokens: usage.reasoning_tokens.unwrap_or(0),
                        total_tokens: usage.total_tokens,
                    });
                }
                for choice in chunk.choices {
                    if let Some(reason) = choice.finish_reason {
                        final_finish_reason = reason;
                    }
                    let delta = choice.delta.unwrap_or_default();
                    if let Some(content) = delta.content
                        && !content.is_empty()
                    {
                        accumulated.push_str(&content);
                        chunk_count += 1;
                        // Mercury Edit 2 emits the FULL merged file as it
                        // streams. Strip the prefix/suffix to surface just
                        // the candidate replacement so the panel renders a
                        // tight ghost overlay rather than the whole file.
                        if let Some(partial_rep) =
                            extract_replacement_between(&accumulated, &prefix_owned, &suffix_owned)
                        {
                            on_partial(&partial_rep);
                        }
                    }
                }
            })?;
        eprintln!(
            "[eri.mercury.rewrite] stream done: {} chunks, {} chars, finish={}, total={}ms",
            chunk_count,
            accumulated.len(),
            final_finish_reason,
            start_time.elapsed().as_millis()
        );

        let merged = strip_code_fence(accumulated.trim()).to_string();
        let replacement =
            extract_replacement_between(&merged, prefix, suffix).unwrap_or_else(|| merged.clone());
        Ok(replacement)
    }

    /// Generate the `update_snippet` for the apply endpoint. Asks Mercury 2
    /// chat to emit only the changed regions wrapped in `// ... existing code
    /// ...` markers — the exact shape Mercury Edit 2's apply endpoint
    /// expects. Returns the raw snippet text (possibly empty if Mercury
    /// refused or produced unusable output).
    fn fetch_update_snippet(
        &self,
        ctx: &PromptCtx,
        current_draft: &str,
    ) -> Result<String, InferenceError> {
        let request_text = ctx
            .transcript()
            .last()
            .cloned()
            .or_else(|| ctx.partial_transcript().map(|s| s.to_string()))
            .unwrap_or_default();
        if request_text.trim().is_empty() {
            return Ok(String::new());
        }
        let system = APPLY_SNIPPET_SYSTEM_PROMPT;
        let user_msg = format!(
            "# User request\n{request_text}\n\n# Current code\n{current_draft}\n\nProduce the update snippet now. Wrap unchanged regions with `// ... existing code ...` and include ONLY the lines that change."
        );
        let payload = ChatCompletionPayload {
            model: &self.config.model,
            messages: &[ChatMessage::system(system), ChatMessage::user(user_msg)],
            max_tokens: 1500.min(self.config.max_tokens),
            temperature: self.config.temperature,
            stream: false,
            reasoning_effort: &self.config.reasoning_effort,
            stream_options: None,
            diffusing: None,
            tools: None,
            tool_choice: None,
        };
        let body = serde_json::to_string(&payload)?;
        let response = self.transport.post_json(&self.endpoint(), &body)?;
        let parsed: ChatCompletionResponse = serde_json::from_str(&response)?;
        let text = parsed
            .choices
            .into_iter()
            .next()
            .map(|c| c.message.content)
            .unwrap_or_default();
        Ok(strip_code_fence(text.trim()).to_string())
    }

    /// Mercury pass 1: ask for a tight JSON design brief that names a custom
    /// palette, fonts, layout, and 3 unique copy hooks. The second pass uses
    /// this to avoid generic SaaS output.
    fn fetch_design_brief(&self, ctx: &PromptCtx) -> Result<String, InferenceError> {
        let request_text = ctx
            .transcript()
            .last()
            .cloned()
            .unwrap_or_else(|| ctx.partial_transcript().unwrap_or("").to_string());
        if request_text.trim().is_empty() {
            return Ok(String::new());
        }
        let system = "You are eri's design brief planner. Output ONLY a single JSON object with this shape, NO prose:\n{\n  \"product_kind\": \"<one-line specific description>\",\n  \"audience\": \"<who actually uses this — be specific, not 'businesses'>\",\n  \"mood\": \"<3 adjectives, e.g. 'gritty, urgent, magazine-editorial'>\",\n  \"accent_hex\": \"#XXXXXX (specific to the domain, not a default Tailwind color)\",\n  \"neutral_hex\": \"#XXXXXX (background neutral, warmer or cooler than pure gray)\",\n  \"display_font\": \"<Google Fonts family for headings — e.g. Fraunces, Space Grotesk, Plus Jakarta Sans>\",\n  \"body_font\": \"<Google Fonts family for body>\",\n  \"layout\": \"<editorial-grid | asymmetric-split | bento | centered-hero | newspaper>\",\n  \"hero_headline\": \"<specific, domain-aware headline, max 8 words, NEVER the banned generic phrases>\",\n  \"hero_subhead\": \"<one sentence naming the actual pain point or differentiator>\",\n  \"primary_cta\": \"<2 words max — verb + noun>\",\n  \"section_outline\": [\"<5–7 section names tailored to the product, NOT 'Features / Pricing / FAQ'>\"]\n}";
        let user_msg = format!(
            "Build a design brief for this request:\n\n{request_text}\n\nMake it SPECIFIC. The hero_headline must reference the actual domain or subculture, not generic 'Empower' / 'Step up' / 'Take it to the next level' wording.",
        );
        let payload = ChatCompletionPayload {
            model: &self.config.model,
            messages: &[ChatMessage::system(system), ChatMessage::user(user_msg)],
            max_tokens: 768,
            temperature: 0.9,
            stream: false,
            reasoning_effort: &self.config.reasoning_effort,
            stream_options: None,
            diffusing: None,
            tools: None,
            tool_choice: None,
        };
        let body = serde_json::to_string(&payload)?;
        let response = self.transport.post_json(&self.endpoint(), &body)?;
        let parsed: ChatCompletionResponse = serde_json::from_str(&response)?;
        let text = parsed
            .choices
            .into_iter()
            .next()
            .map(|c| c.message.content)
            .unwrap_or_default();
        Ok(text.trim().to_string())
    }

    fn build_messages(
        &self,
        ctx: &PromptCtx,
        current_draft: Option<&str>,
        design_brief: Option<&str>,
    ) -> Vec<ChatMessage> {
        self.build_messages_inner(ctx, current_draft, design_brief, false)
    }

    /// Build messages with the surgical search/replace prompt layered on top
    /// of the normal system prompt. Mercury emits compact `<<<<<<< SEARCH` /
    /// `>>>>>>> REPLACE` blocks instead of a full file. ~10x smaller output,
    /// zero drift on unrelated sections.
    fn build_messages_surgical(
        &self,
        ctx: &PromptCtx,
        current_draft: Option<&str>,
    ) -> Vec<ChatMessage> {
        self.build_messages_inner(ctx, current_draft, None, true)
    }

    fn build_messages_inner(
        &self,
        ctx: &PromptCtx,
        current_draft: Option<&str>,
        design_brief: Option<&str>,
        surgical: bool,
    ) -> Vec<ChatMessage> {
        let mut messages = if surgical {
            vec![ChatMessage::system(SURGICAL_SYSTEM_PROMPT)]
        } else {
            vec![ChatMessage::system(SYSTEM_PROMPT)]
        };

        // Per-project rules.md (Cursor's `.cursorrules` equivalent). Read on
        // EVERY iteration so the user can edit the file between fires without
        // restarting eri. Missing file is the common case (most projects have
        // no rules) — propagate silently. I/O errors on read are logged but
        // don't break the iteration; we'd rather Mercury fire without the
        // rules than refuse to fire at all.
        if let Some(root) = self.project_root() {
            match read_project_rules(&root) {
                Ok(Some(body)) => {
                    messages.push(ChatMessage::system(format_rules_system_prompt(&body)));
                }
                Ok(None) => {}
                Err(error) => {
                    log::warn!(
                        "[eri.rules] failed to read {}: {error}",
                        rules_path_for(&root).display()
                    );
                }
            }
        }

        // Layer shadcn/ui component defaults onto every fire (new builds AND
        // iterations). Mercury picks up the production-quality class strings,
        // CSS-var color tokens, and dialog/modal patterns without growing the
        // main prompt const. We also attach the motion presets here so the
        // "add motion" voice command can reference them verbatim from the
        // user-prompt directive block without re-defining the snippets.
        messages.push(ChatMessage::system(SHADCN_COMPONENT_HINTS));
        if !surgical {
            messages.push(ChatMessage::system(MOTION_PRESETS));
        }

        let mut user = String::new();

        if let Some(brief) = design_brief
            && !brief.is_empty()
        {
            user.push_str(
                "# Design brief (use these exact values — palette hex, fonts, headline copy, section outline)\n",
            );
            user.push_str(brief);
            user.push_str("\n\n");
        }

        // The user request is the LATEST committed turn — older turns are
        // history that confuses Mercury (each call is stateless). Fall back to
        // partial transcript if nothing committed.
        let mut request_text = ctx
            .transcript()
            .last()
            .map(|turn| turn.trim().to_string())
            .unwrap_or_default();
        if request_text.is_empty()
            && let Some(partial) = ctx.partial_transcript()
        {
            request_text = partial.trim().to_string();
        }

        // The ORIGINAL request (first committed turn) anchors the topic so
        // iterations like "make it red and white" don't lose the "coffee shop"
        // identity. Only include if it differs from the latest turn.
        if ctx.transcript().len() > 1
            && let Some(original) = ctx.transcript().first()
            && !original.trim().is_empty()
            && original.trim() != request_text
        {
            user.push_str("# Topic (original request — this is WHAT the site is, do not lose this identity)\n");
            user.push_str(original.trim());
            user.push_str("\n\n");
        }

        // If we have NO prior turn but current_draft exists (e.g. eri was
        // restarted), still anchor the topic by sniffing the <title> from
        // the current HTML — at least Mercury keeps building "for X" rather
        // than starting over.
        if ctx.transcript().len() <= 1
            && let Some(draft) = current_draft
            && let Some(title_start) = draft.to_ascii_lowercase().find("<title>")
            && let Some(title_end) = draft[title_start..].find("</title>")
        {
            let raw = &draft[title_start + 7..title_start + title_end];
            let title = raw.trim();
            if !title.is_empty() && title.len() < 120 {
                user.push_str(&format!(
                    "# Topic (inferred from current code <title> — keep building this same site)\n{title}\n\n"
                ));
            }
        }

        if !request_text.is_empty() {
            user.push_str(
                "# User request (the LATEST change to apply — keep the topic above intact)\n",
            );
            user.push_str(&request_text);
            user.push_str("\n\n");
            // When iterating, add a reminder right next to the request so the
            // model can't miss it. Anchor the expected output length to
            // prevent Mercury from progressively truncating across iterations
            // (the "death spiral" where each iteration produces a smaller
            // file than the last until everything disappears). Also enforce
            // SURGICAL discipline: Mercury must reproduce every untouched line
            // verbatim from the current code, not "improve" or "refactor"
            // anything the user didn't ask about. The full-file emission is a
            // transport requirement (eri overwrites the path) — it is NOT a
            // license to rewrite untargeted sections.
            if let Some(draft) = current_draft
                && !draft.trim().is_empty()
                && draft.contains("<!DOCTYPE html")
            {
                let approx_lines = draft.lines().count();
                user.push_str(&format!(
                    "(Iteration mode — SURGICAL EDIT. The current code is ~{approx_lines} lines and ~{} characters. Emit ONE ```diff block with `--- /dev/null` + `+++ b/index.html` containing the COMPLETE updated file (eri overwrites the path; partial files break the apply). Output length MUST be AT LEAST that long — never truncate.\n\nCHANGE ONLY THE LINES THE USER NAMED. Every other line — `<head>`, fonts, `<script>` tags, Tailwind config, nav, hero structure, sections you weren't asked about, footer, JS — must appear byte-for-byte identical to the current code. Do NOT rewrite a section because you think it could be better. Do NOT refactor class names. Do NOT swap fonts or palette unless the user said 'change the colors' or 'change the font'. Do NOT add or delete sections. If the user said 'change the tagline', exactly one line changes; if they said 'change the colors to red and black', only the palette tokens and color utility classes change. The rest of the file is COPIED VERBATIM from the current code below. NO prose. NO advice. Apply the change directly.)\n\n",
                    draft.len()
                ));
            }
        }

        let gaze = ctx.gaze_target();
        if !matches!(gaze, GazeTarget::Unknown { .. }) {
            user.push_str("# Looking at\n");
            user.push_str(&format_gaze_target(gaze));
            user.push_str("\n(If you produce a diff, prefer modifying this region first.)\n\n");
        }

        if let Some(selection) = ctx.editor_selection() {
            user.push_str(&format!(
                "# Editor selection\n{}:{}-{}\n\n",
                selection.path.display(),
                selection.line_range.start,
                selection.line_range.end
            ));
        }

        // (No template injection — eri follows the user's guide and codes
        // from scratch. Mercury's general knowledge + the user's specific
        // request is the right level of abstraction.)

        if !ctx.open_files().is_empty() {
            user.push_str("# Open files\n");
            for file in ctx.open_files() {
                user.push_str(&format!(
                    "## {}\n```\n{}\n```\n",
                    file.path.display(),
                    file.text
                ));
            }
        }

        // Default to iterating on the existing draft. Only opt OUT when the
        // intent classifier reports a new build. Additionally, only attach
        // the draft if it actually looks like a complete HTML document —
        // fragments left over from earlier streaming bugs would confuse
        // Mercury and cause topic drift (e.g. coffee shop → fitness app
        // because the previous draft was just `+</footer>` fragments).
        let starts_new_build = self.classify_intent(ctx, current_draft).is_new_build();
        let draft_looks_complete = current_draft
            .map(|d| {
                let trimmed = d.trim();
                let lower = trimmed.to_ascii_lowercase();
                trimmed.len() > 500 && lower.contains("<!doctype html") && lower.contains("</html>")
            })
            .unwrap_or(false);
        if let Some(draft) = current_draft
            && draft_looks_complete
            && !draft.contains("Waiting for a concrete edit intent")
            && !starts_new_build
        {
            user.push_str(
                "# Current code (the user wants to iterate on THIS — keep what works, change only what they asked for)\n",
            );
            user.push_str(draft);
            user.push('\n');
        }

        messages.push(ChatMessage::user(user));
        messages
    }
}

const SYSTEM_PROMPT: &str = concat!(
    "You are eri, a code editor copilot whose output is auto-applied. ",
    "Be terse. Output must be runnable, not advice.\n\n",
    "RULES:\n",
    "0. EVERY diff you emit MUST use `--- /dev/null` and `+++ b/<path>` — even when iterating on a file that already exists. ",
    "   Include the FULL updated file content (eri overwrites the path completely). NEVER emit `--- a/<path>` patch hunks — they will be silently dropped.\n",
    "0a. ITERATION DISCIPLINE (read EVERY time `# Current code` is present): you MUST output a ```diff block. NEVER respond with prose, advice, instructions, or 'sure, here is how you do it'. The user's request is a DIRECTIVE — execute it, do not describe it. Examples:\n",
    "  USER: 'I don't like this. Make the colors blue and white.' → emit a ```diff block with --- /dev/null and +++ b/index.html containing the COMPLETE updated file with blue/white palette. NOT 'Sure, replace the accent with #1e40af and use bg-white...'\n",
    "  USER: 'make the buttons pink' → emit a complete updated file with pink buttons. NOT 'You can change the Tailwind classes to bg-pink-500...'\n",
    "  USER: 'add a pricing section' → emit a complete updated file with the new section. NOT 'Add a <section> with three tier cards...'\n",
    "  Keep every other line unchanged. Only modify what the user named. Apply the change, emit the diff, period.\n",
    "  If you respond with prose for any user request that has `# Current code` attached, your response is invalid.\n",
    "0b. SURGICAL DIFF RULE (applies whenever `# Current code` is present — this is the #1 reason iterations look wrong):\n",
    "  You emit the FULL file because eri overwrites the path; that is a TRANSPORT requirement, NOT permission to rewrite untargeted regions. Every line outside the user's named change must be reproduced VERBATIM (character-for-character) from the `# Current code` block. Treat the current code as ground truth: copy it line by line, then mutate ONLY the lines that implement the user's instruction.\n",
    "  Scope mapping (what counts as 'the named change'):\n",
    "    - 'change the tagline ...'        → ONLY the hero subhead / tagline text node. ~1 line.\n",
    "    - 'change the headline ...'       → ONLY the hero <h1> text. ~1 line.\n",
    "    - 'rename the button to ...'      → ONLY that button's text. ~1 line.\n",
    "    - 'change the color scheme to X'  → palette tokens (accent hex, tailwind.config colors) + the utility classes that reference them. Typically 5-30 lines. NOT fonts, NOT layout, NOT copy.\n",
    "    - 'change the font'               → ONLY the Google Fonts <link> + the font-family classes. NOT colors, NOT copy.\n",
    "    - 'add a <section> for X'         → INSERT one new <section>. Do not touch existing sections.\n",
    "    - 'remove the X section'          → DELETE only that <section>. Do not touch others.\n",
    "  BANNED in iteration mode (these behaviors mean you are doing it wrong — restart and re-emit a verbatim copy with only the named change):\n",
    "    - Rewriting `<head>` (title, meta, fonts, Tailwind script) when the user only asked for body copy or colors.\n",
    "    - Swapping the display font, body font, or Google Fonts link when the user did not say 'font'.\n",
    "    - Restructuring layout (changing grid, flex, max-w-*, py-*) when the user asked for a textual or color change.\n",
    "    - Renaming/refactoring Tailwind class names that are unrelated to the requested change.\n",
    "    - Rewriting nav links, footer columns, or section headings the user did not name.\n",
    "    - Adding new sections when the user only asked to change existing copy.\n",
    "    - Deleting existing sections when the user only asked to change copy or colors.\n",
    "    - Rewriting JavaScript when the user asked for a visual change.\n",
    "  Self-check before output: a one-sentence intent ('change the tagline from X to Y') should produce a diff where, if you ran `diff old new`, fewer than ~30 lines differ. If your output mutates more than that for a single-sentence intent, you are rewriting things you weren't asked to — STOP, copy the current code verbatim, and apply only the requested mutation.\n",
    "  Old-line reference rule: every existing line you intend to KEEP must appear in your output exactly as it appears in `# Current code` — same indentation, same attributes, same class list, same text. Do not paraphrase. Do not 'clean up' whitespace. Do not approximate.\n",
    "  GOOD example — USER said 'change the tagline from \"awaken your day\" to \"be more alive\"':\n",
    "    The diff contains the entire ~200-line file. Exactly ONE text node changes: `<p ...>awaken your day</p>` → `<p ...>be more alive</p>`. Every other line — DOCTYPE, head, fonts, tailwind config, nav, hero <h1>, every other <p>, every <section>, footer, scripts — is byte-identical to the current code.\n",
    "  BAD example for the same request (DO NOT DO THIS):\n",
    "    The diff also swaps the display font from Fraunces to Space Grotesk, changes the accent hex, rewords the hero <h1>, restyles the CTA button, and reorders nav links. This is a HARD REFUSAL — the user did not ask for any of that.\n",
    "  GOOD example — USER said 'change the color scheme to red and black':\n",
    "    The diff updates the tailwind.config accent hex to a red, swaps `bg-accent`/`text-accent`/`ring-accent` callsites to red+black, sets the neutral background to black or near-black, and adjusts text contrast utilities. Copy, layout, fonts, section structure, JS — all byte-identical to current code.\n",
    "  BAD example for the same request (DO NOT DO THIS):\n",
    "    The diff also rewrites the hero headline, replaces the Unsplash photo IDs, refactors section names, switches the font, and adds a new pricing section. HARD REFUSAL — the user said colors, only colors change.\n",
    "1. Single-file build (default for 'build me a game/app/website/demo/visualization'): ",
    "   one markdown line of plan, then a SINGLE ```diff block creating exactly `b/index.html` with ",
    "   COMPLETE self-contained HTML+CSS+JS. No Python, pygame, npm, requirements.txt, multi-file.\n",
    "2. Fullstack build (only when user explicitly says 'fullstack', 'backend', 'API', 'server', 'database'): ",
    "   emit MULTIPLE ```diff blocks, one per file. The backend MUST be a single self-contained file using ",
    "   stdlib only — `server.js` for Node (use built-in `http` module, no Express/no npm install) or ",
    "   `server.py` for Python (use built-in `http.server` / `socketserver`, no flask/fastapi). ",
    "   The frontend MUST be `b/public/index.html` (or `b/index.html` if no public dir) that fetches the backend ",
    "   at `http://localhost:3000`. The backend MUST listen on port 3000 and serve static files from its own directory. ",
    "   Every backend response that needs CORS MUST set `Access-Control-Allow-Origin: *`.\n",
    "3. Modify an existing file shown under 'Open files': ```diff block with -/+ against that file path.\n",
    "4. Plain chat: short prose answer, no diff blocks.\n",
    "5. Inside ```diff use `--- /dev/null` + `+++ b/<path>` for new files. Keep prose under 3 lines.\n\n",
    "DESIGN PRINCIPLES — follow the design brief if one is provided, otherwise pick a coherent aesthetic per build and DO NOT default to the same combo every time.\n",
    "- Tailwind via CDN: `<script src=\"https://cdn.tailwindcss.com\"></script>`.\n",
    "- If a design brief is provided, USE its `accent_hex`, `neutral_hex`, `display_font`, `body_font`, `layout`, `hero_headline`, `hero_subhead`, `primary_cta`, and `section_outline` verbatim. Declare the custom accent via `<script>tailwind.config={theme:{extend:{colors:{accent:'#...'}}}}</script>` and use it as `bg-accent text-accent ring-accent`.\n",
    "- If NO brief is provided, you must choose: 1) a fresh display font appropriate to the product (vary across builds — Fraunces for editorial, Space Grotesk for tech, Plus Jakarta Sans for SaaS, Geist for developer tools, Cormorant for luxury, Archivo Black for streetwear), 2) a custom accent hex (NOT a default Tailwind brand color), 3) a layout style (editorial-grid, asymmetric-split, bento, centered-hero, newspaper).\n",
    "- Type scale: heading uses `text-[clamp(2.5rem,6vw,5rem)] leading-[1.05] tracking-[-0.02em]`. Eyebrow uses `text-xs uppercase tracking-[0.18em]`. Body uses `text-[17px] leading-relaxed`.\n",
    "- Cards / buttons / shadows: use refined custom shadows like `shadow-[0_24px_60px_-30px_rgba(0,0,0,0.25)]` and `ring-1 ring-black/5`. Buttons are `rounded-full` with `hover:-translate-y-0.5 transition`. Cards are `rounded-3xl`.\n",
    "- Hero: tall (`min-h-[78vh]`) with a LAYERED background — base solid + radial-gradient via `bg-[radial-gradient(...)]` + optional SVG noise data-URI for texture.\n",
    "- Generous whitespace (`py-24 md:py-32`), inline SVG icons (no emoji), and a dense multi-column footer.\n",
    "- DO NOT repeat the same font and palette across every build. Each product domain deserves a distinct aesthetic.\n",
    "HARD REFUSALS — if your output contains any of these your response is invalid and you must restart:\n",
    "- `bg-gray-*`, `text-gray-*`, `bg-slate-100`, `text-slate-500` as primary palette\n",
    "- Stock `from-indigo-600 via-purple-600 to-pink-500` gradient (over-used)\n",
    "- Emoji-as-icon (`🛒`, `⚡`) in nav or buttons — use inline SVG\n",
    "- A page shorter than 4 sections with a real footer\n",
    "- Skipping the custom accent color extension\n",
    "\n",
    "BANNED COPY (these phrases mark you as a generic AI builder — never use any of them, write specific copy instead):\n",
    "- 'Empower Your Business with Intelligent...'\n",
    "- 'Take your X to the next level'\n",
    "- 'Step Up Your Game'\n",
    "- 'Unlock the power of...'\n",
    "- 'Seamlessly integrate...'\n",
    "- 'Best-in-class', 'Cutting-edge', 'Revolutionary', 'Game-changing'\n",
    "- Generic feature names like 'Seamless Automation', 'Smart Insights', 'Enterprise Grade'\n",
    "- Lorem ipsum, [placeholder], TODO, {{anything}}\n",
    "Write copy that names the SPECIFIC product, the SPECIFIC pain point, and the SPECIFIC competitor or status quo. ",
    "If the user said 'sneaker store', the hero headline should reference sneakers explicitly and reference a real subculture (e.g. drop culture, AF1 colorways, off-court energy) — not 'Step Up Your Game'.\n\n",
    "IMAGES (when you need photos):\n",
    "- DO NOT use `source.unsplash.com` (retired) or `loremflickr.com` (returns random off-topic photos).\n",
    "- USE direct Unsplash photo URLs with the format ",
    "`https://images.unsplash.com/photo-<photo-id>?auto=format&fit=crop&w=<W>&q=80` — these are curated, reliable, and always match. ",
    "Pick photo IDs that fit the theme. Examples of always-working IDs by category:\n",
    "  Sneakers/footwear: `1542291026-7eec264c27ff`, `1606107557195-0e29a4b5b4aa`, `1551107696-a4b0c5a0d9a2`, `1525966222134-fcfa99b8ae77`\n",
    "  Fashion / streetwear: `1521572163474-6864f9cf17ab`, `1490481651871-ab68de25d43d`, `1483985988355-763728e1935b`\n",
    "  Tech / gadgets: `1518770660439-4636190af475`, `1593642632559-0c6d3fc62b89`, `1517336714731-489689fd1ca8`\n",
    "  Food / drinks: `1504674900247-0877df9cc836`, `1559056199-641a0ac8b55e`, `1571115177098-24ec42ed204d`\n",
    "  People portraits: `1494790108377-be9c29b29330`, `1500648767791-00dcc994a43e`, `1438761681033-6461ffad8d80`\n",
    "  Workspaces / offices: `1499951360447-b19be8fe80f5`, `1497366216548-37526070297c`, `1497366811353-6870744d04b2`\n",
    "  Nature / outdoor: `1506744038136-46273834b3fb`, `1441974231531-c6227db76b6e`, `1518837695005-2083093ee35b`\n",
    "  Abstract / gradients: `1557682250-33bd709cbe85`, `1620207418302-439b387441b0`, `1530021232320-687d8e3dba54`\n",
    "  Dashboards / abstract data: use `https://images.unsplash.com/photo-1551288049-bebda4e38f71?...` (charts mockup).\n",
    "- If no listed ID fits, fall back to `https://picsum.photos/seed/<descriptive-seed>/<W>/<H>` (seeded so reruns match).\n\n",
    "GAME QUALITY (when the user asks for a game):\n",
    "- Default to EASY difficulty (large gaps, slow speed). The user is testing, not playing seriously.\n",
    "- Input MUST work via BOTH `click` on canvas AND `keydown` (`Space` and `ArrowUp`). Both fire the same action.\n",
    "- On game over, render a clear restart hint ('Click or press Space to play again'). Either input must reset the game.\n",
    "- Reset MUST restore initial state for ALL mutable variables (bird position, velocity, pipes array, frame counter, score, gameOver flag).\n",
    "- Animation loop uses `requestAnimationFrame`. Always call it once on load to start.\n",
    "- Use `addEventListener` only ONCE per event type; don't re-bind inside reset.\n",
    "- For Flappy-style games: gap >= 200px, pipe speed <= 2.0, gravity <= 0.45, jump impulse around -8.\n",
    "- For ALL games: ensure the controls work on the FIRST click without needing the canvas to gain focus first."
);

/// Curated component-library hints layered onto every Mercury fire (new
/// builds AND iterations). shadcn/ui is the industry-default token vocabulary
/// for production-quality React/HTML — its class strings encode the "looks
/// hand-designed by a senior designer" defaults (correct focus rings,
/// semantic CSS-var color tokens, radius/shadow scale) without forcing a
/// component library at runtime. Mercury reproduces these in plain Tailwind
/// markup, so the output stays single-file HTML while picking up the polish.
pub const SHADCN_COMPONENT_HINTS: &str = concat!(
    "COMPONENT LIBRARY DEFAULTS (shadcn/ui patterns — copy these CLASS STRINGS verbatim when you emit a button, card, input, or dialog; ",
    "they encode the focus rings, contrast ratios, and motion that production design teams ship):\n",
    "- Button: `inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50`. ",
    "Primary variant adds `bg-primary text-primary-foreground hover:bg-primary/90`. Secondary uses `bg-secondary text-secondary-foreground hover:bg-secondary/80`. Ghost uses `hover:bg-accent hover:text-accent-foreground`.\n",
    "- Card: `rounded-lg border bg-card text-card-foreground shadow-sm`. Header: `flex flex-col space-y-1.5 p-6`. Title: `text-2xl font-semibold leading-none tracking-tight`. Description: `text-sm text-muted-foreground`. Content: `p-6 pt-0`.\n",
    "- Input: `flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50`.\n",
    "- Color tokens (CSS vars — use these utility classes so palette swaps work cleanly): ",
    "`bg-background`, `text-foreground`, `bg-card`, `text-card-foreground`, `bg-primary`, `text-primary-foreground`, `bg-secondary`, `text-secondary-foreground`, ",
    "`bg-muted`, `text-muted-foreground`, `bg-accent`, `text-accent-foreground`, `bg-destructive`, `text-destructive-foreground`, `border-input`, `ring-ring`. ",
    "Define these in a `<script>tailwind.config={theme:{extend:{colors:{...}}}}</script>` block mapping each token to the brief's hex values (or, when no brief is provided, the palette you chose for this build).\n",
    "- Dialog / modal: full-screen `fixed inset-0 z-50 bg-background/80 backdrop-blur-sm` backdrop with `data-[state=open]:animate-in data-[state=open]:fade-in-0` ",
    "and a centered panel `fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 ",
    "data-[state=open]:animate-in data-[state=open]:slide-in-from-top-[48%] data-[state=open]:zoom-in-95 sm:rounded-lg`. ",
    "Dismissable with `Escape` (wire `keydown` to remove the open state) AND a corner close button.\n",
    "Treat these strings as the floor, not the ceiling — extend them when the design brief asks for it, but do not strip them."
);

/// Curated theme palettes the user can invoke by voice ("use stripe colors",
/// "make it look like linear", "theme it like a coffee shop"). Each palette
/// pins four hex codes — background, foreground, accent, muted — that map
/// directly to the shadcn/ui CSS-var token set so Mercury can drop them into
/// `tailwind.config.theme.extend.colors` and the new build inherits the look
/// instantly. The set is intentionally diverse (clean tech, dark editorial,
/// warm productivity, brutalist, cyberpunk, etc.) so the user has real range
/// without naming hex codes.
pub const THEME_PALETTES: &[ThemePalette] = &[
    ThemePalette {
        name: "stripe",
        aliases: &["stripe style", "stripe colors", "stripe palette"],
        bg_hex: "#FFFFFF",
        fg_hex: "#1A1F36",
        accent_hex: "#635BFF",
        muted_hex: "#F6F9FC",
        description: "clean tech, blue-purple accent",
    },
    ThemePalette {
        name: "linear",
        aliases: &["linear app", "linear colors", "linear palette"],
        bg_hex: "#08070D",
        fg_hex: "#FFFFFF",
        accent_hex: "#5E6AD2",
        muted_hex: "#1A1B1F",
        description: "dark editorial, indigo accent",
    },
    ThemePalette {
        name: "notion",
        aliases: &["notion colors", "notion palette"],
        bg_hex: "#FFFFFF",
        fg_hex: "#37352F",
        accent_hex: "#2EAADC",
        muted_hex: "#F7F6F3",
        description: "warm productivity, soft cyan accent",
    },
    ThemePalette {
        name: "coffee shop",
        aliases: &[
            "coffee",
            "coffeeshop",
            "coffee colors",
            "coffee palette",
            "cafe",
        ],
        bg_hex: "#FFF8F0",
        fg_hex: "#2D1810",
        accent_hex: "#C97B5A",
        muted_hex: "#F4E5D3",
        description: "warm sepia, terracotta accent",
    },
    ThemePalette {
        name: "editorial magazine",
        aliases: &["editorial", "magazine", "editorial palette"],
        bg_hex: "#F5F2EC",
        fg_hex: "#0A0A0A",
        accent_hex: "#E0FF4F",
        muted_hex: "#C8C0AC",
        description: "dark on cream, neon yellow accent",
    },
    ThemePalette {
        name: "pastel dreamy",
        aliases: &["pastel", "dreamy", "pastel palette", "dreamy palette"],
        bg_hex: "#FDF6FF",
        fg_hex: "#4A2C5E",
        accent_hex: "#FFB5DC",
        muted_hex: "#F0D9F7",
        description: "soft lavender and pink",
    },
    ThemePalette {
        name: "newspaper print",
        aliases: &["newspaper", "print", "newspaper palette"],
        bg_hex: "#FAF7F2",
        fg_hex: "#1A1A1A",
        accent_hex: "#B91D1D",
        muted_hex: "#EBE5DA",
        description: "ink on newsprint, red accent",
    },
    ThemePalette {
        name: "cyberpunk neon",
        aliases: &["cyberpunk", "neon", "cyberpunk palette", "neon palette"],
        bg_hex: "#0A0E1A",
        fg_hex: "#00FFA3",
        accent_hex: "#FF006E",
        muted_hex: "#1A1F3A",
        description: "deep navy with mint and magenta neon",
    },
    ThemePalette {
        name: "forest",
        aliases: &["forest palette", "woodland"],
        bg_hex: "#F4F1EA",
        fg_hex: "#2D3A2F",
        accent_hex: "#4A7C59",
        muted_hex: "#DDD4C1",
        description: "muted greens on stone",
    },
    ThemePalette {
        name: "y2k chrome",
        aliases: &["y2k", "chrome", "y2k palette"],
        bg_hex: "#E8E8F0",
        fg_hex: "#1B1B23",
        accent_hex: "#FF4FA0",
        muted_hex: "#C6C6D8",
        description: "metallic lilac with hot pink",
    },
    ThemePalette {
        name: "brutalist",
        aliases: &["brutalism", "brutalist palette"],
        bg_hex: "#FFFFFF",
        fg_hex: "#000000",
        accent_hex: "#FFE600",
        muted_hex: "#E5E5E5",
        description: "high-contrast geometric, yellow caution accent",
    },
    ThemePalette {
        name: "sunset",
        aliases: &["sunset palette", "dusk"],
        bg_hex: "#FFF0E5",
        fg_hex: "#2D1810",
        accent_hex: "#FF6B35",
        muted_hex: "#FFD7B5",
        description: "peach and orange",
    },
];

/// Metadata for a single voice-invokable color palette. Stored as a flat
/// const struct array (`THEME_PALETTES`) so palette lookups are zero-cost and
/// the panel can render the palette card without re-querying the inference
/// crate. Aliases are matched case-insensitively after stripping punctuation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ThemePalette {
    pub name: &'static str,
    pub aliases: &'static [&'static str],
    pub bg_hex: &'static str,
    pub fg_hex: &'static str,
    pub accent_hex: &'static str,
    pub muted_hex: &'static str,
    pub description: &'static str,
}

impl ThemePalette {
    /// Render the palette as a `# Theme directive` block ready to prepend to
    /// the user's transcript turn. Mercury's system prompt already knows how
    /// to consume `accent_hex` and friends — this block reuses the existing
    /// design-brief vocabulary so no second prompt path is required.
    pub fn directive_block(&self) -> String {
        format!(
            "# Theme directive (USE THESE EXACT HEX CODES — do not invent your own palette this build)\n\
             palette_name: {name}\n\
             palette_mood: {description}\n\
             background_hex: {bg}\n\
             foreground_hex: {fg}\n\
             accent_hex: {accent}\n\
             muted_hex: {muted}\n\
             Map them into `tailwind.config.theme.extend.colors` as `background`, `foreground`, `accent`, `muted` \
             (plus shadcn's `primary`/`primary-foreground` derived from `accent`/`background`) and use the \
             matching utility classes (`bg-background`, `text-foreground`, `bg-accent`, `text-muted-foreground`).\n",
            name = self.name,
            description = self.description,
            bg = self.bg_hex,
            fg = self.fg_hex,
            accent = self.accent_hex,
            muted = self.muted_hex,
        )
    }
}

/// Case-insensitive, punctuation-tolerant lookup against `THEME_PALETTES`.
/// Used by both the voice parser (`ControlCommand::SetTheme`) and by tests
/// that assert palette names round-trip. Matching strategy: normalize to
/// lowercase alphanumeric+spaces, then accept either the canonical `name` or
/// any entry in `aliases`. The order of the slice is significant — longer
/// matches first — so "coffee shop" wins over a hypothetical "coffee".
pub fn match_theme_palette(query: &str) -> Option<&'static ThemePalette> {
    let normalized = normalize_palette_query(query);
    if normalized.is_empty() {
        return None;
    }
    THEME_PALETTES.iter().find(|palette| {
        if normalize_palette_query(palette.name) == normalized {
            return true;
        }
        palette
            .aliases
            .iter()
            .any(|alias| normalize_palette_query(alias) == normalized)
    })
}

fn normalize_palette_query(input: &str) -> String {
    input
        .chars()
        .filter_map(|c| {
            if c.is_ascii_alphanumeric() {
                Some(c.to_ascii_lowercase())
            } else if c.is_whitespace() || c == '-' || c == '_' {
                Some(' ')
            } else {
                None
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Reusable motion snippets layered onto Mercury's user prompt when the user
/// said "add motion" / "make it animated". Each snippet is a self-contained
/// CSS+markup recipe — Mercury copies them verbatim rather than improvising
/// keyframes, which keeps the animations consistent across builds. The
/// preset emphasizes Framer-Motion-style ease curves (`cubic-bezier(0.16, 1,
/// 0.3, 1)`) because that's what production sites ship.
pub const MOTION_PRESETS: &str = concat!(
    "MOTION PRESETS (drop these into the `<style>` block and tag the matching elements):\n",
    "- Hero fade-up on load:\n",
    "  ```css\n",
    "  @keyframes eriFadeUp {\n",
    "    from { opacity: 0; transform: translateY(24px); }\n",
    "    to   { opacity: 1; transform: translateY(0); }\n",
    "  }\n",
    "  .eri-fade-up { animation: eriFadeUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) both; }\n",
    "  ```\n",
    "  Apply `class=\"eri-fade-up\"` to the hero `<h1>`, subhead, and primary CTA. Stagger ",
    "with inline `style=\"animation-delay:.12s\"`, `.24s`, `.36s` on successive children.\n",
    "- Button hover lift:\n",
    "  ```css\n",
    "  .eri-lift { transition: transform 200ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 200ms; }\n",
    "  .eri-lift:hover { transform: translateY(-1px); box-shadow: 0 10px 30px -12px rgba(0,0,0,0.25); }\n",
    "  ```\n",
    "- Smooth scroll for anchor links: add `html { scroll-behavior: smooth; }` to the global `<style>`.\n",
    "- Stagger grid items:\n",
    "  ```css\n",
    "  .eri-stagger > * { opacity: 0; animation: eriFadeUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) both; }\n",
    "  .eri-stagger > *:nth-child(1) { animation-delay: 0.08s; }\n",
    "  .eri-stagger > *:nth-child(2) { animation-delay: 0.16s; }\n",
    "  .eri-stagger > *:nth-child(3) { animation-delay: 0.24s; }\n",
    "  .eri-stagger > *:nth-child(4) { animation-delay: 0.32s; }\n",
    "  .eri-stagger > *:nth-child(5) { animation-delay: 0.40s; }\n",
    "  .eri-stagger > *:nth-child(6) { animation-delay: 0.48s; }\n",
    "  ```\n",
    "Respect `prefers-reduced-motion`: wrap the animations in `@media (prefers-reduced-motion: no-preference) { ... }`."
);

/// The user-prompt block produced by the "add motion" voice command. Keeping
/// the literal string in this crate (alongside `MOTION_PRESETS`) ensures the
/// inference layer owns the wording so future tweaks don't require touching
/// the UI crate.
pub const MOTION_DIRECTIVE_BLOCK: &str = concat!(
    "# Motion directive\n",
    "Add subtle Framer-Motion-style transitions to the hero, primary buttons, and any grid/card sections. ",
    "Use the MOTION PRESETS provided in the system prompt verbatim — do not improvise new keyframes. ",
    "Respect `prefers-reduced-motion`.\n"
);

/// System prompt for the SURGICAL iteration path (Phase 4). Mercury is given
/// the `edit_html` tool and forced to call it via `tool_choice`. Each call's
/// `edits` array maps directly to search/replace pairs eri applies in-process.
/// Output is typically 200-500 bytes per intent (vs 8-12kB for a full rewrite),
/// so iterations finish in ~600ms and the model physically cannot drift onto
/// unrelated sections.
const SURGICAL_SYSTEM_PROMPT: &str = concat!(
    "You are eri's surgical editor. You will receive a self-contained HTML file ",
    "(the user's current draft) and one edit instruction. You MUST respond by ",
    "calling the `edit_html` tool with a list of minimal `{search, replace}` ",
    "pairs. Do NOT emit assistant content — only the tool call.\n",
    "\n",
    "RULES (non-negotiable):\n",
    "1. Each `search` MUST appear VERBATIM in the current draft, byte-for-byte. ",
    "No reformatting, no paraphrasing. If the same fragment appears more than ",
    "once, include 1-3 lines of surrounding context until the match is unique.\n",
    "2. Each `replace` is the substitute text. Keep it minimal — do not 'improve' ",
    "unrelated styling, comments, or whitespace. Touch only what the user asked.\n",
    "3. Emit multiple entries in `edits` if the intent needs several edits in ",
    "different parts of the file. Each entry stands alone.\n",
    "4. NEVER call the tool with an empty `edits` array. If the user's intent ",
    "cannot be expressed as a small targeted edit (e.g. they asked for a ",
    "completely different product), use a single entry whose `search` is the ",
    "entire `<body>...</body>` contents and whose `replace` is the new body. ",
    "Keep `<head>` unchanged.\n",
    "5. NEVER emit prose, code fences, diff fences, or any free-form text. Use ",
    "the tool call and nothing else.\n",
    "\n",
    "Good example — user says 'make the pipes red':\n",
    "edit_html({\"edits\": [{\"search\": \"      pipeColor: '#34d399',\", ",
    "\"replace\": \"      pipeColor: '#ef4444',\"}]})\n",
);

/// System prompt for the apply-path snippet generator (task #48). Mercury 2
/// chat receives the current file plus a user instruction and must emit ONLY
/// the changed regions, with `// ... existing code ...` markers standing in
/// for every untouched region. This snippet then feeds Mercury Edit 2's
/// `/v1/apply/completions` endpoint, which merges it back into the full file.
const APPLY_SNIPPET_SYSTEM_PROMPT: &str = concat!(
    "You are eri's update-snippet generator for Mercury Edit 2's apply endpoint. ",
    "You will receive a full HTML file (the user's current draft) and one edit ",
    "instruction. You MUST output a compact `update snippet` that shows ONLY the ",
    "lines that change, with `// ... existing code ...` markers replacing every ",
    "untouched region.\n",
    "\n",
    "RULES (non-negotiable):\n",
    "1. Output ONLY the snippet — NO prose, NO code fences, NO explanations.\n",
    "2. Use `// ... existing code ...` (the literal comment, including the two ",
    "leading slashes) to stand in for every contiguous run of unchanged lines.\n",
    "3. Include at most 1-3 lines of surrounding context around each changed ",
    "region so the apply endpoint can anchor the merge. Do NOT paste the full ",
    "file back — that defeats the point of this path.\n",
    "4. Apply ONLY the user's named change. Do NOT refactor unrelated code, ",
    "swap fonts, rewrite copy outside the named region, or 'improve' anything.\n",
    "5. If multiple non-contiguous regions change, separate each with a ",
    "`// ... existing code ...` line.\n",
    "\n",
    "Example — USER said 'change the tagline to \"be more alive\"':\n",
    "// ... existing code ...\n",
    "<p class=\"hero-tagline\">be more alive</p>\n",
    "// ... existing code ...\n",
);

/// Strip a leading/trailing ```...``` fence from a model response so the
/// apply endpoint sees the raw snippet. Tolerates `` ```html ``, `` ```diff ``,
/// or plain `` ``` `` openers.
fn strip_code_fence(text: &str) -> &str {
    let trimmed = text.trim();
    let Some(rest) = trimmed.strip_prefix("```") else {
        return trimmed;
    };
    // Drop the language hint up to the first newline.
    let body = match rest.find('\n') {
        Some(idx) => &rest[idx + 1..],
        None => rest,
    };
    body.strip_suffix("```")
        .map(|s| s.trim_end())
        .unwrap_or(body)
}

impl InferenceBackend for MercuryBackend {
    fn iterate(
        &self,
        prompt_ctx: &PromptCtx,
        request: IterationRequest,
    ) -> Result<Vec<IterEvent>, InferenceError> {
        // PASS 1 (design brief): only for new builds with no current draft.
        // We ask Mercury to produce a structured JSON brief — custom palette,
        // unique copy hooks, layout choice — so the second pass has concrete
        // direction and we get genuine variety per build.
        let needs_brief =
            request.current_draft.is_none() && self.looks_like_new_build_from_ctx(prompt_ctx);
        let design_brief = if needs_brief {
            self.fetch_design_brief(prompt_ctx).ok()
        } else {
            None
        };

        let messages = self.build_messages(
            prompt_ctx,
            request.current_draft.as_deref(),
            design_brief.as_deref(),
        );
        let payload = ChatCompletionPayload {
            model: &self.config.model,
            messages: &messages,
            max_tokens: self.config.max_tokens,
            temperature: self.config.temperature,
            stream: false,
            reasoning_effort: &self.config.reasoning_effort,
            stream_options: None,
            diffusing: None,
            tools: None,
            tool_choice: None,
        };
        let body = serde_json::to_string(&payload)?;
        let response = self.transport.post_json(&self.endpoint(), &body)?;
        let parsed: ChatCompletionResponse = serde_json::from_str(&response).map_err(|err| {
            if let Ok(error) = serde_json::from_str::<ChatErrorEnvelope>(&response) {
                InferenceError::Transport(format!(
                    "eri Engine returned an error: {}",
                    error.error.message
                ))
            } else {
                InferenceError::Json(err)
            }
        })?;
        let usage = parsed.usage.clone();
        let choice = parsed.choices.into_iter().next();
        let finish_reason = choice
            .as_ref()
            .and_then(|c| c.finish_reason.clone())
            .unwrap_or_default();
        let text = choice
            .map(|choice| choice.message.content)
            .unwrap_or_default();

        let mut events = vec![IterEvent::DenoisingStep {
            step: 1,
            total: request.denoising_steps.max(1),
        }];

        let completion_tokens = usage.as_ref().map(|u| u.completion_tokens).unwrap_or(0);
        let reasoning_tokens = usage.as_ref().and_then(|u| u.reasoning_tokens).unwrap_or(0);
        let prompt_tokens = usage.as_ref().map(|u| u.prompt_tokens).unwrap_or(0);

        let total_tokens = usage.as_ref().map(|u| u.total_tokens).unwrap_or(0);
        if text.trim().is_empty() && completion_tokens == 0 && finish_reason == "length" {
            events.push(IterEvent::Error {
                message: format!(
                    "capped at reasoning (in {prompt_tokens} · reason {reasoning_tokens} · out 0 · total {total_tokens}). \
                     Set MERCURY_MAX_TOKENS higher than {} or simplify the prompt.",
                    self.config.max_tokens
                ),
            });
            return Ok(events);
        }

        if !text.is_empty() {
            events.push(IterEvent::DraftToken { text: text.clone() });
        }
        if let Some(patch) = extract_diff_patch(&text, prompt_ctx, self.next_patch_id()) {
            events.push(IterEvent::CandidatePatch { patch });
        }
        if let Some(usage) = usage.as_ref() {
            events.push(IterEvent::Usage {
                model: self.config.model.clone(),
                prompt_tokens: usage.prompt_tokens,
                completion_tokens: usage.completion_tokens,
                reasoning_tokens: usage.reasoning_tokens.unwrap_or(0),
                total_tokens: usage.total_tokens,
            });
        }
        events.push(IterEvent::Done);
        Ok(events)
    }

    /// SSE-streaming Mercury implementation. Posts with `stream: true`,
    /// parses `data: {...}` chunks line-by-line, and fires
    /// `IterEvent::DraftToken { text: delta }` for each token delta as it
    /// arrives — first tokens visible in ~300ms instead of waiting ~1-2s
    /// for the full response.
    fn iterate_stream(
        &self,
        prompt_ctx: &PromptCtx,
        request: IterationRequest,
        on_event: &mut dyn FnMut(IterEvent),
        on_partial_html: &mut dyn FnMut(&str),
    ) -> Result<(), InferenceError> {
        // When the user has flipped MCP on (`mcp_active`), run a brief
        // multi-turn tool-resolve loop BEFORE the normal iteration so any
        // facts Mercury wants from MCP servers (e.g. "list my open PRs")
        // are folded into context for the build. The loop's results are
        // attached to the prompt as additional `# Tool results` chunks; the
        // normal streaming edit_html path then produces the final draft.
        // Failures inside the loop are logged but never crash the iteration
        // — we'd rather Mercury build without the tool results than fail.
        let tool_results = if self.mcp_active() {
            match self.run_mcp_tool_loop(prompt_ctx, request.current_draft.as_deref(), on_event) {
                Ok(results) => results,
                Err(error) => {
                    eprintln!(
                        "[eri.mcp] tool loop failed: {error} — continuing without tool results"
                    );
                    Vec::new()
                }
            }
        } else {
            Vec::new()
        };
        let prompt_ctx_with_tools = if tool_results.is_empty() {
            prompt_ctx.clone()
        } else {
            let mut extended = prompt_ctx.clone();
            let header = format!(
                "# MCP tool results (gathered before this iteration — use them as ground truth)\n{}",
                tool_results.join("\n\n---\n\n")
            );
            extended.commit_transcript_chunk(header);
            extended
        };
        let prompt_ctx = &prompt_ctx_with_tools;

        // Phase 4 routing: when the adaptive classifier says this is an
        // ITERATION on an existing complete draft, take the surgical
        // search/replace path. Mercury emits ~200-500 byte blocks instead of
        // a full ~8-12kB file rewrite — ~10x smaller output, ~5x faster, and
        // physically incapable of drift on unrelated sections.
        let intent = self.classify_intent(prompt_ctx, request.current_draft.as_deref());
        let is_iteration = !intent.is_new_build() && request.current_draft.is_some();
        // Task #48: opt-in Mercury Edit 2 apply path. Only meaningful for
        // iterations on a large existing draft (>4000 chars); for smaller
        // files the surgical tool-call path's overhead is already negligible.
        let draft_len = request
            .current_draft
            .as_deref()
            .map(|s| s.len())
            .unwrap_or(0);
        let use_apply = is_iteration
            && draft_len > 4000
            && env::var("ERI_APPLY_ITERATE")
                .map(|v| v != "0" && !v.is_empty())
                .unwrap_or(false);
        if use_apply {
            return self.iterate_apply_stream(prompt_ctx, request, on_event, on_partial_html);
        }
        let use_surgical = is_iteration
            && env::var("ERI_SURGICAL_ITERATE")
                .map(|v| v != "0" && !v.is_empty())
                .unwrap_or(true); // opt-OUT not opt-in — surgical is the default
        if use_surgical {
            return self.iterate_surgical_stream(prompt_ctx, request, on_event, on_partial_html);
        }

        // Skip the design-brief Pass 1 — it added 1-2s of dead time before
        // streaming started. The strong system prompt + per-build prompt is
        // enough to drive variety. If users want it back, set
        // MERCURY_DESIGN_BRIEF=1.
        let design_brief = if env::var("MERCURY_DESIGN_BRIEF")
            .ok()
            .map(|v| v != "0" && !v.is_empty())
            .unwrap_or(false)
            && request.current_draft.is_none()
            && self.looks_like_new_build_from_ctx(prompt_ctx)
        {
            self.fetch_design_brief(prompt_ctx).ok()
        } else {
            None
        };

        let mut messages = self.build_messages(
            prompt_ctx,
            request.current_draft.as_deref(),
            design_brief.as_deref(),
        );
        // Template seed (project starters): when this is a new build, no
        // current draft exists, and the user's prompt matches a known
        // starter ("portfolio", "coffee shop", "flappy bird", etc.), prepend
        // the template HTML as a quality floor. Mercury treats it as a base
        // to modify rather than a blank canvas to invent. Massive speedup on
        // the inner loop AND a higher-quality starting point.
        if intent.is_new_build() && request.current_draft.is_none() {
            let prompt_text = prompt_ctx
                .transcript()
                .last()
                .map(String::as_str)
                .or_else(|| prompt_ctx.partial_transcript())
                .unwrap_or("");
            if let Some(template) = templates::match_template(prompt_text) {
                eprintln!(
                    "[eri.template] seeding new build with template={} ({} chars)",
                    template.slug,
                    template.html.len()
                );
                let seed_message = format!(
                    "Start from this template (modify it to fit the user's request — keep the structure and aesthetic, do NOT replace the whole file with a from-scratch rewrite):\n```html\n{}\n```\n",
                    template.html
                );
                // Insert as a second system message right after SYSTEM_PROMPT
                // so Mercury sees it before the user's content.
                let insert_at = messages
                    .iter()
                    .position(|m| m.role != "system")
                    .unwrap_or(messages.len());
                messages.insert(insert_at, ChatMessage::system(seed_message));
            }
        }
        // Mercury 2 supports `diffusing: true` alongside `stream: true` to
        // surface intermediate denoising states (the "text emerges from noise"
        // visualization from the original eri vision). It only ever fires on
        // the streaming new-build path — iterations take the surgical tool-call
        // route below. Opt-out via MERCURY_DIFFUSING=0.
        let want_diffusing = env::var("MERCURY_DIFFUSING")
            .map(|value| value != "0" && !value.is_empty())
            .unwrap_or(true);
        let payload = ChatCompletionPayload {
            model: &self.config.model,
            messages: &messages,
            max_tokens: self.config.max_tokens,
            temperature: self.config.temperature,
            stream: true,
            reasoning_effort: &self.config.reasoning_effort,
            stream_options: Some(StreamOptions {
                include_usage: true,
            }),
            diffusing: if want_diffusing { Some(true) } else { None },
            tools: None,
            tool_choice: None,
        };
        let body = serde_json::to_string(&payload)?;

        on_event(IterEvent::DenoisingStep {
            step: 1,
            total: request.denoising_steps.max(1),
        });

        let start_time = std::time::Instant::now();
        let first_chunk_time: std::cell::Cell<Option<std::time::Duration>> =
            std::cell::Cell::new(None);
        let mut accumulated = String::new();
        let mut emitted_patch = false;
        let mut final_finish_reason = String::new();
        let mut chunk_count: u32 = 0;
        let mut last_partial_write = std::time::Instant::now();
        // Coalesce partial writes — Mercury chunks can be sub-token; the WKWebView
        // preview repaints on each disk write, so capping at ~150ms keeps the
        // FSEvents watcher from thrashing while still feeling live.
        let partial_write_min_gap = std::time::Duration::from_millis(150);
        eprintln!(
            "[eri.mercury] POST {} (reasoning={}, max_tokens={}, prompt_chars={})",
            self.endpoint(),
            self.config.reasoning_effort,
            self.config.max_tokens,
            body.len()
        );
        let billing_model = self.config.model.clone();
        self.transport
            .post_json_lines(&self.endpoint(), &body, &mut |raw| {
                // Each SSE event is a line beginning with `data:`. Blank
                // lines separate events. `data: [DONE]` is the stream
                // terminator.
                let trimmed = raw.trim_start();
                let Some(payload_str) = trimmed.strip_prefix("data:") else {
                    return;
                };
                let payload_str = payload_str.trim();
                if payload_str.is_empty() || payload_str == "[DONE]" {
                    eprintln!("[eri.mercury] stream terminator received");
                    return;
                }
                let Ok(chunk) = serde_json::from_str::<ChatCompletionChunk>(payload_str) else {
                    eprintln!(
                        "[eri.mercury] failed to parse SSE chunk ({} chars)",
                        payload_str.len()
                    );
                    return;
                };
                if let Some(usage) = chunk.usage {
                    on_event(IterEvent::Usage {
                        model: billing_model.clone(),
                        prompt_tokens: usage.prompt_tokens,
                        completion_tokens: usage.completion_tokens,
                        reasoning_tokens: usage.reasoning_tokens.unwrap_or(0),
                        total_tokens: usage.total_tokens,
                    });
                }
                for choice in chunk.choices {
                    if let Some(reason) = choice.finish_reason {
                        final_finish_reason = reason;
                    }
                    let delta = choice.delta.unwrap_or_default();
                    if let Some(content) = delta.content
                        && !content.is_empty()
                    {
                        if first_chunk_time.get().is_none() {
                            first_chunk_time.set(Some(start_time.elapsed()));
                        }
                        accumulated.push_str(&content);
                        chunk_count += 1;
                        on_event(IterEvent::DraftToken {
                            text: accumulated.clone(),
                        });

                        // Phase 2 (live preview): write the in-flight HTML to
                        // disk whenever the accumulated text has crossed a
                        // renderable threshold AND ≥150ms has passed since the
                        // last partial write. The Swift sidecar's FSEvents
                        // watcher (Phase 3) repaints the preview within ~10ms
                        // of each write, so the user sees the page assemble
                        // chunk-by-chunk while Mercury is still streaming —
                        // not after the full 2-5s response arrives.
                        let now = std::time::Instant::now();
                        if now.duration_since(last_partial_write) >= partial_write_min_gap
                            && (accumulated.contains("</head>") || accumulated.contains("</HEAD>"))
                            && let Some(html) = extract_partial_html_body(&accumulated)
                        {
                            on_partial_html(&html);
                            last_partial_write = now;
                        }
                    }
                }
            })?;
        let total_time = start_time.elapsed();
        let first_chunk_ms = first_chunk_time.get().map(|d| d.as_millis()).unwrap_or(0);
        eprintln!(
            "[eri.mercury] stream done: {} chunks, {} chars, finish_reason={}, ttfb={}ms, total={}ms",
            chunk_count,
            accumulated.len(),
            final_finish_reason,
            first_chunk_ms,
            total_time.as_millis()
        );

        // After the stream closes, try to extract a candidate patch from
        // the accumulated text once (separate from the streaming deltas so
        // we don't try to parse incomplete diffs).
        if !accumulated.is_empty()
            && !emitted_patch
            && let Some(patch) = extract_diff_patch(&accumulated, prompt_ctx, self.next_patch_id())
        {
            on_event(IterEvent::CandidatePatch { patch });
            emitted_patch = true;
        }

        if accumulated.trim().is_empty() && final_finish_reason == "length" {
            on_event(IterEvent::Error {
                message: format!(
                    "stream ended with no content (finish_reason=length). \
                     Increase MERCURY_MAX_TOKENS beyond {}.",
                    self.config.max_tokens
                ),
            });
            return Ok(());
        }

        on_event(IterEvent::Done);
        let _ = emitted_patch;
        Ok(())
    }
}

/// Parallel polish backend that drives the locally-installed `claude` CLI
/// (Claude Code) as a subprocess. Mercury streams the fast draft; Claude
/// runs in the background and produces a higher-quality version that
/// overwrites the build file ~5-15s later.
#[derive(Debug, Clone)]
pub struct ClaudeCliBackend {
    binary: PathBuf,
    extra_args: Vec<String>,
}

impl ClaudeCliBackend {
    /// Detect whether `claude` is available on PATH. Returns `None` if not,
    /// in which case the panel renders a "polish unavailable" status and
    /// Mercury alone keeps working.
    pub fn detect() -> Option<Self> {
        let _ = dotenvy::dotenv();
        let candidate = env::var("ERI_CLAUDE_BIN").unwrap_or_else(|_| "claude".to_string());
        if which_path(&candidate).is_some() {
            Some(Self {
                binary: PathBuf::from(candidate),
                extra_args: Vec::new(),
            })
        } else {
            None
        }
    }

    pub fn binary(&self) -> &Path {
        &self.binary
    }

    /// Ship-it: package every intent the user voiced plus the final Mercury
    /// HTML (minified to cut tokens) and hand the bundle to Claude. Returns
    /// the same diff-block stdout as `run_polish` so the existing extractor
    /// reuses cleanly.
    pub fn run_ship_it(
        &self,
        intents: &[String],
        final_html: &str,
        cancel: Arc<AtomicBool>,
    ) -> Result<String, InferenceError> {
        let prompt = build_ship_it_prompt(intents, final_html);
        self.run_with_prompt(&prompt, cancel)
    }

    /// Ship-it variant that lets the caller pass a known deploy URL. When
    /// `target_url` is `None`, behaviour is identical to [`Self::run_ship_it`]
    /// and the polish output carries the [`SHIP_IT_DEPLOY_URL_PLACEHOLDER`]
    /// sentinel for post-deploy rewrite.
    pub fn run_ship_it_with_target(
        &self,
        intents: &[String],
        final_html: &str,
        target_url: Option<&str>,
        cancel: Arc<AtomicBool>,
    ) -> Result<String, InferenceError> {
        let prompt = build_ship_it_prompt_with_target(intents, final_html, target_url);
        self.run_with_prompt(&prompt, cancel)
    }

    /// Run the SEO + accessibility audit polish. Triggered by the `SeoCheck`
    /// voice command. Distinct from `run_polish` (which rewrites for design)
    /// and `run_ship_it` (which assumes the user is finalizing): the audit
    /// keeps the existing layout and content, but enforces every rule in the
    /// SEO + a11y + production-cleanup checklists.
    pub fn run_seo_audit(
        &self,
        current_html: &str,
        target_url: Option<&str>,
        cancel: Arc<AtomicBool>,
    ) -> Result<String, InferenceError> {
        let prompt = build_seo_audit_prompt(current_html, target_url);
        self.run_with_prompt(&prompt, cancel)
    }

    /// Run `claude --print "<prompt>"` in a blocking subprocess. The caller
    /// should invoke this from `cx.background_spawn` so the foreground
    /// thread stays responsive. `cancel` is checked before launching; once
    /// the subprocess is alive, dropping it cancels via kill from outside.
    pub fn run_polish(
        &self,
        user_request: &str,
        current_html: &str,
        cancel: Arc<AtomicBool>,
    ) -> Result<String, InferenceError> {
        let prompt = build_polish_prompt(user_request, current_html);
        self.run_with_prompt(&prompt, cancel)
    }

    /// Run the "recording → Twitter thread" pass. Bundles the user's voice
    /// intents, the optional deploy URL, and the on-disk recording path into
    /// a single prompt, then shells out to Claude. Returns raw stdout — the
    /// caller is expected to feed it through [`crate::social::parse_social_thread`]
    /// to extract the structured [`crate::social::SocialThread`].
    pub fn run_social_thread(
        &self,
        project_name: &str,
        intents: &[String],
        deployed_url: Option<&str>,
        recording_path: Option<&Path>,
        iteration_count: u64,
        cancel: Arc<AtomicBool>,
    ) -> Result<String, InferenceError> {
        let prompt = social::build_social_thread_prompt(
            project_name,
            intents,
            deployed_url,
            recording_path,
            iteration_count,
        );
        self.run_with_prompt(&prompt, cancel)
    }

    /// Run the background bug-finder pass. Bundles the current `index.html`
    /// into the audit prompt built by [`crate::bug_finder::build_bug_finder_prompt`],
    /// shells out to Claude Code CLI, and returns the parsed [`Bug`] list.
    /// Mirrors `run_polish` for cancellation + subprocess lifetime. Returns
    /// an empty list when the audit found nothing actionable; falls back to
    /// a single `Severity::Medium` bug when Claude's output isn't valid JSON
    /// rather than failing the whole call (the panel still surfaces the raw
    /// message so the user has something to act on).
    pub fn run_bug_finder(
        &self,
        html: &str,
        cancel: Arc<AtomicBool>,
    ) -> Result<Vec<bug_finder::Bug>, InferenceError> {
        let prompt = bug_finder::build_bug_finder_prompt(html);
        let stdout = self.run_with_prompt(&prompt, cancel)?;
        Ok(bug_finder::parse_bug_finder_response(&stdout))
    }

    /// Run an integration scaffolding prompt (Auth0 / Clerk / Supabase / Neon
    /// / Stripe). Shape is identical to `run_polish`: shell out to
    /// `claude --print "<prompt>"`, block until exit, return stdout. The
    /// prompt is expected to be built by one of the `build_*_setup_prompt`
    /// functions in [`crate::integrations`], which embed the guard rails that
    /// keep Claude from rewriting unrelated files.
    pub fn run_integration(
        &self,
        prompt: &str,
        cancel: Arc<AtomicBool>,
    ) -> Result<String, InferenceError> {
        self.run_with_prompt(prompt, cancel)
    }

    /// Run the "AI-generated commit message / PR description" pass. Identical
    /// transport shape to [`Self::run_polish`]: shell out to
    /// `claude --print "<prompt>"`, block until exit, return raw stdout. The
    /// prompt is built by one of [`crate::pr::build_commit_message_prompt`] or
    /// [`crate::pr::build_pr_description_prompt`]; the caller is responsible
    /// for parsing the response (e.g. via [`crate::pr::parse_pr_response`] for
    /// the PR-description case).
    pub fn run_pr_generator(
        &self,
        prompt: &str,
        cancel: Arc<AtomicBool>,
    ) -> Result<String, InferenceError> {
        self.run_with_prompt(prompt, cancel)
    }

    /// Run a Cursor-style code-assist prompt (write tests, explain, refactor,
    /// document). Same shape as `run_polish`: spawn `claude --print
    /// "<prompt>"`, block until exit, return raw stdout. The caller is
    /// expected to build the prompt with one of the `build_*` functions in
    /// [`crate::code_assist`] and to strip the fenced code block (or pipe the
    /// plain prose through TTS for the explainer case).
    ///
    /// Not wired through `AgentBackend` on purpose — Goose isn't a great fit
    /// for terse one-shot code prompts and routing every code-assist through
    /// Claude keeps the panel logic simple.
    pub fn run_code_assist(
        &self,
        prompt: &str,
        cancel: Arc<AtomicBool>,
    ) -> Result<String, InferenceError> {
        self.run_with_prompt(prompt, cancel)
    }

    fn run_with_prompt(
        &self,
        prompt: &str,
        cancel: Arc<AtomicBool>,
    ) -> Result<String, InferenceError> {
        if cancel.load(Ordering::Relaxed) {
            return Err(InferenceError::Transport("polish cancelled".into()));
        }
        let mut cmd = std::process::Command::new(&self.binary);
        cmd.arg("--print").arg(prompt);
        for arg in &self.extra_args {
            cmd.arg(arg);
        }
        cmd.stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        eprintln!(
            "[eri.claude] spawning polish: {} args + prompt of {} chars",
            self.extra_args.len(),
            prompt.len()
        );
        let mut child = cmd
            .spawn()
            .map_err(|err| InferenceError::Transport(format!("spawn claude failed: {err}")))?;
        // Poll for completion so we can cancel by killing the process.
        loop {
            if cancel.load(Ordering::Relaxed) {
                let _ = child.kill();
                let _ = child.wait();
                return Err(InferenceError::Transport("polish cancelled".into()));
            }
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) => std::thread::sleep(std::time::Duration::from_millis(120)),
                Err(err) => {
                    return Err(InferenceError::Transport(format!(
                        "claude wait failed: {err}"
                    )));
                }
            }
        }
        let output = child
            .wait_with_output()
            .map_err(|err| InferenceError::Transport(format!("claude output: {err}")))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(InferenceError::Transport(format!(
                "claude exited with {}: {stderr}",
                output.status
            )));
        }
        let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
        eprintln!(
            "[eri.claude] polish done: exit={} stdout={} chars stderr={} chars",
            output.status,
            stdout.len(),
            output.stderr.len()
        );
        Ok(stdout)
    }
}

/// Check whether the `vercel` CLI is installed on the user's PATH (honors the
/// `ERI_VERCEL_BIN` override). Returns the resolved binary path so callers can
/// invoke it directly without re-resolving. Returns `None` when unavailable;
/// callers should surface a status message instead of failing the ship-it.
pub fn vercel_cli_available() -> Option<PathBuf> {
    let _ = dotenvy::dotenv();
    let candidate = env::var("ERI_VERCEL_BIN").unwrap_or_else(|_| "vercel".to_string());
    which_path(&candidate)
}

/// Is one-click Vercel deploy enabled? Defaults to ON; set
/// `ERI_VERCEL_DEPLOY=0` (or `false`, `off`, `no`) to skip deploy after
/// polish. Users without the Vercel CLI should set this off to silence the
/// "vercel not found" status entirely.
pub fn vercel_deploy_enabled() -> bool {
    let _ = dotenvy::dotenv();
    match env::var("ERI_VERCEL_DEPLOY") {
        Ok(value) => {
            let v = value.trim().to_ascii_lowercase();
            !matches!(v.as_str(), "0" | "false" | "off" | "no")
        }
        Err(_) => true,
    }
}

/// Shell out to `vercel --prod --yes --no-clipboard` inside `build_dir`,
/// capture stdout, and extract the deployed `https://*.vercel.app` URL.
///
/// Synchronous: callers must invoke from a background task so the foreground
/// UI thread stays responsive. Errors are returned via `InferenceError` so
/// they bubble up to the panel status.
pub fn deploy_to_vercel(build_dir: &Path) -> Result<String, InferenceError> {
    let binary = vercel_cli_available().ok_or_else(|| {
        InferenceError::Transport("vercel CLI not found on PATH — install: npm i -g vercel".into())
    })?;
    if !build_dir.is_dir() {
        return Err(InferenceError::Transport(format!(
            "vercel deploy: build dir does not exist: {}",
            build_dir.display()
        )));
    }
    eprintln!(
        "[eri.vercel] deploying {} via {}",
        build_dir.display(),
        binary.display()
    );
    let output = std::process::Command::new(&binary)
        .arg("--prod")
        .arg("--yes")
        .arg("--no-clipboard")
        .current_dir(build_dir)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .map_err(|err| InferenceError::Transport(format!("spawn vercel failed: {err}")))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !output.status.success() {
        return Err(InferenceError::Transport(format!(
            "vercel exited with {}: {}",
            output.status,
            stderr.trim()
        )));
    }
    // Vercel prints the deployed URL on stdout; some versions also echo it to
    // stderr ("Production: https://..."). Check stdout first, then stderr.
    let url = extract_vercel_url(&stdout)
        .or_else(|| extract_vercel_url(&stderr))
        .ok_or_else(|| {
            InferenceError::Transport(format!(
                "vercel succeeded but no *.vercel.app URL found in output:\nstdout: {}\nstderr: {}",
                stdout.trim(),
                stderr.trim()
            ))
        })?;
    eprintln!("[eri.vercel] deployed: {url}");
    Ok(url)
}

/// Pull the first `https://<host>.vercel.app[/path]` URL out of vercel CLI
/// output. Stops at whitespace or common terminator chars so trailing punctuation
/// from log lines doesn't pollute the URL.
pub fn extract_vercel_url(text: &str) -> Option<String> {
    let needle = "https://";
    let mut search_from = 0usize;
    while let Some(rel) = text[search_from..].find(needle) {
        let start = search_from + rel;
        let tail = &text[start..];
        let end = tail
            .find(|c: char| c.is_whitespace() || matches!(c, '"' | '\'' | '<' | '>' | '`' | ')'))
            .unwrap_or(tail.len());
        let mut candidate = &tail[..end];
        // Trim trailing punctuation that commonly hugs URLs in logs.
        while let Some(last) = candidate.chars().last() {
            if matches!(last, '.' | ',' | ';' | ':' | '!' | '?') {
                candidate = &candidate[..candidate.len() - last.len_utf8()];
            } else {
                break;
            }
        }
        if candidate.contains(".vercel.app") {
            return Some(candidate.to_string());
        }
        search_from = start + needle.len();
    }
    None
}

fn build_polish_prompt(user_request: &str, current_html: &str) -> String {
    format!(
        "You are eri's polish pass for a single self-contained HTML build.\n\n\
         The user asked for: {user_request}\n\n\
         Mercury's first draft is below. Your job: produce a MORE BEAUTIFUL version that keeps the same functionality and structure but elevates the design — better typography, a coherent custom palette, refined spacing and motion, real Unsplash photo IDs (https://images.unsplash.com/photo-<id>?auto=format&fit=crop&w=...&q=80), and tasteful micro-interactions. Output ONLY a single ```diff block creating exactly b/index.html with --- /dev/null and the COMPLETE updated file. No prose before or after.\n\n\
         === current draft ===\n{current_html}\n=== end draft ===\n"
    )
}

/// Placeholder embedded by ship-it polish in canonical / og:url / twitter:url
/// fields when no deploy URL is known at prompt time. After `deploy_to_vercel`
/// returns the live URL, the build dir's `index.html` is rewritten via
/// [`replace_deploy_url_placeholder`] so the deployed page advertises the
/// correct URL on first request. Using a sentinel avoids a two-pass Claude
/// call (which would double the polish cost and latency).
pub const SHIP_IT_DEPLOY_URL_PLACEHOLDER: &str = "{{DEPLOY_URL}}";

/// SEO checklist injected into the ship-it prompt. These rules are
/// deterministic — Mercury sometimes emits og: tags but inconsistently, and
/// ship-it is the user's "I'm done, make it production-ready" moment, so we
/// hard-require the full meta package every time. The 155-char cap on meta
/// description matches Google's SERP truncation; longer descriptions get
/// silently clipped which hurts CTR.
pub const SHIP_IT_SEO_RULES: &str = "\
SEO REQUIREMENTS (all mandatory):\n\
- <html lang=\"en\"> (or correct language) on the root element.\n\
- <title> populated with the product/page name (≤60 chars).\n\
- <meta name=\"description\" content=\"…\"> describing the page in ≤155 chars.\n\
- <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">.\n\
- Open Graph: og:title, og:description, og:type=\"website\", og:image (use a real Unsplash photo URL), og:url.\n\
- Twitter card: twitter:card=\"summary_large_image\", twitter:title, twitter:description, twitter:image.\n\
- <link rel=\"canonical\" href=\"…\"> matching og:url.\n\
- <link rel=\"icon\" …> — use a data: URI SVG favicon if no asset is available.\n\
- Inline HTML comment near </head>: <!-- sitemap.xml: list /; robots.txt: User-agent: *\\nAllow: / -->\n\
  (Single-page builds do not host these files, but the comment documents the intent for crawlers and reviewers.)\n";

/// Accessibility checklist injected into the ship-it prompt. Every rule maps
/// to a Lighthouse a11y check that frequently fails on AI-generated UI: icon
/// buttons with no label, decorative <img> without alt, form inputs floating
/// without an associated <label>, and heading hierarchy that jumps levels
/// (h1 → h3) because the model picked sizes for visual rhythm rather than
/// semantics.
pub const SHIP_IT_A11Y_RULES: &str = "\
ACCESSIBILITY REQUIREMENTS (all mandatory):\n\
- Every <img> has an alt attribute (alt=\"\" only when purely decorative).\n\
- Every <button>, <a>, and interactive role has either visible text or an aria-label.\n\
- Every <input>, <select>, <textarea> has an associated <label> (for/id pair) or aria-label.\n\
- Heading hierarchy is monotonic: exactly one <h1>; no skipping levels (no h1 → h3).\n\
- Visible :focus styles on all interactive elements (do NOT use `outline: none` without a replacement).\n\
- Color contrast ≥ 4.5:1 for body text, ≥ 3:1 for large text and UI components.\n\
- Form errors and status messages use aria-live=\"polite\" or role=\"alert\" where appropriate.\n";

/// Production cleanup rules. Mercury's drafts often carry exploratory
/// scaffolding (`console.log`, `// TODO`, `// FIXME`, `debugger`) that's fine
/// during iteration but should never reach the shipped build.
pub const SHIP_IT_PRODUCTION_RULES: &str = "\
PRODUCTION CLEANUP (all mandatory):\n\
- Remove every console.log, console.debug, console.warn, and `debugger;` statement.\n\
- Remove every `// TODO`, `// FIXME`, `// XXX`, `/* TODO */` and similar dev marker comments.\n\
- Remove commented-out dead code blocks.\n\
- If a CSS framework is referenced (e.g. Tailwind via CDN), prefer Tailwind utility classes for any new styles over hand-written CSS.\n\
- The deployed page must target Lighthouse ≥90 on Performance, Accessibility, Best Practices, and SEO. If you spot issues that would tank a category, fix them before emitting the diff.\n";

/// Design hints applied during ship-it. These bias the polish toward a
/// recognisable modern aesthetic (shadcn buttons, modern display type, tasteful
/// motion) so the deployed page feels like a designed product, not an AI
/// draft. Kept separate from the SEO/a11y/cleanup rules so design intent and
/// correctness intent can be tuned independently.
pub const SHIP_IT_DESIGN_HINTS: &str = "\
DESIGN HINTS:\n\
- Use shadcn-style buttons: rounded-md, subtle border or shadow, ring on :focus-visible, smooth hover transitions.\n\
- Modern typographic scale — prefer Fraunces or Space Grotesk for display headings (load via Google Fonts unless offline is required).\n\
- Subtle motion via Tailwind transition utilities (transition-colors, duration-200, ease-out). Avoid heavy keyframe animations.\n\
- Real product photography from Unsplash: https://images.unsplash.com/photo-<id>?auto=format&fit=crop&w=1200&q=80 — pick photo IDs that actually exist.\n\
- Generous whitespace, restrained palette (2-3 colors + neutrals), and consistent spacing on a 4px/8px grid.\n";

/// Build the ship-it prompt: package the full session intent (every prompt the
/// user committed) plus the FINAL Mercury draft, compressed via `minify_html`
/// to keep the token footprint low. Claude sees the trajectory of intents,
/// not the noisy intermediate diffs, then produces the final shipping HTML.
///
/// Convenience wrapper around [`build_ship_it_prompt_with_target`] for callers
/// that do not yet know the deploy URL.
pub fn build_ship_it_prompt(intents: &[String], final_html: &str) -> String {
    build_ship_it_prompt_with_target(intents, final_html, None)
}

/// Build the ship-it prompt with an optional deploy target URL.
///
/// When `target_url` is `Some`, the prompt instructs Claude to use that URL
/// directly in canonical / og:url / twitter:url meta tags. When `None`,
/// Claude is told to emit the literal sentinel [`SHIP_IT_DEPLOY_URL_PLACEHOLDER`]
/// in those slots; the eri_ui ship-it pipeline runs
/// [`replace_deploy_url_placeholder`] on the on-disk `index.html` after Vercel
/// returns the real URL. This single-pass approach keeps the Claude cost flat
/// while still producing canonical-correct HTML at deploy time.
pub fn build_ship_it_prompt_with_target(
    intents: &[String],
    final_html: &str,
    target_url: Option<&str>,
) -> String {
    let mut bullet_block = String::new();
    for (i, intent) in intents.iter().enumerate() {
        let trimmed = intent.trim();
        if trimmed.is_empty() {
            continue;
        }
        bullet_block.push_str(&format!("{}. {}\n", i + 1, trimmed));
    }
    let compressed = minify_html(final_html);
    let url_instruction = match target_url {
        Some(url) => format!(
            "DEPLOY URL: this page will be served from {url}. Use that exact URL for <link rel=\"canonical\">, og:url, and twitter:url.\n"
        ),
        None => format!(
            "DEPLOY URL UNKNOWN: emit the literal sentinel {placeholder} as the href/content of <link rel=\"canonical\">, og:url, and twitter:url. eri will rewrite the sentinel to the real Vercel URL after deploy.\n",
            placeholder = SHIP_IT_DEPLOY_URL_PLACEHOLDER,
        ),
    };
    format!(
        "You are eri's SHIP-IT pass. The user has been iterating with Mercury (a fast diffusion code model) and now wants to ship the final production-ready version.\n\n\
         Their iteration intents, in order:\n{bullet_block}\n\
         The final Mercury draft (compressed: whitespace + comments stripped) is below. Your job: produce the FINAL SHIPPING version of this single self-contained HTML page. Treat the intents above as the user's accumulated requirements — every one should be reflected in the final output.\n\n\
         {url_instruction}\n\
         {seo}\n\
         {a11y}\n\
         {production}\n\
         {design}\n\
         Output ONLY a single ```diff block creating exactly b/index.html with --- /dev/null and the COMPLETE updated file. No prose before or after.\n\n\
         === final draft (compressed) ===\n{compressed}\n=== end draft ===\n",
        seo = SHIP_IT_SEO_RULES,
        a11y = SHIP_IT_A11Y_RULES,
        production = SHIP_IT_PRODUCTION_RULES,
        design = SHIP_IT_DESIGN_HINTS,
    )
}

/// Build the SEO + accessibility audit prompt. Used by the `SeoCheck` voice
/// command — Claude re-reads the current HTML and emits a diff that fixes ONLY
/// SEO / a11y / production-cleanup issues, leaving content and layout intact.
/// Distinct from ship-it because it does not re-design the page; it audits
/// the page already in front of the user.
pub fn build_seo_audit_prompt(current_html: &str, target_url: Option<&str>) -> String {
    let compressed = minify_html(current_html);
    let url_instruction = match target_url {
        Some(url) => format!(
            "DEPLOY URL: {url}. Use it for <link rel=\"canonical\">, og:url, and twitter:url.\n"
        ),
        None => format!(
            "If canonical / og:url / twitter:url tags need to be added or fixed and no deploy URL is known, emit the sentinel {placeholder} which eri will rewrite at deploy time.\n",
            placeholder = SHIP_IT_DEPLOY_URL_PLACEHOLDER,
        ),
    };
    format!(
        "You are eri's SEO + accessibility audit pass. The user already shipped or polished this HTML and wants a focused audit. DO NOT redesign the page; ONLY fix correctness issues from the checklists below.\n\n\
         {url_instruction}\n\
         {seo}\n\
         {a11y}\n\
         {production}\n\
         Output ONLY a single ```diff block creating exactly b/index.html with --- /dev/null and the COMPLETE updated file. No prose before or after.\n\n\
         === current page (compressed) ===\n{compressed}\n=== end page ===\n",
        seo = SHIP_IT_SEO_RULES,
        a11y = SHIP_IT_A11Y_RULES,
        production = SHIP_IT_PRODUCTION_RULES,
    )
}

/// Rewrite every occurrence of [`SHIP_IT_DEPLOY_URL_PLACEHOLDER`] in `html`
/// with the live deploy URL. Returns the rewritten string and the number of
/// replacements made; zero replacements is not an error (the polish output may
/// already have known the URL, or the placeholder may have been stripped by a
/// subsequent edit).
pub fn replace_deploy_url_placeholder(html: &str, deploy_url: &str) -> (String, usize) {
    let count = html.matches(SHIP_IT_DEPLOY_URL_PLACEHOLDER).count();
    let replaced = html.replace(SHIP_IT_DEPLOY_URL_PLACEHOLDER, deploy_url);
    (replaced, count)
}

/// Minify HTML to cut the token footprint we send to Claude.
/// Steps:
/// 1. Strip HTML comments `<!-- ... -->` (but keep IE conditionals — uncommon
///    in eri builds, but cheap to preserve).
/// 2. Collapse runs of whitespace (spaces, tabs, newlines) into a single space
///    OUTSIDE of `<script>`, `<style>`, `<pre>`, `<textarea>` blocks where
///    whitespace is semantic.
/// 3. Trim leading/trailing whitespace around tags (`> <` → `><`).
///
/// This is a conservative minifier — it won't break visible whitespace
/// inside text nodes that need it, but it'll shave 30-50% off typical Tailwind
/// HTML where indentation dominates byte count.
pub fn minify_html(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0;
    let mut last_was_space = false;
    while i < bytes.len() {
        // HTML comment
        if i + 4 <= bytes.len() && &bytes[i..i + 4] == b"<!--" {
            if let Some(end) = find_subsequence(&bytes[i..], b"-->") {
                i += end + 3;
                continue;
            } else {
                break;
            }
        }
        // Verbatim blocks: pass through unchanged (whitespace is meaningful).
        for tag in &["<script", "<style", "<pre", "<textarea"] {
            let tlen = tag.len();
            if i + tlen <= bytes.len() && bytes[i..i + tlen].eq_ignore_ascii_case(tag.as_bytes()) {
                // Find matching close tag.
                let close = match *tag {
                    "<script" => "</script>",
                    "<style" => "</style>",
                    "<pre" => "</pre>",
                    "<textarea" => "</textarea>",
                    _ => unreachable!(),
                };
                if let Some(end_offset) = find_subsequence_ci(&bytes[i..], close.as_bytes()) {
                    let end = i + end_offset + close.len();
                    out.push_str(&input[i..end]);
                    i = end;
                    last_was_space = false;
                    continue;
                }
            }
        }
        let c = bytes[i] as char;
        if c.is_whitespace() {
            if !last_was_space {
                out.push(' ');
                last_was_space = true;
            }
            i += 1;
            continue;
        }
        // Strip the space we just appended if the next char is `<` (collapse `> <` → `><`).
        if c == '<' && last_was_space {
            // Look back; if we just appended a space, pop it.
            if out.ends_with(' ') {
                out.pop();
            }
        }
        out.push(c);
        last_was_space = false;
        i += 1;
    }
    out
}

fn find_subsequence(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

fn find_subsequence_ci(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|w| w.eq_ignore_ascii_case(needle))
}

fn which_path(bin: &str) -> Option<PathBuf> {
    if bin.contains('/') {
        let p = PathBuf::from(bin);
        return p.is_file().then_some(p);
    }
    let path_var = env::var_os("PATH")?;
    for entry in env::split_paths(&path_var) {
        let candidate = entry.join(bin);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// One SSE chunk shape from Mercury's `/v1/chat/completions?stream=true`.
/// When `stream_options.include_usage: true`, the FINAL chunk has an empty
/// `choices` array but populates `usage`.
#[derive(Deserialize)]
struct ChatCompletionChunk {
    #[serde(default)]
    choices: Vec<ChunkChoice>,
    #[serde(default)]
    usage: Option<ChatUsage>,
}

#[derive(Deserialize)]
struct ChunkChoice {
    #[serde(default)]
    delta: Option<ChunkDelta>,
    #[serde(default)]
    finish_reason: Option<String>,
}

#[derive(Default, Deserialize)]
struct ChunkDelta {
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    tool_calls: Option<Vec<ChunkToolCall>>,
}

#[derive(Deserialize)]
struct ChunkToolCall {
    /// OpenAI's tool-call delta protocol includes `index` and `id` to support
    /// parallel tool calls. Deserialized for protocol compliance even though
    /// the streaming surgical path concatenates `function.arguments` across
    /// chunks regardless of index — the MCP multi-turn loop uses the
    /// non-streaming `McpToolCall` shape below for tool dispatch.
    #[serde(default)]
    #[allow(dead_code)]
    index: Option<u32>,
    #[serde(default)]
    #[allow(dead_code)]
    id: Option<String>,
    #[serde(default)]
    function: Option<ChunkToolCallFunction>,
}

#[derive(Deserialize)]
struct ChunkToolCallFunction {
    #[serde(default)]
    #[allow(dead_code)]
    name: Option<String>,
    #[serde(default)]
    arguments: Option<String>,
}

/// Payload for Mercury Edit 2's `/v1/apply/completions` endpoint. Per the
/// Inception Labs docs, the apply endpoint expects the full current file
/// (`original_code`) plus an `update_snippet` containing only the changed
/// regions surrounded by `// ... existing code ...` markers. Mercury Edit 2
/// returns the merged file (streaming when `stream: true`).
#[derive(Serialize)]
struct ApplyCompletionPayload<'a> {
    model: &'a str,
    original_code: &'a str,
    update_snippet: &'a str,
    stream: bool,
}

#[derive(Serialize)]
struct ChatCompletionPayload<'a> {
    model: &'a str,
    messages: &'a [ChatMessage],
    max_tokens: u32,
    temperature: f32,
    stream: bool,
    reasoning_effort: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    stream_options: Option<StreamOptions>,
    /// Mercury 2's native iterative-denoising visualization. When `true` (and
    /// `stream: true`), the SSE stream interleaves intermediate denoising
    /// states so the UI can show text emerging from noise. Only meaningful on
    /// new-build calls where the user is watching the build assemble.
    #[serde(skip_serializing_if = "Option::is_none")]
    diffusing: Option<bool>,
    /// OpenAI-compatible function calling. Mercury 2 supports this on
    /// `/v1/chat/completions`. We use it for iteration to force a structured
    /// `edit_html` response instead of free-form text.
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<&'a [ToolSpec<'a>]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_choice: Option<ToolChoice<'a>>,
}

#[derive(Serialize)]
struct StreamOptions {
    include_usage: bool,
}

#[derive(Serialize)]
struct ToolSpec<'a> {
    #[serde(rename = "type")]
    kind: &'a str,
    function: ToolFunctionSpec<'a>,
}

#[derive(Serialize)]
struct ToolFunctionSpec<'a> {
    name: &'a str,
    description: &'a str,
    parameters: serde_json::Value,
}

#[derive(Serialize)]
#[serde(untagged)]
enum ToolChoice<'a> {
    Named {
        #[serde(rename = "type")]
        kind: &'a str,
        function: NamedFunction<'a>,
    },
    /// String form — typically `"auto"` (Mercury picks whether to call a
    /// tool) or `"none"` (no tool calls). Used by the MCP multi-turn loop so
    /// Mercury can decide whether to call an MCP tool or emit content.
    Auto(&'a str),
}

#[derive(Serialize)]
struct NamedFunction<'a> {
    name: &'a str,
}

#[derive(Clone, Debug, Serialize)]
pub struct ChatMessage {
    role: String,
    content: String,
    /// OpenAI-compatible tool-call response identifier. Populated on
    /// `role: "tool"` messages so Mercury can correlate the response with
    /// the `tool_calls[].id` it emitted on the previous turn. Skipped when
    /// `None` to keep payloads identical for non-tool messages.
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_call_id: Option<String>,
    /// Tool name carried on `role: "tool"` messages. Optional in the OpenAI
    /// spec but accepted for clarity.
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
}

impl ChatMessage {
    pub fn system(content: impl Into<String>) -> Self {
        Self {
            role: "system".to_string(),
            content: content.into(),
            tool_call_id: None,
            name: None,
        }
    }

    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: "user".to_string(),
            content: content.into(),
            tool_call_id: None,
            name: None,
        }
    }

    pub fn assistant(content: impl Into<String>) -> Self {
        Self {
            role: "assistant".to_string(),
            content: content.into(),
            tool_call_id: None,
            name: None,
        }
    }

    /// Build a `role: "tool"` follow-up message that carries a tool's JSON
    /// result back to Mercury so it can continue the conversation with the
    /// result in context.
    pub fn tool_result(
        tool_call_id: impl Into<String>,
        name: impl Into<String>,
        content: impl Into<String>,
    ) -> Self {
        Self {
            role: "tool".to_string(),
            content: content.into(),
            tool_call_id: Some(tool_call_id.into()),
            name: Some(name.into()),
        }
    }
}

#[derive(Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<ChatChoice>,
    #[serde(default)]
    usage: Option<ChatUsage>,
}

#[derive(Deserialize)]
struct ChatChoice {
    message: ChatChoiceMessage,
    #[serde(default)]
    finish_reason: Option<String>,
}

#[derive(Deserialize)]
struct ChatChoiceMessage {
    #[serde(default, deserialize_with = "deserialize_nullable_string")]
    content: String,
}

/// Non-streaming chat response shape used by [`MercuryBackend::run_mcp_tool_loop`].
/// Includes `tool_calls` so we can inspect Mercury's tool-call requests
/// without streaming machinery — the loop is multi-turn but each turn is
/// small enough that buffering the whole response is cheaper than wiring
/// SSE through the tool-dispatch state machine.
#[derive(Deserialize)]
struct McpChatResponse {
    #[serde(default)]
    choices: Vec<McpChatChoice>,
}

#[derive(Deserialize)]
struct McpChatChoice {
    message: McpChatMessage,
}

#[derive(Deserialize, Default)]
struct McpChatMessage {
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    tool_calls: Option<Vec<McpToolCall>>,
}

#[derive(Deserialize)]
struct McpToolCall {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    function: McpToolCallFunction,
}

#[derive(Deserialize, Default)]
struct McpToolCallFunction {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    arguments: Option<String>,
}

#[derive(Clone, Deserialize)]
struct ChatUsage {
    #[serde(default)]
    prompt_tokens: u32,
    #[serde(default)]
    completion_tokens: u32,
    #[serde(default)]
    reasoning_tokens: Option<u32>,
    #[serde(default)]
    total_tokens: u32,
}

fn deserialize_nullable_string<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value: Option<String> = serde::Deserialize::deserialize(deserializer)?;
    Ok(value.unwrap_or_default())
}

#[derive(Deserialize)]
struct ChatErrorEnvelope {
    error: ChatErrorDetail,
}

#[derive(Deserialize)]
struct ChatErrorDetail {
    message: String,
}

/// Legacy shim — kept for any external callers that imported it directly.
/// New code should construct an [`IntentContext`] and call a classifier so
/// the topic-shift signal (current page lexicon) participates in the
/// decision. This shim mirrors the original phrase-list behavior and is
/// equivalent to `HeuristicClassifier` over a context with only the prompt.
#[allow(dead_code)]
fn looks_like_new_build_prompt(lower: &str) -> bool {
    intent::NEW_BUILD_MARKERS.iter().any(|m| lower.contains(m))
}

fn format_gaze_target(target: &GazeTarget) -> String {
    match target {
        GazeTarget::Preview {
            element_label,
            confidence,
            source_hint,
            ..
        } => {
            let element = element_label.as_deref().unwrap_or("unknown element");
            if let Some(hint) = source_hint {
                format!(
                    "Preview · {} ({}:{}-{}) conf={:.0}%",
                    element,
                    hint.path.display(),
                    hint.line_range.start,
                    hint.line_range.end,
                    confidence * 100.0
                )
            } else {
                format!("Preview · {element} conf={:.0}%", confidence * 100.0)
            }
        }
        GazeTarget::Editor {
            path,
            line_range,
            confidence,
        } => format!(
            "Editor · {}:{}-{} conf={:.0}%",
            path.display(),
            line_range.start,
            line_range.end,
            confidence * 100.0
        ),
        GazeTarget::Panel {
            panel_id,
            confidence,
        } => format!("Panel · {panel_id} conf={:.0}%", confidence * 100.0),
        GazeTarget::Unknown { confidence } => {
            format!("Unknown · conf={:.0}%", confidence * 100.0)
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParsedFile {
    pub path: PathBuf,
    pub content: String,
    pub is_new: bool,
}

/// Extract every file the model wants to create or rewrite from the unified
/// diff inside an LLM response. All diff blocks are treated as full-file
/// rewrites (eri's contract with Mercury is "always emit /dev/null"); for
/// safety we also accept `--- a/<path>` as an iteration on an existing file
/// and treat the `+` lines as the new full content.
pub fn extract_files_from_response(response: &str) -> Vec<ParsedFile> {
    let mut files = Vec::new();
    for block in find_diff_blocks(response) {
        files.extend(parse_unified_diff_files(&block));
    }
    // Fallback: if Mercury skipped the ```diff fence and just emitted
    // ```html / ```javascript / ```python blocks, extract those as new files.
    if files.is_empty() {
        files.extend(extract_fenced_code_files(response));
    }
    files
}

fn extract_fenced_code_files(response: &str) -> Vec<ParsedFile> {
    let mut files = Vec::new();
    let lines: Vec<&str> = response.lines().collect();
    let mut i = 0;
    while i < lines.len() {
        let trimmed = lines[i].trim();
        if let Some(rest) = trimmed.strip_prefix("```") {
            let lang = rest
                .split_whitespace()
                .next()
                .unwrap_or("")
                .to_ascii_lowercase();
            let (default_path, accept) = match lang.as_str() {
                "html" => ("index.html", true),
                "javascript" | "js" => ("script.js", true),
                "css" => ("style.css", true),
                "python" | "py" => ("server.py", true),
                "json" => ("data.json", true),
                _ => ("", false),
            };
            if accept {
                // Look back up to 3 lines for a filename hint like `**index.html**`,
                // `## index.html`, or `### style.css`.
                let mut path = default_path.to_string();
                for back in 1..=3 {
                    if i < back {
                        break;
                    }
                    let prev = lines[i - back].trim();
                    if let Some(name) = extract_path_hint(prev) {
                        path = name;
                        break;
                    }
                }
                let mut content = String::new();
                i += 1;
                while i < lines.len() && lines[i].trim() != "```" {
                    content.push_str(lines[i]);
                    content.push('\n');
                    i += 1;
                }
                if !content.trim().is_empty() {
                    files.push(ParsedFile {
                        path: PathBuf::from(path),
                        content,
                        is_new: true,
                    });
                }
            }
        }
        i += 1;
    }
    files
}

fn extract_path_hint(line: &str) -> Option<String> {
    let candidate = line
        .trim()
        .trim_matches('*')
        .trim_start_matches('#')
        .trim_start_matches("File:")
        .trim_start_matches("file:")
        .trim()
        .trim_matches('`')
        .trim()
        .to_string();
    if candidate.is_empty() {
        return None;
    }
    if candidate.contains('.') && !candidate.contains(' ') && candidate.len() <= 100 {
        Some(candidate)
    } else {
        None
    }
}

fn parse_unified_diff_files(diff: &str) -> Vec<ParsedFile> {
    let mut files: Vec<ParsedFile> = Vec::new();
    let mut current_path: Option<String> = None;
    let mut current_lines: Vec<String> = Vec::new();
    let mut is_new = false;
    let mut in_hunk = false;

    let flush = |files: &mut Vec<ParsedFile>,
                 path: &mut Option<String>,
                 lines: &mut Vec<String>,
                 is_new: &mut bool| {
        if let Some(p) = path.take()
            && !lines.is_empty()
        {
            let mut content = lines.join("\n");
            if !content.ends_with('\n') {
                content.push('\n');
            }
            files.push(ParsedFile {
                path: PathBuf::from(&p),
                content,
                is_new: *is_new,
            });
        }
        lines.clear();
    };

    for line in diff.lines() {
        if line.starts_with("--- ") {
            flush(
                &mut files,
                &mut current_path,
                &mut current_lines,
                &mut is_new,
            );
            // Treat ALL diff hunks as full-file rewrites for the build flow.
            // The system prompt instructs Mercury to always send /dev/null, and
            // even if it slips and sends `--- a/<path>`, we still write the
            // collected + lines as the new file content (overwrite).
            is_new = true;
            in_hunk = false;
        } else if let Some(rest) = line.strip_prefix("+++ ") {
            let cleaned = rest
                .trim()
                .trim_start_matches("b/")
                .trim_start_matches("a/");
            if cleaned != "/dev/null" {
                current_path = Some(cleaned.to_string());
            }
            // Mercury frequently omits the `@@` hunk header for new files
            // (since the entire file is additions). Treat the `+++ b/<path>`
            // line itself as the hunk start so subsequent `+` lines are
            // collected even without an explicit `@@`.
            in_hunk = true;
        } else if line.starts_with("@@") {
            in_hunk = true;
        } else if in_hunk {
            // Standard unified diff: + adds, - removes.
            if let Some(rest) = line.strip_prefix('+') {
                current_lines.push(rest.to_string());
            } else if line.starts_with('-') {
                // Removal line — ignore for new files; existing-file edits
                // are handled by extract_diff_patch's hunk applier elsewhere.
            } else if is_new {
                // Mercury frequently emits new-file diffs as
                //   @@
                //   <!DOCTYPE html>
                //   <html>
                //   ...
                // with NO `+` prefix because the entire file is additions.
                // For new files only, accept these raw lines as content.
                current_lines.push(line.to_string());
            }
        }
    }
    flush(
        &mut files,
        &mut current_path,
        &mut current_lines,
        &mut is_new,
    );
    files
}

fn extract_diff_patch(
    response: &str,
    prompt_ctx: &PromptCtx,
    patch_id: u64,
) -> Option<CandidatePatch> {
    let target = target_path(prompt_ctx)?;
    let original = prompt_ctx
        .open_files()
        .iter()
        .find(|file| file.path == target)?
        .text
        .clone();
    let diff = find_diff_block(response)?;
    let updated = apply_unified_diff(&original, &diff)?;
    if updated == original {
        return None;
    }
    Some(CandidatePatch::replace_text(
        patch_id, target, original, updated,
    ))
}

fn find_diff_block(response: &str) -> Option<String> {
    find_diff_blocks(response).into_iter().next()
}

fn find_diff_blocks(response: &str) -> Vec<String> {
    let mut blocks = Vec::new();
    let mut current = String::new();
    let mut inside = false;
    for line in response.lines() {
        if !inside {
            let trimmed = line.trim();
            if trimmed.starts_with("```diff") || trimmed == "```patch" {
                inside = true;
                current.clear();
                continue;
            }
        } else if line.trim_end() == "```" {
            inside = false;
            if !current.is_empty() {
                blocks.push(std::mem::take(&mut current));
            }
        } else {
            current.push_str(line);
            current.push('\n');
        }
    }
    if inside && !current.is_empty() {
        blocks.push(current);
    }
    blocks
}

fn apply_unified_diff(original: &str, diff: &str) -> Option<String> {
    let mut additions = Vec::new();
    let mut removals = Vec::new();
    for line in diff.lines() {
        if line.starts_with("+++") || line.starts_with("---") || line.starts_with("@@") {
            continue;
        }
        if let Some(rest) = line.strip_prefix('+') {
            additions.push(rest.to_string());
        } else if let Some(rest) = line.strip_prefix('-') {
            removals.push(rest.to_string());
        }
    }

    if removals.is_empty() && additions.is_empty() {
        return None;
    }

    let removed_chunk = removals.join("\n");
    let added_chunk = additions.join("\n");
    if !removed_chunk.is_empty() && original.contains(&removed_chunk) {
        return Some(original.replacen(&removed_chunk, &added_chunk, 1));
    }
    if removed_chunk.is_empty() && !added_chunk.is_empty() {
        let mut updated = original.to_string();
        if !updated.ends_with('\n') {
            updated.push('\n');
        }
        updated.push_str(&added_chunk);
        return Some(updated);
    }
    None
}

#[derive(Debug, Error)]
pub enum InferenceError {
    #[error("could not serialize or decode sidecar payload: {0}")]
    Json(#[from] serde_json::Error),
    #[error("sidecar transport failed: {0}")]
    Transport(String),
}

/// Default publish endpoint when `ERI_PUBLISH_URL` is unset. Points at the
/// local Next.js dev server so the publish flow works end-to-end on a laptop
/// without touching production. Production builds override via env.
pub const DEFAULT_PUBLISH_BASE_URL: &str = "http://localhost:3000";

/// One iteration row in the publish payload. Mirrors the shape `eri_git`
/// emits via `IterationExport` and the JSON shape the website's
/// `POST /api/publish` accepts.
#[derive(Debug, Clone, serde::Serialize)]
pub struct PublishIteration {
    pub n: u64,
    pub prompt: String,
    pub html: String,
    pub ts: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct PublishIntent {
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ts: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
struct PublishPayload<'a> {
    slug: &'a str,
    name: &'a str,
    intents: &'a [PublishIntent],
    iterations: &'a [PublishIteration],
}

#[derive(Debug, serde::Deserialize)]
struct PublishOk {
    url: String,
}

/// POST a project's iteration history to the eri.dev publish endpoint.
///
/// `slug` is the URL-safe project slug (matches the website's
/// `/p/<slug>` route). `name` is the human-readable project label.
/// `intents` is the list of natural-language prompts the user spoke for
/// this project (informational on the public page). `iterations` is the
/// full timeline — the website expects at least one row.
///
/// The base URL is taken from `ERI_PUBLISH_URL`; when unset it defaults to
/// `http://localhost:3000` so a developer running `pnpm dev` next to eri
/// gets a working publish flow without configuration. Returns the public
/// `eri.dev/p/<slug>` URL on success.
pub fn publish_project_to_website(
    slug: &str,
    name: &str,
    intents: &[PublishIntent],
    iterations: &[PublishIteration],
) -> Result<String, InferenceError> {
    if iterations.is_empty() {
        return Err(InferenceError::Transport(
            "no iterations to publish — fire at least one build first".to_string(),
        ));
    }
    let base = std::env::var("ERI_PUBLISH_URL")
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_PUBLISH_BASE_URL.to_string());
    let endpoint = format!("{base}/api/publish");

    let payload = PublishPayload {
        slug,
        name,
        intents,
        iterations,
    };
    let body = serde_json::to_string(&payload)?;

    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(5))
        .timeout(Duration::from_secs(30))
        .build();
    let response = match agent
        .post(&endpoint)
        .set("content-type", "application/json")
        .send_string(&body)
    {
        Ok(response) => response,
        Err(ureq::Error::Status(status, response)) => {
            let body = response.into_string().unwrap_or_default();
            return Err(InferenceError::Transport(format!(
                "{endpoint} returned {status}: {body}"
            )));
        }
        Err(other) => return Err(InferenceError::Transport(other.to_string())),
    };
    let response_body = response
        .into_string()
        .map_err(|error| InferenceError::Transport(error.to_string()))?;
    let parsed: PublishOk = serde_json::from_str(&response_body)?;
    Ok(parsed.url)
}

#[cfg(test)]
mod tool_call_tests {
    use super::*;

    #[test]
    fn parses_single_edit_tool_argument() {
        let args = r#"{"edits":[{"search":"<title>Old</title>","replace":"<title>New</title>"}]}"#;
        let blocks = parse_edit_html_tool_arguments(args).expect("parse");
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].search, "<title>Old</title>");
        assert_eq!(blocks[0].replace, "<title>New</title>");
    }

    #[test]
    fn parses_multiple_edits_preserving_order() {
        let args = r#"{"edits":[{"search":"a","replace":"A"},{"search":"b","replace":"B"}]}"#;
        let blocks = parse_edit_html_tool_arguments(args).expect("parse");
        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[0].search, "a");
        assert_eq!(blocks[1].search, "b");
    }

    #[test]
    fn drops_edits_with_empty_search() {
        let args = r#"{"edits":[{"search":"","replace":"x"},{"search":"y","replace":"Y"}]}"#;
        let blocks = parse_edit_html_tool_arguments(args).expect("parse");
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].search, "y");
    }

    #[test]
    fn rejects_malformed_arguments() {
        let result = parse_edit_html_tool_arguments("{not json");
        assert!(result.is_err());
    }

    #[test]
    fn tool_spec_advertises_edit_html_function() {
        let spec = edit_html_tool_spec();
        assert_eq!(spec.kind, "function");
        assert_eq!(spec.function.name, "edit_html");
        let params = spec.function.parameters;
        let required = params
            .get("required")
            .and_then(|v| v.as_array())
            .expect("required array");
        assert!(required.iter().any(|v| v.as_str() == Some("edits")));
    }

    #[test]
    fn apply_payload_has_expected_shape() {
        let payload = ApplyCompletionPayload {
            model: "mercury-edit-2",
            original_code: "<html><body>old</body></html>",
            update_snippet: "// ... existing code ...\n<body>new</body>\n// ... existing code ...",
            stream: true,
        };
        let serialized = serde_json::to_value(&payload).expect("serialize");
        assert_eq!(serialized["model"], "mercury-edit-2");
        assert_eq!(serialized["original_code"], "<html><body>old</body></html>");
        assert!(
            serialized["update_snippet"]
                .as_str()
                .expect("snippet string")
                .contains("// ... existing code ...")
        );
        assert_eq!(serialized["stream"], true);
        // The apply endpoint MUST NOT receive chat-only fields.
        assert!(serialized.get("messages").is_none());
        assert!(serialized.get("tools").is_none());
        assert!(serialized.get("max_tokens").is_none());
    }

    #[test]
    fn strip_code_fence_handles_plain_text() {
        assert_eq!(strip_code_fence("hello"), "hello");
        assert_eq!(strip_code_fence("  hello  "), "hello");
    }

    #[test]
    fn strip_code_fence_drops_html_fence() {
        let input = "```html\n<div>hi</div>\n```";
        assert_eq!(strip_code_fence(input).trim(), "<div>hi</div>");
    }

    #[test]
    fn strip_code_fence_drops_bare_fence() {
        let input = "```\n// ... existing code ...\n<p>hi</p>\n```";
        let stripped = strip_code_fence(input);
        assert!(stripped.contains("// ... existing code ..."));
        assert!(stripped.contains("<p>hi</p>"));
        assert!(!stripped.contains("```"));
    }

    #[test]
    fn extract_vercel_url_picks_up_production_url() {
        let stdout = "Vercel CLI 32.4.1\n\
             ? Set up and deploy \"~/project\"? yes\n\
             ? Which scope do you want to deploy to? khai\n\
             ? Link to existing project? no\n\
             ? What's your project's name? my-app\n\
             ? In which directory is your code located? ./\n\
             🔍  Inspect: https://vercel.com/khai/my-app/abc123 [2s]\n\
             ✅  Production: https://my-app-abc123.vercel.app [4s]\n";
        let url = extract_vercel_url(stdout).expect("url");
        assert_eq!(url, "https://my-app-abc123.vercel.app");
    }

    #[test]
    fn extract_vercel_url_returns_none_when_missing() {
        let stdout = "vercel: command produced no deploy URL\n";
        assert!(extract_vercel_url(stdout).is_none());
    }

    #[test]
    fn extract_vercel_url_strips_trailing_punctuation() {
        let stdout = "Deployed at https://demo-7q2.vercel.app, ready to share.";
        let url = extract_vercel_url(stdout).expect("url");
        assert_eq!(url, "https://demo-7q2.vercel.app");
    }

    #[test]
    fn extract_vercel_url_ignores_non_vercel_hosts() {
        let stdout = "checking https://vercel.com/khai before deploying...\n\
             Production: https://app-xyz.vercel.app";
        let url = extract_vercel_url(stdout).expect("url");
        assert_eq!(url, "https://app-xyz.vercel.app");
    }

    #[test]
    fn ship_it_prompt_includes_seo_checklist() {
        let prompt = build_ship_it_prompt(
            &["build me a landing page".to_string()],
            "<html><body>hi</body></html>",
        );
        // Spot-check that every SEO bullet that callers depend on is present.
        assert!(prompt.contains("SEO REQUIREMENTS"));
        assert!(prompt.contains("meta name=\"description\""));
        assert!(prompt.contains("og:title"));
        assert!(prompt.contains("og:description"));
        assert!(prompt.contains("og:image"));
        assert!(prompt.contains("og:url"));
        assert!(prompt.contains("twitter:card"));
        assert!(prompt.contains("rel=\"canonical\""));
        assert!(prompt.contains("rel=\"icon\""));
        assert!(prompt.contains("sitemap.xml"));
        assert!(prompt.contains("robots.txt"));
        assert!(prompt.contains("≤155"));
    }

    #[test]
    fn ship_it_prompt_includes_accessibility_rules() {
        let prompt = build_ship_it_prompt(
            &["make a contact form".to_string()],
            "<html><body><form></form></body></html>",
        );
        assert!(prompt.contains("ACCESSIBILITY REQUIREMENTS"));
        assert!(prompt.contains("alt attribute"));
        assert!(prompt.contains("aria-label"));
        assert!(prompt.contains("<label>"));
        assert!(prompt.contains("Heading hierarchy"));
        assert!(prompt.contains(":focus"));
        // Production cleanup
        assert!(prompt.contains("console.log"));
        assert!(prompt.contains("TODO"));
        assert!(prompt.contains("Lighthouse"));
        // Design hints
        assert!(prompt.contains("shadcn"));
        assert!(prompt.contains("Fraunces") || prompt.contains("Space Grotesk"));
        assert!(prompt.contains("Unsplash"));
    }

    #[test]
    fn ship_it_prompt_with_target_includes_canonical_url() {
        let url = "https://my-app-abc123.vercel.app";
        let prompt = build_ship_it_prompt_with_target(
            &["build a portfolio".to_string()],
            "<html><body>p</body></html>",
            Some(url),
        );
        assert!(prompt.contains(url));
        // canonical / og:url instructions should reference the URL.
        assert!(prompt.contains("rel=\"canonical\""));
        assert!(prompt.contains("og:url"));
        // No placeholder when target is provided.
        assert!(!prompt.contains(SHIP_IT_DEPLOY_URL_PLACEHOLDER));
    }

    #[test]
    fn ship_it_prompt_without_target_uses_placeholder() {
        let prompt = build_ship_it_prompt(&["a thing".to_string()], "<html></html>");
        assert!(prompt.contains(SHIP_IT_DEPLOY_URL_PLACEHOLDER));
    }

    #[test]
    fn seo_audit_prompt_includes_all_checklists() {
        let prompt = build_seo_audit_prompt("<html><body>x</body></html>", None);
        assert!(prompt.contains("SEO REQUIREMENTS"));
        assert!(prompt.contains("ACCESSIBILITY REQUIREMENTS"));
        assert!(prompt.contains("PRODUCTION CLEANUP"));
        // Audit pass must NOT redesign the page.
        assert!(prompt.contains("DO NOT redesign"));
    }

    #[test]
    fn replace_deploy_url_placeholder_swaps_every_match() {
        let html = "<link rel=\"canonical\" href=\"{{DEPLOY_URL}}\">\n\
                    <meta property=\"og:url\" content=\"{{DEPLOY_URL}}\">";
        let (out, count) = replace_deploy_url_placeholder(html, "https://demo.vercel.app");
        assert_eq!(count, 2);
        assert!(out.contains("https://demo.vercel.app"));
        assert!(!out.contains(SHIP_IT_DEPLOY_URL_PLACEHOLDER));
    }

    #[test]
    fn replace_deploy_url_placeholder_is_noop_when_absent() {
        let html = "<title>hi</title>";
        let (out, count) = replace_deploy_url_placeholder(html, "https://x.vercel.app");
        assert_eq!(count, 0);
        assert_eq!(out, html);
    }

    #[test]
    fn vercel_deploy_enabled_defaults_on() {
        // unset → enabled
        // SAFETY: tests in this crate are not parallelized across env vars used here;
        // worst case the test reads a value another test set, which still produces
        // a deterministic boolean we assert below.
        unsafe { std::env::remove_var("ERI_VERCEL_DEPLOY") };
        assert!(vercel_deploy_enabled());
        unsafe { std::env::set_var("ERI_VERCEL_DEPLOY", "0") };
        assert!(!vercel_deploy_enabled());
        unsafe { std::env::set_var("ERI_VERCEL_DEPLOY", "false") };
        assert!(!vercel_deploy_enabled());
        unsafe { std::env::set_var("ERI_VERCEL_DEPLOY", "1") };
        assert!(vercel_deploy_enabled());
        unsafe { std::env::remove_var("ERI_VERCEL_DEPLOY") };
    }

    #[test]
    fn shadcn_hints_present_in_new_build_system_prompt() {
        let backend = MercuryBackend::new(MercuryConfig {
            api_base: "http://localhost".into(),
            model: "mercury-2".into(),
            api_key: "test".into(),
            max_tokens: 1024,
            temperature: 0.85,
            reasoning_effort: "low".into(),
            edit_model: "mercury-edit-2".into(),
        });
        let ctx = PromptCtx::default();
        let messages = backend.build_messages(&ctx, None, None);

        let system_messages: Vec<&str> = messages
            .iter()
            .filter(|m| m.role == "system")
            .map(|m| m.content.as_str())
            .collect();

        assert!(
            system_messages
                .iter()
                .any(|m| m.contains("shadcn/ui patterns")),
            "expected shadcn component hints in system messages"
        );
        assert!(
            system_messages
                .iter()
                .any(|m| m.contains("bg-primary text-primary-foreground")),
            "expected primary button class string"
        );
        assert!(
            system_messages
                .iter()
                .any(|m| m.contains("rounded-lg border bg-card")),
            "expected card class string"
        );
        assert!(
            system_messages
                .iter()
                .any(|m| m.contains("flex h-10 w-full rounded-md border border-input")),
            "expected input class string"
        );
        assert!(
            system_messages
                .iter()
                .any(|m| m.contains("backdrop-blur-sm")),
            "expected dialog backdrop pattern"
        );
        assert!(
            system_messages.iter().any(|m| m.contains("MOTION PRESETS")),
            "expected motion presets in non-surgical system messages"
        );
    }

    fn test_backend() -> MercuryBackend {
        MercuryBackend::new(MercuryConfig {
            api_base: "http://localhost".into(),
            model: "mercury-2".into(),
            api_key: "test".into(),
            max_tokens: 1024,
            temperature: 0.85,
            reasoning_effort: "low".into(),
            edit_model: "mercury-edit-2".into(),
        })
    }

    fn tempdir_for_rules() -> PathBuf {
        let mut path = std::env::temp_dir();
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        path.push(format!("eri_rules_test_{}_{nanos}", std::process::id()));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn rules_md_prepended_to_system_prompt_when_present() {
        let project = tempdir_for_rules();
        let dot_eri = project.join(".eri");
        std::fs::create_dir_all(&dot_eri).unwrap();
        std::fs::write(
            dot_eri.join("rules.md"),
            "- Always use shadcn buttons.\n- The brand color is #FF6B35.\n",
        )
        .unwrap();

        let backend = test_backend().with_project_root(&project);
        let ctx = PromptCtx::default();
        let messages = backend.build_messages(&ctx, None, None);

        let system_blob: String = messages
            .iter()
            .filter(|m| m.role == "system")
            .map(|m| m.content.as_str())
            .collect::<Vec<_>>()
            .join("\n---\n");

        assert!(
            system_blob.contains("# Project rules"),
            "rules.md should be prepended as a system message"
        );
        assert!(
            system_blob.contains("Always use shadcn buttons"),
            "rules.md body should be present verbatim in the system messages"
        );
        assert!(
            system_blob.contains("#FF6B35"),
            "every rule line should make it into the prompt"
        );

        // Cleanup.
        let _ = std::fs::remove_dir_all(&project);
    }

    #[test]
    fn rules_md_absent_does_not_break_iteration() {
        // Project root exists, but `.eri/rules.md` is missing — the common
        // case for a fresh project. build_messages must still succeed and
        // omit the "Project rules" block rather than failing the fire.
        let project = tempdir_for_rules();
        let backend = test_backend().with_project_root(&project);
        let ctx = PromptCtx::default();
        let messages = backend.build_messages(&ctx, None, None);

        let has_rules_block = messages
            .iter()
            .filter(|m| m.role == "system")
            .any(|m| m.content.starts_with("# Project rules"));
        assert!(
            !has_rules_block,
            "missing rules.md must produce zero rules system messages"
        );
        // Sanity: the normal system prompt is still there so the fire is
        // viable.
        assert!(
            messages.iter().any(|m| m.role == "system"),
            "build_messages must still produce a non-empty system message list"
        );

        let _ = std::fs::remove_dir_all(&project);
    }

    #[test]
    fn rules_md_collapses_to_none_when_only_comments() {
        // The starter scaffold is entirely commented out; until the user
        // uncomments a rule, Mercury must not see an empty rules block.
        let project = tempdir_for_rules();
        ensure_rules_scaffold(&project).expect("write scaffold");
        let backend = test_backend().with_project_root(&project);
        let ctx = PromptCtx::default();
        let messages = backend.build_messages(&ctx, None, None);

        let has_rules_block = messages
            .iter()
            .filter(|m| m.role == "system")
            .any(|m| m.content.starts_with("# Project rules"));
        assert!(
            !has_rules_block,
            "comments-only scaffold must collapse to no rules block"
        );

        let _ = std::fs::remove_dir_all(&project);
    }

    #[test]
    fn mcp_tools_can_be_swapped_after_construction() {
        // Default state is empty; set_mcp_tools must replace the list. Used
        // by the panel when the user toggles MCP on/off via voice.
        let backend = test_backend();
        assert!(backend.mcp_tools().is_empty());

        backend.set_mcp_tools(vec![McpToolDescriptor {
            name: "github__list_prs".into(),
            description: "List open PRs".into(),
            parameters: serde_json::json!({"type": "object"}),
        }]);
        let tools = backend.mcp_tools();
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].name, "github__list_prs");
    }

    #[test]
    fn theme_palettes_have_valid_hex_codes_and_unique_names() {
        use std::collections::HashSet;

        assert!(
            THEME_PALETTES.len() >= 12,
            "expected at least 12 curated palettes, found {}",
            THEME_PALETTES.len()
        );

        let mut seen_names = HashSet::new();
        for palette in THEME_PALETTES {
            assert!(
                seen_names.insert(palette.name),
                "duplicate palette name: {}",
                palette.name
            );

            for (label, hex) in [
                ("bg_hex", palette.bg_hex),
                ("fg_hex", palette.fg_hex),
                ("accent_hex", palette.accent_hex),
                ("muted_hex", palette.muted_hex),
            ] {
                assert!(
                    hex.starts_with('#'),
                    "{}.{} must start with #, got {hex}",
                    palette.name,
                    label
                );
                assert_eq!(
                    hex.len(),
                    7,
                    "{}.{} must be 7 chars (#RRGGBB), got {hex}",
                    palette.name,
                    label
                );
                assert!(
                    hex[1..].chars().all(|c| c.is_ascii_hexdigit()),
                    "{}.{} must be hex digits, got {hex}",
                    palette.name,
                    label
                );
            }
        }
    }

    #[test]
    fn match_theme_palette_handles_aliases_and_punctuation() {
        assert_eq!(
            match_theme_palette("stripe").map(|p| p.name),
            Some("stripe")
        );
        assert_eq!(
            match_theme_palette("Stripe Style").map(|p| p.name),
            Some("stripe")
        );
        assert_eq!(
            match_theme_palette("cyberpunk").map(|p| p.name),
            Some("cyberpunk neon")
        );
        assert_eq!(
            match_theme_palette("coffee shop").map(|p| p.name),
            Some("coffee shop")
        );
        assert_eq!(match_theme_palette("does-not-exist"), None);
    }

    #[test]
    fn theme_directive_block_contains_all_four_hex_codes() {
        let palette = match_theme_palette("stripe").expect("stripe palette");
        let block = palette.directive_block();
        assert!(block.contains("# Theme directive"));
        assert!(block.contains(palette.bg_hex));
        assert!(block.contains(palette.fg_hex));
        assert!(block.contains(palette.accent_hex));
        assert!(block.contains(palette.muted_hex));
        assert!(block.contains("stripe"));
    }
}
