//! Layered context-compaction pipeline -- the shapers eri runs over the
//! growing `messages` before a model call so a long session never blows the
//! context window.
//!
//! Modeled on Claude Code's "run cheapest reductions first" approach. The
//! shapers, in order of increasing aggression / loss:
//!
//!   1. **Budget-reduction** -- truncate any single oversized tool output.
//!      Cheapest and near-lossless (huge file dumps rarely need every byte
//!      re-sent every turn).
//!   2. **Snip** -- elide the *contents* of the OLDEST tool results (keeping
//!      the tool calls + the most recent results). The model keeps the shape
//!      of what it did without re-reading stale outputs.
//!   3. **Microcompact** -- caveman-compress old assistant/user prose (code
//!      fences preserved), squeezing tokens out of narration that's no longer
//!      load-bearing.
//!
//! All three are **pure functions over the message vec** -- no network, no
//! token-billing -- so they unit-test deterministically. When even microcompact
//! can't get under budget, the pipeline sets `needs_summarization`: the caller
//! decides whether to run the (metered, model-driven) `compact_session`
//! whole-history summary, which is layers 4-5 (context-collapse / auto-compact).
//!
//! Token counts are a chars/4 estimate -- we have no local tokenizer, but the
//! estimate is stable and monotonic, which is all the shaper needs to decide
//! "are we over budget" and "did this layer help".

use serde_json::Value;

/// Rough token estimate for a chunk of JSON-serializable context. ~4 chars per
/// token is the long-standing English heuristic; close enough to drive shaping
/// decisions (we only need monotonicity, not exactness).
pub fn estimate_tokens(messages: &[Value]) -> usize {
    messages
        .iter()
        .map(|m| serde_json::to_string(m).map(|s| s.len()).unwrap_or(0))
        .sum::<usize>()
        / 4
}

/// Per-tool-result byte cap used by the budget-reduction layer. Generous: only
/// pathologically large outputs (whole-repo greps, huge file reads) get clipped.
const TOOL_OUTPUT_CAP: usize = 12_000;
/// How many of the most-recent tool results the snip layer keeps verbatim.
const KEEP_RECENT_TOOL_RESULTS: usize = 4;
/// Never compress/snip the last N messages -- the live working set the model is
/// actively reasoning over.
const PROTECT_RECENT_MESSAGES: usize = 6;
/// Marker left in place of elided content so the model knows it was dropped on
/// purpose (vs the tool returning nothing).
const ELIDED: &str = "[earlier tool output elided to save context]";

/// What the pipeline did, for narration + tests.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct ShapeReport {
    pub tokens_before: usize,
    pub tokens_after: usize,
    /// Names of the layers that actually changed something, in order.
    pub layers_applied: Vec<&'static str>,
    /// True when, after all local layers, the context is still over budget --
    /// the caller should consider a model-driven whole-history summary.
    pub needs_summarization: bool,
}

impl ShapeReport {
    pub fn changed(&self) -> bool {
        !self.layers_applied.is_empty()
    }
}

/// Run the local shaping pipeline in place, cheapest layer first, stopping as
/// soon as the context fits under `target_tokens`. Returns a report. The first
/// `protect` newest messages are never touched (the live working set); the
/// system blocks are not part of `messages` and so are always preserved.
pub fn shape_context(messages: &mut [Value], target_tokens: usize) -> ShapeReport {
    let tokens_before = estimate_tokens(messages);
    let mut report = ShapeReport {
        tokens_before,
        tokens_after: tokens_before,
        ..Default::default()
    };
    if tokens_before <= target_tokens {
        return report;
    }

    let protect = PROTECT_RECENT_MESSAGES.min(messages.len());
    let mutable = messages.len().saturating_sub(protect);

    // Layer 1: budget-reduction -- truncate oversized single outputs.
    if truncate_large_tool_outputs(&mut messages[..mutable], TOOL_OUTPUT_CAP) {
        report.layers_applied.push("budget-reduction");
    }
    if estimate_tokens(messages) <= target_tokens {
        report.tokens_after = estimate_tokens(messages);
        return report;
    }

    // Layer 2: snip -- elide the oldest tool-result CONTENTS (keep the calls).
    if snip_old_tool_results(&mut messages[..mutable], KEEP_RECENT_TOOL_RESULTS) {
        report.layers_applied.push("snip");
    }
    if estimate_tokens(messages) <= target_tokens {
        report.tokens_after = estimate_tokens(messages);
        return report;
    }

    // Layer 3: microcompact -- caveman-compress old prose (code preserved).
    if microcompact_prose(&mut messages[..mutable]) {
        report.layers_applied.push("microcompact");
    }

    report.tokens_after = estimate_tokens(messages);
    report.needs_summarization = report.tokens_after > target_tokens;
    report
}

