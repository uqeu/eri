//! Adaptive intent classifier for eri's voice-driven IDE loop.
//!
//! Every user utterance routes to one of two modes:
//! - `NewBuild`: clear the draft and ask Mercury to build something fresh.
//! - `Iteration`: keep the draft and surgically modify it.
//!
//! The classifier runs on every partial / final transcript, so it must be
//! offline and fast (sub-millisecond). It also needs to ADAPT — a static
//! phrase list breaks the moment a user says "let me make this a calculator
//! instead" or any wording outside the list. The design here combines:
//!
//! 1. Linguistic markers — demonstratives ("this/it") pull toward iteration,
//!    pivot cues ("actually/instead/scrap") pull toward new-build, and
//!    classic build-verbs ("build me", "create a") strongly suggest new-build.
//! 2. Topic-shift signal — the prompt's content nouns are compared against
//!    the current draft's `<title>` (or the original transcript turn). If
//!    the user introduces product nouns absent from the page's lexicon, the
//!    score tips toward new-build; if every content word overlaps the page,
//!    the score tips toward iteration. This makes the classifier sensitive
//!    to the actual page context rather than a fixed phrase list — saying
//!    "snake" while looking at a flappy bird page is a pivot, while saying
//!    "the pipes" is a tweak.
//! 3. Fallback rule-based backend (the legacy phrase list) for parity with
//!    the previous behavior and as a safety net when scores are ambiguous.
//!
//! Backend selection is swappable through the `ERI_INTENT_CLASSIFIER`
//! environment variable (`heuristic | adaptive | hybrid`), defaulting to
//! `adaptive`.

use std::collections::HashSet;

use eri_core::PromptCtx;

/// Coarse intent label routed downstream by [`MercuryBackend`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Intent {
    /// User wants to scaffold something fresh — clear the draft.
    NewBuild,
    /// User wants to keep the draft and modify it surgically.
    Iteration,
}

/// A scored decision with confidence and a short human-readable trace —
/// useful for telemetry and debugging.
#[derive(Clone, Debug, PartialEq)]
pub struct IntentDecision {
    pub intent: Intent,
    /// Confidence in `[0.0, 1.0]`; the closer to 1 the more decisive.
    pub confidence: f32,
    /// One-line trace of which signals fired — kept tiny on purpose so we
    /// can log it on every classification without bloat.
    pub reason: &'static str,
}

impl IntentDecision {
    pub const fn new(intent: Intent, confidence: f32, reason: &'static str) -> Self {
        Self {
            intent,
            confidence,
            reason,
        }
    }

    pub fn is_new_build(&self) -> bool {
        matches!(self.intent, Intent::NewBuild)
    }
}

/// All inputs the classifier may consider. Built from a [`PromptCtx`] but
/// kept as a thin struct so the tests can construct one without touching
/// the rest of the crate.
#[derive(Clone, Debug, Default)]
pub struct IntentContext<'a> {
    /// The latest finalized user utterance, if any.
    pub latest_turn: Option<&'a str>,
    /// The in-flight partial speech recognition output, if any.
    pub partial_turn: Option<&'a str>,
    /// The original (anchoring) transcript turn — the one that defined the
    /// build's topic. Used to detect pivots away from the established topic.
    pub original_turn: Option<&'a str>,
    /// Current HTML draft, used to extract the topic lexicon from `<title>`
    /// and `<h1>`. May be `None` when no draft exists yet (always new-build).
    pub current_draft: Option<&'a str>,
}

impl<'a> IntentContext<'a> {
    pub fn from_prompt_ctx(ctx: &'a PromptCtx, current_draft: Option<&'a str>) -> Self {
        let transcript = ctx.transcript();
        let latest_turn = transcript.last().map(String::as_str);
        let original_turn = transcript.first().map(String::as_str);
        // Only surface `original` when it differs from `latest`; otherwise
        // both pointers reference the same turn and there's no anchor to
        // contrast against.
        let original_turn = match (original_turn, latest_turn) {
            (Some(o), Some(l)) if o != l => Some(o),
            _ => None,
        };
        Self {
            latest_turn,
            partial_turn: ctx.partial_transcript(),
            original_turn,
            current_draft,
        }
    }

