//! Edit-mode call path.
//!
//! The intent classifier in [`crate::intent`] tags each fire as either
//! `NewBuild` (start from scratch) or `Iteration` (modify what's already on
//! disk). For iterations, asking the diffusion backend to emit a full file
//! is slow and drift-prone — even a one-line tweak forces a full regenerate.
//!
//! This module wires the new pipeline: render an "edit-blocks" prompt that
//! tells the model to emit aider-style `<<<<<<< SEARCH ... >>>>>>> REPLACE`
//! blocks, then hand the raw text to [`eri_apply`] for deterministic
//! parse + atomic write. Once Mercury's block-emit quality is validated in
//! the field this becomes the default iteration path; today it's an opt-in
//! sibling of [`InferenceBackend::iterate`].
//!
//! The surface is provider-agnostic on purpose: any [`LlmProvider`] (OpenAI,
//! Anthropic, Gemini, future engines) can drive it because the trait only
//! sees plain `system` / `user` strings and returns plain text.

use std::path::PathBuf;

use crate::llm_provider::{LlmProvider, LlmResponse};
use crate::templates::{edit_mode_system_prompt, edit_mode_user_prompt};
use crate::InferenceError;

/// Budget for the assistant's reply in tokens. Edit-block responses are
/// dominated by SEARCH / REPLACE text, not prose; this leaves room for
/// several blocks while still bounding worst-case latency.
const EDIT_MODE_MAX_TOKENS: u32 = 4_096;

/// Per-call token + cost summary, kept narrow so the type doesn't leak any
/// provider-specific fields. Mirrors what [`LlmResponse`] reports minus the
/// raw text (which lives on [`EditModeResponse`]).
#[derive(Debug, Clone, PartialEq)]
pub struct TokenUsage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub cost_usd: f64,
}

impl From<&LlmResponse> for TokenUsage {
    fn from(r: &LlmResponse) -> Self {
        Self {
            prompt_tokens: r.prompt_tokens,
            completion_tokens: r.completion_tokens,
            cost_usd: r.cost_usd,
        }
    }
}

/// Input to [`run_edit_mode`].
#[derive(Debug, Clone)]
pub struct EditModeRequest {
    /// What the user said — the imperative for the model to act on.
    pub user_text: String,
    /// Optional language hint shown to the model (e.g. "rust", "typescript").
    pub language: Option<String>,
    /// Files currently open in the editor, in user-visible order. Each tuple
    /// is `(relative_path, full_content)`.
    pub open_files: Vec<(PathBuf, String)>,
    /// Root of the user's workspace. All apply paths are resolved relative
    /// to this directory; [`eri_apply::apply`] enforces no traversal escapes.
    pub workspace_root: PathBuf,
}

/// Output of [`run_edit_mode`]. The caller decides whether to surface
/// apply failures to the user — this function reports them verbatim.
#[derive(Debug)]
pub struct EditModeResponse {
    pub raw_model_output: String,
    pub edits: Vec<eri_apply::Edit>,
    pub apply_report: eri_apply::ApplyReport,
    pub usage: Option<TokenUsage>,
}

/// Streaming events emitted by [`run_edit_mode_streaming`].
///
/// `Token` fires for every model delta; `EditApplied` / `EditFailed` fire
/// as individual blocks complete (the streaming parser holds back partial
/// blocks until they're terminated); `Done` fires once with the final
/// rolled-up response so the caller can flush summary UI.
#[derive(Debug)]
pub enum StreamEvent {
    Token(String),
    EditApplied(eri_apply::Applied),
    EditFailed(eri_apply::Failed),
    Done(EditModeResponse),
}

/// One-shot edit-mode call: prompt the provider, parse search/replace
/// blocks out of its response, and apply them atomically.
///
/// The function is intentionally synchronous to match the existing
/// [`LlmProvider`] trait — that trait is a sync surface today, and adding
/// async would force a tokio dep into every caller. If/when the trait
/// gains an async variant we can ship an `async` mirror alongside this one.
pub fn run_edit_mode(
    req: EditModeRequest,
    provider: &dyn LlmProvider,
) -> Result<EditModeResponse, InferenceError> {
    let system = edit_mode_system_prompt(req.language.as_deref());
    let user = edit_mode_user_prompt(&req.user_text, &req.open_files);
    let response = provider.complete(&system, &user, EDIT_MODE_MAX_TOKENS)?;
    let edits = eri_apply::parse(&response.text);
    let apply_report = eri_apply::apply(&edits, &req.workspace_root);
    Ok(EditModeResponse {
        raw_model_output: response.text.clone(),
        edits,
        apply_report,
        usage: Some(TokenUsage::from(&response)),
    })
}