/// Layer 1: clip the `content` string of any tool_result that exceeds `cap`.
/// Returns whether anything changed.
fn truncate_large_tool_outputs(messages: &mut [Value], cap: usize) -> bool {
    let mut changed = false;
    for msg in messages.iter_mut() {
        for block in tool_result_blocks(msg) {
            let Some(text) = block.get("content").and_then(Value::as_str) else {
                continue;
            };
            if text.len() <= cap {
                continue;
            }
            let mut clipped: String = text.chars().take(cap).collect();
            clipped.push_str("\n…[truncated]");
            block["content"] = Value::String(clipped);
            changed = true;
        }
    }
    changed
}

/// Layer 2: replace the contents of all but the `keep_recent` newest tool
/// results with a short marker. The tool_use calls (in assistant turns) are
/// untouched, so the model still sees WHAT it ran -- just not the stale output.
fn snip_old_tool_results(messages: &mut [Value], keep_recent: usize) -> bool {
    // First pass: count total tool results so we know which are "old".
    let total: usize = messages
        .iter_mut()
        .map(|m| tool_result_blocks(m).len())
        .sum();
    if total <= keep_recent {
        return false;
    }
    let snip_until = total - keep_recent;
    let mut seen = 0usize;
    let mut changed = false;
    for msg in messages.iter_mut() {
        for block in tool_result_blocks(msg) {
            let idx = seen;
            seen += 1;
            if idx >= snip_until {
                continue; // recent -> keep verbatim
            }
            match block.get("content").and_then(Value::as_str) {
                Some(c) if c != ELIDED => {
                    block["content"] = Value::String(ELIDED.to_string());
                    changed = true;
                }
                _ => {}
            }
        }
    }
    changed
}

/// Layer 3: caveman-compress assistant text blocks and plain-string user
/// messages, preserving fenced code. Returns whether anything shrank.
fn microcompact_prose(messages: &mut [Value]) -> bool {
    let compressor = eri_caveman::Compressor::new(eri_caveman::CompressionLevel::Medium)
        .with_preserve_blocks(vec!["```"]);
    let mut changed = false;
    for msg in messages.iter_mut() {
        // Plain-string user turn (e.g. the original prompt or a summary).
        if let Some(text) = msg.get("content").and_then(Value::as_str) {
            let compact = compressor.compress(text);
            if compact.len() < text.len() {
                msg["content"] = Value::String(compact);
                changed = true;
            }
            continue;
        }
        // Assistant text blocks within a content array.
        if let Some(blocks) = msg.get_mut("content").and_then(Value::as_array_mut) {
            for block in blocks.iter_mut() {
                if block.get("type").and_then(Value::as_str) != Some("text") {
                    continue;
                }
                let Some(text) = block.get("text").and_then(Value::as_str) else {
                    continue;
                };
                let compact = compressor.compress(text);
                if compact.len() < text.len() {
                    block["text"] = Value::String(compact);
                    changed = true;
                }
            }
        }
    }
    changed
}

