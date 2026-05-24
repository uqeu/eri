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
use eri_graph::{auto as graph_auto, Graph};
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
                if let Err(err) =
                    graph_auto::record_edit_rejected(&g, &proposed_id, Some(&format!("{:?}", failed.reason)))
                {
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

/// Build the full set of [`BudgetPart`]s from the request. Mandatory parts
/// (priority 0) are the prompt itself; file payloads come in at priority 5
/// with a min_keep so very short files survive a truncation pass; auto-
/// attached rules land at priority 2.
fn build_parts(
    prompt: &str,
    open_files: &[OpenFileWire],
    rules: &[String],
) -> Vec<BudgetPart> {
    let mut parts: Vec<BudgetPart> = Vec::with_capacity(open_files.len() + rules.len() + 2);
    parts.push(BudgetPart::new(
        "system:base",
        0,
        "You are eri, a careful coding assistant. \
         When asked to modify files, respond with aider-style search/replace blocks. \
         Otherwise respond in plain prose.",
    ));
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

/// Resolve BYOK keys via the existing secret cache. Each lookup is best
/// effort; missing values mean the planner will route around that vendor
/// or surface a [`BrainIterationError::MissingKey`] error later.
async fn collect_provider_keys(services: &Services) -> ProviderKeys {
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
    let parts = build_parts(&p.prompt, &p.open_files, &rules);

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
            let search_adapter =
                index_handle.map(|h| IndexSearchAdapter { handle: h });
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
                assert!(
                    e.to_string().contains("search intent requires"),
                    "got: {e}"
                );
            }
            other => panic!("unexpected error: {other:?}"),
        }
    }
}
