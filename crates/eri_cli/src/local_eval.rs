//! Local-engine eval scorer — the 50-task scorecard's pass/fail engine.
//!
//! Each [`Task`] pairs a prompt with the substrings a correct answer must
//! contain (case-insensitive). The candle session runs the candidate small
//! models on these tasks and feeds their real answers here; this module decides
//! pass/fail so the morph demo shows MEASURED capability, not vibes. Kept pure
//! + model-agnostic so it scores Qwen2.5 / SmolLM3 / Llama-3.2 identically.

/// One eval task: what eri is asked, and what a correct answer must mention.
pub struct Task {
    pub prompt: &'static str,
    /// Every entry must appear (case-insensitive) in the answer to pass.
    pub expect: &'static [&'static str],
}

/// Score a model's `answer` against `task`: passes only when every expected
/// substring is present (case-insensitive).
pub fn score_task(_answer: &str, _task: &Task) -> bool {
    // RED stub — replaced once the failing test pins the behavior.
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passes_when_all_expected_substrings_present() {
        let t = Task {
            prompt: "open YouTube",
            expect: &["youtube"],
        };
        assert!(score_task("Opening YouTube for you.", &t));
    }

    #[test]
    fn fails_when_an_expected_substring_is_missing() {
        let t = Task {
            prompt: "what's the top calendar priority?",
            expect: &["deck", "priya"],
        };
        assert!(!score_task("Your most urgent task is the standup.", &t));
    }

    #[test]
    fn empty_expectations_pass_trivially() {
        let t = Task {
            prompt: "x",
            expect: &[],
        };
        assert!(score_task("anything", &t));
    }
}
