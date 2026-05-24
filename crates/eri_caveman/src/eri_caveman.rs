//! Caveman-style prose compressor for LLM prompts.
//!
//! Strips filler words, articles, and (at higher levels) weak verbs and
//! unambiguous pronouns from natural-language prose, while leaving code
//! fences, inline code, HTML tags, and template placeholders untouched.
//!
//! Pairs with `eri_graph`'s TOON code compression: caveman handles the
//! prose half of any prompt eri sends to an LLM (Mercury, Claude Code,
//! brain prompts, polish briefs, ship-it instructions).
//!
//! Deterministic: same input always produces the same output.

// Token counting routes through eri_tokens crate. See ERI_BLOAT_AUDIT.md.

use serde::{Deserialize, Serialize};

mod budget;
mod segment;

pub use budget::{
    BudgetError, BudgetPart, Budgeter, ModelProfile, TokenizerKind, default_profile_for,
};

/// How aggressively to compress prose.
#[derive(Copy, Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum CompressionLevel {
    /// Strip filler adverbs only ("very", "really", "actually", ...).
    Light,
    /// Light + articles ("a", "an", "the") + weak verb-noun pairs.
    Medium,
    /// Medium + unambiguous pronouns + list conjunctions ("and"/"or" → ",").
    Aggressive,
}

/// Compression statistics produced by `Compressor::estimate_savings`.
#[derive(Copy, Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CompressionStats {
    pub original_tokens_est: u32,
    pub compressed_tokens_est: u32,
    /// `compressed_tokens_est / original_tokens_est`, in `[0.0, 1.0]`.
    /// `1.0` means no compression; lower is better.
    pub ratio: f32,
}

/// Prose compressor.
#[derive(Clone, Debug)]
pub struct Compressor {
    level: CompressionLevel,
    /// Additional literal substrings whose contents are passed through
    /// untouched. The built-in protections (code fences, inline backticks,
    /// HTML tags, `{{...}}`, quoted strings) are always active and do not
    /// need to be listed here.
    preserve_blocks: Vec<&'static str>,
}

impl Compressor {
    pub fn new(level: CompressionLevel) -> Self {
        Self {
            level,
            preserve_blocks: Vec::new(),
        }
    }

    pub fn with_preserve_blocks(mut self, blocks: Vec<&'static str>) -> Self {
        self.preserve_blocks = blocks;
        self
    }

    /// Compress `text` according to the configured level.
    ///
    /// Preserved regions (code, HTML, placeholders, quoted strings) are
    /// emitted byte-for-byte. Everything else is run through the rule chain
    /// for the current level.
    pub fn compress(&self, text: &str) -> String {
        let segments = segment::split(text, &self.preserve_blocks);
        let mut out = String::with_capacity(text.len());
        for seg in segments {
            match seg {
                segment::Segment::Preserved(s) => out.push_str(s),
                segment::Segment::Prose(s) => out.push_str(&compress_prose(s, self.level)),
            }
        }
        out
    }

    pub fn estimate_savings(&self, text: &str) -> CompressionStats {
        let compressed = self.compress(text);
        let original_tokens_est = estimate_tokens(text);
        let compressed_tokens_est = estimate_tokens(&compressed);
        let ratio = if original_tokens_est == 0 {
            1.0
        } else {
            compressed_tokens_est as f32 / original_tokens_est as f32
        };
        CompressionStats {
            original_tokens_est,
            compressed_tokens_est,
            ratio,
        }
    }
}

/// Real token estimate via [`eri_tokens::tokens_or_fallback`]. Caveman is
/// model-agnostic, so we tokenize against `claude-3.5-sonnet` — that proxies
/// through `cl100k_base`, which is empirically within ~5% of every closed
/// tokenizer (Claude, Gemini, Mercury) and exact for `gpt-3.5`/`gpt-4`.
///
/// On tokenizer failure `tokens_or_fallback` degrades to `chars / 4` and
/// emits a one-shot warning. Compression telemetry must never crash.
pub fn estimate_tokens(text: &str) -> u32 {
    eri_tokens::tokens_or_fallback(text, "claude-3.5-sonnet")
}

// ---- rule chain ----

const FILLERS: &[&str] = &[
    "very",
    "really",
    "actually",
    "basically",
    "essentially",
    "just",
    "literally",
    "simply",
    "quite",
    "rather",
    "somewhat",
    "perhaps",
    "maybe",
    "probably",
];

const ARTICLES: &[&str] = &["a", "an", "the"];

// Weak verbs that frequently act as filler when followed by a noun ("get
// the file", "make a request"). When dropping them, the next noun stands
// in for the whole verb phrase.
const WEAK_VERBS: &[&str] = &[
    "get", "gets", "make", "makes", "do", "does", "perform", "performs",
];

const UNAMBIGUOUS_PRONOUNS: &[&str] = &[
    "it", "its", "this", "that", "these", "those", "me", "you", "us",
];

const LIST_CONJUNCTIONS: &[&str] = &["and", "or", "but"];

