use std::path::PathBuf;

use eri_core::{
    Bounds, CandidatePatch, ControlCommand, GazeTarget, IdeAction, IterEvent, LineRange,
    PatchStage, PatchStatus, PreviewWidth, PromptCtx, SourceHint, SourceRange,
};

#[test]
fn committed_speech_updates_context_and_iteration_budget() {
    let mut ctx = PromptCtx::default();
    let initial_iteration = ctx.active_iteration();

    let next_iteration = ctx.commit_transcript_chunk("make this red");

    assert_ne!(next_iteration, initial_iteration);
    assert_eq!(ctx.transcript(), &["make this red".to_string()]);
    assert_eq!(ctx.partial_transcript(), None);
    assert_eq!(ctx.iteration_budget(), 16);
}

#[test]
fn partial_speech_cancels_stale_iterations() {
    let mut ctx = PromptCtx::default();
    let first_iteration = ctx.active_iteration();

    let partial_iteration = ctx.update_partial_transcript("make this");
    assert!(!ctx.is_current_iteration(first_iteration));
    assert!(ctx.is_current_iteration(partial_iteration));
}

#[test]
fn gaze_updates_do_not_invalidate_in_flight_iteration() {
    // Gaze is a UI hint; a 12 Hz gaze stream must not wipe a remote LLM's
    // in-flight draft, so set_gaze_target leaves the iteration counter alone.
    let mut ctx = PromptCtx::default();
    let baseline = ctx.update_partial_transcript("make this");

    let gaze_iteration = ctx.set_gaze_target(GazeTarget::Preview {
        element_label: Some("Subscribe".into()),
        bounds: Bounds::new(10.0, 20.0, 120.0, 36.0),
        source_hint: Some(SourceHint::new(
            PathBuf::from("src/App.tsx"),
            LineRange::new(12, 14),
            Some("button.subscribe".into()),
        )),
        confidence: 0.72,
    });

    assert_eq!(gaze_iteration, baseline);
    assert!(ctx.is_current_iteration(baseline));
}

#[test]
fn stale_iteration_events_are_ignored() {
    let mut ctx = PromptCtx::default();
    let stale_iteration = ctx.active_iteration();
    let current_iteration = ctx.commit_transcript_chunk("make this red");

    ctx.apply_iter_event(
        stale_iteration,
        IterEvent::DraftToken {
            text: "stale".into(),
        },
    )
    .unwrap();
    ctx.apply_iter_event(
        current_iteration,
        IterEvent::DraftToken {
            text: "current".into(),
        },
    )
    .unwrap();

    assert_eq!(ctx.current_draft(), "current");
}

#[test]
fn restarted_iteration_clears_stale_candidate_patches() {
    let mut ctx = PromptCtx::default();
    let iteration = ctx.commit_transcript_chunk("make this red");
    ctx.apply_iter_event(
        iteration,
        IterEvent::CandidatePatch {
            patch: CandidatePatch::replace_text(
                1,
                PathBuf::from("src/App.tsx"),
                "button { background: blue; }",
                "button { background: red; }",
            ),
        },
    )
    .unwrap();

    assert_eq!(ctx.candidate_patches().len(), 1);

    ctx.update_partial_transcript("try blue instead");

    assert!(ctx.candidate_patches().is_empty());
}

#[test]
fn editor_selection_updates_source_target_context() {
    let mut ctx = PromptCtx::default();
    let selection = SourceRange::new(PathBuf::from("src/App.tsx"), LineRange::new(7, 9));

    ctx.set_editor_selection(selection.clone());

    assert_eq!(ctx.editor_selection(), Some(&selection));
    assert_eq!(
        ctx.gaze_target(),
        &GazeTarget::Editor {
            path: PathBuf::from("src/App.tsx"),
            line_range: LineRange::new(7, 9),
            confidence: 1.0,
        }
    );
}

#[test]
fn voice_confirmation_grammar_parses_control_words() {
    assert_eq!(
        ControlCommand::parse("accept"),
        Some(ControlCommand::Accept)
    );
    assert_eq!(
        ControlCommand::parse("try another"),
        Some(ControlCommand::TryAnother)
    );
    assert_eq!(
        ControlCommand::parse("focus preview"),
        Some(ControlCommand::FocusPreview)
    );
    assert_eq!(
        ControlCommand::parse("please make this red"),
        None,
        "natural language intent must not be mistaken for confirmation"
    );
}

#[test]
fn project_voice_commands_parse_with_names() {
    // "new project <name>" / "start a new <name>"
    assert_eq!(
        ControlCommand::parse("new project coffee shop"),
        Some(ControlCommand::NewProject("coffee shop".into()))
    );
    assert_eq!(
        ControlCommand::parse("start a new portfolio"),
        Some(ControlCommand::NewProject("portfolio".into()))
    );
    // Trailing "project" word is stripped: "start a new portfolio project"
    assert_eq!(
        ControlCommand::parse("create a new project landing page project"),
        Some(ControlCommand::NewProject("landing page".into()))
    );

    // "open <name>" / "load <name>"
    assert_eq!(
        ControlCommand::parse("open coffee shop"),
        Some(ControlCommand::OpenProject("coffee shop".into()))
    );
    assert_eq!(
        ControlCommand::parse("load portfolio."),
        Some(ControlCommand::OpenProject("portfolio".into()))
    );

    // "list projects"
    assert_eq!(
        ControlCommand::parse("list projects"),
        Some(ControlCommand::ListProjects)
    );

    // Empty project name should fail to parse — we never create unnamed dirs.
    assert_eq!(ControlCommand::parse("new project"), None);
    assert_eq!(ControlCommand::parse("open "), None);
}

#[test]
fn mcp_voice_commands_parse() {
    for phrase in [
        "list mcp tools",
        "list tools",
        "show tools",
        "show mcp tools",
        "what tools do you have",
        "what tools do you have?",
        "what tools are available",
    ] {
        assert_eq!(
            ControlCommand::parse(phrase),
            Some(ControlCommand::ListMcpTools),
            "phrase {phrase:?} should map to ListMcpTools",
        );
    }

    for phrase in ["reload mcp", "reload tools", "reload mcp config", "refresh tools"] {
        assert_eq!(
            ControlCommand::parse(phrase),
            Some(ControlCommand::ReloadMcpConfig),
            "phrase {phrase:?} should map to ReloadMcpConfig",
        );
    }
}

#[test]
fn enable_mcp_voice_command_parses() {
    // Every phrasing that should flip the MCP-enabled flag ON. Default is
    // OFF (so we don't accidentally hand Mercury tools the user didn't
    // authorise), and the brief lists exactly these triggers.
    for phrase in [
        "enable mcp tools",
        "enable mcp",
        "use mcp tools",
        "use the mcp tools",
        "give mercury the tools",
        "give mercury the mcp tools",
        "turn on mcp tools",
        "let mercury use mcp tools",
    ] {
        assert_eq!(
            ControlCommand::parse(phrase),
            Some(ControlCommand::EnableMcp),
            "phrase {phrase:?} should map to EnableMcp",
        );
    }

    for phrase in [
        "disable mcp tools",
        "stop using mcp tools",
        "turn off mcp tools",
    ] {
        assert_eq!(
            ControlCommand::parse(phrase),
            Some(ControlCommand::DisableMcp),
            "phrase {phrase:?} should map to DisableMcp",
        );
    }
}

