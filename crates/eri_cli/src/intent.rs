//! Deterministic, zero-token intent router for bare-prompt invocations.
//!
//! WHY: the top UX priority is that `eri <natural language>` — with **no
//! subcommand and no required quotes** — Just Works. The user should never have
//! to remember whether a request is a `build`, a `control`, or an `ask`; eri
//! decides its own mode. clap's `external_subcommand` captures any unrecognized
//! leading token as a free-text prompt, and this module decides where that
//! prompt should go.
//!
//! Design constraints:
//! - **0 tokens, sub-millisecond.** This is a pure, allocation-light heuristic
//!   over the lowercased prompt. It runs on every bare invocation, so it must be
//!   free and instant — no network, no model.
//! - **Pure function.** [`classify_intent`] takes `&str` and returns [`Intent`].
//!   That makes it trivially unit-testable and side-effect-free.
//! - **Safe default.** Ambiguous or unclassifiable prompts fall back to
//!   [`Intent::Answer`] — the agentic one-shot path that has the connected tools
//!   (email/calendar/etc.) AND can simply talk. It's the least-surprising,
//!   most-capable general handler.
//!
//! ## Upgrade seam (the hosted eri-brain)
//!
//! This heuristic is intentionally a *seam*, not the final word. A future smart
//! classifier — the hosted eri-brain — can replace or augment this function
//! without touching any call site: keep the `&str -> Intent` signature, and swap
//! the body for a (cached, budgeted) model call that falls back to this
//! heuristic on miss/timeout. The dispatch layer only knows about [`Intent`], so
//! the routing contract is stable across that upgrade. See the TODO below.

/// Where a bare natural-language prompt should be routed.
///
/// The four modes map onto eri's existing handlers — see the dispatch in
/// `eri_cli::dispatch` for `Command::External`. Keeping this a small enum (not a
/// struct of scores) keeps the routing contract obvious and the eri-brain
/// upgrade a drop-in.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Intent {
    /// Write/ship code or a project (build/iterate path).
    Build,
    /// Drive the physical computer — apps, screen, mouse/keyboard (control path).
    Control,
    /// One-shot Q&A or a connected-tool action (email/calendar/etc.) via the
    /// agentic answer path that carries the tools.
    Answer,
    /// Open-ended conversation / greeting / ambiguous — start a chat.
    Chat,
}

/// Classify a bare prompt into the mode that should handle it.
///
/// WHY ordered checks: the modes overlap in vocabulary ("open a PR" vs "open
/// Spotify"), so order encodes precedence. We check the most *physically
/// specific* intent (Control) first, then code authoring (Build), then the
/// question/connector path (Answer), and finally fall through to Chat only for
/// genuine conversation. Anything we can't place confidently lands on Answer
/// (the safe, tool-capable default) rather than Chat.
///
/// TODO(eri-brain): replace/augment this heuristic with the hosted classifier.
/// Preserve this `&str -> Intent` signature so dispatch never changes; the model
/// call should be cached + budgeted and fall back to this heuristic on
/// miss/timeout so routing stays free and instant in the common case.
pub fn classify_intent(prompt: &str) -> Intent {
    let p = prompt.trim().to_lowercase();
    if p.is_empty() {
        // Empty handled by dispatch (falls back to interactive), but be total.
        return Intent::Chat;
    }

    // 1. Greetings / pure conversation → Chat. Checked first because a bare
    //    "hey" or "thanks" should never be misread as an imperative.
    if is_greeting(&p) {
        return Intent::Chat;
    }

    // 2. Interrogatives win early. A real question ("who wrote this code", "is
    //    the build passing?") is an Answer even when it mentions code-y nouns —
    //    so this guards Build/Control from swallowing questions. We still let
    //    explicit local framing ("what's on my screen") reach Control below by
    //    only short-circuiting *pure* questions here.
    if is_question(&p) && !mentions_local_machine(&p) {
        return Intent::Answer;
    }

    // 3. Control — drive the machine. Imperatives about apps/screen/input, or
    //    explicit "on my computer / my screen" framing.
    if is_control(&p) {
        return Intent::Control;
    }

    // 4. Build — author/ship code or a project. Code-y verbs + software
    //    artifacts (and explicit fix/refactor of code).
    if is_build(&p) {
        return Intent::Build;
    }

    // 5. Answer — connected-tool actions (email/calendar/slack) not caught above.
    if is_answer(&p) {
        return Intent::Answer;
    }

    // 6. Fallback. The agentic answer path is the safest general default: it has
    //    the tools and can also just talk. Ties/ambiguous → Answer.
    Intent::Answer
}

/// Whole-word containment check. WHY: substring matching would fire on
/// "scrollbar" for "scroll" or "scalable" for "scale"; we want token matches.
fn has_word(haystack: &str, word: &str) -> bool {
    haystack
        .split(|c: char| !c.is_alphanumeric())
        .any(|tok| tok == word)
}

