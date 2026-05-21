use std::path::PathBuf;

use eri_core::{Bounds, GazeTarget, IterEvent, LineRange, PromptCtx, SourceHint};
use eri_inference::MockDiffusionBackend;
use eri_iterator::{IteratorRuntime, RuntimeInput};

#[test]
fn typed_inputs_drive_mock_iteration_into_candidate_patch() {
    let mut runtime = IteratorRuntime::new(PromptCtx::default(), MockDiffusionBackend);
    let path = PathBuf::from("src/App.tsx");

    runtime.submit(RuntimeInput::OpenFile {
        path: path.clone(),
        text: "button { background: blue; }".into(),
    });
    runtime.submit(RuntimeInput::Gaze(GazeTarget::Preview {
        element_label: Some("Subscribe".into()),
        bounds: Bounds::new(10.0, 20.0, 120.0, 36.0),
        source_hint: Some(SourceHint::new(
            path.clone(),
            LineRange::new(1, 1),
            Some("button.subscribe".into()),
        )),
        confidence: 0.82,
    }));

    let outcome = runtime.submit(RuntimeInput::CommitSpeech(
        "make the button I am looking at red".into(),
    ));

    assert_eq!(outcome.iteration, runtime.ctx().active_iteration());
    assert!(outcome
        .events
        .iter()
        .any(|event| matches!(event, IterEvent::CandidatePatch { patch } if patch.path == path && patch.new_text.contains("red"))));
    assert_eq!(runtime.ctx().candidate_patches().len(), 1);
}

#[test]
fn partial_input_restarts_iteration_without_spending_speech_budget() {
    let mut runtime = IteratorRuntime::new(PromptCtx::default(), MockDiffusionBackend);

    let outcome = runtime.submit(RuntimeInput::PartialSpeech("make this".into()));

    assert_eq!(runtime.ctx().partial_transcript(), Some("make this"));
    assert_eq!(runtime.ctx().iteration_budget(), 0);
    assert_eq!(outcome.iteration, runtime.ctx().active_iteration());
}

#[test]
fn partial_input_stream_drives_mock_candidate_patch() {
    let mut runtime = IteratorRuntime::new(PromptCtx::default(), MockDiffusionBackend);
    let path = PathBuf::from("src/App.tsx");

    runtime.submit(RuntimeInput::OpenFile {
        path: path.clone(),
        text: "button { background: blue; }".into(),
    });
    runtime.submit(RuntimeInput::Gaze(GazeTarget::Preview {
        element_label: Some("Subscribe".into()),
        bounds: Bounds::new(10.0, 20.0, 120.0, 36.0),
        source_hint: Some(SourceHint::new(
            path.clone(),
            LineRange::new(1, 1),
            Some("button.subscribe".into()),
        )),
        confidence: 0.82,
    }));

    let outcome = runtime.submit(RuntimeInput::PartialSpeech(
        "make the button I am looking at red".into(),
    ));

    assert_eq!(
        runtime.ctx().partial_transcript(),
        Some("make the button I am looking at red")
    );
    assert_eq!(runtime.ctx().iteration_budget(), 0);
    assert!(outcome
        .events
        .iter()
        .any(|event| matches!(event, IterEvent::CandidatePatch { patch } if patch.path == path && patch.new_text.contains("red"))));
    assert_eq!(runtime.ctx().candidate_patches().len(), 1);
}