#[test]
fn edit_rules_voice_command_parses() {
    for phrase in [
        "edit rules",
        "edit the rules",
        "edit project rules",
        "edit the rules file",
        "open rules",
        "open the rules file",
        "show project rules",
        "show the rules",
        "what are the rules",
    ] {
        assert_eq!(
            ControlCommand::parse(phrase),
            Some(ControlCommand::EditRules),
            "phrase {phrase:?} should map to EditRules",
        );
    }
}

#[test]
fn scrubber_voice_commands_parse_to_undo_redo_and_go_to() {
    // Undo synonyms collapse to the single Undo command.
    assert_eq!(ControlCommand::parse("undo"), Some(ControlCommand::Undo));
    assert_eq!(ControlCommand::parse("go back"), Some(ControlCommand::Undo));
    assert_eq!(ControlCommand::parse("revert"), Some(ControlCommand::Undo));
    assert_eq!(ControlCommand::parse("revert."), Some(ControlCommand::Undo));

    // Redo synonyms collapse to Redo.
    assert_eq!(ControlCommand::parse("redo"), Some(ControlCommand::Redo));
    assert_eq!(ControlCommand::parse("forward"), Some(ControlCommand::Redo));

    // Numeric jumps.
    assert_eq!(
        ControlCommand::parse("go to iteration 5"),
        Some(ControlCommand::GoToIteration(5))
    );
    assert_eq!(
        ControlCommand::parse("Go to iteration 23."),
        Some(ControlCommand::GoToIteration(23))
    );
    assert_eq!(
        ControlCommand::parse("load 12"),
        Some(ControlCommand::GoToIteration(12))
    );
    assert_eq!(
        ControlCommand::parse("revert to 7"),
        Some(ControlCommand::GoToIteration(7))
    );

    // "load <project-name>" must NOT be mistaken for a numeric jump.
    assert_eq!(
        ControlCommand::parse("load portfolio"),
        Some(ControlCommand::OpenProject("portfolio".to_string()))
    );
}

#[test]
fn retry_voice_commands_parse_to_retry() {
    // Primary phrasings every demo run will use.
    assert_eq!(ControlCommand::parse("try again"), Some(ControlCommand::Retry));
    assert_eq!(ControlCommand::parse("retry"), Some(ControlCommand::Retry));
    assert_eq!(
        ControlCommand::parse("do it again"),
        Some(ControlCommand::Retry)
    );
    assert_eq!(
        ControlCommand::parse("try that again"),
        Some(ControlCommand::Retry)
    );
    // Trailing punctuation from whisper should not break the match.
    assert_eq!(
        ControlCommand::parse("Try again."),
        Some(ControlCommand::Retry)
    );
    assert_eq!(ControlCommand::parse("retry!"), Some(ControlCommand::Retry));

    // "try another" stays distinct (resets the partial instead of replaying).
    assert_eq!(
        ControlCommand::parse("try another"),
        Some(ControlCommand::TryAnother)
    );
    // Random sentences containing the word "try" must not match.
    assert_eq!(ControlCommand::parse("try a red button"), None);
}

#[test]
fn recording_voice_commands_parse_to_start_and_stop() {
    // Start synonyms collapse onto a single StartRecording variant.
    assert_eq!(
        ControlCommand::parse("start recording"),
        Some(ControlCommand::StartRecording)
    );
    assert_eq!(
        ControlCommand::parse("Record this."),
        Some(ControlCommand::StartRecording)
    );
    assert_eq!(
        ControlCommand::parse("start demo"),
        Some(ControlCommand::StartRecording)
    );
    assert_eq!(
        ControlCommand::parse("begin demo!"),
        Some(ControlCommand::StartRecording)
    );

    // Stop synonyms collapse onto StopRecording.
    assert_eq!(
        ControlCommand::parse("stop recording"),
        Some(ControlCommand::StopRecording)
    );
    assert_eq!(
        ControlCommand::parse("Stop demo."),
        Some(ControlCommand::StopRecording)
    );
    assert_eq!(
        ControlCommand::parse("end recording"),
        Some(ControlCommand::StopRecording)
    );
    assert_eq!(
        ControlCommand::parse("finish demo"),
        Some(ControlCommand::StopRecording)
    );

    // "start a new <name>" / "start new <name>" must still create projects —
    // the recording arms must not eat the new-project prefix family.
    assert_eq!(
        ControlCommand::parse("start a new portfolio"),
        Some(ControlCommand::NewProject("portfolio".into()))
    );
    assert_eq!(
        ControlCommand::parse("start new coffee shop"),
        Some(ControlCommand::NewProject("coffee shop".into()))
    );
}

#[test]
fn social_thread_voice_commands_parse_to_generate_and_copy() {
    // "post about this" / "write a thread about this" / "make a tweet about
    // this build" must all route to GenerateSocialThread, beating the
    // NEW_PREFIXES ("make a ...") and TEMPLATE_PREFIXES which would
    // otherwise consume these prefixes as project names.
    for phrase in [
        "post about this",
        "post about this build",
        "write a thread about this",
        "write a thread about this build",
        "make a tweet about this",
        "make a tweet about this build",
        "make a thread",
        "generate social",
        "generate social thread",
        "draft a thread",
        "social post",
        "Post about this.",
        "WRITE A THREAD",
    ] {
        assert_eq!(
            ControlCommand::parse(phrase),
            Some(ControlCommand::GenerateSocialThread),
            "phrase {phrase:?} should map to GenerateSocialThread",
        );
    }

    // Copy variants must beat OPEN_PREFIXES (which would otherwise treat
    // "load thread" / "load that thread" as a project to open).
    for phrase in [
        "copy the thread",
        "copy that thread",
        "copy this thread",
        "copy thread",
        "Copy the thread.",
        "copy social thread",
        "copy social",
    ] {
        assert_eq!(
            ControlCommand::parse(phrase),
            Some(ControlCommand::CopyLastThread),
            "phrase {phrase:?} should map to CopyLastThread",
        );
    }

    // Bare "make a coffee shop" must NOT be hijacked as a social-thread
    // command — the trigger requires the deictic ("this") + tweet/thread.
    assert_ne!(
        ControlCommand::parse("make a pomodoro timer"),
        Some(ControlCommand::GenerateSocialThread)
    );
}