/// True if any of `words` appears as a whole token in `p`.
fn has_any(p: &str, words: &[&str]) -> bool {
    words.iter().any(|w| has_word(p, w))
}

/// Greetings and bare social phrases → Chat.
fn is_greeting(p: &str) -> bool {
    const GREETINGS: &[&str] = &[
        "hi", "hey", "hello", "yo", "sup", "thanks", "thx", "ok", "okay", "cool", "nice", "lol",
    ];
    // A short utterance that is *only* a greeting token (optionally with "eri").
    let stripped = p.replace("eri", " ");
    let toks: Vec<&str> = stripped
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .collect();
    if toks.is_empty() {
        return false;
    }
    if toks.iter().all(|t| GREETINGS.contains(t)) {
        return true;
    }
    // "how are you" / "what's up" style openers with no task attached.
    p == "how are you" || p == "how's it going" || p == "what's up" || p == "whats up"
}

/// Control: imperatives that drive the physical computer.
fn is_control(p: &str) -> bool {
    // Explicit "my computer / my screen / on screen" framing is decisive.
    if mentions_local_machine(p) {
        return true;
    }

    // Physical-action verbs over the GUI. "open"/"launch" are control unless the
    // object is clearly a code artifact (handled by ordering: Build runs after,
    // but "open a PR" is an Answer/connector concern — guard it here).
    const CONTROL_VERBS: &[&str] = &[
        "click",
        "double-click",
        "right-click",
        "type",
        "scroll",
        "screenshot",
        "drag",
        "swipe",
        "tap",
        "press",
        "minimize",
        "maximize",
        "close",
        "switch",
    ];
    if has_any(p, CONTROL_VERBS) {
        return true;
    }

    // "take a screenshot" / "grab a screenshot".
    if p.contains("screenshot") || p.contains("screen shot") {
        return true;
    }

    // open / launch / play / pause / quit an APP (not a PR/issue/file-in-repo).
    const APP_VERBS: &[&str] = &[
        "open", "launch", "play", "pause", "quit", "mute", "unmute", "volume",
    ];
    if has_any(p, APP_VERBS) {
        // "open a pull request" / "open an issue" are connector/answer actions,
        // not desktop control — let those fall through to Answer.
        if has_any(p, &["pr", "pull", "issue", "ticket"]) {
            return false;
        }
        return true;
    }

    // Named desktop apps as objects of an action.
    const APP_NAMES: &[&str] = &[
        "spotify",
        "youtube",
        "chrome",
        "safari",
        "finder",
        "notes",
        "messages",
        "maps",
        "photos",
        "calculator",
        "terminal",
        "vscode",
        "discord",
        "slack",
        "netflix",
    ];
    // Only treat an app name as Control when paired with an action-ish word,
    // otherwise "summarize my slack" should stay an Answer.
    if has_any(p, APP_NAMES) && has_any(p, &["start", "stop", "go", "navigate", "search", "find"]) {
        return true;
    }

    false
}

/// Build: write/ship code or a project.
fn is_build(p: &str) -> bool {
    // Code-authoring verbs.
    const BUILD_VERBS: &[&str] = &[
        "build",
        "make",
        "create",
        "scaffold",
        "generate",
        "deploy",
        "refactor",
        "implement",
        "add",
        "write",
        "fix",
        "rewrite",
        "port",
        "migrate",
        "code",
    ];
    // Software artifacts the verb might act on.
    const ARTIFACTS: &[&str] = &[
        "app",
        "site",
        "website",
        "page",
        "landing",
        "component",
        "feature",
        "function",
        "bug",
        "endpoint",
        "api",
        "module",
        "class",
        "test",
        "tests",
        "ui",
        "form",
        "button",
        "dashboard",
        "css",
        "html",
        "code",
        "script",
        "project",
        "frontend",
        "backend",
        "database",
        "schema",
        "route",
        "handler",
    ];
    let has_verb = has_any(p, BUILD_VERBS);
    if !has_verb {
        return false;
    }
    // "fix the bug" / "refactor" are build even without an explicit artifact.
    if has_any(p, &["refactor", "rewrite", "scaffold"]) {
        return true;
    }
    if has_word(p, "fix") && has_any(p, &["bug", "test", "code", "build", "error", "function"]) {
        return true;
    }
    // Otherwise need a software artifact to be confident it's code, not e.g.
    // "make a reservation" (which is an Answer/connector action).
    has_any(p, ARTIFACTS)
}

/// True if the prompt reads as a question — a trailing `?` or a leading
/// interrogative word. WHY shared: both the early interrogative guard and the
/// Answer check need the exact same notion of "this is a question".
fn is_question(p: &str) -> bool {
    if p.ends_with('?') {
        return true;
    }
    const QUESTION_LEADS: &[&str] = &[
        "what", "what's", "whats", "when", "where", "who", "why", "how", "which", "is", "are",
        "can", "could", "should", "would", "do", "does", "did", "will", "was",
    ];
    if let Some(first) = p.split_whitespace().next() {
        let first = first.trim_matches(|c: char| !c.is_alphanumeric() && c != '\'');
        return QUESTION_LEADS.contains(&first);
    }
    false
}

