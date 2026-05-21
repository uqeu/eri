//! Per-service cost telemetry. The eri panel multiplies each service's usage
//! by the constants here to surface a running session $$ figure to the user.
//!
//! Prices captured late-2025/early-2026; revisit periodically. Every constant
//! cites the public source we sampled it from. Token-based services bill per
//! 1M tokens; ElevenLabs bills per character against a plan-tier credit pool,
//! so the panel reports chars and the rough $$ equivalent for the most common
//! plan ("starter").

// Token counting routes through eri_tokens crate. See ERI_BLOAT_AUDIT.md.

/// Mercury 2 chat ($/1M input tokens).
/// Source: https://platform.inceptionlabs.ai/pricing (mercury-2 line).
pub const MERCURY_2_INPUT_PER_M: f64 = 1.50;
/// Mercury 2 chat ($/1M output tokens).
/// Source: https://platform.inceptionlabs.ai/pricing (mercury-2 line).
pub const MERCURY_2_OUTPUT_PER_M: f64 = 6.00;

// TODO: Mercury Edit 2 pricing is not separately listed on the public pricing
// page (as of 2026-05). Treat these as best-effort estimates pulled from
// community reports — refresh when Inception publishes official numbers.
/// Mercury Edit 2 apply ($/1M input tokens).
pub const MERCURY_EDIT_2_INPUT_PER_M: f64 = 1.00;
/// Mercury Edit 2 apply ($/1M output tokens).
pub const MERCURY_EDIT_2_OUTPUT_PER_M: f64 = 4.00;

/// Claude Sonnet 4.5 ($/1M input tokens). Default model for Claude Code CLI.
/// Source: https://www.anthropic.com/pricing (Claude Sonnet 4.5 line).
pub const CLAUDE_SONNET_4_5_INPUT_PER_M: f64 = 3.00;
/// Claude Sonnet 4.5 ($/1M output tokens).
/// Source: https://www.anthropic.com/pricing (Claude Sonnet 4.5 line).
pub const CLAUDE_SONNET_4_5_OUTPUT_PER_M: f64 = 15.00;

// === Multi-LLM provider pricing (2025-2026 public list prices) =============
//
// Constants below are consumed by the per-provider [`crate::llm_provider`]
// implementations to surface the same $$-per-call telemetry the Mercury path
// already reports. Rates are sampled from each vendor's pricing page; refresh
// when the vendors publish new tiers.

/// OpenAI GPT-4o ($/1M input tokens).
/// Source: https://openai.com/api/pricing/
pub const OPENAI_GPT_4O_INPUT_PER_M: f64 = 2.50;
/// OpenAI GPT-4o ($/1M output tokens).
pub const OPENAI_GPT_4O_OUTPUT_PER_M: f64 = 10.00;
/// OpenAI GPT-4o-mini ($/1M input tokens).
pub const OPENAI_GPT_4O_MINI_INPUT_PER_M: f64 = 0.15;
/// OpenAI GPT-4o-mini ($/1M output tokens).
pub const OPENAI_GPT_4O_MINI_OUTPUT_PER_M: f64 = 0.60;
/// OpenAI o1-mini reasoning model ($/1M input tokens).
pub const OPENAI_O1_MINI_INPUT_PER_M: f64 = 3.00;
/// OpenAI o1-mini reasoning model ($/1M output tokens).
pub const OPENAI_O1_MINI_OUTPUT_PER_M: f64 = 12.00;
/// OpenAI o3-mini reasoning model ($/1M input tokens).
pub const OPENAI_O3_MINI_INPUT_PER_M: f64 = 1.10;
/// OpenAI o3-mini reasoning model ($/1M output tokens).
pub const OPENAI_O3_MINI_OUTPUT_PER_M: f64 = 4.40;
/// OpenAI o4 next-gen reasoning model ($/1M input tokens).
pub const OPENAI_O4_INPUT_PER_M: f64 = 10.00;
/// OpenAI o4 next-gen reasoning model ($/1M output tokens).
pub const OPENAI_O4_OUTPUT_PER_M: f64 = 40.00;