#[test]
fn rewrite_voice_commands_parse_to_rewrite_selection_when_selection_present() {
    // With a selection, a deictic + rewrite-verb phrase becomes a
    // `RewriteSelection` carrying the natural-language instruction.
    assert_eq!(
        ControlCommand::parse_with_selection("make this async", true),
        Some(ControlCommand::RewriteSelection("make this async".into()))
    );
    assert_eq!(
        ControlCommand::parse_with_selection("add error handling here", true),
        Some(ControlCommand::RewriteSelection(
            "add error handling here".into()
        ))
    );
    assert_eq!(
        ControlCommand::parse_with_selection("refactor this to use map.", true),
        Some(ControlCommand::RewriteSelection(
            "refactor this to use map".into()
        ))
    );
    assert_eq!(
        ControlCommand::parse_with_selection("wrap this in a try block", true),
        Some(ControlCommand::RewriteSelection(
            "wrap this in a try block".into()
        ))
    );

    // Without a selection, the same phrases must NOT be hijacked — they
    // either stay None (the build flow then dispatches them as fresh build
    // turns) or otherwise behave the same as before.
    assert_eq!(
        ControlCommand::parse_with_selection("make this async", false),
        None
    );
    assert_eq!(ControlCommand::parse("make this async"), None);

    // Build intents must NEVER route to a rewrite even when a selection
    // exists — "build me a coffee shop" / "make a pomodoro timer" carry no
    // deictic anchor pointing at the selection.
    assert_eq!(
        ControlCommand::parse_with_selection("build me a coffee shop", true),
        None,
        "build intent must not trigger rewrite even with a selection"
    );
    assert_eq!(
        ControlCommand::parse_with_selection("make a pomodoro timer", true),
        None
    );
    // Deictic + build-noun: "make this app dark mode" still reads as a build,
    // not a selection rewrite. The user is naming a new thing they want.
    assert_eq!(
        ControlCommand::parse_with_selection("make this app dark mode", true),
        None
    );
}

#[test]
fn accept_and_reject_voice_commands_route_to_patch_variants_with_selection() {
    // Plain "accept" with no selection keeps the legacy meaning so the
    // existing candidate-patch flow still fires.
    assert_eq!(
        ControlCommand::parse_with_selection("accept", false),
        Some(ControlCommand::Accept)
    );
    assert_eq!(
        ControlCommand::parse_with_selection("reject", false),
        Some(ControlCommand::Reject)
    );

    // With a selection (i.e. an inline rewrite is pending), "accept",
    // "apply", "keep it", "yes" all route to `AcceptPatch`.
    assert_eq!(
        ControlCommand::parse_with_selection("accept", true),
        Some(ControlCommand::AcceptPatch)
    );
    assert_eq!(
        ControlCommand::parse_with_selection("apply", true),
        Some(ControlCommand::AcceptPatch)
    );
    assert_eq!(
        ControlCommand::parse_with_selection("keep it.", true),
        Some(ControlCommand::AcceptPatch)
    );
    assert_eq!(
        ControlCommand::parse_with_selection("yes", true),
        Some(ControlCommand::AcceptPatch)
    );

    // Reject / discard / cancel / no all route to `RejectPatch`.
    assert_eq!(
        ControlCommand::parse_with_selection("reject", true),
        Some(ControlCommand::RejectPatch)
    );
    assert_eq!(
        ControlCommand::parse_with_selection("discard", true),
        Some(ControlCommand::RejectPatch)
    );
    assert_eq!(
        ControlCommand::parse_with_selection("cancel", true),
        Some(ControlCommand::RejectPatch)
    );
    assert_eq!(
        ControlCommand::parse_with_selection("no", true),
        Some(ControlCommand::RejectPatch)
    );
}

#[test]
fn destructive_ide_actions_require_confirmation() {
    assert!(
        !IdeAction::HighlightTarget {
            target: GazeTarget::Unknown { confidence: 0.0 },
        }
        .requires_confirmation()
    );
    assert!(IdeAction::ApplyPatch { patch_id: 1 }.requires_confirmation());
    assert!(IdeAction::OpenTerminal.requires_confirmation());
    assert!(IdeAction::SendToBuilder { command: None }.requires_confirmation());
}

#[test]
fn patch_stage_can_preview_accept_reject_and_undo() {
    let path = PathBuf::from("src/App.tsx");
    let mut stage = PatchStage::new();
    stage.set_file(path.clone(), "button { background: blue; }");

    let patch = CandidatePatch::replace_text(
        1,
        path.clone(),
        "button { background: blue; }",
        "button { background: red; }",
    );
    stage.propose_patch(patch).unwrap();

    assert_eq!(stage.patch_status(1), Some(PatchStatus::Proposed));
    assert_eq!(
        stage.stage_patch(1).unwrap(),
        "button { background: red; }".to_string()
    );
    assert_eq!(stage.patch_status(1), Some(PatchStatus::Staged));

    stage.reject_patch(1).unwrap();
    assert_eq!(stage.file_text(&path), Some("button { background: blue; }"));
    assert_eq!(stage.patch_status(1), Some(PatchStatus::Rejected));

    let second_patch = CandidatePatch::replace_text(
        2,
        path.clone(),
        "button { background: blue; }",
        "button { background: red; }",
    );
    stage.propose_patch(second_patch).unwrap();
    stage.stage_patch(2).unwrap();
    stage.apply_patch(2).unwrap();
    assert_eq!(stage.patch_status(2), Some(PatchStatus::Applied));

    stage.undo_last_patch().unwrap();
    assert_eq!(stage.file_text(&path), Some("button { background: blue; }"));
    assert_eq!(stage.patch_status(2), Some(PatchStatus::Undone));
}

#[test]
fn git_history_voice_commands_parse_to_show_history() {
    assert_eq!(
        ControlCommand::parse("show history"),
        Some(ControlCommand::ShowHistory)
    );
    assert_eq!(
        ControlCommand::parse("show commits"),
        Some(ControlCommand::ShowHistory)
    );
    assert_eq!(
        ControlCommand::parse("git log"),
        Some(ControlCommand::ShowHistory)
    );
    assert_eq!(
        ControlCommand::parse("Show history."),
        Some(ControlCommand::ShowHistory)
    );
    assert_eq!(
        ControlCommand::parse("show iterations"),
        Some(ControlCommand::ShowHistory)
    );
}

#[test]
fn git_revert_voice_commands_parse_to_revert_to_commit() {
    assert_eq!(
        ControlCommand::parse("go back to last commit"),
        Some(ControlCommand::RevertToCommit("last".to_string()))
    );
    assert_eq!(
        ControlCommand::parse("Revert to last commit."),
        Some(ControlCommand::RevertToCommit("last".to_string()))
    );
    assert_eq!(
        ControlCommand::parse("revert to commit abc123"),
        Some(ControlCommand::RevertToCommit("abc123".to_string()))
    );
    assert_eq!(
        ControlCommand::parse("go back to commit deadbeef"),
        Some(ControlCommand::RevertToCommit("deadbeef".to_string()))
    );

    // "revert to <integer>" must remain a scrubber jump, not a commit revert.
    assert_eq!(
        ControlCommand::parse("revert to 7"),
        Some(ControlCommand::GoToIteration(7))
    );
    // Plain "go back" stays an Undo.
    assert_eq!(
        ControlCommand::parse("go back"),
        Some(ControlCommand::Undo)
    );
}