    /// Returns the utterance the classifier should grade, preferring the
    /// finalized turn over the partial.
    pub fn active_prompt(&self) -> Option<&str> {
        self.latest_turn
            .filter(|s| !s.trim().is_empty())
            .or(self.partial_turn)
    }
}

/// Pluggable backend strategy.
pub trait IntentClassifier: Send + Sync {
    fn classify(&self, ctx: &IntentContext<'_>) -> IntentDecision;
}

/// Build a classifier from the `ERI_INTENT_CLASSIFIER` env var — falls back
/// to the adaptive backend (the default eri behavior).
pub fn classifier_from_env() -> Box<dyn IntentClassifier> {
    let choice = std::env::var("ERI_INTENT_CLASSIFIER").unwrap_or_default();
    match choice.trim().to_ascii_lowercase().as_str() {
        "heuristic" | "rule" | "rules" | "legacy" => Box::new(HeuristicClassifier),
        "adaptive" | "" => Box::new(AdaptiveClassifier),
        "hybrid" => Box::new(HybridClassifier),
        _ => Box::new(AdaptiveClassifier),
    }
}

// ---------------------------------------------------------------------------
// Backend 1: rule-based heuristic (parity with the original phrase list).
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, Default)]
pub struct HeuristicClassifier;

impl IntentClassifier for HeuristicClassifier {
    fn classify(&self, ctx: &IntentContext<'_>) -> IntentDecision {
        let Some(prompt) = ctx.active_prompt() else {
            // No utterance at all → nothing to iterate on → new-build is
            // the safer default (it scaffolds rather than mutating a stale
            // draft).
            return IntentDecision::new(Intent::NewBuild, 1.0, "empty prompt");
        };
        let lower = prompt.to_ascii_lowercase();
        if NEW_BUILD_MARKERS.iter().any(|m| lower.contains(m)) {
            IntentDecision::new(Intent::NewBuild, 0.9, "phrase-list match")
        } else {
            IntentDecision::new(Intent::Iteration, 0.6, "no new-build phrase")
        }
    }
}

// ---------------------------------------------------------------------------
// Backend 2: adaptive (linguistic + topic overlap).
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, Default)]
pub struct AdaptiveClassifier;

