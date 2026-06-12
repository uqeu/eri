// The scorecard's consumer is the candle session (it runs the models, then
// calls score_all); these are intentionally ahead of their live caller.
#![allow(dead_code)]

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
pub fn score_task(answer: &str, task: &Task) -> bool {
    let lower = answer.to_lowercase();
    task.expect
        .iter()
        .all(|e| lower.contains(&e.to_lowercase()))
}

/// Run a model's answers over a task set, returning (passed, total). The candle
/// session calls this per candidate model to build the 50-task scorecard.
pub fn score_all(answers: &[String], tasks: &[Task]) -> (usize, usize) {
    let passed = tasks
        .iter()
        .zip(answers)
        .filter(|(t, a)| score_task(a, t))
        .count();
    (passed, tasks.len())
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

    #[test]
    fn score_all_counts_passes_over_a_task_set() {
        let tasks = [
            Task {
                prompt: "open YouTube",
                expect: &["youtube"],
            },
            Task {
                prompt: "open Spotify",
                expect: &["spotify"],
            },
        ];
        let answers = vec!["opening youtube".to_string(), "I can't".to_string()];
        assert_eq!(score_all(&answers, &tasks), (1, 2));
    }
}
