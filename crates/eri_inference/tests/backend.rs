use std::path::PathBuf;

use eri_core::{Bounds, GazeTarget, IterEvent, LineRange, PromptCtx, SourceHint};
use eri_inference::{
    AgentBackend, AgentChoice, ClaudeCliBackend, DreamSidecarBackend, GooseCliBackend,
    InferenceBackend, IterationRequest, MockDiffusionBackend, StaticSidecarTransport,
    extract_replacement_between,
};

#[test]
fn extract_replacement_between_returns_middle_slice_when_bounds_match() {
    let prefix = "fn outer() {\n    let x = 1;\n";
    let suffix = "\n}\n";
    let original_mid = "    let y = old();";
    let proposed_mid = "    let y = new_async().await?;";
    let merged_old = format!("{prefix}{original_mid}{suffix}");
    let merged_new = format!("{prefix}{proposed_mid}{suffix}");

    // Full merged file with the new middle reproduces the prefix/suffix
    // byte-for-byte, so the extractor returns the proposed replacement.
    let extracted = extract_replacement_between(&merged_new, prefix, suffix);
    assert_eq!(extracted.as_deref(), Some(proposed_mid));

    // Sanity: passing the original through still works.
    let extracted_old = extract_replacement_between(&merged_old, prefix, suffix);
    assert_eq!(extracted_old.as_deref(), Some(original_mid));
}

#[test]
fn extract_replacement_between_rejects_partial_stream() {
    // Mid-stream Mercury hasn't yet emitted the suffix — extractor must
    // return None so the caller waits for more chunks.
    let prefix = "PREFIX";
    let suffix = "SUFFIX";
    let partial = "PREFIXmiddle_inflight";
    assert!(extract_replacement_between(partial, prefix, suffix).is_none());
}

#[test]
fn mock_backend_streams_patch_for_red_button_intent() {
    let mut ctx = PromptCtx::default();
    ctx.set_file_context(
        PathBuf::from("src/App.tsx"),
        "button { background: blue; }".into(),
    );
    ctx.set_gaze_target(GazeTarget::Preview {
        element_label: Some("Subscribe".into()),
        bounds: Bounds::new(10.0, 20.0, 120.0, 36.0),
        source_hint: Some(SourceHint::new(
            PathBuf::from("src/App.tsx"),
            LineRange::new(1, 1),
            Some("button.subscribe".into()),
        )),
        confidence: 0.8,
    });
    ctx.commit_transcript_chunk("make the button I am looking at red");

    let events = MockDiffusionBackend
        .iterate(&ctx, IterationRequest::new(ctx.iteration_budget(), None))
        .unwrap();

    assert!(events.iter().any(|event| matches!(event, IterEvent::DenoisingStep { step, total } if *step == 1 && *total == 16)));
    assert!(
        events
            .iter()
            .any(|event| matches!(event, IterEvent::DraftToken { text } if text.contains("red")))
    );
    assert!(events.iter().any(|event| matches!(event, IterEvent::CandidatePatch { patch } if patch.path.as_path() == std::path::Path::new("src/App.tsx") && patch.new_text.contains("background: red"))));
    assert!(events.iter().any(|event| matches!(event, IterEvent::Done)));
}

#[test]
fn dream_sidecar_backend_posts_iterate_contract_and_decodes_events() {
    let transport = StaticSidecarTransport::responding_with(
        r#"[{"type":"draft_token","text":"draft"},{"type":"done"}]"#,
    );
    let backend = DreamSidecarBackend::new("http://127.0.0.1:8765", transport);
    let mut ctx = PromptCtx::default();
    ctx.commit_transcript_chunk("make this red");

    let events = backend
        .iterate(
            &ctx,
            IterationRequest::new(24, Some("current draft".into())),
        )
        .unwrap();

    assert_eq!(backend.endpoint(), "http://127.0.0.1:8765/iterate");
    assert_eq!(
        backend.last_request_body().unwrap(),
        r#"{"prompt_ctx":{"transcript":["make this red"],"partial_transcript":null,"gaze_target":{"type":"unknown","confidence":0.0},"editor_selection":null,"open_files":[],"current_draft":"","candidate_patches":[],"decisions":[],"iteration_budget":16,"active_iteration":1},"denoising_steps":24,"current_draft":"current draft"}"#
    );
    assert_eq!(
        events,
        vec![
            IterEvent::DraftToken {
                text: "draft".into()
            },
            IterEvent::Done
        ]
    );
}