#[test]
fn seo_voice_commands_parse_to_seo_check() {
    for phrase in [
        "check seo",
        "seo check",
        "lighthouse check",
        "run lighthouse",
        "audit seo",
        "audit accessibility",
        "accessibility audit",
        "a11y check",
        "check accessibility",
        "check a11y",
        "Check SEO.",
        "Audit accessibility!",
    ] {
        assert_eq!(
            ControlCommand::parse(phrase),
            Some(ControlCommand::SeoCheck),
            "phrase {phrase:?} should map to SeoCheck",
        );
    }
}

#[test]
fn publish_voice_commands_parse_to_publish_project() {
    for phrase in [
        "publish this",
        "share this",
        "publish",
        "publish it",
        "publish this project",
        "share this project",
        "publish to eri.dev",
        "publish to eri dev",
        "publish to the web",
        "Share this.",
        "Publish this!",
    ] {
        assert_eq!(
            ControlCommand::parse(phrase),
            Some(ControlCommand::PublishProject),
            "phrase {phrase:?} should map to PublishProject",
        );
    }

    // "share" alone is intentionally claimed by the publish path — confirm
    // the bare verb resolves so the UI can disambiguate against e.g.
    // "share screen" (which would carry a noun and not hit this arm).
    assert_eq!(
        ControlCommand::parse("share"),
        Some(ControlCommand::PublishProject),
    );
}

#[test]
fn responsive_preview_phrases_parse_to_set_preview_width() {
    for phrase in [
        "preview as phone",
        "preview as mobile",
        "phone preview",
        "mobile preview",
        "switch to phone",
        "preview as phone.",
    ] {
        assert_eq!(
            ControlCommand::parse(phrase),
            Some(ControlCommand::SetPreviewWidth(PreviewWidth::Phone)),
            "phrase {phrase:?} should select the phone viewport",
        );
    }

    for phrase in [
        "preview as tablet",
        "tablet preview",
        "switch to tablet",
        "show tablet preview",
    ] {
        assert_eq!(
            ControlCommand::parse(phrase),
            Some(ControlCommand::SetPreviewWidth(PreviewWidth::Tablet)),
            "phrase {phrase:?} should select the tablet viewport",
        );
    }

    for phrase in [
        "preview as desktop",
        "desktop preview",
        "full width",
        "full width preview",
        "switch to desktop",
    ] {
        assert_eq!(
            ControlCommand::parse(phrase),
            Some(ControlCommand::SetPreviewWidth(PreviewWidth::Desktop)),
            "phrase {phrase:?} should select the desktop viewport",
        );
    }
}

#[test]
fn preview_width_pixel_values_match_breakpoints() {
    assert_eq!(PreviewWidth::Phone.pixels(), 375);
    assert_eq!(PreviewWidth::Tablet.pixels(), 768);
    // Desktop is "fill the window" — the sidecar reads `0` as the sentinel.
    assert_eq!(PreviewWidth::Desktop.pixels(), 0);
}

#[test]
fn pause_spending_voice_commands_parse_to_pause_spending() {
    for phrase in [
        "pause",
        "pause spending",
        "stop spending",
        "pause the spending",
        "stop the spending",
        "halt spending",
        "Pause.",
        "Pause spending!",
    ] {
        assert_eq!(
            ControlCommand::parse(phrase),
            Some(ControlCommand::PauseSpending),
            "phrase {phrase:?} should map to PauseSpending",
        );
    }
}

#[test]
fn resume_spending_voice_commands_parse_to_resume_spending() {
    for phrase in [
        "resume",
        "resume spending",
        "resume the spending",
        "unpause",
        "unpause spending",
        "continue spending",
        "go ahead",
        "Resume.",
        "Resume spending!",
    ] {
        assert_eq!(
            ControlCommand::parse(phrase),
            Some(ControlCommand::ResumeSpending),
            "phrase {phrase:?} should map to ResumeSpending",
        );
    }
}

#[test]
fn raise_spending_limit_voice_commands_carry_dollar_amount() {
    let cases: &[(&str, f64)] = &[
        ("raise the limit to 5 dollars", 5.0),
        ("raise the limit to 5", 5.0),
        ("raise limit to 2.50", 2.50),
        ("set the spending limit to $10", 10.0),
        ("set spending limit to 1 dollar", 1.0),
        ("raise the cap to 25 bucks", 25.0),
        ("bump the limit to 3", 3.0),
        ("increase the budget to 7 usd", 7.0),
        ("Raise the limit to 5 dollars.", 5.0),
        ("set the budget to $0.50", 0.5),
    ];
    for (phrase, expected) in cases {
        assert_eq!(
            ControlCommand::parse(phrase),
            Some(ControlCommand::RaiseSpendingLimit(*expected)),
            "phrase {phrase:?} should map to RaiseSpendingLimit({expected})",
        );
    }

    // Zero / negative / non-numeric tails must reject so the parser falls
    // through to other arms instead of accepting a junk limit.
    assert_eq!(ControlCommand::parse("raise the limit to zero"), None);
    assert_eq!(ControlCommand::parse("raise the limit to -5"), None);
    assert_eq!(ControlCommand::parse("raise the limit to 0"), None);
}

#[test]
fn show_spending_voice_commands_parse_to_show_spending() {
    for phrase in [
        "show cost",
        "show costs",
        "show the cost",
        "show spending",
        "show my spending",
        "show budget",
        "show my budget",
        "what's my spending",
        "what is my spending",
        "how much have i spent",
        "how much did i spend",
        "what have i spent",
        "Show cost.",
    ] {
        assert_eq!(
            ControlCommand::parse(phrase),
            Some(ControlCommand::ShowSpending),
            "phrase {phrase:?} should map to ShowSpending",
        );
    }
}

#[test]
fn switch_agent_voice_command_parses() {
    for phrase in [
        "use goose",
        "switch to goose",
        "switch agent to goose",
        "use the goose agent",
        "use the goose backend",
        "switch backend to goose",
        "Use Goose.",
    ] {
        assert_eq!(
            ControlCommand::parse(phrase),
            Some(ControlCommand::SwitchAgent("goose".into())),
            "phrase {phrase:?} should map to SwitchAgent(goose)",
        );
    }

    for phrase in [
        "use claude",
        "use claude code",
        "switch to claude",
        "switch to claude code",
        "switch agent to claude",
        "use the claude agent",
        "use the claude backend",
        "switch backend to claude",
        "Use Claude.",
    ] {
        assert_eq!(
            ControlCommand::parse(phrase),
            Some(ControlCommand::SwitchAgent("claude".into())),
            "phrase {phrase:?} should map to SwitchAgent(claude)",
        );
    }

    // "use the X template" must NOT be hijacked by the agent-switch arms.
    assert_eq!(
        ControlCommand::parse("use the portfolio template"),
        Some(ControlCommand::UseTemplate("portfolio".into())),
    );
}

