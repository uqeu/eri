//! High-level intent classifier + model router for eri's brain layer.
//!
//! Where the legacy [`crate::route`] function picks a single model from a
//! keyword table, [`Router`] returns a richer [`Plan`] including a
//! reasoning-depth hint and a temperature. The brain layer ([`eri_inference::brain`])
//! pairs this with the [`eri_caveman::Budgeter`] to produce a complete,
//! sized + routed plan that any inference dispatch can execute.
//!
//! Classification is heuristic + lexical for v0 — the same approach as the
//! legacy `route()` function. Future revisions can swap in a small local
//! classifier model without touching the public API.

use serde::{Deserialize, Serialize};

/// Coarse intent class. Distinct from the legacy [`crate::IntentKind`]: this
/// taxonomy is what the brain layer reasons over (chat / explain / edit /
/// build / refactor / debug / search / voice / unknown) rather than the
/// model-shape lanes the legacy router exposes (diffusion / polish /
/// long-form-planning / etc.).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Intent {
    /// Pure Q&A — answer without touching any file.
    Chat,
    /// Explain code or behaviour; no edit.
    Explain,
    /// Targeted single-file edit.
    Edit,
    /// Multi-file new feature.
    Build,
    /// Multi-file rewrite without behaviour change.
    Refactor,
    /// Investigate an error / failing test / stack trace.
    Debug,
    /// Find something in the codebase — handled by the index, not a model.
    Search,
    /// Voice-only social ("hi", "are you there", "thanks").
    Voice,
    /// Couldn't classify confidently.
    Unknown,
}

/// Concrete model the brain layer wants to dispatch to. Strings carry the
/// vendor's model id (e.g. `"claude-sonnet-4-5"`) so providers can resolve
/// them without a separate enum lookup.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ModelChoice {
    /// Mercury 2 diffusion engine — diffusion-shaped edit work.
    Mercury,
    Claude(String),
    OpenAI(String),
    Gemini(String),
    /// Local backend by model id (e.g. llama-3.1-8b-instruct).
    Local(String),
}

impl ModelChoice {
    pub fn vendor(&self) -> &'static str {
        match self {
            ModelChoice::Mercury => "mercury",
            ModelChoice::Claude(_) => "claude",
            ModelChoice::OpenAI(_) => "openai",
            ModelChoice::Gemini(_) => "gemini",
            ModelChoice::Local(_) => "local",
        }
    }

    pub fn model_id(&self) -> &str {
        match self {
            ModelChoice::Mercury => "mercury-2",
            ModelChoice::Claude(id)
            | ModelChoice::OpenAI(id)
            | ModelChoice::Gemini(id)
            | ModelChoice::Local(id) => id,
        }
    }
}

/// How much "thinking-time" the model should spend before answering. The
/// brain layer renders this as a system-prompt amendment; providers that
/// expose an explicit reasoning knob (o-series, Claude extended thinking)
/// may also use it to set their native dial.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ReasoningLevel {
    None,
    Light,
    Deep,
}

/// Output of [`Router::decide`]: full plan for the brain layer to execute.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Plan {
    pub intent: Intent,
    pub model: ModelChoice,
    pub temperature: f32,
    pub reasoning: ReasoningLevel,
}

/// Signal-level context for classifying and routing a prompt. Pure data —
/// the router never reads files or the network.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct PromptContext {
    pub language: Option<String>,
    pub open_files: Vec<String>,
    pub linter_errors_count: usize,
    pub voice_input: bool,
    /// Caller's best estimate of the prompt's token cost. Used by the brain
    /// layer for downstream budget decisions; the router doesn't consult it
    /// directly.
    pub prompt_token_estimate: usize,
}

/// Router configuration. Built once at startup from environment variables
/// and reused for every prompt — cheap to clone.
#[derive(Clone, Debug)]
pub struct Router {
    overrides: RouteTable,
}