/// Mutable references to the `tool_result` blocks inside one message's content
/// array (user-role turns carry them). Empty for assistant turns / string
/// content.
fn tool_result_blocks(msg: &mut Value) -> Vec<&mut Value> {
    msg.get_mut("content")
        .and_then(Value::as_array_mut)
        .map(|blocks| {
            blocks
                .iter_mut()
                .filter(|b| b.get("type").and_then(Value::as_str) == Some("tool_result"))
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tool_result(id: &str, content: &str) -> Value {
        json!({
            "role": "user",
            "content": [{ "type": "tool_result", "tool_use_id": id, "content": content }]
        })
    }

    #[test]
    fn under_budget_is_a_noop() {
        let mut msgs = vec![json!({ "role": "user", "content": "hi" })];
        let r = shape_context(&mut msgs, 1_000_000);
        assert!(!r.changed());
        assert!(!r.needs_summarization);
        assert_eq!(r.tokens_before, r.tokens_after);
    }

    #[test]
    fn budget_reduction_truncates_one_huge_output() {
        // One giant tool output, far past the protect window so it's mutable.
        let big = "x".repeat(60_000);
        let mut msgs = vec![tool_result("t1", &big)];
        for i in 0..PROTECT_RECENT_MESSAGES {
            msgs.push(json!({ "role": "user", "content": format!("note {i}") }));
        }
        let before = estimate_tokens(&msgs);
        // Target below the big output but the small notes fit.
        let r = shape_context(&mut msgs, before / 2);
        assert!(r.layers_applied.contains(&"budget-reduction"));
        assert!(r.tokens_after < r.tokens_before);
        // The clipped marker is present; original 60k is gone.
        let s = serde_json::to_string(&msgs[0]).unwrap();
        assert!(s.contains("truncated"));
        assert!(s.len() < 60_000);
    }

    #[test]
    fn snip_elides_old_results_keeps_recent() {
        // Many medium tool results; budget forces snipping the oldest.
        let mut msgs = Vec::new();
        for i in 0..12 {
            msgs.push(tool_result(&format!("t{i}"), &"data ".repeat(2_000)));
        }
        // Push protected recent messages so the older ones are mutable.
        for i in 0..PROTECT_RECENT_MESSAGES {
            msgs.push(json!({ "role": "user", "content": format!("recent {i}") }));
        }
        let before = estimate_tokens(&msgs);
        let r = shape_context(&mut msgs, before / 4);
        assert!(r.layers_applied.contains(&"snip"));
        // Oldest results elided; the 4 most-recent (still in mutable range)
        // keep their data.
        let first = serde_json::to_string(&msgs[0]).unwrap();
        assert!(first.contains(ELIDED));
    }

    #[test]
    fn microcompact_runs_when_still_over_after_snip() {
        // A long prose history that snipping can't touch (no tool results),
        // forcing the microcompact layer.
        let mut msgs = Vec::new();
        for i in 0..40 {
            msgs.push(json!({
                "role": "assistant",
                "content": [{
                    "type": "text",
                    "text": format!("This is a fairly verbose explanation number {i} that the \
                        the compressor should be able to shorten because it has filler words.")
                }]
            }));
        }
        for i in 0..PROTECT_RECENT_MESSAGES {
            msgs.push(json!({ "role": "user", "content": format!("recent {i}") }));
        }
        let before = estimate_tokens(&msgs);
        let r = shape_context(&mut msgs, before / 3);
        assert!(r.layers_applied.contains(&"microcompact"));
        assert!(r.tokens_after < r.tokens_before);
    }

    #[test]
    fn protects_recent_messages() {
        // The newest PROTECT_RECENT_MESSAGES must survive verbatim.
        let mut msgs = Vec::new();
        for i in 0..10 {
            msgs.push(tool_result(&format!("old{i}"), &"junk ".repeat(3_000)));
        }
        let sentinel = "SENTINEL-RECENT-CONTENT";
        for i in 0..PROTECT_RECENT_MESSAGES {
            msgs.push(tool_result(&format!("r{i}"), &format!("{sentinel} {i}")));
        }
        let before = estimate_tokens(&msgs);
        shape_context(&mut msgs, before / 5);
        // The protected tail still contains the sentinel verbatim.
        let tail = &msgs[msgs.len() - PROTECT_RECENT_MESSAGES..];
        let joined = tail
            .iter()
            .map(|m| serde_json::to_string(m).unwrap())
            .collect::<String>();
        assert!(joined.contains(sentinel));
    }
}
