//! Context-window budgeter for eri's brain layer.
//!
//! Given a target model (with a known context window and reserved output
//! budget) and a list of prompt parts with priorities, [`Budgeter::fit`]
//! returns a trimmed set of parts that will fit inside the prompt half of
//! the window. Mandatory parts (`priority = 0`) are never dropped — if they
//! alone exceed the budget, fitting fails fast with a typed error.
//!
//! Tokenization is delegated to `eri_tokens` for Cl100k-family models
//! (Claude, GPT-4/3.5, Gemini, Mercury proxy) and falls back to a cheap
//! `chars / 4` estimate for Llama3 and unknown encoders. No new tokenizer
//! dependencies are introduced.

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Which tokenizer the budgeter should use when counting tokens. Mirrors the
/// public encoder families recognised by `eri_tokens`, plus a `Llama3`
/// placeholder and a pure character estimate for the absolute fallback.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum TokenizerKind {
    /// `cl100k_base` — Claude 3.x family, GPT-4, GPT-3.5, Gemini proxy.
    Cl100k,
    /// Named tiktoken encoder (e.g. `"o200k_base"` for GPT-5/o-series).
    /// The string is matched against `eri_tokens`' model table.
    Tiktoken(String),
    /// Llama3-family models — no public tokenizer dep, so estimate via
    /// `chars / 4` (slightly conservative for English prose).
    Llama3,
    /// Pure character-based estimate. Last-resort fallback that never panics.
    Estimate,
}

/// Static profile for a target inference model.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelProfile {
    pub name: String,
    /// Total tokens the model can attend over (input + output).
    pub context_window: usize,
    /// Reserved for the model's response. The input budget is
    /// `context_window - max_output`.
    pub max_output: usize,
    pub tokenizer: TokenizerKind,
}

impl ModelProfile {
    /// Tokens available for the prompt half of the context window.
    pub fn input_budget(&self) -> usize {
        self.context_window.saturating_sub(self.max_output)
    }
}

/// A labelled piece of prompt content with a drop priority.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BudgetPart {
    pub label: String,
    /// `0` is mandatory (never dropped). Higher numbers are dropped first.
    pub priority: i32,
    pub text: String,
    /// When set, the budgeter will truncate this part down to (approximately)
    /// this many tokens before dropping it entirely. Ignored for mandatory
    /// parts.
    pub min_keep_tokens: Option<usize>,
}

impl BudgetPart {
    pub fn new(label: impl Into<String>, priority: i32, text: impl Into<String>) -> Self {
        Self {
            label: label.into(),
            priority,
            text: text.into(),
            min_keep_tokens: None,
        }
    }

    pub fn with_min_keep(mut self, tokens: usize) -> Self {
        self.min_keep_tokens = Some(tokens);
        self
    }
}

/// Errors that can occur when fitting prompt parts to a model's context.
#[derive(Debug, Error)]
pub enum BudgetError {
    #[error(
        "mandatory prompt parts exceed input budget: {required} > {budget} (model {model:?})"
    )]
    MandatoryOverflow {
        required: usize,
        budget: usize,
        model: String,
    },
}

/// Budgeter for a single model profile. Cheap to clone (just metadata).
#[derive(Clone, Debug)]
pub struct Budgeter {
    model: ModelProfile,
}

impl Budgeter {
    pub fn new(model: ModelProfile) -> Self {
        Self { model }
    }

    pub fn model(&self) -> &ModelProfile {
        &self.model
    }

    /// Count the tokens `text` would consume under the configured tokenizer.
    pub fn count(&self, text: &str) -> usize {
        count_tokens(&self.model.tokenizer, text)
    }

