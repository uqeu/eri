//! `eri/inference/iterate` JSON-RPC handler.
//!
//! Wires the brain layer ([`eri_inference::run_iteration_via_brain`]) into
//! the sidecar dispatch. The handler:
//!
//! 1. Parses the incoming params (workspace, prompt, openFiles, etc.).
//! 2. Resolves BYOK API keys for every provider via [`Services::fetch_secret`].
//! 3. Auto-attaches rules via [`eri_rules`] as low-priority [`BudgetPart`]s.
//! 4. Calls into `eri_inference` on a blocking task (the inference path is
//!    synchronous and may make a network call). Each [`StreamEvent`] is
//!    captured into a Vec which we return at the end of the call — the
//!    real streaming hook will land once the host writer is plumbed.
//! 5. Records every step to the workspace [`eri_graph::Graph`] best-effort
//!    via a thin [`Instrumentation`] adapter — failures warn and continue.
//!
//! Tier gating: requires `inlineEdit`; if the brain picks a non-Mercury
//! frontier model, the caller must also have the `byokModels` feature.

use std::path::PathBuf;
use std::sync::{Arc, Mutex as StdMutex};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::Mutex;

use eri_caveman::BudgetPart;
use eri_graph::{Graph, auto as graph_auto};
use eri_index::Index;
use eri_inference::{
    BrainIterationError, BrainIterationRequest, BrainIterationResponse, InferenceError,
    Instrumentation as IterInstrumentation, ProviderKeys, SearchProvider, StreamEvent,
};
use eri_router::{Intent, PromptContext};

use crate::services::Services;
use crate::{DispatchError, SharedTierState};

/// Wire shape for an open file entry.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenFileWire {
    path: String,
    #[serde(default)]
    content: String,
}

/// One linter / language-server diagnostic surfaced from the IDE. Threaded
/// through `eri/inference/iterate` so the model sees what's broken in the
/// active + open files BEFORE it edits, instead of having to guess from
/// the file content alone.
#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DiagnosticWire {
    path: String,
    line: u32,
    /// `"error" | "warning" | "info" | "hint"`. Loose union so the wire
    /// stays compatible with VS Code's `DiagnosticSeverity` enum + LSP.
    #[serde(default)]
    severity: String,
    #[serde(default)]
    message: String,
    /// Linter / language-server source — `"eslint"`, `"tsc"`, `"rust-analyzer"`,
    /// etc. Helps the model weigh which complaint to act on first.
    #[serde(default)]
    source: Option<String>,
}

/// Image attachment travelling alongside the prompt. The actual
/// multimodal dispatch to Sonnet / GPT-4o happens upstream in the
/// proxy; here we accept the payload, surface a descriptive
/// `system:images` BudgetPart so the model knows what the user
/// attached, and forward the URIs to the brain layer for future
/// vision routing.
#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ImageWire {
    /// MIME type — `image/png`, `image/jpeg`, etc.
    mime: String,
    /// `data:<mime>;base64,<payload>` URI. Lives in memory only; never
    /// persisted to disk by the sidecar.
    #[allow(dead_code)]
    data_uri: String,
    /// File name from the picker — surfaced to the model so it can
    /// refer to the attachment by name in its response.
    #[serde(default)]
    name: Option<String>,
    /// Optional size hint for debug + budget heuristics.
    #[serde(default)]
    size_bytes: Option<u64>,
}

/// Wire shape of `eri/inference/iterate` params.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IterateParams {
    workspace: PathBuf,
    prompt: String,
    #[serde(default)]
    open_files: Vec<OpenFileWire>,
    #[serde(default)]
    linter_errors_count: usize,
    /// Active linter / language-server diagnostics for the open file set.
    /// Optional — older IDE builds still ship just `linter_errors_count`.
    #[serde(default)]
    diagnostics: Vec<DiagnosticWire>,
    /// Multimodal image attachments (Phase 16a). Empty when no images
    /// are pinned.
    #[serde(default)]
    images: Vec<ImageWire>,
    #[serde(default)]
    voice_input: bool,
    #[serde(default)]
    language: Option<String>,
}

/// Compact view of a [`StreamEvent`] suitable for JSON serialisation.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EventWire {
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