/// Build a real `ClaudeCliBackend` without depending on the `claude` binary
/// being installed. We use the existing `ERI_CLAUDE_BIN` env override to
/// point `detect()` at `/bin/echo` (present on every UNIX host) — the CLI
/// is never actually invoked in these tests, we only need a `Some(_)`.
fn stub_claude() -> ClaudeCliBackend {
    if let Some(backend) = ClaudeCliBackend::detect() {
        return backend;
    }
    let previous = std::env::var("ERI_CLAUDE_BIN").ok();
    // SAFETY: cargo runs each integration test file as its own binary and
    // tests within a file are single-threaded by default. We restore the env
    // var immediately so neighbours don't observe the stub.
    unsafe { std::env::set_var("ERI_CLAUDE_BIN", "/bin/echo") };
    let backend = ClaudeCliBackend::detect().expect("/bin/echo as stub claude");
    match previous {
        Some(value) => unsafe { std::env::set_var("ERI_CLAUDE_BIN", value) },
        None => unsafe { std::env::remove_var("ERI_CLAUDE_BIN") },
    }
    backend
}

fn stub_goose() -> GooseCliBackend {
    if let Some(backend) = GooseCliBackend::detect() {
        return backend;
    }
    let previous = std::env::var("ERI_GOOSE_BIN").ok();
    // SAFETY: see `stub_claude`.
    unsafe { std::env::set_var("ERI_GOOSE_BIN", "/bin/echo") };
    let backend = GooseCliBackend::detect().expect("/bin/echo as stub goose");
    match previous {
        Some(value) => unsafe { std::env::set_var("ERI_GOOSE_BIN", value) },
        None => unsafe { std::env::remove_var("ERI_GOOSE_BIN") },
    }
    backend
}

#[test]
fn agent_backend_picks_claude_when_env_says_claude() {
    // Both backends are "installed"; env preference picks Claude.
    let picked = AgentBackend::detect_with(
        Some(AgentChoice::Claude),
        || Some(stub_claude()),
        || Some(stub_goose()),
    )
    .expect("backend resolves");
    assert_eq!(picked.choice(), AgentChoice::Claude);
    assert_eq!(picked.label(), "claude");
}

#[test]
fn agent_backend_picks_goose_when_env_says_goose_and_goose_installed() {
    let picked = AgentBackend::detect_with(
        Some(AgentChoice::Goose),
        || Some(stub_claude()),
        || Some(stub_goose()),
    )
    .expect("backend resolves");
    assert_eq!(picked.choice(), AgentChoice::Goose);
    assert_eq!(picked.label(), "goose");
}

#[test]
fn agent_backend_falls_back_to_claude_when_goose_missing() {
    // Env asks for Goose but Goose isn't installed — must fall back to
    // Claude rather than returning None outright.
    let picked =
        AgentBackend::detect_with(Some(AgentChoice::Goose), || Some(stub_claude()), || None)
            .expect("falls back to claude");
    assert_eq!(picked.choice(), AgentChoice::Claude);
}

#[test]
fn agent_backend_returns_none_when_neither_installed() {
    let picked = AgentBackend::detect_with(None, || None, || None);
    assert!(picked.is_none());
}

#[test]
fn agent_backend_no_env_prefers_claude_when_both_present() {
    let picked = AgentBackend::detect_with(None, || Some(stub_claude()), || Some(stub_goose()))
        .expect("backend resolves");
    assert_eq!(picked.choice(), AgentChoice::Claude);
}