#[test]
fn clone_my_voice_phrases_parse() {
    for phrase in [
        "clone my voice",
        "clone my voice.",
        "Clone my voice!",
        "use my voice",
        "use my own voice",
        "make eri sound like me",
        "make eri talk like me",
        "sound like me",
        "talk like me",
        "voice clone",
        "record my voice",
    ] {
        assert_eq!(
            ControlCommand::parse(phrase),
            Some(ControlCommand::CloneMyVoice),
            "phrase {phrase:?} should map to CloneMyVoice",
        );
    }

    // "use my voice" must NOT be hijacked by the template-seed prefix arms
    // ("use ..." can otherwise match `UseTemplate`). Without `template` in
    // the suffix, the template arm bails — the dedicated literal arm wins.
    assert_eq!(
        ControlCommand::parse("use the portfolio template"),
        Some(ControlCommand::UseTemplate("portfolio".into())),
    );
}

#[test]
fn theme_voice_commands_parse_with_palette_names() {
    use eri_core::ControlCommand;

    assert_eq!(
        ControlCommand::parse("use stripe colors"),
        Some(ControlCommand::SetTheme("stripe".into()))
    );
    assert_eq!(
        ControlCommand::parse("use the cyberpunk palette"),
        Some(ControlCommand::SetTheme("cyberpunk".into()))
    );
    assert_eq!(
        ControlCommand::parse("Use the Coffee Shop palette."),
        Some(ControlCommand::SetTheme("coffee shop".into()))
    );
    assert_eq!(
        ControlCommand::parse("make it look like linear"),
        Some(ControlCommand::SetTheme("linear".into()))
    );
    assert_eq!(
        ControlCommand::parse("theme it like a coffee shop"),
        Some(ControlCommand::SetTheme("a coffee shop".into()))
    );
    assert_eq!(
        ControlCommand::parse("use the stripe color scheme"),
        Some(ControlCommand::SetTheme("stripe".into()))
    );

    // Must NOT hijack the template-seed prefix.
    assert_eq!(
        ControlCommand::parse("use the portfolio template"),
        Some(ControlCommand::UseTemplate("portfolio".into()))
    );
    // Must NOT hijack agent switch.
    assert_eq!(
        ControlCommand::parse("use goose"),
        Some(ControlCommand::SwitchAgent("goose".into()))
    );
}

#[test]
fn ui_theme_voice_commands_route_to_set_ui_theme() {
    use eri_core::ControlCommand;

    // Known eri_theme ids + names beat the SetTheme directive when the
    // suffix is "theme" / "themes". Mercury directives still win for
    // generic "palette" / "colors" suffixes.
    assert_eq!(
        ControlCommand::parse("use the midnight theme"),
        Some(ControlCommand::SetUiTheme("midnight".into()))
    );
    assert_eq!(
        ControlCommand::parse("switch to the eri noir theme"),
        Some(ControlCommand::SetUiTheme("eri noir".into()))
    );
    assert_eq!(
        ControlCommand::parse("use the cyberpunk theme"),
        Some(ControlCommand::SetUiTheme("cyberpunk".into()))
    );

    // Generic / unknown palette suffix still routes to Mercury directive.
    assert_eq!(
        ControlCommand::parse("use the cyberpunk palette"),
        Some(ControlCommand::SetTheme("cyberpunk".into()))
    );
}

#[test]
fn list_themes_phrases_parse_to_list_themes() {
    use eri_core::ControlCommand;

    for phrase in [
        "list themes",
        "show themes",
        "list all themes",
        "what themes do you have",
        "what themes can i use",
    ] {
        assert_eq!(
            ControlCommand::parse(phrase),
            Some(ControlCommand::ListThemes),
            "phrase: {phrase}"
        );
    }
}

#[test]
fn dark_and_light_mode_phrases_parse_to_set_ui_theme_mode() {
    use eri_core::ControlCommand;

    for phrase in ["dark mode", "use dark mode", "switch to dark mode", "make it dark"] {
        assert_eq!(
            ControlCommand::parse(phrase),
            Some(ControlCommand::SetUiThemeMode("dark".into())),
            "phrase: {phrase}"
        );
    }
    for phrase in ["light mode", "use light mode", "switch to light mode", "make it light"] {
        assert_eq!(
            ControlCommand::parse(phrase),
            Some(ControlCommand::SetUiThemeMode("light".into())),
            "phrase: {phrase}"
        );
    }
}

#[test]
fn font_picker_phrases_parse_to_font_commands() {
    use eri_core::ControlCommand;

    assert_eq!(
        ControlCommand::parse("use Fraunces"),
        Some(ControlCommand::SetDisplayFont("Fraunces".into()))
    );
    assert_eq!(
        ControlCommand::parse("switch display font to Geist"),
        Some(ControlCommand::SetDisplayFont("Geist".into()))
    );
    assert_eq!(
        ControlCommand::parse("set the body font to Inter"),
        Some(ControlCommand::SetBodyFont("Inter".into()))
    );
    assert_eq!(
        ControlCommand::parse("use JetBrains Mono"),
        Some(ControlCommand::SetMonoFont("JetBrains Mono".into()))
    );
    assert_eq!(
        ControlCommand::parse("switch the mono font to Berkeley Mono"),
        Some(ControlCommand::SetMonoFont("Berkeley Mono".into()))
    );
    assert_eq!(
        ControlCommand::parse("use Iosevka for code"),
        Some(ControlCommand::SetMonoFont("Iosevka".into()))
    );
    // Unknown font must not hijack a `use foo` utterance.
    assert_eq!(ControlCommand::parse("use spaghetti"), None);
}

#[test]
fn add_motion_phrases_parse_to_add_motion() {
    use eri_core::ControlCommand;

    for phrase in [
        "add motion",
        "add motion.",
        "Add motion!",
        "add animations",
        "add animation",
        "make it animated",
        "animate it",
        "animate this",
        "with animations",
    ] {
        assert_eq!(
            ControlCommand::parse(phrase),
            Some(ControlCommand::AddMotion),
            "phrase {phrase:?} should map to AddMotion",
        );
    }
}