/// Wire shape of the response.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct IterateResult {
    intent: &'static str,
    model: ModelWire,
    raw_model_output: String,
    applied: Vec<PathInfoWire>,
    failed: Vec<FailedInfoWire>,
    dropped_parts: Vec<String>,
    events: Vec<EventWire>,
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
struct PathInfoWire {
    path: String,
    bytes_before: usize,
    bytes_after: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FailedInfoWire {
    path: String,
    reason: String,
}

/// Index-backed [`SearchProvider`] adapter. Locks the index for the
/// duration of one search call.
struct IndexSearchAdapter {
    handle: Arc<Mutex<Index>>,
}

impl SearchProvider for IndexSearchAdapter {
    fn search(&self, query: &str, top_k: usize) -> Result<String, InferenceError> {
        // The index is async-locked but the trait is sync; use blocking_lock
        // because this function runs inside `spawn_blocking`.
        let guard = self.handle.blocking_lock();
        match guard.search(query, top_k) {
            Ok(results) => {
                let mut out = String::new();
                for r in results.iter().take(top_k) {
                    use std::fmt::Write;
                    let _ = writeln!(
                        out,
                        "{}:{}-{}\n{}\n---",
                        r.chunk.path, r.chunk.line_start, r.chunk.line_end, r.chunk.content
                    );
                }
                Ok(out)
            }
            Err(err) => Err(InferenceError::Transport(err.to_string())),
        }
    }
}

/// Graph-backed instrumentation. Best-effort — every call swallows errors
/// and logs via tracing so iteration never blocks on graph writes.
struct GraphInstr {
    graph: Arc<Mutex<Graph>>,
    prompt_id: StdMutex<Option<eri_graph::NodeId>>,
    intent_id: StdMutex<Option<eri_graph::NodeId>>,
    model_call_id: StdMutex<Option<eri_graph::NodeId>>,
    model_response_id: StdMutex<Option<eri_graph::NodeId>>,
}

impl GraphInstr {
    fn new(graph: Arc<Mutex<Graph>>) -> Self {
        Self {
            graph,
            prompt_id: StdMutex::new(None),
            intent_id: StdMutex::new(None),
            model_call_id: StdMutex::new(None),
            model_response_id: StdMutex::new(None),
        }
    }
}

impl IterInstrumentation for GraphInstr {
    fn on_prompt(&mut self, prompt: &str) {
        let g = self.graph.blocking_lock();
        match graph_auto::record_prompt(&g, prompt) {
            Ok(id) => {
                if let Ok(mut slot) = self.prompt_id.lock() {
                    *slot = Some(id);
                }
            }
            Err(err) => tracing::warn!(error = %err, "graph: record_prompt failed"),
        }
    }

    fn on_intent(&mut self, intent: Intent) {
        let prompt_id = match self.prompt_id.lock().ok().and_then(|g| g.clone()) {
            Some(id) => id,
            None => return,
        };
        let g = self.graph.blocking_lock();
        match graph_auto::record_intent(&g, &prompt_id, intent_label(intent)) {
            Ok(id) => {
                if let Ok(mut slot) = self.intent_id.lock() {
                    *slot = Some(id);
                }
            }
            Err(err) => tracing::warn!(error = %err, "graph: record_intent failed"),
        }
    }

    fn on_model_call(
        &mut self,
        provider: &str,
        model: &str,
        tokens_in: usize,
        tokens_out: usize,
        latency_ms: u64,
    ) {
        let intent_id = match self.intent_id.lock().ok().and_then(|g| g.clone()) {
            Some(id) => id,
            None => return,
        };
        let g = self.graph.blocking_lock();
        match graph_auto::record_model_call(
            &g,
            &intent_id,
            provider,
            model,
            tokens_in as u32,
            tokens_out as u32,
            latency_ms,
        ) {
            Ok(id) => {
                if let Ok(mut slot) = self.model_call_id.lock() {
                    *slot = Some(id);
                }
            }
            Err(err) => tracing::warn!(error = %err, "graph: record_model_call failed"),
        }
    }

    fn on_model_response(&mut self, text: &str, finish_reason: &str) {
        let call_id = match self.model_call_id.lock().ok().and_then(|g| g.clone()) {
            Some(id) => id,
            None => return,
        };
        let g = self.graph.blocking_lock();
        match graph_auto::record_model_response(&g, &call_id, text, finish_reason) {
            Ok(id) => {
                if let Ok(mut slot) = self.model_response_id.lock() {
                    *slot = Some(id);
                }
            }
            Err(err) => tracing::warn!(error = %err, "graph: record_model_response failed"),
        }
    }

