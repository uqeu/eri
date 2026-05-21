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
    let canonical = canonical_model_id(choice)?;
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
        .map(|c| if c == '-' || c == '.' || c == '_' { ' ' } else { c })
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
        let id_norm: String = id
            .chars()
            .map(|c| if c == '-' { ' ' } else { c })
            .collect();
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
        assert_eq!(canonical_model_id("use claude haiku"), Some("claude-haiku-4-5"));
        assert_eq!(canonical_model_id("switch to claude"), Some("claude-sonnet-4-5"));
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
        assert_eq!(canonical_model_id("switch back to mercury"), Some("mercury-2"));
    }

    #[test]
    fn list_providers_includes_default_and_all_external() {
        let providers = list_providers();
        assert!(providers.contains(&"mercury-2"));
        assert!(providers.contains(&"gpt-4o"));
        assert!(providers.contains(&"claude-sonnet-4-5"));
        assert!(providers.contains(&"gemini-flash-2"));
    }
}
