//! Real tokenizer-backed token counting for eri's cost guards and budget
//! displays. Wraps `tiktoken-rs` so callers can ask "how many tokens does this
//! text use for model X?" without caring which encoder family X belongs to.
//!
//! The token count is exact for OpenAI families (gpt-4o, gpt-5, o1/o3/o4/o5,
//! gpt-4, gpt-3.5, text-embedding-*) since those use public tiktoken
//! encoders. For closed-tokenizer models (Claude, Gemini, Mercury, DeepSeek,
//! Llama, Mistral, anything else) we fall back to `cl100k_base` and flag the
//! result as `approximate = true`. Empirically `cl100k_base` is within ~5%
//! of the real count for these vendors on English prose — close enough for
//! cost rails, far better than `chars / 4`.
//!
//! Design mirrors the JS tokscale reference
//! (https://github.com/junhoyeo/tokscale) and OpenAI's tiktoken
//! (https://github.com/openai/tiktoken).

use std::sync::OnceLock;

use tiktoken_rs::CoreBPE;

/// Result of a token-counting call. The `tokenizer` field names which BPE
/// table produced the count (or `"char"` for the TTS char-billing path).
/// `approximate = true` means the model's true tokenizer is not public and
/// the number is a best-effort proxy.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct TokenCount {
    pub tokens: u32,
    pub tokenizer: &'static str,
    pub approximate: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum TokenError {
    /// Reserved for an explicit-mode API that refuses to guess. Today every
    /// public entry point falls back to `cl100k_base` for unknown models, so
    /// this variant is not constructed internally — it exists so future
    /// strict callers can distinguish "no map entry" from "tokenizer crashed".
    #[error("unknown model: {0}")]
    UnknownModel(String),
    #[error("tokenizer error: {0}")]
    Tokenizer(String),
}

/// Which tiktoken encoder a model maps to. ElevenLabs-style TTS models bill
/// per character, not per token, so we surface that with a dedicated variant
/// instead of forcing a synthetic token count.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)] // P50kBase is wired through but not yet hit by MODEL_TABLE;
                    // kept so the encoder set is complete for future additions.
enum Encoder {
    O200kBase,
    Cl100kBase,
    P50kBase,
    Char,
}

impl Encoder {
    fn name(self) -> &'static str {
        match self {
            Encoder::O200kBase => "o200k_base",
            Encoder::Cl100kBase => "cl100k_base",
            Encoder::P50kBase => "p50k_base",
            Encoder::Char => "char",
        }
    }
}

/// `(lowercased_prefix, encoder, approximate)`. First match wins, so order
/// matters: more specific OpenAI prefixes (`gpt-4o`, `gpt-5`) come before
/// the generic `gpt-4` / `gpt-3.5` row.
const MODEL_TABLE: &[(&str, Encoder, bool)] = &[
    // OpenAI o200k family — public tokenizer, exact counts.
    ("gpt-5", Encoder::O200kBase, false),
    ("gpt-4o", Encoder::O200kBase, false),
    ("o1", Encoder::O200kBase, false),
    ("o3", Encoder::O200kBase, false),
    ("o4", Encoder::O200kBase, false),
    ("o5", Encoder::O200kBase, false),
    // OpenAI cl100k family — public tokenizer, exact counts.
    ("gpt-4", Encoder::Cl100kBase, false),
    ("gpt-3.5", Encoder::Cl100kBase, false),
    ("text-embedding-", Encoder::Cl100kBase, false),
    // Closed-tokenizer vendors — cl100k_base is the conventional proxy.
    ("mercury", Encoder::Cl100kBase, true),
    ("claude", Encoder::Cl100kBase, true),
    ("gemini", Encoder::Cl100kBase, true),
    ("deepseek", Encoder::Cl100kBase, true),
    ("llama", Encoder::Cl100kBase, true),
    ("mistral", Encoder::Cl100kBase, true),
    // ElevenLabs and other TTS — billed per char, not per token.
    ("eleven_", Encoder::Char, true),
    ("eleven-", Encoder::Char, true),
];

/// Fallback used when the model string doesn't match any prefix in
/// `MODEL_TABLE`. We pick `cl100k_base` because it's the broadest-coverage
/// encoder and matches what nearly every closed-source vendor sits closest
/// to empirically.
const FALLBACK: (Encoder, bool) = (Encoder::Cl100kBase, true);

fn resolve(model: &str) -> (Encoder, bool) {
    let key = model.trim().to_ascii_lowercase();
    for (prefix, encoder, approximate) in MODEL_TABLE {
        if key.starts_with(prefix) {
            return (*encoder, *approximate);
        }
    }
    FALLBACK
}

// Encoder constructors are expensive (~50ms to parse the merge table). Cache
// each one in a `OnceLock` so the first caller pays the cost and every
// subsequent call is a pointer load. Failures bubble up as `TokenError`
// instead of panicking — the tables ship with the crate, so this only fails
// under genuinely catastrophic conditions (corrupted binary, OOM at startup).
static CL100K: OnceLock<CoreBPE> = OnceLock::new();
static O200K: OnceLock<CoreBPE> = OnceLock::new();
static P50K: OnceLock<CoreBPE> = OnceLock::new();