    fn on_edit_applied(&mut self, applied: &eri_apply::Applied) {
        let call_id = match self.model_call_id.lock().ok().and_then(|g| g.clone()) {
            Some(id) => id,
            None => return,
        };
        let g = self.graph.blocking_lock();
        if let Err(err) = graph_auto::record_edit_applied(
            &g,
            &call_id,
            &applied.path.display().to_string(),
            applied.bytes_before,
            applied.bytes_after,
        ) {
            tracing::warn!(error = %err, "graph: record_edit_applied failed");
        }
    }

    fn on_edit_rejected(&mut self, failed: &eri_apply::Failed) {
        let response_id = match self.model_response_id.lock().ok().and_then(|g| g.clone()) {
            Some(id) => id,
            None => return,
        };
        let g = self.graph.blocking_lock();
        // We map a failed apply onto the proposed→rejected pair so the
        // node graph has both shapes available.
        match graph_auto::record_edit_proposed(
            &g,
            &response_id,
            &failed.path.display().to_string(),
            &format!("{:?}", failed.reason),
        ) {
            Ok(proposed_id) => {
                if let Err(err) = graph_auto::record_edit_rejected(
                    &g,
                    &proposed_id,
                    Some(&format!("{:?}", failed.reason)),
                ) {
                    tracing::warn!(error = %err, "graph: record_edit_rejected failed");
                }
            }
            Err(err) => tracing::warn!(error = %err, "graph: record_edit_proposed failed"),
        }
    }
}

fn intent_label(intent: Intent) -> &'static str {
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

fn event_to_wire(ev: &StreamEvent) -> EventWire {
    match ev {
        StreamEvent::Token(t) => EventWire {
            kind: "token",
            text: Some(t.clone()),
            path: None,
            reason: None,
        },
        StreamEvent::EditApplied(a) => EventWire {
            kind: "edit_applied",
            text: None,
            path: Some(a.path.display().to_string()),
            reason: None,
        },
        StreamEvent::EditFailed(f) => EventWire {
            kind: "edit_failed",
            text: None,
            path: Some(f.path.display().to_string()),
            reason: Some(format!("{:?}", f.reason)),
        },
        StreamEvent::Done(_) => EventWire {
            kind: "done",
            text: None,
            path: None,
            reason: None,
        },
    }
}

/// Build the full set of [`BudgetPart`]s from the request. Layering:
///
/// - **Priority 0 (mandatory)**: persona system prompt, the user prompt,
///   and explicit project facts (`ERI.md` / `.eri/AGENT.md`).
/// - **Priority 2**: auto-attached rules.
/// - **Priority 5**: file payloads, with `min_keep=200` so very short
///   files survive a truncation pass.
///
/// The persona layer (above the agent registry) lets the user swap the
/// agent identity with a one-line file (`.eri/persona`) or a user-defined
/// `<workspace>/.eri/agents/<name>.md`. See `eri_inference::personas`.
fn build_parts(
    workspace: &std::path::Path,
    prompt: &str,
    open_files: &[OpenFileWire],
    rules: &[String],
    user_id: Option<&str>,
    diagnostics: &[DiagnosticWire],
    images: &[ImageWire],
) -> Vec<BudgetPart> {
    let mut parts: Vec<BudgetPart> = Vec::with_capacity(open_files.len() + rules.len() + 5);

    // Persona system prompt — replaces the previous hard-coded `system:base`.
    let active = eri_inference::personas::read_active(workspace);
    let persona = eri_inference::personas::resolve(workspace, &active);
    parts.push(BudgetPart::new(
        "system:persona",
        0,
        persona.system_prompt.clone(),
    ));

    // Project facts (Phase 8c) — read `<workspace>/ERI.md` and the git-
    // ignored `.eri/AGENT.md` variant. Priority 0 so they survive truncation.
    for (label, body) in load_project_facts(workspace) {
        parts.push(BudgetPart::new(label, 0, body));
    }

    // Learned patterns (Phase 8b) — recent observations from the local
    // memory store, formatted as `## What I've learned about you`. Priority 1
    // sits above rules (2) but is droppable on tight budgets.
    //
    // `user_id` scopes the store to the active signed-in user so two
    // accounts on the same machine don't see each other's patterns.
    if let Some(block) = load_learned_block(workspace, user_id) {
        parts.push(BudgetPart::new("system:learned", 1, block).with_min_keep(0));
    }

    // Active linter / language-server diagnostics (Phase 16b) — formatted
    // as a Markdown list so the model can see what's broken in the open
    // files BEFORE editing. Priority 2 (between learned patterns and
    // user rules); fully droppable when the budget is tight.
    if let Some(block) = format_diagnostics_block(diagnostics) {
        parts.push(BudgetPart::new("system:diagnostics", 2, block).with_min_keep(0));
    }

    // Multimodal image attachments (Phase 16a). The dispatch layer is
    // responsible for routing the actual `data:` URIs to a vision-capable
    // model; here we emit a textual `system:images` part so the model has
    // a stable reference to the attachments in the conversation.
    if let Some(block) = format_images_block(images) {
        parts.push(BudgetPart::new("system:images", 1, block).with_min_keep(0));
    }

    // Active theme (Phase 23b) — design tokens injected at priority 1
    // so generated UI matches the user's vibe from the first turn.
    if let Some(theme) = crate::services::themes::active_theme(workspace) {
        let block = crate::services::themes::format_theme_block(&theme);
        parts.push(BudgetPart::new("system:theme", 1, block).with_min_keep(0));
    }

    // Build preferences (Phase 23c) — the durable per-user "how to
    // build" doc. Priority 1; capped at ~600 tokens by the formatter.
    let (prefs_merged, _sources) = crate::services::preferences::merge_preferences(workspace);
    if let Some(block) = crate::services::preferences::format_preferences_block(&prefs_merged) {
        parts.push(BudgetPart::new("system:preferences", 1, block).with_min_keep(0));
    }

    parts.push(BudgetPart::new("user:prompt", 0, prompt));

    for f in open_files {
        let label = format!("ctx:file:{}", f.path);
        parts.push(BudgetPart::new(label, 5, f.content.clone()).with_min_keep(200));
    }
    for (i, rule) in rules.iter().enumerate() {
        parts.push(BudgetPart::new(format!("system:rule:{i}"), 2, rule.clone()));
    }
    parts
}

/// Format attached images as a textual `## Images attached` block so
/// the model has a stable reference to the multimodal content blocks
/// the dispatch layer will inject separately. The actual `data:` URIs
/// never travel in the system prompt — they're routed via the proxy's
/// multimodal content path.
fn format_images_block(images: &[ImageWire]) -> Option<String> {
    if images.is_empty() {
        return None;
    }
    let mut out = String::from("## Images attached\n");
    for (i, img) in images.iter().enumerate() {
        let name = img.name.as_deref().unwrap_or("image");
        let size = img
            .size_bytes
            .map(|n| format!(" · {} bytes", n))
            .unwrap_or_default();
        out.push_str(&format!("{}. {} ({}{})\n", i + 1, name, img.mime, size));
    }
    out.push_str("These are visible to the model as image content blocks in the same turn.\n");
    Some(out)
}

/// Format the active linter / language-server diagnostics as a
/// `## Live diagnostics` Markdown block ready for system-prompt
/// injection. Returns `None` when the IDE sent no diagnostics — the
/// caller drops the part rather than wasting tokens on an empty header.
///
/// Sorted: errors first (so the model addresses them before warnings),
/// then within a severity by `path:line`. Capped at the top 40 entries
/// + a `…and N more` footer so a 1000-warning ESLint sweep doesn't blow
/// the prompt budget.
fn format_diagnostics_block(diagnostics: &[DiagnosticWire]) -> Option<String> {
    if diagnostics.is_empty() {
        return None;
    }
    const SEVERITY_ORDER: [&str; 4] = ["error", "warning", "info", "hint"];
    let mut sorted: Vec<&DiagnosticWire> = diagnostics.iter().collect();
    sorted.sort_by(|a, b| {
        let rank = |s: &str| {
            SEVERITY_ORDER
                .iter()
                .position(|x| x.eq_ignore_ascii_case(s))
                .unwrap_or(SEVERITY_ORDER.len())
        };
        rank(&a.severity)
            .cmp(&rank(&b.severity))
            .then_with(|| a.path.cmp(&b.path))
            .then_with(|| a.line.cmp(&b.line))
    });
    let mut out = String::from("## Live diagnostics\n");
    const MAX: usize = 40;
    let shown = sorted.iter().take(MAX);
    for d in shown {
        let sev_glyph = match d.severity.to_ascii_lowercase().as_str() {
            "error" => "✗",
            "warning" => "⚠",
            "info" => "ℹ",
            "hint" => "·",
            _ => "·",
        };
        let src = d
            .source
            .as_deref()
            .filter(|s| !s.is_empty())
            .map(|s| format!(" [{s}]"))
            .unwrap_or_default();
        let line = format!(
            "{} {}:{}{} {}\n",
            sev_glyph,
            d.path,
            d.line.max(1),
            src,
            d.message
        );
        out.push_str(&line);
    }
    if sorted.len() > MAX {
        out.push_str(&format!("…and {} more\n", sorted.len() - MAX));
    }
    Some(out)
}

/// Format the local memory store's recent observations as a system-prompt
/// block. Returns `None` when the store doesn't exist yet or has no
/// observations for this workspace — failure is non-fatal because memory
/// is enrichment, not a precondition.
fn load_learned_block(workspace: &std::path::Path, user_id: Option<&str>) -> Option<String> {
    let store = eri_inference::memory::MemoryStore::open_for(user_id).ok()?;
    let patterns = store.top_patterns(workspace, 20);
    if patterns.is_empty() {
        return None;
    }
    let formatted = eri_inference::memory::format_learned_block(&patterns);
    if formatted.is_empty() {
        None
    } else {
        Some(formatted)
    }
}

/// Read the workspace's explicit project memory files. eri honours the
/// emerging 2026 `AGENTS.md` / `AGENT.md` convention used by Cursor,
/// Cline, Claude Code, and other agentic IDEs in addition to its own
/// `ERI.md` so users don't need to maintain a duplicate file when they
/// switch tooling.
///
/// Lookup order (first hit wins per filename slot):
///   1. `<workspace>/ERI.md`           — eri-native, takes precedence
///   2. `<workspace>/AGENTS.md`        — 2026 community standard (committed)
///   3. `<workspace>/AGENT.md`         — singular variant some tools emit
///   4. `<workspace>/.eri/AGENT.md`    — eri-specific, gitignored variant
///
/// All hits are returned (deduped by canonical content) so a project
/// that maintains both a committed `AGENTS.md` and a personal
/// `.eri/AGENT.md` keeps both layers. Missing files return nothing —
/// every entry is opt-in.
fn load_project_facts(workspace: &std::path::Path) -> Vec<(&'static str, String)> {
    let candidates: &[(&str, &'static str)] = &[
        ("ERI.md", "system:project_facts:eri_md"),
        ("AGENTS.md", "system:project_facts:agents_md"),
        ("AGENT.md", "system:project_facts:agent_md"),
        (".eri/AGENT.md", "system:project_facts:eri_agent_md"),
    ];
    let mut out = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    for (relpath, label) in candidates {
        let path = workspace.join(relpath);
        let Ok(body) = std::fs::read_to_string(&path) else {
            continue;
        };
        let trimmed = body.trim();
        if trimmed.is_empty() {
            continue;
        }
        // Dedup by content so two tools writing identical bytes don't
        // double-count toward the budget.
        if !seen.insert(trimmed.to_string()) {
            continue;
        }
        out.push((*label, trimmed.to_string()));
    }
    out
}

/// Load active rules for the workspace as a list of body strings. Returns
/// an empty Vec on any error — rules are an enhancement, not a precondition.
fn load_rules(workspace: &std::path::Path, ctx: &PromptContext) -> Vec<String> {
    use eri_rules::{PromptContext as RulesCtx, Rules};
    match Rules::load(workspace) {
        Ok(rules) => {
            // Adapt the brain-layer PromptContext onto the rules-layer one;
            // we forward open files which is what auto-attached rules glob.
            let rules_ctx = RulesCtx::new().with_open_files(ctx.open_files.clone());
            rules
                .active_for(&rules_ctx)
                .into_iter()
                .map(|r| r.body.clone())
                .collect()
        }
        Err(err) => {
            tracing::debug!(error = %err, "no rules loaded");
            Vec::new()
        }
    }
}

/// The one seam for "give me a provider for this model choice, using this
/// user's keys." Resolves BYOK + proxy + env from the secret cache (via
/// [`collect_provider_keys`]) then constructs the provider — replacing ad-hoc
/// `provider_from_choice` calls that only ever saw process env vars. Callers
/// that already hold `&Services` (review, voice routing, …) go through here so
/// signed-in / BYOK users get the right upstream instead of an env-only guess.
pub(crate) async fn resolve_provider(
    services: &Services,
    choice: &str,
) -> Result<Box<dyn eri_inference::llm_provider::LlmProvider>, DispatchError> {
    let keys = collect_provider_keys(services).await;
    eri_inference::llm_provider::provider_from_choice_with_keys(choice, &keys).ok_or_else(|| {
        DispatchError::Other(anyhow::anyhow!(
            "no provider available for {choice:?} — set an API key or sign in"
        ))
    })
}

/// Resolve credentials via the existing secret cache.
///
/// Two parallel lookups:
/// * Session bearer + base URL → enables the eri.dev inference proxy when
///   the user is signed in. The bearer is process-cached so cost is one
///   round-trip per sidecar lifetime.
/// * BYOK keys per vendor → if a user explicitly configured a power-user
///   key in `SecretStorage`, that vendor bypasses the proxy.
///
/// Missing values are not fatal: the planner falls through to the next
/// available auth mode or surfaces a [`BrainIterationError::MissingKey`].
pub(crate) async fn collect_provider_keys(services: &Services) -> ProviderKeys {
    let anthropic = services
        .fetch_secret("anthropic", "anthropic-api-key")
        .await
        .unwrap_or(None);
    let openai = services
        .fetch_secret("openai", "openai-api-key")
        .await
        .unwrap_or(None);
    let google = services
        .fetch_secret("google", "google-api-key")
        .await
        .unwrap_or(None);
    let inception = services
        .fetch_secret("inception", "inception-api-key")
        .await
        .unwrap_or(None);
    let session = services
        .secrets
        .eri_session_token(services.host_client.as_deref())
        .await;
    let base_url = services.secrets.eri_base_url();

    let mut keys = ProviderKeys::default();
    if let Some(k) = anthropic {
        keys = keys.with_anthropic(k);
    }
    if let Some(k) = openai {
        keys = keys.with_openai(k);
    }
    if let Some(k) = google {
        keys = keys.with_google(k);
    }
    if let Some(k) = inception {
        keys = keys.with_inception(k);
    }
    if let Some(s) = session {
        keys = keys.with_proxy(s, base_url);
    }
    keys
}

/// `eri/inference/iterate` handler. Tier gating is performed by the caller
/// before invoking this function.
pub async fn iterate(
    params: Value,
    tier_state: &SharedTierState,
    services: &Arc<Services>,
) -> Result<Value, DispatchError> {
    // Always require the iteration feature.
    crate::require_feature(tier_state, "inlineEdit").await?;

    let p: IterateParams = serde_json::from_value(params)
        .map_err(|e| DispatchError::BadParams(format!("eri/inference/iterate: {e}")))?;

    let prompt_ctx = PromptContext {
        language: p.language.clone(),
        open_files: p.open_files.iter().map(|f| f.path.clone()).collect(),
        linter_errors_count: p.linter_errors_count,
        voice_input: p.voice_input,
        prompt_token_estimate: 0,
    };

    let rules = load_rules(&p.workspace, &prompt_ctx);
    let user_id = services.current_user_id().await;
    let parts = build_parts(
        &p.workspace,
        &p.prompt,
        &p.open_files,
        &rules,
        user_id.as_deref(),
        &p.diagnostics,
        &p.images,
    );

    let provider_keys = collect_provider_keys(services).await;
    let req = BrainIterationRequest {
        user_prompt: p.prompt.clone(),
        context: prompt_ctx,
        parts,
        provider_keys,
        workspace_root: p.workspace.clone(),
        language: p.language,
    };

    // Resolve the per-workspace graph + index handles up front so the
    // blocking task can run without re-locking the outer services maps.
    let graph_handle = match Graph::open(&p.workspace) {
        Ok(g) => Some(Arc::new(Mutex::new(g))),
        Err(err) => {
            tracing::warn!(error = %err, "graph open failed; skipping instrumentation");
            None
        }
    };

    let index_handle: Option<Arc<Mutex<Index>>> = {
        // Reuse the cached handle if there is one; otherwise leave None and
        // search intent will return NoSearchProvider — that's preferable to
        // opening a fresh Index on the iteration hot path.
        let map = services.indexes.lock().await;
        map.get(&p.workspace).cloned()
    };

    let events: Arc<StdMutex<Vec<EventWire>>> = Arc::new(StdMutex::new(Vec::new()));
    let events_capture = Arc::clone(&events);
    let workspace = p.workspace.clone();

    // Run the synchronous brain pipeline on a blocking task — `LlmProvider`
    // makes blocking network calls and would otherwise jam the dispatcher.
    let response: Result<BrainIterationResponse, BrainIterationError> =
        tokio::task::spawn_blocking(move || {
            let search_adapter = index_handle.map(|h| IndexSearchAdapter { handle: h });
            let search_dyn: Option<&dyn SearchProvider> = match &search_adapter {
                Some(s) => Some(s as &dyn SearchProvider),
                None => None,
            };
            let instr: Box<dyn IterInstrumentation> = match graph_handle {
                Some(g) => Box::new(GraphInstr::new(g)),
                None => Box::new(eri_inference::NullInstr),
            };
            eri_inference::run_iteration_via_brain(req, search_dyn, instr, move |ev| {
                if let Ok(mut e) = events_capture.lock() {
                    e.push(event_to_wire(&ev));
                }
            })
        })
        .await
        .map_err(|e| DispatchError::Other(anyhow::anyhow!("blocking task join: {e}")))?;

    let resp = match response {
        Ok(r) => r,
        Err(BrainIterationError::MissingKey(model)) => {
            // The planner picked a frontier model the user has no key for.
            // Surface as a feature-locked error so the IDE can show a BYOK
            // prompt instead of a generic transport failure.
            tracing::info!(model = %model, "iteration blocked: missing BYOK key");
            return Err(DispatchError::FeatureLocked("byokModels"));
        }
        Err(other) => return Err(DispatchError::Other(anyhow::anyhow!(other))),
    };

    // Tier sub-gate: if the picked model isn't Mercury, require byokModels.
    if !matches!(resp.plan.model, eri_router::ModelChoice::Mercury) {
        crate::require_feature(tier_state, "byokModels").await?;
    }

    let applied: Vec<PathInfoWire> = resp
        .apply_report
        .as_ref()
        .map(|r| {
            r.applied
                .iter()
                .map(|a| PathInfoWire {
                    path: a.path.display().to_string(),
                    bytes_before: a.bytes_before,
                    bytes_after: a.bytes_after,
                })
                .collect()
        })
        .unwrap_or_default();
    let failed: Vec<FailedInfoWire> = resp
        .apply_report
        .as_ref()
        .map(|r| {
            r.failed
                .iter()
                .map(|f| FailedInfoWire {
                    path: f.path.display().to_string(),
                    reason: format!("{:?}", f.reason),
                })
                .collect()
        })
        .unwrap_or_default();

    let events_out = Arc::try_unwrap(events)
        .map(|m| m.into_inner().unwrap_or_default())
        .unwrap_or_else(|arc| arc.lock().map(|g| g.clone()).unwrap_or_default());

    let result = IterateResult {
        intent: intent_label(resp.plan.intent),
        model: ModelWire {
            vendor: resp.plan.model.vendor(),
            id: resp.plan.model.model_id().to_string(),
        },
        raw_model_output: resp.raw_model_output,
        applied,
        failed,
        dropped_parts: resp.plan.budgeted_prompt.dropped_parts,
        events: events_out,
        estimated_tokens_in: resp.plan.estimated_tokens_in,
        estimated_tokens_out: resp.plan.estimated_tokens_out,
    };

    let _ = workspace; // pinned to keep the lifetime obvious; unused outside spawn.
    serde_json::to_value(result).map_err(|e| DispatchError::Other(anyhow::anyhow!(e)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::TierState;
    use std::collections::HashSet;

    fn tier_with(features: &[&str]) -> SharedTierState {
        let mut set = HashSet::new();
        for f in features {
            set.insert((*f).to_string());
        }
        Arc::new(tokio::sync::Mutex::new(TierState {
            tier: "test".into(),
            features: set,
        }))
    }

    #[test]
    fn format_diagnostics_block_orders_errors_first() {
        let diagnostics = vec![
            DiagnosticWire {
                path: "src/foo.ts".into(),
                line: 10,
                severity: "warning".into(),
                message: "unused import".into(),
                source: Some("eslint".into()),
            },
            DiagnosticWire {
                path: "src/bar.ts".into(),
                line: 3,
                severity: "error".into(),
                message: "Type 'string' is not assignable to 'number'.".into(),
                source: Some("tsc".into()),
            },
        ];
        let block = format_diagnostics_block(&diagnostics).expect("non-empty");
        let err_idx = block.find("✗ src/bar.ts").expect("error present");
        let warn_idx = block.find("⚠ src/foo.ts").expect("warning present");
        assert!(err_idx < warn_idx, "errors must sort before warnings");
        assert!(block.contains("[tsc]"));
        assert!(block.contains("[eslint]"));
    }

    #[test]
    fn format_diagnostics_block_caps_long_lists() {
        let mut diagnostics: Vec<DiagnosticWire> = Vec::new();
        for i in 0..55u32 {
            diagnostics.push(DiagnosticWire {
                path: format!("src/x{i:03}.ts"),
                line: i + 1,
                severity: "warning".into(),
                message: format!("warning {i:03}"),
                source: None,
            });
        }
        let block = format_diagnostics_block(&diagnostics).expect("non-empty");
        assert!(
            block.contains("…and 15 more"),
            "expected cap footer, got: {block}"
        );
        // Body lines start with the severity glyph; count them to confirm
        // the cap (40 entries) — the footer line is separate.
        let body_lines = block
            .lines()
            .filter(|l| l.starts_with('✗') || l.starts_with('⚠'))
            .count();
        assert_eq!(body_lines, 40);
    }

    #[test]
    fn format_diagnostics_block_is_none_when_empty() {
        assert!(format_diagnostics_block(&[]).is_none());
    }

    #[test]
    fn format_images_block_includes_name_and_mime() {
        let images = vec![ImageWire {
            mime: "image/png".into(),
            data_uri: "data:image/png;base64,xyz".into(),
            name: Some("hero.png".into()),
            size_bytes: Some(234_000),
        }];
        let block = format_images_block(&images).expect("non-empty");
        assert!(block.contains("hero.png"));
        assert!(block.contains("image/png"));
        assert!(block.contains("234000 bytes"));
    }

    #[test]
    fn format_images_block_is_none_when_empty() {
        assert!(format_images_block(&[]).is_none());
    }

    #[test]
    fn load_project_facts_reads_agents_md_alias() {
        let dir = tempfile::TempDir::new().unwrap();
        std::fs::write(dir.path().join("AGENTS.md"), "use pnpm always").unwrap();
        let facts = load_project_facts(dir.path());
        assert_eq!(facts.len(), 1);
        assert_eq!(facts[0].0, "system:project_facts:agents_md");
        assert_eq!(facts[0].1, "use pnpm always");
    }

    #[test]
    fn load_project_facts_dedupes_identical_content() {
        let dir = tempfile::TempDir::new().unwrap();
        // Two files with identical bytes should only appear once in the budget.
        std::fs::write(dir.path().join("ERI.md"), "team is khai").unwrap();
        std::fs::write(dir.path().join("AGENTS.md"), "team is khai").unwrap();
        let facts = load_project_facts(dir.path());
        assert_eq!(facts.len(), 1, "deduped by content");
        // Lookup order means ERI.md wins.
        assert_eq!(facts[0].0, "system:project_facts:eri_md");
    }

    #[test]
    fn load_project_facts_returns_all_distinct_layers() {
        let dir = tempfile::TempDir::new().unwrap();
        std::fs::write(dir.path().join("ERI.md"), "core fact").unwrap();
        std::fs::write(dir.path().join("AGENTS.md"), "community fact").unwrap();
        std::fs::create_dir_all(dir.path().join(".eri")).unwrap();
        std::fs::write(dir.path().join(".eri").join("AGENT.md"), "private fact").unwrap();
        let facts = load_project_facts(dir.path());
        assert_eq!(facts.len(), 3);
        let labels: Vec<&str> = facts.iter().map(|(l, _)| *l).collect();
        assert_eq!(
            labels,
            vec![
                "system:project_facts:eri_md",
                "system:project_facts:agents_md",
                "system:project_facts:eri_agent_md",
            ]
        );
    }

    #[tokio::test]
    async fn iterate_rejects_when_inline_edit_locked() {
        let tier = tier_with(&[]);
        let services = Services::new();
        let dir = tempfile::TempDir::new().unwrap();
        let params = serde_json::json!({
            "workspace": dir.path().to_string_lossy(),
            "prompt": "hi",
        });
        let err = iterate(params, &tier, &services).await.expect_err("locked");
        assert!(matches!(err, DispatchError::FeatureLocked("inlineEdit")));
    }

    #[tokio::test]
    async fn iterate_bad_params_returns_bad_params_error() {
        let tier = tier_with(&["inlineEdit"]);
        let services = Services::new();
        let params = serde_json::json!({});
        let err = iterate(params, &tier, &services).await.expect_err("bad");
        assert!(matches!(err, DispatchError::BadParams(_)));
    }

    #[tokio::test]
    async fn iterate_search_intent_works_without_byok_key() {
        let tier = tier_with(&["inlineEdit"]);
        let services = Services::new();
        let dir = tempfile::TempDir::new().unwrap();
        // No index is opened yet, so search intent surfaces a clean error
        // (NoSearchProvider) via DispatchError::Other.
        let params = serde_json::json!({
            "workspace": dir.path().to_string_lossy(),
            "prompt": "where is the auth handler",
            "openFiles": [],
        });
        let err = iterate(params, &tier, &services).await.expect_err("err");
        match err {
            DispatchError::Other(e) => {
                assert!(e.to_string().contains("search intent requires"), "got: {e}");
            }
            other => panic!("unexpected error: {other:?}"),
        }
    }
}
