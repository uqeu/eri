//! Multi-LLM provider abstraction.
//!
//! Cursor's signature lets users say "use GPT-4o" / "use claude-3.5-sonnet" /
//! "use gemini" at any point. eri's existing inference stack pins Mercury 2 as
//! the inner loop and Claude Code / Goose CLIs for polish. This module adds a
//! sibling abstraction — [`LlmProvider`] — that exposes a uniform
//! `complete + stream` surface across OpenAI, Anthropic, and Google direct
//! APIs so the panel (and later, the iterator) can route a fire to whichever
//! provider the user asked for without disturbing the Mercury default.
//!
//! Mercury stays the default; the providers here are opt-in alongside it.
//!
//! Each provider:
//! * reads its API key from an env var at construction
//! * speaks the vendor's native chat/messages REST schema
//! * tokenizes via `eri_tokens` (cl100k_base proxy) and computes a $$ figure
//!   from the [`crate::costs`] constants
//! * surfaces errors as [`crate::InferenceError::Transport`] so callers don't
//!   need to learn a third error type

use crate::InferenceError;
use crate::providers;

/// Snapshot of credentials available to the inference layer.
///
/// Two parallel concepts:
/// * `eri_session` + `eri_base_url` — the bearer + URL used to talk to the
///   eri.dev inference proxy. When set, every provider call defaults to the
///   proxy so the backend can enforce tier + count tokens centrally.
/// * `*_byok` — power-user keys stored in the host's `SecretStorage`.
///   When present for a given vendor, that vendor's calls bypass the proxy
///   and hit the upstream API directly with the user's key.
///
/// The legacy `anthropic` / `openai` / `google` fields remain as aliases for
/// the BYOK keys so callers built before the proxy split keep compiling. The
/// `inception_byok` slot is new — when set it bypasses the proxy for the
/// bundled engine too.
///
/// Field names match the provider ids declared in the extension's
/// `providers.ts` so the wire vocabulary is consistent end-to-end.
#[derive(Debug, Default, Clone)]
pub struct ProviderKeys {
    /// Bearer token for the eri.dev inference proxy.
    pub eri_session: Option<String>,
    /// Base URL for the eri.dev inference proxy (defaults to the production
    /// host when constructed via `with_proxy`).
    pub eri_base_url: String,
    /// Power-user Anthropic key. Bypasses the proxy when present.
    pub anthropic_byok: Option<String>,
    /// Power-user OpenAI key. Bypasses the proxy when present.
    pub openai_byok: Option<String>,
    /// Power-user Google/Gemini key. Bypasses the proxy when present.
    pub google_byok: Option<String>,
    /// Power-user Inception/Mercury key. Bypasses the proxy when present.
    pub inception_byok: Option<String>,
}

impl ProviderKeys {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_anthropic(mut self, key: impl Into<String>) -> Self {
        self.anthropic_byok = Some(key.into());
        self
    }

    pub fn with_openai(mut self, key: impl Into<String>) -> Self {
        self.openai_byok = Some(key.into());
        self
    }

    pub fn with_google(mut self, key: impl Into<String>) -> Self {
        self.google_byok = Some(key.into());
        self
    }

    pub fn with_inception(mut self, key: impl Into<String>) -> Self {
        self.inception_byok = Some(key.into());
        self
    }

    /// Attach the eri.dev session bearer + base URL to this bundle. Both
    /// fields are required to enable the proxy code path; an absent bearer
    /// keeps the legacy BYOK-only behaviour.
    pub fn with_proxy(
        mut self,
        session: impl Into<String>,
        base_url: impl Into<String>,
    ) -> Self {
        self.eri_session = Some(session.into());
        self.eri_base_url = base_url.into();
        self
    }

    /// Back-compat alias for `anthropic_byok`. Existing call sites that
    /// peek the raw key field still compile.
    pub fn anthropic(&self) -> Option<&str> {
        self.anthropic_byok.as_deref()
    }

    pub fn openai(&self) -> Option<&str> {
        self.openai_byok.as_deref()
    }

    pub fn google(&self) -> Option<&str> {
        self.google_byok.as_deref()
    }

    /// Pick the BYOK key for a canonical model id. Returns `None` when the
    /// model is not external (e.g. "mercury-2") or when the user has not
    /// configured a BYOK key for the corresponding vendor.
    pub fn for_canonical(&self, canonical: &str) -> Option<&str> {
        let vendor = vendor_for_canonical(canonical)?;
        match vendor {
            "anthropic" => self.anthropic_byok.as_deref(),
            "openai" => self.openai_byok.as_deref(),
            "google" => self.google_byok.as_deref(),
            _ => None,
        }
    }