fn cl100k() -> Result<&'static CoreBPE, TokenError> {
    if let Some(bpe) = CL100K.get() {
        return Ok(bpe);
    }
    let bpe = tiktoken_rs::cl100k_base().map_err(|e| TokenError::Tokenizer(e.to_string()))?;
    Ok(CL100K.get_or_init(|| bpe))
}

fn o200k() -> Result<&'static CoreBPE, TokenError> {
    if let Some(bpe) = O200K.get() {
        return Ok(bpe);
    }
    let bpe = tiktoken_rs::o200k_base().map_err(|e| TokenError::Tokenizer(e.to_string()))?;
    Ok(O200K.get_or_init(|| bpe))
}

fn p50k() -> Result<&'static CoreBPE, TokenError> {
    if let Some(bpe) = P50K.get() {
        return Ok(bpe);
    }
    let bpe = tiktoken_rs::p50k_base().map_err(|e| TokenError::Tokenizer(e.to_string()))?;
    Ok(P50K.get_or_init(|| bpe))
}

fn encode_count(encoder: Encoder, text: &str) -> Result<u32, TokenError> {
    let bpe = match encoder {
        Encoder::Cl100kBase => cl100k()?,
        Encoder::O200kBase => o200k()?,
        Encoder::P50kBase => p50k()?,
        Encoder::Char => {
            // TTS-style models bill per character, not per token. We return
            // the unicode scalar count so callers can multiply by the
            // per-char rate.
            let n = text.chars().count();
            return Ok(u32::try_from(n).unwrap_or(u32::MAX));
        }
    };
    let n = bpe.encode_ordinary(text).len();
    Ok(u32::try_from(n).unwrap_or(u32::MAX))
}

/// Count the tokens that `text` would consume for `model`. Unknown models
/// fall back to `cl100k_base` with `approximate = true` so cost rails stay
/// non-zero instead of erroring out.
pub fn count_tokens(text: &str, model: &str) -> Result<TokenCount, TokenError> {
    let (encoder, approximate) = resolve(model);
    let tokens = encode_count(encoder, text)?;
    Ok(TokenCount {
        tokens,
        tokenizer: encoder.name(),
        approximate,
    })
}

/// Convenience wrapper around [`count_tokens`] that returns a `u32` and
/// degrades to the `chars / 4` heuristic when the tokenizer fails. Cost
/// telemetry and compression stats prefer never to error out — a slightly
/// inaccurate count beats a panic or a $0.00 figure on a working session.
///
/// The first time the fallback fires per process we log a warning via the
/// `log` crate so the fallback isn't silently masking a build issue.
/// Subsequent fallback hits stay quiet to avoid log spam.
///
/// This is the ONE place in the workspace where `let _ =` style swallowing
/// of the tokenizer error is acceptable: cost rails must keep running, and
/// the warning log preserves visibility.
pub fn tokens_or_fallback(text: &str, model: &str) -> u32 {
    match count_tokens(text, model) {
        Ok(count) => count.tokens,
        Err(err) => {
            log_fallback_once(model, &err);
            let chars = text.chars().count() as f64;
            (chars / 4.0).ceil() as u32
        }
    }
}

static FALLBACK_WARNED: OnceLock<()> = OnceLock::new();

fn log_fallback_once(model: &str, err: &TokenError) {
    if FALLBACK_WARNED.set(()).is_ok() {
        log::warn!(
            "eri_tokens: tokenizer failed for model {model:?} ({err}); \
             falling back to chars/4 heuristic for this and future calls \
             until process restart"
        );
    }
}

/// Vectorised form. Same encoder is resolved once and reused for every
/// element, so this is meaningfully faster than a loop over `count_tokens`.
pub fn count_tokens_batch(texts: &[&str], model: &str) -> Result<Vec<TokenCount>, TokenError> {
    let (encoder, approximate) = resolve(model);
    let tokenizer = encoder.name();
    let mut out = Vec::with_capacity(texts.len());
    for text in texts {
        let tokens = encode_count(encoder, text)?;
        out.push(TokenCount {
            tokens,
            tokenizer,
            approximate,
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_picks_o200k_for_gpt_4o() {
        let (enc, approx) = resolve("gpt-4o-mini");
        assert_eq!(enc.name(), "o200k_base");
        assert!(!approx);
    }

    #[test]
    fn resolve_falls_back_for_unknown_model() {
        let (enc, approx) = resolve("brand-new-vendor-1");
        assert_eq!(enc.name(), "cl100k_base");
        assert!(approx);
    }

    #[test]
    fn resolve_is_case_insensitive() {
        let (enc, _) = resolve("CLAUDE-3.5-SONNET");
        assert_eq!(enc.name(), "cl100k_base");
    }
}
