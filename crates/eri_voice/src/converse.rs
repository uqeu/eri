//! End-to-end spoken-conversation loop: audio in → eri brain → spoken reply.
//!
//! This module is pure *plumbing*. It ties the existing voice pieces together
//! into a continuous conversation but holds no identity of its own: the
//! [`Responder`] IS the eri brain, and this layer only routes text between the
//! microphone, the brain, and the speaker. Persona, prompts, and routing live
//! above the engine — consistent with the rest of the codebase, where the
//! whisper inference loop ([`crate::engine`]) and the dictation cleanup
//! ([`crate::dictation`]) are likewise opinion-free.
//!
//! Everything is behind injected traits so the loop is unit-testable WITHOUT a
//! microphone, model, or speaker. The real wiring (whisper transcripts on one
//! side, a cloud/local LLM + TTS on the other) implements these traits; the
//! tests pass scripted stubs.
//!
//! ## Stages
//!
//! 1. [`Transcriber`] — yields the next finalized utterance as text, or `None`
//!    when the audio source has ended. A real impl drains [`crate::VoiceEvent`]
//!    `Final` events from the whisper pipeline.
//! 2. [`Responder`] — text in, eri's reply text out. This is the brain.
//! 3. [`Speaker`] — speaks a line of text (TTS).
//!
//! ## Stop / cancellation
//!
//! Two ways to end the loop, mirroring the safety boundary the typed-goal path
//! enforces in `eri_cli::control_safety`:
//!
//! - **Spoken stop word** ("stop", "never mind", …): the loop ends *without*
//!   producing a turn for that utterance, so a retraction never becomes a
//!   command. See [`is_stop_word`].
//! - **External cancellation** ([`Conversation::cancel_handle`]): flipping the
//!   shared flag stops the loop cleanly at the next stage boundary.

use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

/// Errors surfaced by a conversation stage. The loop itself never panics; a
/// stage failure is propagated so the host can decide whether to retry or tear
/// down.
#[derive(Debug, thiserror::Error)]
pub enum ConverseError {
    /// The responder (eri brain) failed to produce a reply.
    #[error("responder failed: {0}")]
    Responder(String),
    /// The speaker (TTS) failed to emit a reply.
    #[error("speaker failed: {0}")]
    Speaker(String),
}

/// Source of finalized user utterances (capture + transcription).
///
/// `next_utterance` blocks until the next complete utterance is available and
/// returns it, or returns `None` when the audio source has ended (mic closed,
/// stream torn down). A real implementation drains `VoiceEvent::Final` strings
/// from the whisper pipeline; the empty/partial/hallucination filtering already
/// happens upstream in [`crate::engine`], but this loop re-checks for empties
/// defensively so a stub or a future source can't inject a blank turn.
pub trait Transcriber {
    fn next_utterance(&mut self) -> Option<String>;
}

/// The eri brain: a user utterance in, eri's reply text out.
///
/// Deliberately the only stage that can fail with semantic meaning — capture
/// and speech are best-effort, but a brain error is worth surfacing.
pub trait Responder {
    fn respond(&mut self, utterance: &str) -> Result<String, ConverseError>;
}

/// Text-to-speech sink. Speaks one reply line.
pub trait Speaker {
    fn speak(&mut self, reply: &str) -> Result<(), ConverseError>;
}

/// Why a [`Conversation::run`] returned, so the host can distinguish a user
/// hang-up from a natural end-of-audio.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConverseEnd {
    /// The user spoke a stop word ("stop", "never mind").
    StopWord,
    /// External cancellation flag was raised.
    Cancelled,
    /// The transcriber returned `None` (audio source ended).
    AudioEnded,
}

/// Stop words that end the conversation when spoken on their own. Kept small
/// and aligned in spirit with `eri_cli::control_safety::is_cancellation` (which
/// the typed-goal path uses); duplicated here rather than depended on because
/// `eri_cli` sits *above* this crate, not beside it. Matched case-insensitively
/// against the whole (punctuation-trimmed) utterance.
const STOP_WORDS: &[&str] = &[
    "stop",
    "stop it",
    "stop listening",
    "never mind",
    "nevermind",
    "cancel",
    "that's all",
    "thats all",
    "goodbye eri",
    "bye eri",
    "go to sleep",
];

