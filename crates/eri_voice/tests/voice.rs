//! Integration tests for the voice pipeline filters and model resolution.
//!
//! These tests cover the pure logic surface (hallucination filter and
//! model filename resolution) so they can run without a microphone or
//! the whisper model file on disk.

use eri_voice::{is_hallucination, whisper_model_filename};

#[test]
fn is_hallucination_filters_subscribe_text() {
    // YouTube-trained noise: whisper invents these for silent or
    // background-music frames. Each form must be filtered.
    assert!(is_hallucination("Subscribe."));
    assert!(is_hallucination("Like and subscribe!"));
    assert!(is_hallucination("Please subscribe."));
    assert!(is_hallucination("Don't forget to subscribe."));
    assert!(is_hallucination("Thanks for watching!"));
    assert!(is_hallucination("Thank you for watching."));
}

#[test]
fn is_hallucination_filters_ellipsis_only() {
    // Silent-frame hallucinations: whisper emits punctuation-only output
    // when fed near-silent audio. Anything with no alphanumeric content
    // is dropped.
    assert!(is_hallucination("..."));
    assert!(is_hallucination(". . . . . ."));
    assert!(is_hallucination("…"));
    assert!(is_hallucination("—"));
    assert!(is_hallucination("    "));
    assert!(is_hallucination(""));
    // Bracketed noise tags from the training set.
    assert!(is_hallucination("[Music]"));
    assert!(is_hallucination("[Applause]"));
    assert!(is_hallucination("(silence)"));
}

#[test]
fn is_hallucination_keeps_real_short_command() {
    // Real one-word commands the voice IDE must respect — these are
    // intent triggers Mercury cares about. They must NOT be filtered
    // even though they're short.
    assert!(!is_hallucination("save"));
    assert!(!is_hallucination("run"));
    assert!(!is_hallucination("commit"));
    assert!(!is_hallucination("undo"));
    // Multi-word real commands also survive.
    assert!(!is_hallucination("build amazon"));
    assert!(!is_hallucination("open the project panel"));
    assert!(!is_hallucination("fix the failing test"));
}

#[test]
fn whisper_model_path_resolves_from_env_or_default() {
    // Default: turbo variant for the real-time hot path.
    // SAFETY: tests in the same binary run sequentially by default and
    // we set+restore the env var inside this test; no other tests in
    // this file read ERI_WHISPER_MODEL.
    let previous = std::env::var("ERI_WHISPER_MODEL").ok();
    // SAFETY: single-threaded test execution within this binary.
    unsafe {
        std::env::remove_var("ERI_WHISPER_MODEL");
    }
    assert_eq!(whisper_model_filename(), "ggml-large-v3-turbo-q5_0.bin");

    // Friendly key → mapped filename.
    // SAFETY: see above.
    unsafe {
        std::env::set_var("ERI_WHISPER_MODEL", "medium.en-q5_0");
    }
    assert_eq!(whisper_model_filename(), "ggml-medium.en-q5_0.bin");

    // SAFETY: see above.
    unsafe {
        std::env::set_var("ERI_WHISPER_MODEL", "small.en-q5_0");
    }
    assert_eq!(whisper_model_filename(), "ggml-small.en-q5_0.bin");

    // SAFETY: see above.
    unsafe {
        std::env::set_var("ERI_WHISPER_MODEL", "large-v3-q5_0");
    }
    assert_eq!(whisper_model_filename(), "ggml-large-v3-q5_0.bin");

    // Raw filename pass-through for power users.
    // SAFETY: see above.
    unsafe {
        std::env::set_var("ERI_WHISPER_MODEL", "ggml-base.en.bin");
    }
    assert_eq!(whisper_model_filename(), "ggml-base.en.bin");

    // Restore prior env so we don't leak state into other tests.
    // SAFETY: see above.
    unsafe {
        match previous {
            Some(value) => std::env::set_var("ERI_WHISPER_MODEL", value),
            None => std::env::remove_var("ERI_WHISPER_MODEL"),
        }
    }
}