/// True if the prompt explicitly references the user's own machine/screen, e.g.
/// "what's on my screen". Such questions are about live computer state and
/// belong to Control, so the early interrogative guard must NOT steal them.
fn mentions_local_machine(p: &str) -> bool {
    const LOCAL_FRAMING: &[&str] = &[
        "my computer",
        "my screen",
        "on screen",
        "on my computer",
        "this computer",
        "my desktop",
        "my machine",
    ];
    LOCAL_FRAMING.iter().any(|f| p.contains(f))
}

/// Answer: questions and connected-tool actions (email/calendar/slack/etc.).
fn is_answer(p: &str) -> bool {
    if is_question(p) {
        return true;
    }

    // Connector actions over email/calendar/messaging.
    const CONNECTOR_OBJECTS: &[&str] = &[
        "email",
        "emails",
        "inbox",
        "calendar",
        "schedule",
        "meeting",
        "event",
        "mom",
        "dad",
        "slack",
        "message",
        "text",
        "reply",
        "draft",
        "send",
        "summarize",
        "summarise",
    ];
    if has_any(p, CONNECTOR_OBJECTS) {
        return true;
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Table-driven: (prompt, expected intent). Covers all four modes plus the
    /// ambiguous→Answer fallback. This is the contract for the router.
    #[test]
    fn classifies_prompts_into_the_right_mode() {
        let cases: &[(&str, Intent)] = &[
            // -- Control: drive the physical computer --
            ("open Spotify and play jazz", Intent::Control),
            ("take a screenshot", Intent::Control),
            ("click the submit button", Intent::Control),
            ("scroll down to the footer", Intent::Control),
            ("type my address into the form", Intent::Control),
            ("launch Chrome", Intent::Control),
            ("close the current window", Intent::Control),
            ("what's on my screen", Intent::Control),
            ("pause the music", Intent::Control),
            ("turn up the volume", Intent::Control),
            // -- Build: write/ship code or a project --
            ("build me a landing page", Intent::Build),
            ("add dark mode to the settings page", Intent::Build),
            ("create a React component for the navbar", Intent::Build),
            ("scaffold a portfolio", Intent::Build),
            ("refactor this", Intent::Build),
            ("fix the bug in the login function", Intent::Build),
            ("deploy the site", Intent::Build),
            ("write a function to parse CSV", Intent::Build),
            ("make a dashboard with charts", Intent::Build),
            // -- Answer: Q&A and connector actions --
            ("what is tokio?", Intent::Answer),
            ("how do promises work", Intent::Answer),
            ("what's on my calendar", Intent::Answer),
            ("reply to mom", Intent::Answer),
            ("summarize my latest email", Intent::Answer),
            ("send a slack to the team", Intent::Answer),
            ("who wrote this code", Intent::Answer),
            ("is the build passing?", Intent::Answer),
            // -- Chat: greetings / conversation --
            ("hey", Intent::Chat),
            ("hi eri", Intent::Chat),
            ("thanks", Intent::Chat),
            ("what's up", Intent::Chat),
            // -- Ambiguous → Answer (safe default) --
            ("the weather seems nice today", Intent::Answer),
            ("tell me something interesting", Intent::Answer),
            ("lorem ipsum dolor", Intent::Answer),
        ];
        for (prompt, expected) in cases {
            assert_eq!(
                classify_intent(prompt),
                *expected,
                "prompt {prompt:?} should classify as {expected:?}"
            );
        }
    }

    #[test]
    fn empty_prompt_is_chat() {
        assert_eq!(classify_intent(""), Intent::Chat);
        assert_eq!(classify_intent("   "), Intent::Chat);
    }

    #[test]
    fn open_a_pr_is_not_desktop_control() {
        // "open" is a control verb, but a PR/issue is a connector concern, not a
        // desktop app — it must route to Answer, not Control.
        assert_eq!(classify_intent("open a pull request"), Intent::Answer);
        assert_eq!(
            classify_intent("open an issue for this bug"),
            Intent::Answer
        );
    }

    #[test]
    fn make_a_reservation_is_not_build() {
        // "make" is a build verb, but with no software artifact it's a real-world
        // action — falls through to the tool-capable Answer path.
        assert_eq!(
            classify_intent("make a reservation for two"),
            Intent::Answer
        );
    }

    #[test]
    fn case_and_whitespace_insensitive() {
        assert_eq!(classify_intent("  BUILD me an APP  "), Intent::Build);
        assert_eq!(classify_intent("Take A Screenshot"), Intent::Control);
    }

    #[test]
    fn whole_word_matching_avoids_false_positives() {
        // "scrollbar" must not trigger the "scroll" control verb on its own.
        assert!(!has_word("style the scrollbar", "scroll"));
        // but a real "scroll" token does.
        assert!(has_word("scroll down", "scroll"));
    }
}