    /// Decide whether a given provider should route through the eri.dev
    /// proxy. True when the user has a session bearer AND has not configured
    /// a BYOK key for that vendor. The `provider` argument is the short id
    /// (`"anthropic"`, `"openai"`, `"google"`, `"inception"`).
    pub fn use_proxy(&self, provider: &str) -> bool {
        let has_session = self.eri_session.is_some() && !self.eri_base_url.is_empty();
        if !has_session {
            return false;
        }
        match provider {
            "anthropic" => self.anthropic_byok.is_none(),
            "openai" => self.openai_byok.is_none(),
            "google" => self.google_byok.is_none(),
            "inception" => self.inception_byok.is_none(),
            _ => false,
        }
    }
}

fn vendor_for_canonical(canonical: &str) -> Option<&'static str> {
    match canonical {
        "claude-sonnet-4-5" | "claude-haiku-4-5" | "claude-opus-4-5" => Some("anthropic"),
        "gpt-4o" | "gpt-4o-mini" | "o1-mini" | "o3-mini" | "o4" => Some("openai"),
        "gemini-flash-2" | "gemini-thinking-2" => Some("google"),
        _ => None,
    }
}

/// Response envelope shared by every provider. `cost_usd` is computed locally
/// from token counts (the providers don't return $$ in their wire format), so
/// it's a best-effort figure that the cost guard can layer into the running
/// session total.
#[derive(Debug, Clone, PartialEq)]
pub struct LlmResponse {
    pub text: String,
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub cost_usd: f64,
}

/// Uniform LLM completion surface. Implementors are responsible for their own
/// HTTP transport, request serialization, response parsing, and cost math.
///
/// `name()` returns the short provider id ("openai", "anthropic", "google")
/// and `model()` returns the wire model id ("gpt-4o", "claude-sonnet-4-5",
/// "gemini-2.0-flash-exp"). The panel surfaces both in status lines.
pub trait LlmProvider: Send + Sync {
    fn name(&self) -> &'static str;
    fn model(&self) -> &str;

    /// Single-shot completion. Returns the assembled assistant text plus
    /// usage / cost telemetry.
    fn complete(
        &self,
        system: &str,
        user: &str,
        max_tokens: u32,
    ) -> Result<LlmResponse, InferenceError>;

    /// Streaming completion. `on_token` fires once per delta chunk; the final
    /// [`LlmResponse`] still carries the fully concatenated `text`.
    fn stream(
        &self,
        system: &str,
        user: &str,
        max_tokens: u32,
        on_token: &mut dyn FnMut(&str),
    ) -> Result<LlmResponse, InferenceError>;
}

/// Stable list of provider ids the voice command parser recognizes. The panel
/// can render this verbatim in response to "list models". Mercury is included
/// so users can switch back to the default explicitly.
pub fn list_providers() -> Vec<&'static str> {
    vec![
        "mercury-2",
        "gpt-4o",
        "gpt-4o-mini",
        "o1-mini",
        "o3-mini",
        "o4",
        "claude-sonnet-4-5",
        "claude-haiku-4-5",
        "claude-opus-4-5",
        "gemini-flash-2",
        "gemini-thinking-2",
    ]
}

/// Resolve a user-facing model choice into a concrete [`LlmProvider`] box.
///
/// Accepts both the canonical id ("gpt-4o", "claude-sonnet-4-5") and the
/// fuzzy spoken variants the voice parser produces ("chatgpt", "claude",
/// "gemini"). Returns `None` if the choice doesn't map to a provider or if
/// the required API key env var is missing — callers should surface a
/// readable status line in that case rather than failing the whole fire.
///
/// `"mercury-2"` returns `None` because Mercury already has its own backend
/// path; the panel uses the registry to detect provider switches, not to
/// replace Mercury.
pub fn provider_from_choice(choice: &str) -> Option<Box<dyn LlmProvider>> {
    provider_from_choice_inner(choice, None)
}

/// Variant of [`provider_from_choice`] that resolves the API key from a
/// pre-fetched [`ProviderKeys`] bundle instead of process env vars. The
/// sidecar populates `keys` via the `settings/getSecret` JSON-RPC call to
/// the extension's `SecretStorage`, then hands it here so the construction
/// chain never has to read env vars on the BYOK path.
///
/// Falls back to the env-var constructor when the bundle does not carry a
/// key for the chosen vendor — this preserves the legacy DX where a
/// developer can drop `OPENAI_API_KEY=...` in `.env` and have it Just Work.
pub fn provider_from_choice_with_keys(
    choice: &str,
    keys: &ProviderKeys,
) -> Option<Box<dyn LlmProvider>> {
    provider_from_choice_inner(choice, Some(keys))
}