impl Default for Router {
    fn default() -> Self {
        Self::new(RouteTable::defaults())
    }
}

impl Router {
    pub fn new(table: RouteTable) -> Self {
        Self { overrides: table }
    }

    /// Build a router from the process environment. Reads `ERI_ROUTE_*`
    /// variables for per-intent overrides:
    ///
    /// - `ERI_ROUTE_EDIT=claude:claude-sonnet-4-6`
    /// - `ERI_ROUTE_BUILD=mercury`
    /// - `ERI_ROUTE_REFACTOR=openai:gpt-5`
    /// - `ERI_ROUTE_DEBUG=...`, `ERI_ROUTE_EXPLAIN=...`, `ERI_ROUTE_CHAT=...`
    /// - `ERI_ROUTE_VOICE=...`, `ERI_ROUTE_UNKNOWN=...`
    pub fn from_env() -> Self {
        let mut table = RouteTable::defaults();
        for (intent, var) in INTENT_ENV_VARS {
            if let Ok(value) = std::env::var(var)
                && let Some(choice) = parse_model_choice(&value)
            {
                table.set(*intent, choice);
            }
        }
        // Local-first: `ERI_LOCAL_MODEL=qwen2.5:1.5b` makes the on-device model
        // the default for local-capable intents (explicit ERI_ROUTE_* overrides
        // still win). Unset = cloud-only, unchanged behavior.
        if let Ok(model) = std::env::var("ERI_LOCAL_MODEL") {
            let model = model.trim();
            if !model.is_empty() {
                table.local_model = Some(model.to_string());
            }
        }
        Self::new(table)
    }

    /// Set eri's on-device model (the local-first default for local-capable
    /// intents). Programmatic alternative to `ERI_LOCAL_MODEL`.
    pub fn set_local_model(&mut self, model: impl Into<String>) {
        self.overrides.local_model = Some(model.into());
    }

    pub fn classify(&self, prompt: &str, ctx: &PromptContext) -> Intent {
        classify_intent(prompt, ctx)
    }

    pub fn route(&self, intent: Intent, _prompt: &str, ctx: &PromptContext) -> Plan {
        let (default_model, default_reasoning, default_temp) = default_route_for(intent);
        // Precedence: explicit override > local-first (on-device model for a
        // local-capable intent) > the baked-in cloud/Mercury default.
        let model = match self.overrides.get(intent) {
            Some(o) => o.clone(),
            None => {
                local_first_choice(intent, self.overrides.local_model.as_deref(), default_model)
            }
        };
        // If the prompt comes from voice and the user picked a non-Voice
        // intent, prefer Light reasoning to keep latency tight.
        let reasoning = if ctx.voice_input && matches!(intent, Intent::Voice) {
            ReasoningLevel::None
        } else {
            default_reasoning
        };
        Plan {
            intent,
            model,
            temperature: default_temp,
            reasoning,
        }
    }

    pub fn decide(&self, prompt: &str, ctx: &PromptContext) -> Plan {
        let intent = self.classify(prompt, ctx);
        self.route(intent, prompt, ctx)
    }
}

/// Map of intent → overridden model choice. Missing entries fall back to the
/// defaults baked into [`default_route_for`].
#[derive(Clone, Debug, Default)]
pub struct RouteTable {
    chat: Option<ModelChoice>,
    explain: Option<ModelChoice>,
    edit: Option<ModelChoice>,
    build: Option<ModelChoice>,
    refactor: Option<ModelChoice>,
    debug: Option<ModelChoice>,
    voice: Option<ModelChoice>,
    unknown: Option<ModelChoice>,
    /// eri's configured on-device model id, if any. When set, local-capable
    /// intents route to it (local-first) unless an explicit override exists.
    local_model: Option<String>,
}

impl RouteTable {
    pub fn defaults() -> Self {
        Self::default()
    }