#[test]
fn hero_image_phrases_parse_to_generate_hero_image() {
    use eri_core::ControlCommand;

    for (phrase, expected) in [
        (
            "generate a hero image of a coffee shop",
            "a coffee shop",
        ),
        (
            "make a hero photo of mountains at sunrise",
            "mountains at sunrise",
        ),
        (
            "add a hero image showing downtown tokyo",
            "downtown tokyo",
        ),
        (
            "Generate a hero image of a coffee shop on a rainy night.",
            "a coffee shop on a rainy night",
        ),
        (
            "create a hero photo of a wooden cabin in the snow",
            "a wooden cabin in the snow",
        ),
    ] {
        assert_eq!(
            ControlCommand::parse(phrase),
            Some(ControlCommand::GenerateHeroImage(expected.to_string())),
            "phrase {phrase:?} should map to GenerateHeroImage({expected:?})",
        );
    }

    // Empty description must NOT produce a command — fall back to None so the
    // build path doesn't fire on a stub.
    assert_eq!(ControlCommand::parse("generate a hero image of "), None);
}

#[test]
fn regenerate_images_phrases_parse_to_regenerate_images() {
    use eri_core::ControlCommand;

    for phrase in [
        "regenerate the images",
        "regenerate images",
        "regenerate all the images",
        "Regenerate the images.",
        "replace placeholder images",
        "replace the placeholder images",
        "replace the stock photos",
        "swap the stock photos",
        "refresh the images",
        "generate real images",
    ] {
        assert_eq!(
            ControlCommand::parse(phrase),
            Some(ControlCommand::RegenerateImages),
            "phrase {phrase:?} should map to RegenerateImages",
        );
    }
}

#[test]
fn add_auth0_phrases_parse_to_add_auth_auth0() {
    use eri_core::{AuthProviderKind, ControlCommand};

    for phrase in [
        "add auth0",
        "wire up auth0",
        "set up auth0",
        "integrate auth0",
        "Add Auth0.",
        "use auth0",
    ] {
        assert_eq!(
            ControlCommand::parse(phrase),
            Some(ControlCommand::AddAuth(AuthProviderKind::Auth0)),
            "phrase {phrase:?} should map to AddAuth(Auth0)",
        );
    }
}

#[test]
fn add_clerk_and_supabase_auth_route_to_correct_providers() {
    use eri_core::{AuthProviderKind, ControlCommand};

    assert_eq!(
        ControlCommand::parse("add clerk"),
        Some(ControlCommand::AddAuth(AuthProviderKind::Clerk)),
    );
    assert_eq!(
        ControlCommand::parse("set up clerk"),
        Some(ControlCommand::AddAuth(AuthProviderKind::Clerk)),
    );
    assert_eq!(
        ControlCommand::parse("add supabase auth"),
        Some(ControlCommand::AddAuth(AuthProviderKind::SupabaseAuth)),
    );
    assert_eq!(
        ControlCommand::parse("use supabase for auth"),
        Some(ControlCommand::AddAuth(AuthProviderKind::SupabaseAuth)),
    );
}

#[test]
fn database_phrases_default_to_neon_and_route_supabase_when_named() {
    use eri_core::{ControlCommand, DbProviderKind};

    for phrase in [
        "set up postgres",
        "add postgres",
        "add a postgres database",
        "add a database",
        "set up a database",
        "set up a postgres on neon",
        "add neon postgres",
    ] {
        assert_eq!(
            ControlCommand::parse(phrase),
            Some(ControlCommand::AddDatabase(DbProviderKind::Neon)),
            "phrase {phrase:?} should default-route to Neon",
        );
    }
    for phrase in [
        "add supabase",
        "use supabase for the db",
        "use supabase for the database",
        "use supabase for postgres",
        "add supabase postgres",
    ] {
        assert_eq!(
            ControlCommand::parse(phrase),
            Some(ControlCommand::AddDatabase(DbProviderKind::Supabase)),
            "phrase {phrase:?} should route to Supabase",
        );
    }
}

#[test]
fn add_stripe_parses_with_optional_price() {
    use eri_core::ControlCommand;

    // Bare confirmation — no plan price.
    for phrase in [
        "add stripe",
        "add a stripe checkout",
        "add stripe payments",
        "wire up stripe",
        "integrate stripe",
    ] {
        match ControlCommand::parse(phrase) {
            Some(ControlCommand::AddPayments(usd)) => {
                assert_eq!(usd, 0.0, "phrase {phrase:?} should parse as bare $0.0");
            }
            other => panic!("phrase {phrase:?} should map to AddPayments(0.0), got {other:?}"),
        }
    }

    // Priced variants.
    let cases: &[(&str, f64)] = &[
        ("add stripe for $20 a month", 20.0),
        ("add stripe for 9.99 a month", 9.99),
        ("add stripe for $5 per month", 5.0),
        ("add stripe at $15", 15.0),
        ("add a stripe checkout for $25 a month", 25.0),
        ("add stripe for $99/month", 99.0),
    ];
    for (phrase, expected_usd) in cases {
        match ControlCommand::parse(phrase) {
            Some(ControlCommand::AddPayments(usd)) => {
                assert!(
                    (usd - expected_usd).abs() < 1e-6,
                    "phrase {phrase:?} should parse plan price {expected_usd}, got {usd}",
                );
            }
            other => panic!(
                "phrase {phrase:?} should map to AddPayments({expected_usd}), got {other:?}",
            ),
        }
    }
}

#[test]
fn parses_rebuild_index_voice_command() {
    for phrase in [
        "rebuild index",
        "rebuild the index",
        "reindex",
        "re-index",
        "refresh the index",
        "scan the project",
        "rescan project",
        "index the project",
    ] {
        assert_eq!(
            ControlCommand::parse(phrase),
            Some(ControlCommand::RebuildIndex),
            "phrase {phrase:?} should map to ControlCommand::RebuildIndex",
        );
    }

    // Trailing whisper punctuation must not break the match.
    assert_eq!(
        ControlCommand::parse("rebuild index."),
        Some(ControlCommand::RebuildIndex),
    );
    assert_eq!(
        ControlCommand::parse("reindex!"),
        Some(ControlCommand::RebuildIndex),
    );
}

#[test]
fn parses_find_bugs_voice_command() {
    for phrase in [
        "find bugs",
        "find the bugs",
        "audit my code",
        "audit this build",
        "what's broken",
        "whats broken",
        "look for problems",
        "look for issues",
        "scan for bugs",
        "run the bug finder",
    ] {
        assert_eq!(
            ControlCommand::parse(phrase),
            Some(ControlCommand::FindBugs),
            "phrase {phrase:?} should map to ControlCommand::FindBugs",
        );
    }

    // Trailing whisper punctuation must not break the match.
    assert_eq!(
        ControlCommand::parse("find bugs."),
        Some(ControlCommand::FindBugs),
    );
    assert_eq!(
        ControlCommand::parse("what's broken?"),
        Some(ControlCommand::FindBugs),
    );
}