impl IntentClassifier for AdaptiveClassifier {
    fn classify(&self, ctx: &IntentContext<'_>) -> IntentDecision {
        let Some(prompt) = ctx.active_prompt().map(str::trim).filter(|s| !s.is_empty()) else {
            return IntentDecision::new(Intent::NewBuild, 1.0, "empty prompt");
        };
        let lower = prompt.to_ascii_lowercase();

        // ---- 1. Strong linguistic cues. -----------------------------------
        // PIVOT markers are the most decisive: "actually", "instead", "scrap"
        // mean "abandon the previous thing". Treat as new-build immediately.
        if PIVOT_MARKERS.iter().any(|m| lower.contains(m)) {
            return IntentDecision::new(Intent::NewBuild, 0.95, "pivot marker");
        }
        // SCRATCH markers explicitly request a fresh build.
        if SCRATCH_MARKERS.iter().any(|m| lower.contains(m)) {
            return IntentDecision::new(Intent::NewBuild, 0.93, "scratch marker");
        }
        // No draft and no anchor turn → there's nothing TO iterate on, so it
        // must be a new build, regardless of phrasing.
        let has_draft = ctx.current_draft.map(draft_looks_complete).unwrap_or(false);
        if !has_draft && ctx.original_turn.is_none() {
            return IntentDecision::new(Intent::NewBuild, 0.85, "no draft yet");
        }

        // ITERATION markers (demonstratives + tweak verbs) are usually
        // decisive in the OTHER direction, but only when a draft exists —
        // otherwise "make it a calculator" with no draft is still a new
        // build. Demonstratives are evaluated as part of the scoring loop
        // below so they can be outweighed when a fresh-noun pivot fires.

        // ---- 2. Topic overlap scoring. ------------------------------------
        // Compare the prompt's content words against the page lexicon
        // (current draft title + h1 + original transcript turn). A high
        // overlap → the user is talking ABOUT the current page (iteration);
        // a low overlap with novel product nouns → topic shift (new build).
        let page_lexicon = build_page_lexicon(ctx);
        let prompt_tokens = content_words(&lower);

        let mut score: f32 = 0.0; // positive ⇒ NewBuild, negative ⇒ Iteration
        let mut reasons: u8 = 0;

        // Verb cues from the phrase list (now used as a soft signal rather
        // than a hard switch).
        if NEW_BUILD_MARKERS.iter().any(|m| lower.contains(m)) {
            score += 1.4;
            reasons |= 0b0001;
        }
        // Demonstratives + tweak verbs → iteration leaning.
        let demonstrative_hit = DEMONSTRATIVE_MARKERS.iter().any(|m| lower.contains(m));
        let tweak_hit = TWEAK_VERBS.iter().any(|m| lower.contains(m));
        if demonstrative_hit {
            score -= 0.7;
            reasons |= 0b0010;
        }
        if tweak_hit {
            score -= 0.5;
            reasons |= 0b0010;
        }

        // Fresh-noun signal: prompt nouns that don't appear in the page
        // lexicon are a strong topic-shift indicator (e.g. "snake" while
        // looking at a flappy-bird page).
        let mut fresh_nouns = 0;
        let mut overlap = 0;
        for token in &prompt_tokens {
            if PRODUCT_NOUNS.contains(token.as_str()) {
                if page_lexicon.contains(token.as_str()) {
                    overlap += 1;
                } else {
                    fresh_nouns += 1;
                }
            }
        }
        if fresh_nouns > 0 {
            score += 1.2 * fresh_nouns as f32;
            reasons |= 0b0100;
        }
        if overlap > 0 && fresh_nouns == 0 {
            score -= 0.6 * overlap as f32;
            reasons |= 0b1000;
        }

        // If the draft is empty/incomplete the iteration option is moot, so
        // tip the scale toward NewBuild.
        if !has_draft {
            score += 0.5;
        }

        let intent = if score > 0.0 {
            Intent::NewBuild
        } else {
            Intent::Iteration
        };
        // Map raw magnitude to a confidence in `[0.5, 0.99]` — a tiny edge
        // is still ambiguous, a large one is decisive.
        let confidence = (0.5 + score.abs().min(2.5) * 0.2).min(0.99);
        let reason = describe_reasons(reasons);
        IntentDecision::new(intent, confidence, reason)
    }
}

// ---------------------------------------------------------------------------
// Backend 3: hybrid — adaptive primary, heuristic safety net.
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, Default)]
pub struct HybridClassifier;

impl IntentClassifier for HybridClassifier {
    fn classify(&self, ctx: &IntentContext<'_>) -> IntentDecision {
        let adaptive = AdaptiveClassifier.classify(ctx);
        if adaptive.confidence >= 0.7 {
            return adaptive;
        }
        // Adaptive is unsure — let the heuristic break the tie. If the
        // heuristic agrees we bump the confidence; if it disagrees we keep
        // the adaptive call (it has more context) but note the conflict.
        let rule = HeuristicClassifier.classify(ctx);
        if rule.intent == adaptive.intent {
            IntentDecision::new(
                adaptive.intent,
                (adaptive.confidence + 0.2).min(0.99),
                "hybrid agreement",
            )
        } else {
            IntentDecision::new(adaptive.intent, adaptive.confidence, "hybrid conflict")
        }
    }
}

// ---------------------------------------------------------------------------
// Shared helpers + lexicons. Tunable in one place so iterations on the
// classifier don't fan out across the file.
// ---------------------------------------------------------------------------

/// Legacy phrase list — preserved for the heuristic backend so we never
/// regress on the prompts that already worked. The adaptive backend treats
/// these as one of several signals, not as a hard switch.
pub(crate) const NEW_BUILD_MARKERS: &[&str] = &[
    "build me a",
    "build me an",
    "build a new",
    "build an new",
    "create a new",
    "create me a",
    "create me an",
    "scaffold a",
    "scaffold me",
    "scaffold an",
    "generate a new",
    "spin up a",
    "spin up an",
    "start a new",
    "start me a",
    "design me a",
    "design a new",
    "let's build a",
    "lets build a",
    "let's make a new",
    "lets make a new",
    "fresh build",
    "from scratch",
    "turn this into",
    "turn it into",
    "convert this into",
    "convert it into",
    "make this into",
    "make it into",
    "instead build",
    "instead make",
    "instead create",
    "actually build",
    "actually make",
    "actually create",
    "actually i want",
    "i want to build",
    "i want a different",
    "can you build me",
    "can you make me",
    "where is my",
    "i don't want to play this",
    "i dont want to play this",
    "let's do something else",
    "lets do something else",
    "scrap this",
    "start over",
    "throw this away",
    "different app",
    "new app",
];