    fn get(&self, intent: Intent) -> Option<&ModelChoice> {
        match intent {
            Intent::Chat => self.chat.as_ref(),
            Intent::Explain => self.explain.as_ref(),
            Intent::Edit => self.edit.as_ref(),
            Intent::Build => self.build.as_ref(),
            Intent::Refactor => self.refactor.as_ref(),
            Intent::Debug => self.debug.as_ref(),
            Intent::Voice => self.voice.as_ref(),
            Intent::Unknown => self.unknown.as_ref(),
            // Search isn't model-served — no override slot.
            Intent::Search => None,
        }
    }

    pub fn set(&mut self, intent: Intent, choice: ModelChoice) {
        match intent {
            Intent::Chat => self.chat = Some(choice),
            Intent::Explain => self.explain = Some(choice),
            Intent::Edit => self.edit = Some(choice),
            Intent::Build => self.build = Some(choice),
            Intent::Refactor => self.refactor = Some(choice),
            Intent::Debug => self.debug = Some(choice),
            Intent::Voice => self.voice = Some(choice),
            Intent::Unknown => self.unknown = Some(choice),
            Intent::Search => {}
        }
    }
}

// ---------------------------------------------------------------------------
// Default routing table.
// ---------------------------------------------------------------------------

// Canonical valid wire ids (see docs/architecture/eri-architecture.html section 9).
// `claude-sonnet-4-5*` is a 404 at Anthropic — never use it.
const CLAUDE_SONNET_DEFAULT: &str = "claude-sonnet-4-6";
const CLAUDE_HAIKU_DEFAULT: &str = "claude-haiku-4-5-20251001";

fn default_route_for(intent: Intent) -> (ModelChoice, ReasoningLevel, f32) {
    match intent {
        // Diffusion-shaped: Mercury with deep reasoning, low temperature.
        Intent::Edit => (ModelChoice::Mercury, ReasoningLevel::Deep, 0.2),
        Intent::Build => (ModelChoice::Mercury, ReasoningLevel::Deep, 0.3),
        Intent::Refactor => (ModelChoice::Mercury, ReasoningLevel::Deep, 0.2),
        // Reasoning-shaped: frontier with deep / light thinking.
        Intent::Debug => (
            ModelChoice::Claude(CLAUDE_SONNET_DEFAULT.into()),
            ReasoningLevel::Deep,
            0.2,
        ),
        Intent::Explain => (
            ModelChoice::Claude(CLAUDE_SONNET_DEFAULT.into()),
            ReasoningLevel::Light,
            0.3,
        ),
        // Cheap fast model for chat-shaped Q&A.
        Intent::Chat => (
            ModelChoice::Claude(CLAUDE_HAIKU_DEFAULT.into()),
            ReasoningLevel::Light,
            0.6,
        ),
        // Search is index-served. We still emit a model choice in case the
        // dispatch wants a natural-language fallback, but caller should
        // short-circuit to the index first.
        Intent::Search => (
            ModelChoice::Claude(CLAUDE_HAIKU_DEFAULT.into()),
            ReasoningLevel::None,
            0.0,
        ),
        // Voice: low latency, no reasoning amendment.
        Intent::Voice => (
            ModelChoice::Claude(CLAUDE_HAIKU_DEFAULT.into()),
            ReasoningLevel::None,
            0.7,
        ),
        Intent::Unknown => (
            ModelChoice::Claude(CLAUDE_SONNET_DEFAULT.into()),
            ReasoningLevel::Light,
            0.4,
        ),
    }
}

/// The intents eri's on-device model is trusted to handle on its own —
/// **data, not logic**, so the 50-task local eval (`scripts/eval`) can widen it
/// by editing this list (or regenerating it) without touching control flow.
/// **Local-first**: eri runs these locally (0 cloud tokens); the heavier,
/// reasoning- or diffusion-shaped intents (build/edit/refactor/debug) stay on
/// the bigger engines, and Claude is the escalation. Runtime low-confidence
/// escalation layers on top.
pub const LOCAL_CAPABLE_INTENTS: &[Intent] =
    &[Intent::Chat, Intent::Voice, Intent::Search, Intent::Explain];