fn compress_prose(text: &str, level: CompressionLevel) -> String {
    let tokens = tokenize(text);
    let mut kept: Vec<Token> = Vec::with_capacity(tokens.len());

    for (idx, tok) in tokens.iter().enumerate() {
        if !tok.is_word() {
            kept.push(tok.clone());
            continue;
        }
        let lower = tok.text.to_ascii_lowercase();

        // Level: Light
        if FILLERS.contains(&lower.as_str()) {
            continue;
        }

        // Level: Medium
        if matches!(
            level,
            CompressionLevel::Medium | CompressionLevel::Aggressive
        ) {
            if ARTICLES.contains(&lower.as_str()) {
                continue;
            }
            if WEAK_VERBS.contains(&lower.as_str()) && next_word(&tokens, idx).is_some() {
                continue;
            }
        }

        // Level: Aggressive
        if matches!(level, CompressionLevel::Aggressive) {
            if UNAMBIGUOUS_PRONOUNS.contains(&lower.as_str()) {
                continue;
            }
            if LIST_CONJUNCTIONS.contains(&lower.as_str()) && in_list_context(&tokens, idx) {
                // Replace conjunction with a comma by emitting a comma token.
                kept.push(Token {
                    text: ",".to_string(),
                    kind: TokenKind::Punct,
                });
                continue;
            }
        }

        kept.push(tok.clone());
    }

    reassemble(&kept)
}

#[derive(Clone, Debug)]
struct Token {
    text: String,
    kind: TokenKind,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TokenKind {
    Word,
    Whitespace,
    Punct,
}

impl Token {
    fn is_word(&self) -> bool {
        self.kind == TokenKind::Word
    }
}

fn tokenize(text: &str) -> Vec<Token> {
    let mut out: Vec<Token> = Vec::new();
    let mut current = String::new();
    let mut current_kind: Option<TokenKind> = None;

    for ch in text.chars() {
        let kind = if ch.is_alphanumeric() || ch == '\'' || ch == '_' || ch == '-' {
            TokenKind::Word
        } else if ch.is_whitespace() {
            TokenKind::Whitespace
        } else {
            TokenKind::Punct
        };

        match current_kind {
            Some(k) if k == kind && kind != TokenKind::Punct => {
                current.push(ch);
            }
            _ => {
                if let Some(k) = current_kind {
                    out.push(Token {
                        text: std::mem::take(&mut current),
                        kind: k,
                    });
                }
                current.push(ch);
                current_kind = Some(kind);
            }
        }
    }
    if let Some(k) = current_kind
        && !current.is_empty()
    {
        out.push(Token {
            text: current,
            kind: k,
        });
    }
    out
}

fn next_word(tokens: &[Token], from: usize) -> Option<&Token> {
    tokens.iter().skip(from + 1).find(|t| t.is_word())
}

fn in_list_context(tokens: &[Token], idx: usize) -> bool {
    // Heuristic: treat the conjunction as a list separator if a comma
    // appears within the previous 6 tokens. Captures "a, b, and c" and
    // "build x, y, and z" but leaves sentence-joining "and" alone.
    let start = idx.saturating_sub(6);
    tokens[start..idx]
        .iter()
        .any(|t| t.kind == TokenKind::Punct && t.text == ",")
}

fn reassemble(tokens: &[Token]) -> String {
    let mut out = String::new();
    let mut prev_was_ws = false;
    for tok in tokens {
        match tok.kind {
            TokenKind::Whitespace => {
                if !prev_was_ws && !out.is_empty() {
                    // Collapse the run of whitespace down to its original
                    // representation, but keep newlines distinct so prose
                    // layout (lists, paragraphs) is not flattened.
                    let normalized = normalize_whitespace(&tok.text);
                    if !normalized.is_empty() {
                        out.push_str(&normalized);
                        prev_was_ws = true;
                    }
                }
            }
            _ => {
                out.push_str(&tok.text);
                prev_was_ws = false;
            }
        }
    }
    // Trim trailing whitespace on each line; some rule passes can leave
    // dangling spaces where a filler used to be.
    cleanup_orphaned_punct(&out)
}

fn normalize_whitespace(ws: &str) -> String {
    // Preserve newlines exactly, collapse runs of spaces/tabs to one space.
    let mut out = String::new();
    let mut last_was_space = false;
    for ch in ws.chars() {
        if ch == '\n' {
            out.push('\n');
            last_was_space = false;
        } else if ch.is_whitespace() {
            if !last_was_space {
                out.push(' ');
                last_was_space = true;
            }
        } else {
            out.push(ch);
            last_was_space = false;
        }
    }
    out
}

fn cleanup_orphaned_punct(text: &str) -> String {
    // After dropping words, we can end up with " ," or " ." patterns.
    // Stitch those back together.
    let mut out = String::with_capacity(text.len());
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let ch = chars[i];
        if ch == ' ' {
            // Look ahead for adjacent punctuation that should hug the
            // previous word.
            let mut j = i + 1;
            while j < chars.len() && chars[j] == ' ' {
                j += 1;
            }
            if j < chars.len() && matches!(chars[j], ',' | '.' | ';' | ':' | '!' | '?') {
                out.push(chars[j]);
                i = j + 1;
                continue;
            }
            out.push(' ');
            i += 1;
        } else {
            out.push(ch);
            i += 1;
        }
    }
    // Collapse repeated commas left by conjunction-stripping ("x, , y").
    let mut deduped = String::with_capacity(out.len());
    let chars: Vec<char> = out.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let ch = chars[i];
        if ch == ',' {
            deduped.push(',');
            let mut j = i + 1;
            while j < chars.len() && (chars[j] == ',' || chars[j] == ' ') {
                if chars[j] == ',' {
                    // skip
                    j += 1;
                } else {
                    break;
                }
            }
            i = j;
        } else {
            deduped.push(ch);
            i += 1;
        }
    }
    deduped
}