/// Streaming edit-mode call: surfaces tokens, then per-block applies, then
/// a final `Done` event.
///
/// Today the underlying [`LlmProvider::stream`] only delivers token deltas;
/// there is no hook for "block complete" mid-stream. We approximate by
/// buffering deltas and feeding [`eri_apply::parse_streaming`] each time a
/// REPLACE marker is observed in the accumulated buffer, so the editor sees
/// edits land file-by-file rather than at the end.
pub fn run_edit_mode_streaming(
    req: EditModeRequest,
    provider: &dyn LlmProvider,
    mut on_event: impl FnMut(StreamEvent),
) -> Result<EditModeResponse, InferenceError> {
    let system = edit_mode_system_prompt(req.language.as_deref());
    let user = edit_mode_user_prompt(&req.user_text, &req.open_files);

    // Shared buffers for the on_token callback to feed.
    let buffer = std::cell::RefCell::new(String::new());
    let applied_acc = std::cell::RefCell::new(Vec::<eri_apply::Applied>::new());
    let failed_acc = std::cell::RefCell::new(Vec::<eri_apply::Failed>::new());
    let edits_acc = std::cell::RefCell::new(Vec::<eri_apply::Edit>::new());
    let on_event_cell = std::cell::RefCell::new(&mut on_event);

    let response = {
        let workspace_root = req.workspace_root.clone();
        let mut on_token = |delta: &str| {
            on_event_cell.borrow_mut()(StreamEvent::Token(delta.to_string()));
            let mut buf = buffer.borrow_mut();
            buf.push_str(delta);
            // Only attempt to drain complete blocks when we've actually seen
            // a closing marker — avoids re-scanning on every token.
            if !buf.contains(">>>>>>> REPLACE") {
                return;
            }
            let new_edits = eri_apply::parse_streaming(&mut buf);
            if new_edits.is_empty() {
                return;
            }
            let report = eri_apply::apply(&new_edits, &workspace_root);
            edits_acc.borrow_mut().extend(new_edits);
            for applied in report.applied {
                on_event_cell.borrow_mut()(StreamEvent::EditApplied(applied.clone()));
                applied_acc.borrow_mut().push(applied);
            }
            for failed in report.failed {
                on_event_cell.borrow_mut()(StreamEvent::EditFailed(failed.clone()));
                failed_acc.borrow_mut().push(failed);
            }
        };
        provider.stream(&system, &user, EDIT_MODE_MAX_TOKENS, &mut on_token)?
    };

    // Final sweep: catch any blocks that trailed in after the last token
    // (some providers flush the closing marker as part of the terminator).
    let trailing = {
        let mut buf = buffer.borrow_mut();
        eri_apply::parse_streaming(&mut buf)
    };
    if !trailing.is_empty() {
        let report = eri_apply::apply(&trailing, &req.workspace_root);
        edits_acc.borrow_mut().extend(trailing);
        for applied in report.applied {
            on_event_cell.borrow_mut()(StreamEvent::EditApplied(applied.clone()));
            applied_acc.borrow_mut().push(applied);
        }
        for failed in report.failed {
            on_event_cell.borrow_mut()(StreamEvent::EditFailed(failed.clone()));
            failed_acc.borrow_mut().push(failed);
        }
    }

    let final_response = EditModeResponse {
        raw_model_output: response.text.clone(),
        edits: edits_acc.into_inner(),
        apply_report: eri_apply::ApplyReport {
            applied: applied_acc.into_inner(),
            failed: failed_acc.into_inner(),
        },
        usage: Some(TokenUsage::from(&response)),
    };
    let report_for_done = EditModeResponse {
        raw_model_output: final_response.raw_model_output.clone(),
        edits: final_response.edits.clone(),
        apply_report: eri_apply::ApplyReport {
            applied: final_response.apply_report.applied.clone(),
            failed: final_response.apply_report.failed.clone(),
        },
        usage: final_response.usage.clone(),
    };
    on_event(StreamEvent::Done(report_for_done));
    Ok(final_response)
}