/// True when `utterance` is a spoken request to end the conversation.
///
/// Pure predicate so the routing is unit-testable without audio. A retraction
/// must win over being treated as a command, so the loop checks this *before*
/// handing the text to the responder.
pub fn is_stop_word(utterance: &str) -> bool {
    let normalized = utterance
        .trim()
        .trim_matches(|c: char| !c.is_alphanumeric() && !c.is_whitespace())
        .trim()
        .to_lowercase();
    if normalized.is_empty() {
        return false;
    }
    STOP_WORDS.iter().any(|stop| normalized == *stop)
}

/// Drives a continuous spoken conversation by tying the injected stages
/// together: capture/transcribe → (skip silence) → respond → speak, looping
/// until a stop word, external cancellation, or end of audio.
pub struct Conversation<T, R, S> {
    transcriber: T,
    responder: R,
    speaker: S,
    cancel: Arc<AtomicBool>,
}

impl<T, R, S> Conversation<T, R, S>
where
    T: Transcriber,
    R: Responder,
    S: Speaker,
{
    /// Assemble a conversation from its three stages. Cancellation starts
    /// un-raised; grab [`Conversation::cancel_handle`] before `run` to stop it
    /// from another thread.
    pub fn new(transcriber: T, responder: R, speaker: S) -> Self {
        Self::with_cancel(transcriber, responder, speaker, Arc::new(AtomicBool::new(false)))
    }

    /// Like [`Conversation::new`] but shares an EXISTING cancellation flag, so the
    /// thing that raises cancel (a hotkey handler, a supervisor thread) and the
    /// loop observe the *same* atomic. Grab the flag, wire it into your canceller,
    /// then construct the conversation with it — otherwise raising a different
    /// `Arc<AtomicBool>` does nothing and the loop never stops.
    pub fn with_cancel(transcriber: T, responder: R, speaker: S, cancel: Arc<AtomicBool>) -> Self {
        Self {
            transcriber,
            responder,
            speaker,
            cancel,
        }
    }

    /// A clonable handle to the cancellation flag. Raising it (`store(true)`)
    /// stops the loop cleanly at the next stage boundary, returning
    /// [`ConverseEnd::Cancelled`].
    pub fn cancel_handle(&self) -> Arc<AtomicBool> {
        self.cancel.clone()
    }

    /// Run the conversation to completion. Returns the reason the loop ended.
    ///
    /// A stage error ([`ConverseError`]) aborts the loop and propagates — the
    /// host decides whether to restart. Empty/whitespace utterances (silence
    /// that slipped through, or a stub feeding a blank) produce no turn.
    pub fn run(&mut self) -> Result<ConverseEnd, ConverseError> {
        loop {
            if self.cancel.load(Ordering::Relaxed) {
                return Ok(ConverseEnd::Cancelled);
            }

            let utterance = match self.transcriber.next_utterance() {
                Some(text) => text,
                None => return Ok(ConverseEnd::AudioEnded),
            };

            // Re-check cancellation: capture may have blocked for a while.
            if self.cancel.load(Ordering::Relaxed) {
                return Ok(ConverseEnd::Cancelled);
            }

            let trimmed = utterance.trim();
            if trimmed.is_empty() {
                // Silence / blank — no turn, keep listening.
                continue;
            }

            // Retraction wins over command (safety boundary): end without a turn.
            if is_stop_word(trimmed) {
                return Ok(ConverseEnd::StopWord);
            }

            let reply = self.responder.respond(trimmed)?;
            // A brain that intentionally stays silent (empty reply) shouldn't
            // make the speaker emit an empty line.
            if reply.trim().is_empty() {
                continue;
            }
            self.speaker.speak(&reply)?;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Feeds a scripted list of utterances, one per call, then ends the stream.
    struct ScriptedTranscriber {
        lines: std::collections::VecDeque<String>,
    }

    impl ScriptedTranscriber {
        fn new(lines: &[&str]) -> Self {
            Self {
                lines: lines.iter().map(|s| s.to_string()).collect(),
            }
        }
    }

    impl Transcriber for ScriptedTranscriber {
        fn next_utterance(&mut self) -> Option<String> {
            self.lines.pop_front()
        }
    }

    /// Echoing brain: replies "eri: <utterance>". Records what it was asked.
    #[derive(Default)]
    struct EchoResponder {
        seen: Vec<String>,
    }

    impl Responder for EchoResponder {
        fn respond(&mut self, utterance: &str) -> Result<String, ConverseError> {
            self.seen.push(utterance.to_string());
            Ok(format!("eri: {utterance}"))
        }
    }

    /// Brain that fails on demand, to exercise error propagation.
    struct FailingResponder;

    impl Responder for FailingResponder {
        fn respond(&mut self, _utterance: &str) -> Result<String, ConverseError> {
            Err(ConverseError::Responder("brain offline".to_string()))
        }
    }

    /// Records every spoken line so tests can assert the spoken outputs.
    #[derive(Default)]
    struct RecordingSpeaker {
        spoken: Arc<parking_lot::Mutex<Vec<String>>>,
    }

    impl RecordingSpeaker {
        fn handle(&self) -> Arc<parking_lot::Mutex<Vec<String>>> {
            self.spoken.clone()
        }
    }

    impl Speaker for RecordingSpeaker {
        fn speak(&mut self, reply: &str) -> Result<(), ConverseError> {
            self.spoken.lock().push(reply.to_string());
            Ok(())
        }
    }

    /// Transcriber that flips a cancel flag mid-stream, then would keep
    /// yielding forever — proving cancellation actually stops the loop.
    struct CancellingTranscriber {
        cancel: Arc<AtomicBool>,
        calls: usize,
    }

    impl Transcriber for CancellingTranscriber {
        fn next_utterance(&mut self) -> Option<String> {
            self.calls += 1;
            if self.calls == 1 {
                return Some("hello eri".to_string());
            }
            // After the first real turn, raise cancel and hand back another
            // utterance. The loop must observe the flag and NOT process this.
            self.cancel.store(true, Ordering::Relaxed);
            Some("this should never be spoken".to_string())
        }
    }

    #[test]
    fn spoken_outputs_match_each_turn() {
        let transcriber = ScriptedTranscriber::new(&["open Spotify", "what time is it"]);
        let speaker = RecordingSpeaker::default();
        let spoken = speaker.handle();
        let mut convo = Conversation::new(transcriber, EchoResponder::default(), speaker);

        let end = convo.run().expect("loop runs clean");

        assert_eq!(end, ConverseEnd::AudioEnded);
        let spoken = spoken.lock();
        assert_eq!(
            *spoken,
            vec![
                "eri: open Spotify".to_string(),
                "eri: what time is it".to_string(),
            ]
        );
    }

    #[test]
    fn a_stop_word_ends_the_loop_without_a_turn() {
        // "stop" arrives between two commands; the loop must end on it and
        // never reach the third line.
        let transcriber = ScriptedTranscriber::new(&["open Spotify", "stop", "play music"]);
        let speaker = RecordingSpeaker::default();
        let spoken = speaker.handle();
        let mut convo = Conversation::new(transcriber, EchoResponder::default(), speaker);

        let end = convo.run().expect("loop runs clean");

        assert_eq!(end, ConverseEnd::StopWord);
        let spoken = spoken.lock();
        // Only the first command produced a spoken reply; "stop" produced none
        // and "play music" was never reached.
        assert_eq!(*spoken, vec!["eri: open Spotify".to_string()]);
    }

    #[test]
    fn silence_and_empty_transcripts_dont_produce_a_turn() {
        let transcriber = ScriptedTranscriber::new(&["", "   ", "open Spotify", "  \t "]);
        let speaker = RecordingSpeaker::default();
        let spoken = speaker.handle();
        let mut responder = EchoResponder::default();
        // Inspect the responder afterwards by moving it back out via the convo.
        {
            let mut convo = Conversation::new(transcriber, &mut responder, speaker);
            let end = convo.run().expect("loop runs clean");
            assert_eq!(end, ConverseEnd::AudioEnded);
        }
        // The brain was asked exactly once — the blanks were skipped.
        assert_eq!(responder.seen, vec!["open Spotify".to_string()]);
        assert_eq!(*spoken.lock(), vec!["eri: open Spotify".to_string()]);
    }

    #[test]
    fn an_empty_reply_is_not_spoken() {
        struct SilentBrain;
        impl Responder for SilentBrain {
            fn respond(&mut self, _utterance: &str) -> Result<String, ConverseError> {
                Ok("   ".to_string())
            }
        }
        let transcriber = ScriptedTranscriber::new(&["think quietly"]);
        let speaker = RecordingSpeaker::default();
        let spoken = speaker.handle();
        let mut convo = Conversation::new(transcriber, SilentBrain, speaker);

        let end = convo.run().expect("loop runs clean");

        assert_eq!(end, ConverseEnd::AudioEnded);
        assert!(spoken.lock().is_empty());
    }

    #[test]
    fn external_cancellation_stops_the_loop_cleanly() {
        let cancel = Arc::new(AtomicBool::new(false));
        let transcriber = CancellingTranscriber {
            cancel: cancel.clone(),
            calls: 0,
        };
        let speaker = RecordingSpeaker::default();
        let spoken = speaker.handle();
        // The transcriber raises THIS flag mid-stream, so the conversation must
        // observe the SAME atomic — construct it with the shared handle. (Using
        // `new` here would give the loop a different internal flag that the
        // transcriber never raises, and the loop would spin forever.)
        let mut convo =
            Conversation::with_cancel(transcriber, EchoResponder::default(), speaker, cancel);

        let end = convo.run().expect("loop runs clean");

        assert_eq!(end, ConverseEnd::Cancelled);
        // Only the first utterance (before cancel) was spoken.
        assert_eq!(*spoken.lock(), vec!["eri: hello eri".to_string()]);
    }

    #[test]
    fn cancellation_before_any_turn_yields_immediately() {
        let transcriber = ScriptedTranscriber::new(&["open Spotify"]);
        let speaker = RecordingSpeaker::default();
        let spoken = speaker.handle();
        let mut convo = Conversation::new(transcriber, EchoResponder::default(), speaker);
        // Raise the flag before running.
        convo.cancel_handle().store(true, Ordering::Relaxed);

        let end = convo.run().expect("loop runs clean");

        assert_eq!(end, ConverseEnd::Cancelled);
        assert!(spoken.lock().is_empty());
    }

    #[test]
    fn a_responder_error_aborts_and_propagates() {
        let transcriber = ScriptedTranscriber::new(&["do the thing"]);
        let speaker = RecordingSpeaker::default();
        let mut convo = Conversation::new(transcriber, FailingResponder, speaker);

        let err = convo.run().expect_err("brain failure propagates");

        assert!(matches!(err, ConverseError::Responder(_)));
    }

    #[test]
    fn a_speaker_error_aborts_and_propagates() {
        struct FailingSpeaker;
        impl Speaker for FailingSpeaker {
            fn speak(&mut self, _reply: &str) -> Result<(), ConverseError> {
                Err(ConverseError::Speaker("tts crashed".to_string()))
            }
        }
        let transcriber = ScriptedTranscriber::new(&["say something"]);
        let mut convo = Conversation::new(transcriber, EchoResponder::default(), FailingSpeaker);

        let err = convo.run().expect_err("speaker failure propagates");

        assert!(matches!(err, ConverseError::Speaker(_)));
    }

    #[test]
    fn stop_word_predicate_matches_retractions_not_commands() {
        assert!(is_stop_word("stop"));
        assert!(is_stop_word("Stop."));
        assert!(is_stop_word("  NEVER MIND  "));
        assert!(is_stop_word("that's all"));
        assert!(is_stop_word("go to sleep"));
        // Commands and partial matches must NOT be treated as stops.
        assert!(!is_stop_word("stop the music")); // a real command
        assert!(!is_stop_word("open Spotify"));
        assert!(!is_stop_word(""));
        assert!(!is_stop_word("nonstop"));
    }
}

/// Lets `&mut R` stand in as a `Responder`, so a test (or host) can keep
/// ownership of the brain and inspect it after the loop returns. The same
/// blanket pattern would apply to the other stages if a caller needs it; only
/// the responder is borrowed back in practice.
impl<R: Responder + ?Sized> Responder for &mut R {
    fn respond(&mut self, utterance: &str) -> Result<String, ConverseError> {
        (**self).respond(utterance)
    }
}