fn provider_from_choice_inner(
    choice: &str,
    keys: Option<&ProviderKeys>,
) -> Option<Box<dyn LlmProvider>> {
    let canonical = canonical_model_id(choice)?;
    if canonical == "mercury-2" {
        return None;
    }
    let supplied = keys.and_then(|k| k.for_canonical(canonical));
    match (canonical, supplied) {
        ("gpt-4o", Some(key)) => {
            providers::openai::OpenAiProvider::for_model_with_key("gpt-4o", key)
                .ok()
                .map(|p| Box::new(p) as Box<dyn LlmProvider>)
        }
        ("gpt-4o-mini", Some(key)) => {
            providers::openai::OpenAiProvider::for_model_with_key("gpt-4o-mini", key)
                .ok()
                .map(|p| Box::new(p) as Box<dyn LlmProvider>)
        }
        ("o1-mini", Some(key)) => {
            providers::openai::OpenAiProvider::for_model_with_key("o1-mini", key)
                .ok()
                .map(|p| Box::new(p) as Box<dyn LlmProvider>)
        }
        ("o3-mini", Some(key)) => {
            providers::openai::OpenAiProvider::for_model_with_key("o3-mini", key)
                .ok()
                .map(|p| Box::new(p) as Box<dyn LlmProvider>)
        }
        ("o4", Some(key)) => providers::openai::OpenAiProvider::for_model_with_key("o4", key)
            .ok()
            .map(|p| Box::new(p) as Box<dyn LlmProvider>),
        ("claude-sonnet-4-5", Some(key)) => {
            providers::anthropic::AnthropicProvider::for_model_with_key(
                "claude-sonnet-4-5-20251015",
                key,
            )
            .ok()
            .map(|p| Box::new(p) as Box<dyn LlmProvider>)
        }
        ("claude-haiku-4-5", Some(key)) => {
            providers::anthropic::AnthropicProvider::for_model_with_key(
                "claude-haiku-4-5-20251001",
                key,
            )
            .ok()
            .map(|p| Box::new(p) as Box<dyn LlmProvider>)
        }
        ("claude-opus-4-5", Some(key)) => {
            providers::anthropic::AnthropicProvider::for_model_with_key("claude-opus-4-5", key)
                .ok()
                .map(|p| Box::new(p) as Box<dyn LlmProvider>)
        }
        ("gemini-flash-2", Some(key)) => {
            providers::gemini::GeminiProvider::for_model_with_key("gemini-2.0-flash-exp", key)
                .ok()
                .map(|p| Box::new(p) as Box<dyn LlmProvider>)
        }
        ("gemini-thinking-2", Some(key)) => providers::gemini::GeminiProvider::for_model_with_key(
            "gemini-2.0-flash-thinking-exp",
            key,
        )
        .ok()
        .map(|p| Box::new(p) as Box<dyn LlmProvider>),
        // Either no caller-supplied key for this vendor or no `keys`
        // bundle at all — fall through to env-based resolution.
        (canonical, _) => provider_from_choice_env(canonical),
    }
}

fn provider_from_choice_env(canonical: &str) -> Option<Box<dyn LlmProvider>> {
    match canonical {
        "mercury-2" => None,
        "gpt-4o" => providers::openai::OpenAiProvider::for_model("gpt-4o")
            .ok()
            .map(|p| Box::new(p) as Box<dyn LlmProvider>),
        "gpt-4o-mini" => providers::openai::OpenAiProvider::for_model("gpt-4o-mini")
            .ok()
            .map(|p| Box::new(p) as Box<dyn LlmProvider>),
        "o1-mini" => providers::openai::OpenAiProvider::for_model("o1-mini")
            .ok()
            .map(|p| Box::new(p) as Box<dyn LlmProvider>),
        "o3-mini" => providers::openai::OpenAiProvider::for_model("o3-mini")
            .ok()
            .map(|p| Box::new(p) as Box<dyn LlmProvider>),
        "o4" => providers::openai::OpenAiProvider::for_model("o4")
            .ok()
            .map(|p| Box::new(p) as Box<dyn LlmProvider>),
        "claude-sonnet-4-5" => {
            providers::anthropic::AnthropicProvider::for_model("claude-sonnet-4-5-20251015")
                .ok()
                .map(|p| Box::new(p) as Box<dyn LlmProvider>)
        }
        "claude-haiku-4-5" => {
            providers::anthropic::AnthropicProvider::for_model("claude-haiku-4-5-20251001")
                .ok()
                .map(|p| Box::new(p) as Box<dyn LlmProvider>)
        }
        "claude-opus-4-5" => providers::anthropic::AnthropicProvider::for_model("claude-opus-4-5")
            .ok()
            .map(|p| Box::new(p) as Box<dyn LlmProvider>),
        "gemini-flash-2" => providers::gemini::GeminiProvider::for_model("gemini-2.0-flash-exp")
            .ok()
            .map(|p| Box::new(p) as Box<dyn LlmProvider>),
        "gemini-thinking-2" => {
            providers::gemini::GeminiProvider::for_model("gemini-2.0-flash-thinking-exp")
                .ok()
                .map(|p| Box::new(p) as Box<dyn LlmProvider>)
        }
        _ => None,
    }
}