/// Whether eri's on-device model is trusted to handle `intent` on its own.
pub fn intent_is_local_capable(intent: Intent) -> bool {
    LOCAL_CAPABLE_INTENTS.contains(&intent)
}

/// Local-first model choice: when an on-device model is configured AND the
/// intent is local-capable, run it locally; otherwise use `fallback` (the
/// cloud/Mercury default or an explicit override). Pure + testable.
pub fn local_first_choice(
    intent: Intent,
    local_model: Option<&str>,
    fallback: ModelChoice,
) -> ModelChoice {
    match local_model {
        Some(m) if !m.trim().is_empty() && intent_is_local_capable(intent) => {
            ModelChoice::Local(m.to_string())
        }
        _ => fallback,
    }
}

const INTENT_ENV_VARS: &[(Intent, &str)] = &[
    (Intent::Chat, "ERI_ROUTE_CHAT"),
    (Intent::Explain, "ERI_ROUTE_EXPLAIN"),
    (Intent::Edit, "ERI_ROUTE_EDIT"),
    (Intent::Build, "ERI_ROUTE_BUILD"),
    (Intent::Refactor, "ERI_ROUTE_REFACTOR"),
    (Intent::Debug, "ERI_ROUTE_DEBUG"),
    (Intent::Voice, "ERI_ROUTE_VOICE"),
    (Intent::Unknown, "ERI_ROUTE_UNKNOWN"),
];