#[test]
fn parses_fix_bug_indexed_command() {
    assert_eq!(
        ControlCommand::parse("fix bug 2"),
        Some(ControlCommand::FixBug(2)),
    );
    assert_eq!(
        ControlCommand::parse("fix bug 10"),
        Some(ControlCommand::FixBug(10)),
    );
    assert_eq!(
        ControlCommand::parse("fix the first bug"),
        Some(ControlCommand::FixBug(1)),
    );
    assert_eq!(
        ControlCommand::parse("fix the second bug"),
        Some(ControlCommand::FixBug(2)),
    );
    assert_eq!(
        ControlCommand::parse("apply the first fix"),
        Some(ControlCommand::FixBug(1)),
    );
    assert_eq!(
        ControlCommand::parse("apply fix 3"),
        Some(ControlCommand::FixBug(3)),
    );
    // Zero is rejected so the panel doesn't have to special-case it.
    assert_eq!(ControlCommand::parse("fix bug 0"), None);
    // "fix the contact form" must NOT be parsed as a bug fix.
    assert_eq!(ControlCommand::parse("fix the contact form"), None);
}

#[test]
fn parses_fix_all_bugs_voice_command() {
    for phrase in [
        "fix all bugs",
        "fix all the bugs",
        "fix everything",
        "fix all of them",
        "fix them all",
        "apply all fixes",
        "apply all the fixes",
        "apply every fix",
    ] {
        assert_eq!(
            ControlCommand::parse(phrase),
            Some(ControlCommand::FixAllBugs),
            "phrase {phrase:?} should map to ControlCommand::FixAllBugs",
        );
    }
}

#[test]
fn parses_start_background_agent_command() {
    assert_eq!(
        ControlCommand::parse("start a background agent to refactor the auth module"),
        Some(ControlCommand::StartBackgroundAgent(
            "refactor the auth module".into()
        )),
    );
    assert_eq!(
        ControlCommand::parse("run in the background refactor the navbar"),
        Some(ControlCommand::StartBackgroundAgent(
            "refactor the navbar".into()
        )),
    );
    assert_eq!(
        ControlCommand::parse("kick off a background task to clean up css"),
        Some(ControlCommand::StartBackgroundAgent("clean up css".into())),
    );
    // Empty task must not produce a command.
    assert_eq!(
        ControlCommand::parse("start a background agent to "),
        None,
    );
}

#[test]
fn parses_clear_reference_image_voice_command() {
    for phrase in [
        "clear the reference",
        "clear reference",
        "clear the reference image",
        "clear reference image",
        "clear the image",
        "clear image",
        "remove the reference",
        "remove reference",
        "remove the reference image",
        "remove the image",
        "remove image",
        "remove the screenshot",
        "remove screenshot",
        "drop the reference",
        "drop the image",
        "drop the screenshot",
        "ignore the reference",
        "ignore the image",
        "ignore the screenshot",
        "forget the image",
        "forget the reference",
        "forget the screenshot",
        "Remove the screenshot.",
        "CLEAR THE IMAGE",
    ] {
        assert_eq!(
            ControlCommand::parse(phrase),
            Some(ControlCommand::ClearReferenceImage),
            "phrase {phrase:?} should parse as ClearReferenceImage",
        );
    }
}

#[test]
fn unrelated_phrases_do_not_match_clear_reference_image() {
    for phrase in [
        "remove the auth0 integration",
        "drop the database",
        "clear the cache",
        "forget the last commit",
        "ignore the warning",
    ] {
        assert_ne!(
            ControlCommand::parse(phrase),
            Some(ControlCommand::ClearReferenceImage),
            "phrase {phrase:?} should not match ClearReferenceImage",
        );
    }
}

#[test]
fn write_tests_voice_command_parses() {
    for phrase in [
        "write tests for this",
        "write tests for this file",
        "write tests for this.",
        "generate tests",
        "generate the tests",
        "test this",
        "test this code",
        "add tests",
        "add a test",
        "add tests for this",
    ] {
        assert_eq!(
            ControlCommand::parse(phrase),
            Some(ControlCommand::WriteTests),
            "phrase {phrase:?} should parse as WriteTests",
        );
    }
}

#[test]
fn explain_this_voice_command_parses() {
    for phrase in [
        "explain this",
        "explain this code",
        "explain this file",
        "what does this do",
        "what does this code do",
        "walk me through this",
        "walk me through this code",
        "explain this.",
    ] {
        assert_eq!(
            ControlCommand::parse(phrase),
            Some(ControlCommand::ExplainThis),
            "phrase {phrase:?} should parse as ExplainThis",
        );
    }
}

#[test]
fn refactor_this_voice_command_parses_with_payload() {
    let cases: &[(&str, &str)] = &[
        ("refactor this to use map", "use map"),
        ("refactor this to use async await", "use async await"),
        ("clean this up by extracting a helper", "extracting a helper"),
        ("rewrite this to use a switch statement", "use a switch statement"),
        ("rewrite it to use early returns", "use early returns"),
        ("refactor this code to use map", "use map"),
    ];
    for (phrase, expected_payload) in cases {
        assert_eq!(
            ControlCommand::parse(phrase),
            Some(ControlCommand::RefactorThis((*expected_payload).into())),
            "phrase {phrase:?} should parse as RefactorThis with payload \
{expected_payload:?}",
        );
    }
}

#[test]
fn refactor_this_voice_command_rejects_empty_tail() {
    assert_ne!(
        ControlCommand::parse("refactor this to "),
        Some(ControlCommand::RefactorThis(String::new())),
        "empty refactor instruction must not parse — the panel needs a \
target to send Claude",
    );
}

#[test]
fn document_this_voice_command_parses() {
    let bare_doc: &[&str] = &[
        "document this",
        "document this file",
        "document it",
        "add docs",
        "add documentation",
        "generate docs",
        "generate documentation",
        "write docs",
    ];
    for phrase in bare_doc {
        assert_eq!(
            ControlCommand::parse(phrase),
            Some(ControlCommand::DocumentThis(String::new())),
            "phrase {phrase:?} should parse as DocumentThis with empty hint",
        );
    }

    let typed_cases: &[(&str, &str)] = &[
        ("add jsdoc", "jsdoc"),
        ("add jsdocs", "jsdoc"),
        ("generate jsdoc", "jsdoc"),
        ("add docstrings", "docstring"),
        ("add doc strings", "docstring"),
        ("generate docstrings", "docstring"),
        ("add rustdoc", "rustdoc"),
        ("add rust docs", "rustdoc"),
        ("generate rustdoc", "rustdoc"),
    ];
    for (phrase, expected) in typed_cases {
        assert_eq!(
            ControlCommand::parse(phrase),
            Some(ControlCommand::DocumentThis((*expected).into())),
            "phrase {phrase:?} should parse as DocumentThis({expected:?})",
        );
    }
}