    /// Fit `parts` into the model's input budget.
    ///
    /// Algorithm:
    /// 1. Sum mandatory parts (priority 0). If they exceed the budget, return
    ///    [`BudgetError::MandatoryOverflow`].
    /// 2. Sort the remainder by ascending priority and add them greedily.
    /// 3. When a part doesn't fit, try to truncate it to `min_keep_tokens`.
    ///    If even that doesn't fit, drop it.
    /// 4. Preserve the original input order in the returned vec so callers
    ///    can stitch parts back together deterministically.
    pub fn fit(&self, parts: Vec<BudgetPart>) -> Result<Vec<BudgetPart>, BudgetError> {
        let budget = self.model.input_budget();
        let mut indexed: Vec<(usize, BudgetPart)> = parts.into_iter().enumerate().collect();

        // Stable partition: mandatory (priority == 0) vs optional.
        let mandatory_total: usize = indexed
            .iter()
            .filter(|(_, p)| p.priority == 0)
            .map(|(_, p)| self.count(&p.text))
            .sum();
        if mandatory_total > budget {
            return Err(BudgetError::MandatoryOverflow {
                required: mandatory_total,
                budget,
                model: self.model.name.clone(),
            });
        }

        // Greedy add by ascending priority. Optional parts are stable-sorted
        // by (priority asc, original_index asc) so deterministic across runs.
        let mut optional_order: Vec<usize> = indexed
            .iter()
            .enumerate()
            .filter(|(_, (_, p))| p.priority != 0)
            .map(|(i, _)| i)
            .collect();
        optional_order.sort_by(|&a, &b| {
            let pa = indexed[a].1.priority;
            let pb = indexed[b].1.priority;
            pa.cmp(&pb).then(indexed[a].0.cmp(&indexed[b].0))
        });

        let mut remaining = budget - mandatory_total;
        let mut keep: Vec<bool> = vec![false; indexed.len()];
        // Mandatory parts are always kept verbatim.
        for (i, (_, part)) in indexed.iter().enumerate() {
            if part.priority == 0 {
                keep[i] = true;
            }
        }

        for i in optional_order {
            let cost = self.count(&indexed[i].1.text);
            if cost <= remaining {
                keep[i] = true;
                remaining -= cost;
                continue;
            }
            // Doesn't fit at full size — try truncating to min_keep_tokens.
            if let Some(min_keep) = indexed[i].1.min_keep_tokens {
                if min_keep > 0 && min_keep <= remaining {
                    let truncated = truncate_to_tokens(
                        &self.model.tokenizer,
                        &indexed[i].1.text,
                        min_keep,
                    );
                    indexed[i].1.text = truncated;
                    let new_cost = self.count(&indexed[i].1.text);
                    if new_cost <= remaining {
                        keep[i] = true;
                        remaining -= new_cost;
                        continue;
                    }
                }
            }
            // Drop entirely.
        }

        // Re-emit in original order.
        indexed.sort_by_key(|(orig, _)| *orig);
        let out = indexed
            .into_iter()
            .enumerate()
            .filter_map(|(i, (_, part))| if keep[i] { Some(part) } else { None })
            .collect();
        Ok(out)
    }
}

/// Best-effort token count for `text` under the given tokenizer choice.
fn count_tokens(kind: &TokenizerKind, text: &str) -> usize {
    if text.is_empty() {
        return 0;
    }
    match kind {
        TokenizerKind::Cl100k => {
            // Route through eri_tokens with a known cl100k model.
            eri_tokens::tokens_or_fallback(text, "claude-3.5-sonnet") as usize
        }
        TokenizerKind::Tiktoken(model) => {
            eri_tokens::tokens_or_fallback(text, model) as usize
        }
        TokenizerKind::Llama3 | TokenizerKind::Estimate => estimate_chars_over_four(text),
    }
}

/// `chars / 4` rounded up. Empirically close for English prose; conservative
/// (slightly over-counts) which is what we want for budget guards.
fn estimate_chars_over_four(text: &str) -> usize {
    let chars = text.chars().count();
    chars.div_ceil(4)
}

/// Truncate `text` to *approximately* `max_tokens` tokens.
///
/// We don't have a public decoder for cl100k/o200k that lets us slice on
/// token boundaries without re-encoding, so we approximate: estimate `chars
/// per token` from the full string, multiply by `max_tokens`, then truncate
/// at the nearest word boundary. The result is then re-counted by the
/// caller and gates the actual budget decision.
fn truncate_to_tokens(kind: &TokenizerKind, text: &str, max_tokens: usize) -> String {
    if max_tokens == 0 || text.is_empty() {
        return String::new();
    }
    let total_tokens = count_tokens(kind, text);
    if total_tokens <= max_tokens {
        return text.to_string();
    }
    let total_chars = text.chars().count();
    if total_chars == 0 || total_tokens == 0 {
        return String::new();
    }
    // Estimate the byte budget. Multiply by 0.9 to give the re-count headroom
    // so we don't oscillate one token over the budget.
    let chars_per_token = total_chars as f64 / total_tokens as f64;
    let target_chars = ((max_tokens as f64) * chars_per_token * 0.9).floor() as usize;
    let target_chars = target_chars.max(1).min(total_chars);

    // Walk to a UTF-8 char boundary near `target_chars`, preferring the last
    // whitespace before that point so we don't bisect a word.
    let mut cut: usize = 0;
    let mut last_ws: Option<usize> = None;
    for (i, (byte_idx, ch)) in text.char_indices().enumerate() {
        if i >= target_chars {
            break;
        }
        cut = byte_idx + ch.len_utf8();
        if ch.is_whitespace() {
            last_ws = Some(byte_idx);
        }
    }
    let cut = last_ws.unwrap_or(cut);
    let mut out = text[..cut].trim_end().to_string();
    out.push_str(" …");
    out
}