/// Preferred new dispatcher for `Intent::Iteration`. Symmetric with the
/// existing per-backend `iterate` path but routes through the search/replace
/// pipeline instead of asking for full-file output. Coexists with the
/// legacy path until Mercury's block-emit quality is validated in the field.
pub fn run_iteration_via_edit_blocks(
    req: EditModeRequest,
    provider: &dyn LlmProvider,
) -> Result<EditModeResponse, InferenceError> {
    run_edit_mode(req, provider)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    use tempfile::TempDir;

    /// Canned provider that returns a fixed text without touching the network.
    struct CannedProvider {
        text: String,
        called: AtomicBool,
    }
    impl CannedProvider {
        fn new(text: &str) -> Self {
            Self {
                text: text.to_string(),
                called: AtomicBool::new(false),
            }
        }
    }
    impl LlmProvider for CannedProvider {
        fn name(&self) -> &'static str {
            "canned"
        }
        fn model(&self) -> &str {
            "canned-1"
        }
        fn complete(
            &self,
            _system: &str,
            _user: &str,
            _max_tokens: u32,
        ) -> Result<LlmResponse, InferenceError> {
            self.called.store(true, Ordering::SeqCst);
            Ok(LlmResponse {
                text: self.text.clone(),
                prompt_tokens: 12,
                completion_tokens: 34,
                cost_usd: 0.001,
            })
        }
        fn stream(
            &self,
            _system: &str,
            _user: &str,
            _max_tokens: u32,
            on_token: &mut dyn FnMut(&str),
        ) -> Result<LlmResponse, InferenceError> {
            // Emit the canned response in a few chunks so the streaming path
            // exercises mid-buffer parsing.
            let chunks: Vec<&str> = self.text.split_inclusive('\n').collect();
            for c in chunks {
                on_token(c);
            }
            Ok(LlmResponse {
                text: self.text.clone(),
                prompt_tokens: 12,
                completion_tokens: 34,
                cost_usd: 0.001,
            })
        }
    }

    fn write_seed(root: &std::path::Path, rel: &str, body: &str) {
        let p = root.join(rel);
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(p, body).unwrap();
    }

    #[test]
    fn run_edit_mode_applies_two_blocks() {
        let dir = TempDir::new().unwrap();
        write_seed(dir.path(), "a.txt", "alpha\nbeta\n");
        write_seed(dir.path(), "b.txt", "first\nsecond\n");

        let canned = CannedProvider::new(
            "<<<<<<< SEARCH a.txt\nalpha\n=======\nALPHA\n>>>>>>> REPLACE\n\
             <<<<<<< SEARCH b.txt\nsecond\n=======\nSECOND\n>>>>>>> REPLACE\n",
        );

        let req = EditModeRequest {
            user_text: "uppercase both".to_string(),
            language: Some("text".to_string()),
            open_files: vec![],
            workspace_root: dir.path().to_path_buf(),
        };

        let resp = run_edit_mode(req, &canned).expect("edit mode ok");
        assert!(canned.called.load(Ordering::SeqCst));
        assert_eq!(resp.edits.len(), 2);
        assert_eq!(resp.apply_report.applied.len(), 2);
        assert!(resp.apply_report.failed.is_empty());
        assert_eq!(
            std::fs::read_to_string(dir.path().join("a.txt")).unwrap(),
            "ALPHA\nbeta\n"
        );
        assert_eq!(
            std::fs::read_to_string(dir.path().join("b.txt")).unwrap(),
            "first\nSECOND\n"
        );
        let usage = resp.usage.expect("usage present");
        assert_eq!(usage.prompt_tokens, 12);
        assert_eq!(usage.completion_tokens, 34);
    }

    #[test]
    fn run_edit_mode_reports_apply_failures_without_erroring() {
        let dir = TempDir::new().unwrap();
        write_seed(dir.path(), "a.txt", "hello\n");
        let canned = CannedProvider::new(
            "<<<<<<< SEARCH a.txt\nNOPE\n=======\nX\n>>>>>>> REPLACE\n",
        );
        let req = EditModeRequest {
            user_text: "won't match".to_string(),
            language: None,
            open_files: vec![],
            workspace_root: dir.path().to_path_buf(),
        };
        let resp = run_edit_mode(req, &canned).expect("call succeeds");
        assert_eq!(resp.apply_report.applied.len(), 0);
        assert_eq!(resp.apply_report.failed.len(), 1);
        // File untouched.
        assert_eq!(
            std::fs::read_to_string(dir.path().join("a.txt")).unwrap(),
            "hello\n"
        );
    }

    #[test]
    fn streaming_emits_tokens_and_applied_events() {
        let dir = TempDir::new().unwrap();
        write_seed(dir.path(), "a.txt", "alpha\n");
        let canned = CannedProvider::new(
            "<<<<<<< SEARCH a.txt\nalpha\n=======\nALPHA\n>>>>>>> REPLACE\n",
        );
        let req = EditModeRequest {
            user_text: "uppercase".to_string(),
            language: None,
            open_files: vec![],
            workspace_root: dir.path().to_path_buf(),
        };
        let mut token_count = 0usize;
        let mut applied_count = 0usize;
        let mut done_seen = false;
        let resp = run_edit_mode_streaming(req, &canned, |ev| match ev {
            StreamEvent::Token(_) => token_count += 1,
            StreamEvent::EditApplied(_) => applied_count += 1,
            StreamEvent::EditFailed(_) => {}
            StreamEvent::Done(_) => done_seen = true,
        })
        .expect("stream ok");
        assert!(token_count > 0);
        assert_eq!(applied_count, 1);
        assert!(done_seen);
        assert_eq!(resp.apply_report.applied.len(), 1);
        assert_eq!(
            std::fs::read_to_string(dir.path().join("a.txt")).unwrap(),
            "ALPHA\n"
        );
    }
}