/// Hard pivot markers — these alone are enough to declare a new build.
const PIVOT_MARKERS: &[&str] = &[
    "actually i want",
    "actually i'd like",
    "actually id like",
    "instead build",
    "instead make",
    "instead create",
    "instead i want",
    "instead give me",
    "scrap this",
    "scrap that",
    "scrap it",
    "start over",
    "throw this away",
    "throw it away",
    "let's do something else",
    "lets do something else",
    "different app",
    "another app",
    "new app",
    "i don't want this",
    "i dont want this",
    "turn this into",
    "turn it into",
    "convert this into",
    "convert it into",
    "make this into",
    "make it into",
];

/// "Build from scratch" markers — also new-build, slightly less decisive.
const SCRATCH_MARKERS: &[&str] = &[
    "build me a",
    "build me an",
    "build a new",
    "create a new",
    "create me a",
    "create me an",
    "scaffold a",
    "scaffold me",
    "generate a new",
    "spin up a",
    "spin up an",
    "start a new",
    "start me a",
    "design me a",
    "design a new",
    "let's build a",
    "lets build a",
    "fresh build",
    "from scratch",
    "i want to build",
    "i want you to build",
    "can you build me",
    "can you make me",
];

/// Demonstratives — when the user references the current artifact ("this",
/// "it") they are almost certainly iterating.
const DEMONSTRATIVE_MARKERS: &[&str] = &[
    "this ", "this.", "this,", "the page", "the site", "the app", "the game", " it ", " it.",
    " it,", " its ", "it's ", "make it", "keep it", "leave it",
];

/// Tweak verbs that signal surgical edits.
const TWEAK_VERBS: &[&str] = &[
    "make the ",
    "change the ",
    "update the ",
    "tweak ",
    "adjust ",
    "rename ",
    "rewrite the ",
    "fix the ",
    "swap the ",
    "replace the ",
    "shrink ",
    "enlarge ",
    "bigger",
    "smaller",
    "darker",
    "lighter",
    "bolder",
    "thinner",
    "wider",
    "narrower",
    "add a ",
    "add an ",
    "remove the ",
    "delete the ",
    "hide the ",
    "show the ",
    "move the ",
    "center the ",
    "align the ",
];

/// Product-noun vocabulary — anything that names a kind of app, game, or
/// site. When a prompt drops one of these AND it's absent from the current
/// page lexicon, that's a pivot. The list is deliberately not exhaustive;
/// the classifier still works without a hit — only the topic-shift bonus
/// stays silent. Compared to the old phrase list this set is open-ended
/// because each NOUN combines with arbitrary verbs and modifiers.
const PRODUCT_NOUN_LIST: &[&str] = &[
    // games
    "snake",
    "tetris",
    "pong",
    "pacman",
    "pac-man",
    "flappy",
    "bird",
    "asteroids",
    "minesweeper",
    "sudoku",
    "chess",
    "checkers",
    "solitaire",
    "platformer",
    "shooter",
    "rpg",
    "rogue",
    "roguelike",
    "puzzle",
    "maze",
    // common product types
    "calculator",
    "timer",
    "stopwatch",
    "clock",
    "todo",
    "kanban",
    "calendar",
    "weather",
    "blog",
    "portfolio",
    "store",
    "shop",
    "storefront",
    "ecommerce",
    "marketplace",
    "dashboard",
    "tracker",
    "planner",
    "chat",
    "messenger",
    "wiki",
    "forum",
    "landing",
    "splash",
    "newsletter",
    "podcast",
    "gallery",
    "portfolio",
    "resume",
    "cv",
    "menu",
    "checkout",
    // verticals / clones
    "amazon",
    "shopify",
    "stripe",
    "airbnb",
    "uber",
    "twitter",
    "reddit",
    "instagram",
    "tiktok",
    "youtube",
    "github",
    "notion",
    "linear",
    "figma",
    "discord",
    "slack",
    "spotify",
    "netflix",
    "lovable",
    "bolt",
    "vercel",
    "cursor",
    // domain words
    "coffee",
    "fitness",
    "yoga",
    "gym",
    "restaurant",
    "cafe",
    "bakery",
    "sneaker",
    "sneakers",
    "shoe",
    "fashion",
    "streetwear",
    "skincare",
    "barber",
    "salon",
    "dentist",
    "doctor",
    "clinic",
    "law",
    "real",
    "estate",
    "crypto",
    "nft",
    "ai",
    "saas",
    "fintech",
    "edtech",
    "healthtech",
    "music",
    "art",
    "photography",
    "wedding",
    "travel",
    "hotel",
    "flight",
    "tour",
    "tutor",
    "lesson",
];