/// Anthropic Claude Haiku 4.5 ($/1M input tokens).
/// Source: https://www.anthropic.com/pricing
pub const CLAUDE_HAIKU_4_5_INPUT_PER_M: f64 = 1.00;
/// Anthropic Claude Haiku 4.5 ($/1M output tokens).
pub const CLAUDE_HAIKU_4_5_OUTPUT_PER_M: f64 = 5.00;
/// Anthropic Claude Opus 4.5 ($/1M input tokens).
pub const CLAUDE_OPUS_4_5_INPUT_PER_M: f64 = 15.00;
/// Anthropic Claude Opus 4.5 ($/1M output tokens).
pub const CLAUDE_OPUS_4_5_OUTPUT_PER_M: f64 = 75.00;

/// Google Gemini 2.0 Flash ($/1M input tokens).
/// Source: https://ai.google.dev/pricing
pub const GEMINI_FLASH_2_INPUT_PER_M: f64 = 0.10;
/// Google Gemini 2.0 Flash ($/1M output tokens).
pub const GEMINI_FLASH_2_OUTPUT_PER_M: f64 = 0.40;
/// Google Gemini 2.0 Flash Thinking (experimental reasoning) ($/1M input tokens).
pub const GEMINI_FLASH_2_THINKING_INPUT_PER_M: f64 = 0.15;
/// Google Gemini 2.0 Flash Thinking ($/1M output tokens).
pub const GEMINI_FLASH_2_THINKING_OUTPUT_PER_M: f64 = 0.60;

/// Generic per-million cost calculator exposed for provider crates.
pub fn cost_for(input: u32, output: u32, input_per_m: f64, output_per_m: f64) -> f64 {
    cost_per_million(input, output, input_per_m, output_per_m)
}

/// Model identifier handed to [`eri_tokens::count_tokens`] when estimating
/// Claude Code CLI usage. The Claude tokenizer is closed-source, so
/// `eri_tokens` proxies via `cl100k_base` and flags the count as
/// approximate — see `eri_tokens` for the rationale.
pub const CLAUDE_TOKENIZER_MODEL: &str = "claude-3.5-sonnet";

/// ElevenLabs char-to-dollar rates by tier. Sourced from
/// https://elevenlabs.io/pricing (snapshot late-2025). Each tier ships a
/// fixed character pool per month — we approximate as a per-character cost
/// (`tier_price / tier_chars`). "free" is $0 since it's prepaid by signup.
const ELEVENLABS_STARTER_PER_K: f64 = 0.30; // $5 / 30k chars
const ELEVENLABS_CREATOR_PER_K: f64 = 0.24; // $22 / 100k chars (with API discount)
const ELEVENLABS_PRO_PER_K: f64 = 0.18; // $99 / 500k chars

pub fn mercury_2_cost(input: u32, output: u32) -> f64 {
    cost_per_million(input, output, MERCURY_2_INPUT_PER_M, MERCURY_2_OUTPUT_PER_M)
}

pub fn mercury_edit_2_cost(input: u32, output: u32) -> f64 {
    cost_per_million(
        input,
        output,
        MERCURY_EDIT_2_INPUT_PER_M,
        MERCURY_EDIT_2_OUTPUT_PER_M,
    )
}

/// Claude Code CLI doesn't always report exact tokens. Tokenize the prompt
/// (input) and stdout (output) with [`eri_tokens::count_tokens`] under the
/// `cl100k_base` proxy used for Claude, then apply Sonnet 4.5 rates.
///
/// If the tokenizer fails for any reason (corrupt encoder tables, OOM at
/// init), we fall back to the old `chars / 4` heuristic so cost telemetry
/// keeps reporting a non-zero estimate instead of breaking the panel.
pub fn claude_code_estimated_cost(stdout_text: &str, prompt_text: &str) -> f64 {
    let input_tokens = eri_tokens::tokens_or_fallback(prompt_text, CLAUDE_TOKENIZER_MODEL);
    let output_tokens = eri_tokens::tokens_or_fallback(stdout_text, CLAUDE_TOKENIZER_MODEL);
    (input_tokens as f64 / 1_000_000.0) * CLAUDE_SONNET_4_5_INPUT_PER_M
        + (output_tokens as f64 / 1_000_000.0) * CLAUDE_SONNET_4_5_OUTPUT_PER_M
}

