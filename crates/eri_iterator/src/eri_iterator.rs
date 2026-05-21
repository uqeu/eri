use std::path::PathBuf;

use eri_core::{GazeTarget, IterEvent, PromptCtx, SourceRange};
use eri_inference::{InferenceBackend, IterationRequest};

mod handoff;
pub mod rate_limit;
pub use handoff::HandoffFile;
pub use rate_limit::{
    DEFAULT_PER_USER_COOLDOWN_SECONDS, DEFAULT_PER_USER_DAILY_LIMIT,
    DEFAULT_PER_USER_DAILY_USD_LIMIT, Decision, RateLimiter,
};

#[derive(Clone, Debug, PartialEq)]
pub enum RuntimeInput {
    OpenFile { path: PathBuf, text: String },
    Gaze(GazeTarget),
    PartialSpeech(String),
    CommitSpeech(String),
    EditorSelection(SourceRange),
}

#[derive(Clone, Debug, PartialEq)]
pub struct IterationOutcome {
    pub iteration: u64,
    pub events: Vec<IterEvent>,
}

#[derive(Debug)]
pub struct IteratorRuntime<B> {
    ctx: PromptCtx,
    backend: B,
}

impl<B: InferenceBackend> IteratorRuntime<B> {
    pub fn new(ctx: PromptCtx, backend: B) -> Self {
        Self { ctx, backend }
    }

    pub fn ctx(&self) -> &PromptCtx {
        &self.ctx
    }

    pub fn ctx_mut(&mut self) -> &mut PromptCtx {
        &mut self.ctx
    }

    pub fn submit(&mut self, input: RuntimeInput) -> IterationOutcome {
        // Gaze updates are UI hints only — they update the target without
        // restarting the iteration or rerunning the mock backend, so a
        // 12 Hz gaze stream cannot wipe a Mercury draft that just landed.
        if let RuntimeInput::Gaze(target) = input {
            let iteration = self.ctx.set_gaze_target(target);
            return IterationOutcome {
                iteration,
                events: Vec::new(),
            };
        }

        let iteration = match input {
            RuntimeInput::OpenFile { path, text } => self.ctx.set_file_context(path, text),
            RuntimeInput::Gaze(_) => unreachable!("handled above"),
            RuntimeInput::PartialSpeech(chunk) => self.ctx.update_partial_transcript(chunk),
            RuntimeInput::CommitSpeech(chunk) => self.ctx.commit_transcript_chunk(chunk),
            RuntimeInput::EditorSelection(selection) => self.ctx.set_editor_selection(selection),
        };

        let denoising_steps = self.ctx.iteration_budget().max(1);
        let request = IterationRequest::new(denoising_steps, None);
        let mut events = match self.backend.iterate(&self.ctx, request) {
            Ok(events) => events,
            Err(error) => vec![IterEvent::Error {
                message: error.to_string(),
            }],
        };

        for event in events.clone() {
            if let Err(error) = self.ctx.apply_iter_event(iteration, event) {
                events.push(IterEvent::Error {
                    message: error.to_string(),
                });
                break;
            }
        }

        IterationOutcome { iteration, events }
    }
}