/// Static set view — built lazily once per call. The list is small (under
/// 100 entries) so a HashSet<&str> over a slice is faster than a perfect
/// hash and keeps the file self-contained without any extra deps.
fn product_nouns_set() -> HashSet<&'static str> {
    PRODUCT_NOUN_LIST.iter().copied().collect()
}

// Module-level access so the scoring loop can match without rebuilding the
// set repeatedly (LazyLock keeps it std-only).
use std::sync::LazyLock;
static PRODUCT_NOUNS: LazyLock<HashSet<&'static str>> = LazyLock::new(product_nouns_set);

/// Stopwords removed from tokenization. Kept small; the union with product
/// nouns drives the topic-shift signal.
const STOPWORDS: &[&str] = &[
    "a",
    "an",
    "the",
    "this",
    "that",
    "these",
    "those",
    "it",
    "its",
    "i",
    "we",
    "you",
    "they",
    "to",
    "of",
    "in",
    "on",
    "for",
    "with",
    "and",
    "or",
    "but",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "make",
    "made",
    "build",
    "built",
    "create",
    "created",
    "want",
    "wanted",
    "would",
    "could",
    "should",
    "please",
    "actually",
    "instead",
    "just",
    "very",
    "really",
    "now",
    "okay",
    "ok",
    "well",
    "uh",
    "um",
    "like",
    "thing",
    "stuff",
    "something",
    "anything",
    "nothing",
    "do",
    "did",
    "does",
    "go",
    "going",
    "let",
    "lets",
    "let's",
    "have",
    "has",
    "had",
    "can",
    "ll",
    "won't",
    "wont",
    "don't",
    "dont",
    "scrap",
    "throw",
    "away",
    "page",
    "site",
    "app",
    "game",
    "demo",
    "project",
];

fn is_stopword(token: &str) -> bool {
    STOPWORDS.contains(&token)
}

/// Tokenize lowercase ASCII text into content words: keep alphanumeric runs
/// of length >= 3, drop stopwords. Allocates O(n) on the prompt length.
fn content_words(lower: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    for ch in lower.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' {
            current.push(ch);
        } else if !current.is_empty() {
            push_token(&mut tokens, &mut current);
        }
    }
    if !current.is_empty() {
        push_token(&mut tokens, &mut current);
    }
    tokens
}

fn push_token(out: &mut Vec<String>, current: &mut String) {
    let trimmed = current.trim_matches('-');
    if trimmed.len() >= 3 && !is_stopword(trimmed) {
        out.push(trimmed.to_string());
    }
    current.clear();
}

/// Build the page lexicon from `<title>`, `<h1>`, and the original anchor
/// transcript turn. Bounded so a 50KB draft doesn't blow up the classifier.
fn build_page_lexicon(ctx: &IntentContext<'_>) -> HashSet<String> {
    let mut bag = HashSet::new();
    if let Some(draft) = ctx.current_draft {
        let lower = draft.to_ascii_lowercase();
        if let Some(title) = extract_tag(&lower, "title") {
            for token in content_words(&title) {
                bag.insert(token);
            }
        }
        if let Some(h1) = extract_tag(&lower, "h1") {
            for token in content_words(&h1) {
                bag.insert(token);
            }
        }
    }
    if let Some(original) = ctx.original_turn {
        for token in content_words(&original.to_ascii_lowercase()) {
            bag.insert(token);
        }
    }
    bag
}