/// Default model profiles for the major frontier models we route to. The
/// numbers are the public defaults at time of writing; downstream code is
/// free to override `max_output` for a specific call site.
pub fn default_profile_for(model_id: &str) -> ModelProfile {
    let lower = model_id.to_ascii_lowercase();
    if lower.starts_with("claude") {
        ModelProfile {
            name: model_id.to_string(),
            context_window: 200_000,
            max_output: 8_192,
            tokenizer: TokenizerKind::Cl100k,
        }
    } else if lower.starts_with("gpt-5") || lower.starts_with("o1") || lower.starts_with("o3") {
        ModelProfile {
            name: model_id.to_string(),
            context_window: 200_000,
            max_output: 16_384,
            tokenizer: TokenizerKind::Tiktoken("gpt-5".into()),
        }
    } else if lower.starts_with("gpt-4o") {
        ModelProfile {
            name: model_id.to_string(),
            context_window: 128_000,
            max_output: 16_384,
            tokenizer: TokenizerKind::Tiktoken("gpt-4o".into()),
        }
    } else if lower.starts_with("gpt-4") || lower.starts_with("gpt-3.5") {
        ModelProfile {
            name: model_id.to_string(),
            context_window: 128_000,
            max_output: 4_096,
            tokenizer: TokenizerKind::Cl100k,
        }
    } else if lower.starts_with("gemini") {
        ModelProfile {
            name: model_id.to_string(),
            context_window: 1_000_000,
            max_output: 8_192,
            tokenizer: TokenizerKind::Cl100k,
        }
    } else if lower.starts_with("mercury") {
        ModelProfile {
            name: model_id.to_string(),
            context_window: 64_000,
            max_output: 8_192,
            tokenizer: TokenizerKind::Cl100k,
        }
    } else if lower.starts_with("llama") {
        ModelProfile {
            name: model_id.to_string(),
            context_window: 128_000,
            max_output: 4_096,
            tokenizer: TokenizerKind::Llama3,
        }
    } else {
        ModelProfile {
            name: model_id.to_string(),
            context_window: 32_000,
            max_output: 4_096,
            tokenizer: TokenizerKind::Estimate,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn small_profile() -> ModelProfile {
        ModelProfile {
            name: "test".into(),
            context_window: 100,
            max_output: 20,
            tokenizer: TokenizerKind::Estimate,
        }
    }

    #[test]
    fn count_matches_known_estimate() {
        let b = Budgeter::new(small_profile());
        // 16 chars → 16/4 = 4 tokens (estimate).
        assert_eq!(b.count("hello hello-five"), 4);
    }

    #[test]
    fn count_handles_empty_string() {
        let b = Budgeter::new(small_profile());
        assert_eq!(b.count(""), 0);
    }

    #[test]
    fn fits_when_everything_fits() {
        let b = Budgeter::new(small_profile());
        let parts = vec![
            BudgetPart::new("sys", 0, "abcdefgh"), // ~2 tokens
            BudgetPart::new("ctx", 1, "12345678"), // ~2 tokens
        ];
        let kept = b.fit(parts.clone()).expect("fits");
        assert_eq!(kept.len(), 2);
        assert_eq!(kept[0].label, "sys");
        assert_eq!(kept[1].label, "ctx");
    }

    #[test]
    fn drops_lowest_priority_first() {
        let mut profile = small_profile();
        profile.context_window = 12;
        profile.max_output = 4; // budget = 8 tokens (~32 chars)
        let b = Budgeter::new(profile);
        let big = "x".repeat(40); // 10 tokens — too big with anything else
        let parts = vec![
            BudgetPart::new("sys", 0, "abcd"),       // 1 token
            BudgetPart::new("high", 5, &big),        // 10 tokens, dropped
            BudgetPart::new("medium", 3, "abcdefg"), // 2 tokens, fits
        ];
        let kept = b.fit(parts).expect("ok");
        let labels: Vec<&str> = kept.iter().map(|p| p.label.as_str()).collect();
        assert!(labels.contains(&"sys"), "kept: {labels:?}");
        assert!(labels.contains(&"medium"), "kept: {labels:?}");
        assert!(!labels.contains(&"high"), "kept: {labels:?}");
    }

    #[test]
    fn truncate_respects_min_keep() {
        let mut profile = small_profile();
        profile.context_window = 24;
        profile.max_output = 4; // budget = 20 tokens
        let b = Budgeter::new(profile);
        // Mandatory eats 16 tokens (64 chars). 4 tokens (16 chars) remain.
        let mandatory = "x".repeat(64);
        // Optional part is 40 tokens (160 chars) — must truncate.
        let optional = "y".repeat(160);
        let parts = vec![
            BudgetPart::new("sys", 0, mandatory),
            BudgetPart::new("ctx", 5, optional).with_min_keep(2), // ask to keep 2 tokens
        ];
        let kept = b.fit(parts).expect("ok");
        let labels: Vec<&str> = kept.iter().map(|p| p.label.as_str()).collect();
        assert!(labels.contains(&"ctx"), "ctx should survive truncation: {labels:?}");
        let ctx = kept.iter().find(|p| p.label == "ctx").unwrap();
        // Truncated text must be much smaller than the original 160 chars.
        assert!(ctx.text.len() < 80, "expected truncation, got {}", ctx.text.len());
    }

    #[test]
    fn drops_when_truncation_still_overflows() {
        let mut profile = small_profile();
        profile.context_window = 20;
        profile.max_output = 4; // budget = 16 tokens
        let b = Budgeter::new(profile);
        let mandatory = "x".repeat(60); // 15 tokens — leaves 1 token of slack
        let parts = vec![
            BudgetPart::new("sys", 0, mandatory),
            // Optional asks to keep 4 tokens minimum but we only have 1.
            BudgetPart::new("ctx", 5, "y".repeat(40)).with_min_keep(4),
        ];
        let kept = b.fit(parts).expect("ok");
        let labels: Vec<&str> = kept.iter().map(|p| p.label.as_str()).collect();
        assert!(!labels.contains(&"ctx"), "expected drop, got {labels:?}");
    }

    #[test]
    fn mandatory_overflow_returns_error() {
        let mut profile = small_profile();
        profile.context_window = 10;
        profile.max_output = 4; // budget = 6 tokens
        let b = Budgeter::new(profile);
        let huge = "x".repeat(200); // 50 tokens — mandatory, over budget
        let parts = vec![BudgetPart::new("sys", 0, huge)];
        let err = b.fit(parts).expect_err("should fail");
        match err {
            BudgetError::MandatoryOverflow { required, budget, .. } => {
                assert!(required > budget);
            }
        }
    }

    #[test]
    fn priority_ordering_is_strict_ascending() {
        let mut profile = small_profile();
        profile.context_window = 16;
        profile.max_output = 4; // budget = 12 tokens (~48 chars)
        let b = Budgeter::new(profile);
        let parts = vec![
            BudgetPart::new("p5", 5, "x".repeat(40)),  // 10 tokens
            BudgetPart::new("p1", 1, "y".repeat(20)),  // 5 tokens
            BudgetPart::new("p2", 2, "z".repeat(8)),   // 2 tokens
        ];
        let kept = b.fit(parts).expect("ok");
        let labels: Vec<&str> = kept.iter().map(|p| p.label.as_str()).collect();
        // p1 + p2 = 7 tokens fits; p5 cannot.
        assert!(labels.contains(&"p1"), "{labels:?}");
        assert!(labels.contains(&"p2"), "{labels:?}");
        assert!(!labels.contains(&"p5"), "{labels:?}");
    }

    #[test]
    fn default_profile_for_known_models_is_sane() {
        let claude = default_profile_for("claude-sonnet-4-5");
        assert!(claude.context_window >= 100_000);
        assert!(claude.input_budget() > 0);
        assert_eq!(claude.tokenizer, TokenizerKind::Cl100k);
        let gemini = default_profile_for("gemini-2.5-pro");
        assert!(gemini.context_window >= 100_000);
    }

    #[test]
    fn preserves_input_order_in_output() {
        let b = Budgeter::new(small_profile());
        let parts = vec![
            BudgetPart::new("a", 1, "aa"),
            BudgetPart::new("b", 0, "bb"),
            BudgetPart::new("c", 2, "cc"),
        ];
        let kept = b.fit(parts).expect("ok");
        let labels: Vec<&str> = kept.iter().map(|p| p.label.as_str()).collect();
        assert_eq!(labels, vec!["a", "b", "c"]);
    }
}