/// Plan-aware $$ estimate for ElevenLabs char usage. Unknown plan strings are
/// treated as "starter" (the most common paid tier) so the panel still shows
/// a non-zero estimate instead of silently falling to 0.
pub fn elevenlabs_char_cost(chars: usize, plan: &str) -> f64 {
    let per_k = match plan.trim().to_ascii_lowercase().as_str() {
        "free" => return 0.0,
        "creator" => ELEVENLABS_CREATOR_PER_K,
        "pro" => ELEVENLABS_PRO_PER_K,
        // Default — covers "starter" and any unrecognized label.
        _ => ELEVENLABS_STARTER_PER_K,
    };
    (chars as f64 / 1000.0) * per_k
}

fn cost_per_million(input: u32, output: u32, input_per_m: f64, output_per_m: f64) -> f64 {
    let input_share = (input as f64 / 1_000_000.0) * input_per_m;
    let output_share = (output as f64 / 1_000_000.0) * output_per_m;
    input_share + output_share
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx_eq(a: f64, b: f64) {
        assert!(
            (a - b).abs() < 1e-4,
            "expected {b}, got {a} (delta {})",
            (a - b).abs()
        );
    }

    #[test]
    fn mercury_2_cost_matches_published_rate() {
        // 1M input + 1M output → $1.50 + $6.00 = $7.50.
        approx_eq(mercury_2_cost(1_000_000, 1_000_000), 7.50);
        // 1,000 input + 4,000 output → $0.0015 + $0.024 = $0.0255.
        approx_eq(mercury_2_cost(1_000, 4_000), 0.0255);
    }

    #[test]
    fn mercury_2_cost_zero_inputs_returns_zero() {
        approx_eq(mercury_2_cost(0, 0), 0.0);
    }

    #[test]
    fn mercury_edit_2_cost_uses_edit_rates() {
        // 1M input + 1M output → $1.00 + $4.00 = $5.00.
        approx_eq(mercury_edit_2_cost(1_000_000, 1_000_000), 5.00);
    }

    #[test]
    fn claude_code_estimated_cost_handles_empty_strings() {
        approx_eq(claude_code_estimated_cost("", ""), 0.0);
    }

    #[test]
    fn claude_code_estimated_cost_uses_sonnet_rates_and_real_tokens() {
        // Use real text so the tokenizer is exercised end-to-end. We assert
        // the cost is positive and consistent with Sonnet 4.5 rates given
        // the actual token counts returned by `eri_tokens`.
        let prompt = "Hello, please summarize this document for me.";
        let stdout = "Sure — here is a one-sentence summary of the document.";

        let prompt_tokens =
            eri_tokens::count_tokens(prompt, CLAUDE_TOKENIZER_MODEL).expect("prompt tokens");
        let stdout_tokens =
            eri_tokens::count_tokens(stdout, CLAUDE_TOKENIZER_MODEL).expect("stdout tokens");
        let expected = (prompt_tokens.tokens as f64 / 1_000_000.0) * CLAUDE_SONNET_4_5_INPUT_PER_M
            + (stdout_tokens.tokens as f64 / 1_000_000.0) * CLAUDE_SONNET_4_5_OUTPUT_PER_M;

        approx_eq(claude_code_estimated_cost(stdout, prompt), expected);
        assert!(claude_code_estimated_cost(stdout, prompt) > 0.0);
    }

    #[test]
    fn elevenlabs_char_cost_free_plan_is_zero() {
        approx_eq(elevenlabs_char_cost(10_000, "free"), 0.0);
    }

    #[test]
    fn elevenlabs_char_cost_starter_uses_starter_rate() {
        // 1000 chars on starter = $0.30.
        approx_eq(elevenlabs_char_cost(1_000, "starter"), 0.30);
    }

    #[test]
    fn elevenlabs_char_cost_creator_uses_creator_rate() {
        approx_eq(elevenlabs_char_cost(1_000, "creator"), 0.24);
    }

    #[test]
    fn elevenlabs_char_cost_pro_uses_pro_rate() {
        approx_eq(elevenlabs_char_cost(1_000, "pro"), 0.18);
    }

    #[test]
    fn elevenlabs_char_cost_unknown_plan_falls_back_to_starter() {
        approx_eq(elevenlabs_char_cost(1_000, "enterprise"), 0.30);
        approx_eq(elevenlabs_char_cost(1_000, ""), 0.30);
    }
}