/// Parse a `vendor:model-id` (or `mercury`) string into a [`ModelChoice`].
/// Returns `None` for any malformed input — the router treats that as "no
/// override" and falls back to the default.
fn parse_model_choice(s: &str) -> Option<ModelChoice> {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.eq_ignore_ascii_case("mercury") {
        return Some(ModelChoice::Mercury);
    }
    let (vendor, model) = trimmed.split_once(':')?;
    let model = model.trim();
    if model.is_empty() {
        return None;
    }
    match vendor.trim().to_ascii_lowercase().as_str() {
        "claude" | "anthropic" => Some(ModelChoice::Claude(model.into())),
        "openai" | "gpt" => Some(ModelChoice::OpenAI(model.into())),
        "gemini" | "google" => Some(ModelChoice::Gemini(model.into())),
        "local" | "llama" | "ollama" => Some(ModelChoice::Local(model.into())),
        "mercury" => Some(ModelChoice::Mercury),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Classifier — heuristic + lexical. Mirrors the style of intent.rs but with
// a coarser taxonomy designed for the brain layer.
// ---------------------------------------------------------------------------

const VOICE_SOCIAL_MARKERS: &[&str] = &[
    "hi",
    "hey",
    "hello",
    "yo",
    "thanks",
    "thank you",
    "are you there",
    "are you alive",
    "you up",
    "you there",
    "good morning",
    "good evening",
];

const EXPLAIN_MARKERS: &[&str] = &[
    "explain ",
    "what does ",
    "what is ",
    "how does ",
    "why does ",
    "what's this",
    "whats this",
    "walk me through",
    "summarize ",
    "summarise ",
];

const BUILD_MARKERS: &[&str] = &[
    "build ",
    "build me ",
    "make a ",
    "make me a ",
    "scaffold ",
    "scaffold me ",
    "generate a new ",
    "spin up a ",
    "create a new ",
    "start a new ",
    "design a ",
    "set up ",
    "setup a ",
    "implement a ",
];

const DEBUG_MARKERS: &[&str] = &[
    "fix ",
    "fix the ",
    "the error is",
    "this error",
    "stack trace",
    "panic ",
    "crashes",
    "doesn't work",
    "doesnt work",
    "not working",
    "failing test",
    "test fails",
    "why is this broken",
    "broken",
];

const REFACTOR_MARKERS: &[&str] = &[
    "refactor",
    "extract ",
    "rename ",
    "inline ",
    "split this",
    "split the ",
    "deduplicate",
    "dedupe",
    "consolidate",
    "reorganise",
    "reorganize",
    "move this to",
    "move it to",
];

const SEARCH_MARKERS: &[&str] = &[
    "where is ",
    "find ",
    "search for",
    "locate ",
    "show me where",
    "what file",
    "which file",
];

const EDIT_MARKERS: &[&str] = &[
    "change ",
    "update ",
    "tweak ",
    "adjust ",
    "add ",
    "remove ",
    "delete the ",
    "swap ",
    "replace ",
    "make it ",
    "make the ",
];

fn classify_intent(prompt: &str, ctx: &PromptContext) -> Intent {
    let trimmed = prompt.trim();
    if trimmed.is_empty() {
        // Empty prompt + voice = social ping. Otherwise unknown.
        return if ctx.voice_input {
            Intent::Voice
        } else {
            Intent::Unknown
        };
    }
    let lower = trimmed.to_ascii_lowercase();

    // 1. Voice social pings — only credit short utterances. "thanks for the
    //    explanation, can you also build me X" is not a voice ping.
    if ctx.voice_input
        && trimmed.split_whitespace().count() <= 4
        && VOICE_SOCIAL_MARKERS.iter().any(|m| lower.contains(m))
    {
        return Intent::Voice;
    }

    // 2. Strong, unambiguous markers in priority order.
    if contains_any(&lower, EXPLAIN_MARKERS) {
        return Intent::Explain;
    }
    if contains_any(&lower, REFACTOR_MARKERS) {
        return Intent::Refactor;
    }
    if contains_any(&lower, SEARCH_MARKERS) {
        return Intent::Search;
    }
    // Debug: explicit marker OR an open linter error count.
    if ctx.linter_errors_count > 0 || contains_any(&lower, DEBUG_MARKERS) {
        return Intent::Debug;
    }
    if contains_any(&lower, BUILD_MARKERS) {
        return Intent::Build;
    }
    if contains_any(&lower, EDIT_MARKERS) && !ctx.open_files.is_empty() {
        return Intent::Edit;
    }

    // 3. Edit-default for short prompts referencing open files; chat for
    //    longer ambiguous prompts.
    let token_estimate = trimmed.split_whitespace().count();
    if token_estimate <= 25 && !ctx.open_files.is_empty() && contains_any(&lower, EDIT_MARKERS) {
        return Intent::Edit;
    }
    if token_estimate >= 60 {
        return Intent::Chat;
    }

    // 4. Fallback: chat for long ambiguous text, unknown for very short
    //    unspecified pings.
    if token_estimate < 4 {
        Intent::Unknown
    } else {
        Intent::Chat
    }
}

fn contains_any(haystack: &str, needles: &[&str]) -> bool {
    needles.iter().any(|n| haystack.contains(n))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx() -> PromptContext {
        PromptContext::default()
    }

    fn ctx_with_files(files: &[&str]) -> PromptContext {
        PromptContext {
            open_files: files.iter().map(|s| (*s).to_string()).collect(),
            ..Default::default()
        }
    }

    #[test]
    fn classifies_build_prompt() {
        let r = Router::default();
        let plan = r.decide("build me a coffee shop landing page", &ctx());
        assert_eq!(plan.intent, Intent::Build);
        assert!(matches!(plan.model, ModelChoice::Mercury));
        assert_eq!(plan.reasoning, ReasoningLevel::Deep);
    }

    #[test]
    fn classifies_explain_prompt() {
        let r = Router::default();
        let plan = r.decide("explain what this regex does", &ctx_with_files(&["a.ts"]));
        assert_eq!(plan.intent, Intent::Explain);
        assert!(matches!(plan.model, ModelChoice::Claude(_)));
        assert_eq!(plan.reasoning, ReasoningLevel::Light);
    }

    #[test]
    fn classifies_refactor_prompt() {
        let r = Router::default();
        let plan = r.decide("refactor this module to use the repository pattern", &ctx());
        assert_eq!(plan.intent, Intent::Refactor);
        assert!(matches!(plan.model, ModelChoice::Mercury));
    }

    #[test]
    fn classifies_debug_via_marker() {
        let r = Router::default();
        let plan = r.decide("fix the panic when nil pointer dereferences", &ctx());
        assert_eq!(plan.intent, Intent::Debug);
        assert!(matches!(plan.model, ModelChoice::Claude(_)));
        assert_eq!(plan.reasoning, ReasoningLevel::Deep);
    }

    #[test]
    fn linter_errors_force_debug() {
        let r = Router::default();
        let mut c = ctx();
        c.linter_errors_count = 3;
        // Prompt is otherwise build-shaped — context should still tip Debug.
        let plan = r.decide("build me a quick fix", &c);
        assert_eq!(plan.intent, Intent::Debug);
    }

    #[test]
    fn classifies_search_prompt() {
        let r = Router::default();
        let plan = r.decide("where is the AuthGuard defined", &ctx());
        assert_eq!(plan.intent, Intent::Search);
    }

    #[test]
    fn classifies_voice_social_ping() {
        let r = Router::default();
        let c = PromptContext {
            voice_input: true,
            ..Default::default()
        };
        let plan = r.decide("hi are you there", &c);
        assert_eq!(plan.intent, Intent::Voice);
        assert_eq!(plan.reasoning, ReasoningLevel::None);
    }

    #[test]
    fn classifies_edit_with_open_files() {
        let r = Router::default();
        let plan = r.decide(
            "change the button color to teal",
            &ctx_with_files(&["x.tsx"]),
        );
        assert_eq!(plan.intent, Intent::Edit);
        assert!(matches!(plan.model, ModelChoice::Mercury));
    }

    #[test]
    fn ambiguous_long_prompt_is_chat() {
        let r = Router::default();
        let long = "i'm curious about how distributed consensus protocols handle byzantine \
                    failures and i want to chat through the tradeoffs between practical bft \
                    raft and paxos with a focus on real-world production deployments at scale";
        let plan = r.decide(long, &ctx());
        assert_eq!(plan.intent, Intent::Chat);
        assert!(matches!(plan.model, ModelChoice::Claude(_)));
    }

    #[test]
    fn empty_prompt_is_unknown_without_voice() {
        let r = Router::default();
        let plan = r.decide("   ", &ctx());
        assert_eq!(plan.intent, Intent::Unknown);
    }

    #[test]
    fn env_override_is_respected() {
        // Set an override before constructing the router. We restore the
        // previous value at the end of the test so siblings see the same
        // environment.
        let prev = std::env::var("ERI_ROUTE_BUILD").ok();
        // SAFETY: tests in a single binary share env vars; this is the only
        // consumer of ERI_ROUTE_BUILD in this binary.
        unsafe {
            std::env::set_var("ERI_ROUTE_BUILD", "claude:claude-opus-4-5");
        }
        let r = Router::from_env();
        let plan = r.decide("build me a snake game", &ctx());
        assert_eq!(plan.intent, Intent::Build);
        match &plan.model {
            ModelChoice::Claude(id) => assert_eq!(id, "claude-opus-4-5"),
            other => panic!("expected Claude override, got {other:?}"),
        }
        match prev {
            Some(v) => unsafe { std::env::set_var("ERI_ROUTE_BUILD", v) },
            None => unsafe { std::env::remove_var("ERI_ROUTE_BUILD") },
        }
    }

    #[test]
    fn parse_model_choice_handles_mercury_and_vendors() {
        assert!(matches!(
            parse_model_choice("mercury"),
            Some(ModelChoice::Mercury)
        ));
        assert!(matches!(
            parse_model_choice("claude:claude-sonnet-4-5"),
            Some(ModelChoice::Claude(id)) if id == "claude-sonnet-4-5"
        ));
        assert!(matches!(
            parse_model_choice("openai:gpt-5"),
            Some(ModelChoice::OpenAI(id)) if id == "gpt-5"
        ));
        assert!(matches!(
            parse_model_choice("gemini:gemini-2.5-pro"),
            Some(ModelChoice::Gemini(id)) if id == "gemini-2.5-pro"
        ));
        assert!(parse_model_choice("garbage:").is_none());
        assert!(parse_model_choice("nothing").is_none());
    }

    #[test]
    fn route_function_is_independent_of_classify() {
        // Even when the caller pre-classifies (e.g. from a UI affordance),
        // routing should respect the explicit intent.
        let r = Router::default();
        let plan = r.route(Intent::Chat, "anything", &ctx());
        assert_eq!(plan.intent, Intent::Chat);
        assert!(matches!(plan.model, ModelChoice::Claude(_)));
        assert_eq!(plan.reasoning, ReasoningLevel::Light);
    }

    #[test]
    fn intent_capability_gate_is_chat_shaped_only() {
        for cap in [Intent::Chat, Intent::Voice, Intent::Search, Intent::Explain] {
            assert!(
                intent_is_local_capable(cap),
                "{cap:?} should be local-capable"
            );
        }
        for heavy in [
            Intent::Edit,
            Intent::Build,
            Intent::Refactor,
            Intent::Debug,
            Intent::Unknown,
        ] {
            assert!(
                !intent_is_local_capable(heavy),
                "{heavy:?} stays on a bigger engine"
            );
        }
    }

    #[test]
    fn local_first_choice_only_redirects_capable_intents_with_a_model() {
        let cloud = ModelChoice::Claude("claude-haiku-4-5-20251001".into());
        // No (or blank) local model -> always the fallback.
        assert!(matches!(
            local_first_choice(Intent::Chat, None, cloud.clone()),
            ModelChoice::Claude(_)
        ));
        assert!(matches!(
            local_first_choice(Intent::Chat, Some("  "), cloud.clone()),
            ModelChoice::Claude(_)
        ));
        // Local model + capable intent -> Local.
        match local_first_choice(Intent::Chat, Some("qwen2.5:1.5b"), cloud.clone()) {
            ModelChoice::Local(m) => assert_eq!(m, "qwen2.5:1.5b"),
            other => panic!("expected Local, got {other:?}"),
        }
        // Local model + heavy intent -> fallback (escalate to the bigger engine).
        assert!(matches!(
            local_first_choice(Intent::Build, Some("qwen2.5:1.5b"), ModelChoice::Mercury),
            ModelChoice::Mercury
        ));
    }

    #[test]
    fn route_is_local_first_but_explicit_override_wins() {
        // On-device model set -> Chat (capable) routes local; Build (heavy) doesn't.
        let mut router = Router::new(RouteTable::defaults());
        router.set_local_model("qwen2.5:1.5b");
        assert!(matches!(
            router.route(Intent::Chat, "hi", &ctx()).model,
            ModelChoice::Local(_)
        ));
        assert!(matches!(
            router.route(Intent::Build, "make x", &ctx()).model,
            ModelChoice::Mercury
        ));
        // An explicit override beats local-first.
        let mut table = RouteTable::defaults();
        table.set(
            Intent::Chat,
            ModelChoice::Claude("claude-haiku-4-5-20251001".into()),
        );
        table.local_model = Some("qwen2.5:1.5b".into());
        let r2 = Router::new(table);
        assert!(matches!(
            r2.route(Intent::Chat, "hi", &ctx()).model,
            ModelChoice::Claude(_)
        ));
    }
}