/// Map fuzzy/spoken model phrases to the canonical id used by
/// [`provider_from_choice`]. Returns `None` for entirely unknown phrases so
/// the parser can decide whether to fall through.
///
/// Matching is intentionally generous: voice transcription drops hyphens,
/// breaks "gpt-4o" into "gpt 4 oh", and so on. Anything containing "mercury"
/// snaps back to the default model; anything containing "gpt" / "chat gpt"
/// maps to a GPT variant; anything containing "claude" maps to a Claude
/// variant; "gemini" → Gemini.
pub fn canonical_model_id(choice: &str) -> Option<&'static str> {
    let lowered = choice.trim().to_ascii_lowercase();
    if lowered.is_empty() {
        return None;
    }
    // Strip hyphens / dots so "gpt-4o" and "gpt 4o" both normalize the same.
    let normalized: String = lowered
        .chars()
        .map(|c| {
            if c == '-' || c == '.' || c == '_' {
                ' '
            } else {
                c
            }
        })
        .collect();
    let squashed: String = normalized.split_whitespace().collect::<Vec<_>>().join(" ");
    let s = squashed.as_str();

    // Direct canonical ids.
    let canonical = [
        "mercury-2",
        "gpt-4o",
        "gpt-4o-mini",
        "o1-mini",
        "o3-mini",
        "o4",
        "claude-sonnet-4-5",
        "claude-haiku-4-5",
        "claude-opus-4-5",
        "gemini-flash-2",
        "gemini-thinking-2",
    ];
    for &id in &canonical {
        let id_norm: String = id.chars().map(|c| if c == '-' { ' ' } else { c }).collect();
        if s == id_norm {
            return Some(id);
        }
    }

    // Mercury default.
    if s.contains("mercury") || s.contains("default") {
        return Some("mercury-2");
    }
    // Gemini family.
    if s.contains("gemini") {
        if s.contains("think") {
            return Some("gemini-thinking-2");
        }
        return Some("gemini-flash-2");
    }
    // Claude family — check Anthropic's tier names before falling back to
    // sonnet so "use claude haiku" doesn't degrade to the default sonnet.
    if s.contains("claude") || s.contains("anthropic") {
        if s.contains("haiku") {
            return Some("claude-haiku-4-5");
        }
        if s.contains("opus") {
            return Some("claude-opus-4-5");
        }
        return Some("claude-sonnet-4-5");
    }
    // OpenAI family. "o1", "o3", "o4" reasoning ids come first so the bare
    // "o4" doesn't get swallowed by the gpt branch below.
    if s == "o4" || s.contains("o 4") || s.contains("o4 mini") {
        // "o4 mini" isn't a public model yet — collapse to o4.
        return Some("o4");
    }
    if s.contains("o3") || s.contains("o 3") {
        return Some("o3-mini");
    }
    if s.contains("o1") || s.contains("o 1") {
        return Some("o1-mini");
    }
    if s.contains("gpt") || s.contains("chatgpt") || s.contains("openai") {
        if s.contains("mini") || s.contains("4o mini") || s.contains("4 mini") {
            return Some("gpt-4o-mini");
        }
        return Some("gpt-4o");
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_from_choice_fuzzy_matches_gpt4o() {
        // No env key set in unit tests, so we only verify the canonical
        // mapping. The provider itself is constructed lazily inside
        // `provider_from_choice` and returns `None` when the key is missing —
        // but the canonical-id resolver must still recognize the phrase.
        assert_eq!(canonical_model_id("use gpt-4o"), Some("gpt-4o"));
        assert_eq!(canonical_model_id("chat gpt"), Some("gpt-4o"));
        assert_eq!(canonical_model_id("GPT-4o"), Some("gpt-4o"));
        assert_eq!(canonical_model_id("gpt 4o mini"), Some("gpt-4o-mini"));
    }

    #[test]
    fn provider_from_choice_returns_none_for_unknown() {
        assert_eq!(canonical_model_id("banana model"), None);
        assert!(provider_from_choice("banana model").is_none());
        assert!(provider_from_choice("").is_none());
    }

    #[test]
    fn canonical_model_id_recognizes_claude_haiku() {
        assert_eq!(
            canonical_model_id("use claude haiku"),
            Some("claude-haiku-4-5")
        );
        assert_eq!(
            canonical_model_id("switch to claude"),
            Some("claude-sonnet-4-5")
        );
        assert_eq!(canonical_model_id("claude opus"), Some("claude-opus-4-5"));
    }

    #[test]
    fn canonical_model_id_recognizes_gemini() {
        assert_eq!(canonical_model_id("use gemini"), Some("gemini-flash-2"));
        assert_eq!(canonical_model_id("gemini flash"), Some("gemini-flash-2"));
        assert_eq!(
            canonical_model_id("gemini thinking"),
            Some("gemini-thinking-2")
        );
    }

    #[test]
    fn canonical_model_id_recognizes_mercury_default() {
        assert_eq!(canonical_model_id("mercury"), Some("mercury-2"));
        assert_eq!(
            canonical_model_id("switch back to mercury"),
            Some("mercury-2")
        );
    }

    #[test]
    fn list_providers_includes_default_and_all_external() {
        let providers = list_providers();
        assert!(providers.contains(&"mercury-2"));
        assert!(providers.contains(&"gpt-4o"));
        assert!(providers.contains(&"claude-sonnet-4-5"));
        assert!(providers.contains(&"gemini-flash-2"));
    }

    #[test]
    fn provider_keys_routes_canonical_to_vendor() {
        let keys = ProviderKeys::new()
            .with_anthropic("ak")
            .with_openai("ok")
            .with_google("gk");
        assert_eq!(keys.for_canonical("claude-sonnet-4-5"), Some("ak"));
        assert_eq!(keys.for_canonical("gpt-4o-mini"), Some("ok"));
        assert_eq!(keys.for_canonical("gemini-flash-2"), Some("gk"));
        assert_eq!(keys.for_canonical("mercury-2"), None);
        assert_eq!(keys.for_canonical("unknown"), None);
    }

    #[test]
    fn provider_from_choice_with_keys_uses_supplied_key() {
        // With an explicit key in the bundle, construction succeeds even
        // when no env var is set (the env var path is bypassed entirely).
        let keys = ProviderKeys::new().with_anthropic("sk-ant-test-only");
        let provider = provider_from_choice_with_keys("claude sonnet", &keys);
        assert!(provider.is_some(), "explicit key must build the provider");
        let provider = provider.expect("provider");
        assert_eq!(provider.name(), "anthropic");
    }

    #[test]
    fn use_proxy_requires_session_and_no_byok_for_vendor() {
        // No session → never proxy.
        let bare = ProviderKeys::new();
        assert!(!bare.use_proxy("anthropic"));
        assert!(!bare.use_proxy("openai"));
        assert!(!bare.use_proxy("google"));
        assert!(!bare.use_proxy("inception"));

        // Session present, no BYOK for any vendor → proxy for all four.
        let signed_in = ProviderKeys::new().with_proxy("tok", "https://eri.dev");
        assert!(signed_in.use_proxy("anthropic"));
        assert!(signed_in.use_proxy("openai"));
        assert!(signed_in.use_proxy("google"));
        assert!(signed_in.use_proxy("inception"));

        // Session + Anthropic BYOK → Anthropic bypasses, others proxy.
        let mixed = ProviderKeys::new()
            .with_proxy("tok", "https://eri.dev")
            .with_anthropic("sk-ant");
        assert!(!mixed.use_proxy("anthropic"));
        assert!(mixed.use_proxy("openai"));
        assert!(mixed.use_proxy("google"));
        assert!(mixed.use_proxy("inception"));

        // Unknown vendor → never proxy.
        assert!(!signed_in.use_proxy("xai"));
    }

    #[test]
    fn provider_from_choice_with_keys_falls_through_to_env_when_missing() {
        // Empty bundle + no env -> same fallback behaviour as the env-only
        // variant: a missing key returns None instead of panicking.
        let keys = ProviderKeys::new();
        // We can't guarantee env is unset in CI, so just assert no panic
        // and a stable return shape.
        let _ = provider_from_choice_with_keys("mercury", &keys);
        assert!(provider_from_choice_with_keys("banana", &keys).is_none());
    }
}