#[test]
fn model_switch_voice_commands_resolve_to_canonical_ids() {
    // Direct canonical ids.
    assert_eq!(
        ControlCommand::parse("use gpt-4o"),
        Some(ControlCommand::SwitchModel("gpt-4o".into())),
    );
    // Fuzzy spoken phrasing.
    assert_eq!(
        ControlCommand::parse("use chat gpt"),
        Some(ControlCommand::SwitchModel("gpt-4o".into())),
    );
    // Claude tiers — "switch to claude" alone stays on SwitchAgent; only
    // specific tiers route to SwitchModel.
    assert_eq!(
        ControlCommand::parse("switch to claude haiku"),
        Some(ControlCommand::SwitchModel("claude-haiku-4-5".into())),
    );
    assert_eq!(
        ControlCommand::parse("use claude opus"),
        Some(ControlCommand::SwitchModel("claude-opus-4-5".into())),
    );
    assert_eq!(
        ControlCommand::parse("use claude sonnet"),
        Some(ControlCommand::SwitchModel("claude-sonnet-4-5".into())),
    );
    // Gemini family.
    assert_eq!(
        ControlCommand::parse("use gemini flash"),
        Some(ControlCommand::SwitchModel("gemini-flash-2".into())),
    );
    assert_eq!(
        ControlCommand::parse("use gemini thinking"),
        Some(ControlCommand::SwitchModel("gemini-thinking-2".into())),
    );
    // Switch back to default.
    assert_eq!(
        ControlCommand::parse("switch back to mercury"),
        Some(ControlCommand::SwitchModel("mercury-2".into())),
    );
}

#[test]
fn bare_use_claude_still_routes_to_switch_agent() {
    // The bare agent-backend literal must NOT be hijacked by the model
    // switcher — it continues to mean "swap the polish CLI to claude code".
    assert_eq!(
        ControlCommand::parse("use claude"),
        Some(ControlCommand::SwitchAgent("claude".into())),
    );
    assert_eq!(
        ControlCommand::parse("switch to claude"),
        Some(ControlCommand::SwitchAgent("claude".into())),
    );
    assert_eq!(
        ControlCommand::parse("use goose"),
        Some(ControlCommand::SwitchAgent("goose".into())),
    );
}

#[test]
fn list_models_voice_commands_parse() {
    for phrase in &[
        "list models",
        "show models",
        "what models can i use",
        "what models do you support",
        "which models do you support",
        "list providers",
    ] {
        assert_eq!(
            ControlCommand::parse(phrase),
            Some(ControlCommand::ListModels),
            "phrase {phrase:?} should parse as ListModels",
        );
    }
}

#[test]
fn open_pull_request_voice_commands_parse() {
    for phrase in &[
        "open a pr",
        "open a pull request",
        "open pull request",
        "make a pr",
        "make a pull request",
        "create a pull request",
        "create a pr",
        "submit a pr",
        "raise a pr",
        "open a pr.",
    ] {
        assert_eq!(
            ControlCommand::parse(phrase),
            Some(ControlCommand::OpenPullRequest),
            "phrase {phrase:?} should parse as OpenPullRequest",
        );
    }
}

#[test]
fn better_commit_message_voice_commands_parse() {
    for phrase in &[
        "amend the commit message",
        "amend commit message",
        "rewrite the commit message",
        "rewrite that commit",
        "write a better commit message",
        "better commit message",
        "improve the commit message",
        "fix the commit message",
    ] {
        assert_eq!(
            ControlCommand::parse(phrase),
            Some(ControlCommand::BetterCommitMessage),
            "phrase {phrase:?} should parse as BetterCommitMessage",
        );
    }
}

#[test]
fn account_login_voice_commands_parse() {
    for phrase in &[
        "log in",
        "login",
        "sign in",
        "log me in",
        "sign in to eri.dev",
    ] {
        assert_eq!(
            ControlCommand::parse(phrase),
            Some(ControlCommand::Login),
            "phrase {phrase:?} should parse as Login",
        );
    }
}

#[test]
fn account_signup_voice_commands_parse() {
    for phrase in &[
        "sign up",
        "signup",
        "create an account",
        "make a new account",
        "register",
    ] {
        assert_eq!(
            ControlCommand::parse(phrase),
            Some(ControlCommand::Signup),
            "phrase {phrase:?} should parse as Signup",
        );
    }
}

#[test]
fn account_logout_voice_commands_parse() {
    for phrase in &["log out", "logout", "sign out", "log me out"] {
        assert_eq!(
            ControlCommand::parse(phrase),
            Some(ControlCommand::Logout),
            "phrase {phrase:?} should parse as Logout",
        );
    }
}

#[test]
fn whoami_voice_commands_parse() {
    for phrase in &[
        "who am i",
        "whoami",
        "what's my account",
        "am i logged in",
    ] {
        assert_eq!(
            ControlCommand::parse(phrase),
            Some(ControlCommand::WhoAmI),
            "phrase {phrase:?} should parse as WhoAmI",
        );
    }
}

#[test]
fn upgrade_account_voice_commands_parse() {
    for phrase in &[
        "upgrade",
        "upgrade my account",
        "upgrade my plan",
        "go pro",
    ] {
        assert_eq!(
            ControlCommand::parse(phrase),
            Some(ControlCommand::UpgradeAccount),
            "phrase {phrase:?} should parse as UpgradeAccount",
        );
    }
}

#[test]
fn pro_plus_voice_command_parses() {
    for phrase in &[
        "subscribe to pro plus",
        "upgrade to pro plus",
        "go pro plus",
        "upgrade my plan to pro plus",
        "switch to pro plus",
    ] {
        assert_eq!(
            ControlCommand::parse(phrase),
            Some(ControlCommand::OpenCheckout("pro_plus".to_string())),
            "phrase {phrase:?} should parse as OpenCheckout(\"pro_plus\")",
        );
    }
}

#[test]
fn teams_voice_command_parses() {
    for phrase in &[
        "subscribe to teams",
        "upgrade to teams",
        "team plan",
        "switch to teams",
        "upgrade to the team plan",
    ] {
        let parsed = ControlCommand::parse(phrase);
        assert_eq!(
            parsed,
            Some(ControlCommand::OpenCheckout("teams".to_string())),
            "phrase {phrase:?} should parse as OpenCheckout(\"teams\"), got {parsed:?}",
        );
    }
}

#[test]
fn whats_my_brain_voice_command_parses() {
    for phrase in [
        "what's my brain",
        "what is my brain",
        "what's my brain tier",
        "what's my eri brain",
        "what tier am i on",
        "what's my tier",
        "am i on adaptive",
        "am i on frontier",
        "am i on personalized",
        "am i on the personalized tier",
    ] {
        let parsed = ControlCommand::parse(phrase);
        assert_eq!(
            parsed,
            Some(ControlCommand::WhatsMyBrain),
            "phrase {phrase:?} should parse as WhatsMyBrain, got {parsed:?}",
        );
    }
    // CheckSubscription phrasings still route to CheckSubscription.
    assert_eq!(
        ControlCommand::parse("check my subscription"),
        Some(ControlCommand::CheckSubscription),
    );
    assert_eq!(
        ControlCommand::parse("what's my plan"),
        Some(ControlCommand::CheckSubscription),
    );
}