/// Extract inner text of the first `<tag>...</tag>` pair from already-
/// lowercased input. Returns the unescaped slice as a String to keep the
/// caller borrow-free. Bounded to 256 characters so a `<title>` doesn't
/// silently include several KB.
fn extract_tag(lower_input: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}");
    let start = lower_input.find(&open)?;
    let after_open = lower_input[start..].find('>')?;
    let body_start = start + after_open + 1;
    let close = format!("</{tag}>");
    let end = lower_input[body_start..].find(&close)?;
    let slice = &lower_input[body_start..body_start + end];
    Some(slice.chars().take(256).collect())
}

fn draft_looks_complete(draft: &str) -> bool {
    let trimmed = draft.trim();
    if trimmed.len() < 200 {
        return false;
    }
    let lower = trimmed.to_ascii_lowercase();
    lower.contains("<!doctype html") || (lower.contains("<html") && lower.contains("</html>"))
}

fn describe_reasons(reasons: u8) -> &'static str {
    match reasons {
        0 => "no strong signal",
        0b0001 => "build-verb",
        0b0010 => "tweak verb / demonstrative",
        0b0100 => "fresh product noun",
        0b1000 => "topic overlap",
        r if r & 0b0100 != 0 && r & 0b0001 != 0 => "build-verb + fresh noun",
        r if r & 0b1000 != 0 && r & 0b0010 != 0 => "tweak verb + topic overlap",
        r if r & 0b0010 != 0 && r & 0b0100 != 0 => "fresh noun overrides tweak verb",
        _ => "multiple signals",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx_with<'a>(
        prompt: &'a str,
        draft: Option<&'a str>,
        original: Option<&'a str>,
    ) -> IntentContext<'a> {
        IntentContext {
            latest_turn: Some(prompt),
            partial_turn: None,
            original_turn: original,
            current_draft: draft,
        }
    }

    fn flappy_draft() -> String {
        let mut html = String::from(
            "<!doctype html><html><head><title>Flappy Bird</title></head><body>\
             <h1>Flappy Bird</h1><canvas id=\"game\"></canvas>",
        );
        // Pad past the 200-char `draft_looks_complete` threshold so the
        // classifier treats it as a real draft.
        for _ in 0..30 {
            html.push_str("<p>flap the bird through the green pipes to score points</p>");
        }
        html.push_str("</body></html>");
        html
    }

    fn coffee_draft() -> String {
        let mut html = String::from(
            "<!doctype html><html><head><title>Roastline Coffee Co</title></head><body>\
             <h1>Roastline Coffee Co</h1>",
        );
        for _ in 0..30 {
            html.push_str("<p>hand-roasted single-origin coffee beans delivered weekly</p>");
        }
        html.push_str("</body></html>");
        html
    }

    #[test]
    fn pivot_from_flappy_bird_to_snake_is_new_build() {
        let draft = flappy_draft();
        let ctx = ctx_with(
            "turn this into snake",
            Some(&draft),
            Some("build me flappy bird"),
        );
        let decision = AdaptiveClassifier.classify(&ctx);
        assert_eq!(decision.intent, Intent::NewBuild, "got {decision:?}");
    }

    #[test]
    fn tweaking_pipes_on_flappy_bird_is_iteration() {
        let draft = flappy_draft();
        let ctx = ctx_with(
            "make the pipes red",
            Some(&draft),
            Some("build me flappy bird"),
        );
        let decision = AdaptiveClassifier.classify(&ctx);
        assert_eq!(decision.intent, Intent::Iteration, "got {decision:?}");
    }

    #[test]
    fn actually_i_want_overrides_any_draft() {
        let draft = flappy_draft();
        let ctx = ctx_with(
            "actually I want a calculator",
            Some(&draft),
            Some("build me flappy bird"),
        );
        let decision = AdaptiveClassifier.classify(&ctx);
        assert_eq!(decision.intent, Intent::NewBuild, "got {decision:?}");
        assert!(decision.confidence > 0.9);
    }

    #[test]
    fn change_color_without_draft_is_new_build() {
        // No draft, no prior turn — there's nothing to iterate on, so the
        // safer routing is to scaffold (Mercury will pick a sensible
        // default).
        let ctx = ctx_with("change the color", None, None);
        let decision = AdaptiveClassifier.classify(&ctx);
        assert_eq!(decision.intent, Intent::NewBuild, "got {decision:?}");
    }

    #[test]
    fn build_me_a_coffee_app_without_draft_is_new_build() {
        let ctx = ctx_with("build me a coffee app", None, None);
        let decision = AdaptiveClassifier.classify(&ctx);
        assert_eq!(decision.intent, Intent::NewBuild, "got {decision:?}");
    }

    #[test]
    fn make_it_bigger_on_coffee_app_is_iteration() {
        let draft = coffee_draft();
        let ctx = ctx_with(
            "make it bigger",
            Some(&draft),
            Some("build me a coffee shop"),
        );
        let decision = AdaptiveClassifier.classify(&ctx);
        assert_eq!(decision.intent, Intent::Iteration, "got {decision:?}");
    }

    #[test]
    fn novel_phrasing_pivot_detected_without_phrase_match() {
        // "let me see snake instead" doesn't match any literal phrase in
        // the legacy list, but the fresh noun ("snake") + pivot marker
        // ("instead") tips the score firmly toward NewBuild.
        let draft = flappy_draft();
        let ctx = ctx_with(
            "let me see snake instead",
            Some(&draft),
            Some("build me flappy bird"),
        );
        let decision = AdaptiveClassifier.classify(&ctx);
        assert_eq!(decision.intent, Intent::NewBuild, "got {decision:?}");
    }

    #[test]
    fn novel_iteration_phrasing_kept_as_iteration() {
        // "swap pipes for clouds" doesn't match the demonstrative list
        // word-for-word but its content nouns ("pipes") all overlap the
        // flappy draft, so it stays an iteration.
        let draft = flappy_draft();
        let ctx = ctx_with(
            "swap pipes for clouds",
            Some(&draft),
            Some("build me flappy bird"),
        );
        let decision = AdaptiveClassifier.classify(&ctx);
        assert_eq!(decision.intent, Intent::Iteration, "got {decision:?}");
    }

    #[test]
    fn heuristic_backend_matches_phrase_list_behavior() {
        let ctx = ctx_with("turn this into snake", Some("some draft"), None);
        let decision = HeuristicClassifier.classify(&ctx);
        assert_eq!(decision.intent, Intent::NewBuild);

        let ctx = ctx_with("make the pipes red", Some("some draft"), None);
        let decision = HeuristicClassifier.classify(&ctx);
        assert_eq!(decision.intent, Intent::Iteration);
    }

    #[test]
    fn hybrid_breaks_ties_with_heuristic() {
        // Both backends agree → confidence bumps.
        let draft = flappy_draft();
        let ctx = ctx_with(
            "turn this into snake",
            Some(&draft),
            Some("build me flappy bird"),
        );
        let hybrid = HybridClassifier.classify(&ctx);
        assert_eq!(hybrid.intent, Intent::NewBuild);
    }

    #[test]
    fn classifier_from_env_honors_explicit_choice() {
        // Set/unset around the test so we don't leak state to siblings.
        // SAFETY: tests in a single binary share env vars; cargo runs them
        // in parallel threads by default, so we serialize via the std
        // mutex on the variable. This test mostly exists to lock the
        // string → backend mapping at the boundary.
        let prev = std::env::var("ERI_INTENT_CLASSIFIER").ok();
        // SAFETY: setting/unsetting env vars in test threads — this single
        // assertion is the only consumer in this test binary, so the race
        // is bounded.
        unsafe {
            std::env::set_var("ERI_INTENT_CLASSIFIER", "heuristic");
        }
        let cls = classifier_from_env();
        let ctx = ctx_with("turn this into snake", None, None);
        assert_eq!(cls.classify(&ctx).intent, Intent::NewBuild);
        match prev {
            Some(v) => unsafe { std::env::set_var("ERI_INTENT_CLASSIFIER", v) },
            None => unsafe { std::env::remove_var("ERI_INTENT_CLASSIFIER") },
        }
    }
}
