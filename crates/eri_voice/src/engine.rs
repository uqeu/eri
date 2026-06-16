//! Pinned-thread [`VoiceEngine`] that hosts the `!Send` `cpal::Stream` for
//! the dispatch-wide `Services` registry.
//!
//! The dispatcher needs a `Send + Sync` voice handle, but `cpal::Stream`
//! is `!Send`. We bridge the gap by spawning a dedicated `eri-voice` thread
//! that:
//!
//! 1. Builds the `cpal::Stream` inside its own stack frame.
//! 2. Drives the whisper inference loop inline.
//! 3. Drops the stream on thread exit.
//!
//! Only Send-safe handles cross the thread boundary: an `Arc<AtomicBool>`
//! stop signal, an `Arc<AtomicBool>` running flag, and the
//! `thread::JoinHandle<()>`. The outer [`VoiceEngine`] therefore becomes
//! `Send + Sync` and embeds cleanly in the dispatch registry.

use std::{
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    thread,
    time::{Duration, Instant},
};

use anyhow::{Result, anyhow};
use cpal::{
    SampleFormat, Stream,
    traits::{DeviceTrait, HostTrait, StreamTrait},
};
use parking_lot::Mutex;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use crate::{
    DEFAULT_FINAL_SILENCE_MS, RING_BUFFER_SECONDS, Resampler, RingBuffer, TARGET_SAMPLE_RATE,
    TRANSCRIBE_WINDOW_SECONDS, VoiceEvent, ensure_model_available, is_hallucination,
    partial_interval_ms, rms_energy, speech_energy_threshold, trailing_samples,
};

/// Configuration for the pinned-thread voice pipeline.
///
/// All fields have sensible defaults via [`VoiceConfig::default`]. Override
/// only what the host needs (model path, language hint, VAD timing).
#[derive(Clone, Debug)]
pub struct VoiceConfig {
    /// Override path to a `ggml-*.bin` whisper model. When `None`, the engine
    /// resolves+downloads the model selected by `ERI_WHISPER_MODEL` via the
    /// existing `ensure_model_available` flow.
    pub model_path: Option<PathBuf>,
    /// Target sample rate for the resampler. Whisper expects 16 kHz.
    pub sample_rate: u32,
    /// Silence window (ms) after which the last partial commits as Final.
    pub vad_silence_ms: u32,
    /// Minimum utterance length before a partial is considered usable.
    /// Reserved for future neural-VAD wiring; the RMS gate already enforces
    /// a soft minimum via the 0.5s buffer warm-up in the inference loop.
    pub min_utterance_ms: u32,
    /// Maximum utterance length before forced flush. Reserved.
    pub max_utterance_ms: u32,
    /// Language hint (`None` → whisper auto-detect, `Some("en")` → English).
    pub language: Option<String>,
}

impl Default for VoiceConfig {
    fn default() -> Self {
        Self {
            model_path: None,
            sample_rate: TARGET_SAMPLE_RATE,
            vad_silence_ms: DEFAULT_FINAL_SILENCE_MS as u32,
            min_utterance_ms: 250,
            max_utterance_ms: 30_000,
            language: Some("en".to_string()),
        }
    }
}

/// Callback set the host installs to receive voice events.
///
/// All callbacks fire on the dedicated `eri-voice` worker thread, so
/// implementations must be cheap and non-blocking. The `Send + Sync` bounds
/// let the engine share the sink with cpal callbacks.
pub struct VoiceSink {
    pub on_partial: Box<dyn Fn(String) + Send + Sync>,
    pub on_final: Box<dyn Fn(String) + Send + Sync>,
    pub on_error: Box<dyn Fn(String) + Send + Sync>,
    pub on_status: Box<dyn Fn(String) + Send + Sync>,
}

impl VoiceSink {
    /// Convenience constructor for callers that don't care about status
    /// breadcrumbs. Status messages are routed to a no-op closure.
    pub fn new(
        on_partial: impl Fn(String) + Send + Sync + 'static,
        on_final: impl Fn(String) + Send + Sync + 'static,
        on_error: impl Fn(String) + Send + Sync + 'static,
    ) -> Self {
        Self {
            on_partial: Box::new(on_partial),
            on_final: Box::new(on_final),
            on_error: Box::new(on_error),
            on_status: Box::new(|_| {}),
        }
    }
}

/// Outer handle for the voice pipeline. The `cpal::Stream` never crosses
/// thread boundaries — it is built inside the pinned `eri-voice` thread
/// and dropped on thread exit. Only Send-safe handles
/// (`Arc<AtomicBool>`, `JoinHandle`) live here, so the struct is
/// `Send + Sync` and embeds cleanly in the dispatch `Services`.
pub struct VoiceEngine {
    join: Option<thread::JoinHandle<()>>,
    stop_flag: Arc<AtomicBool>,
    running: Arc<AtomicBool>,
}

impl VoiceEngine {
    /// Spawn the capture+inference pipeline on a dedicated thread. The
    /// `cpal::Stream` is constructed inside the thread closure and never
    /// escapes, so the returned handle is `Send + Sync`.
    pub fn start(cfg: VoiceConfig, sink: VoiceSink) -> Result<Self> {
        let stop_flag = Arc::new(AtomicBool::new(false));
        let running = Arc::new(AtomicBool::new(false));
        let stop_clone = stop_flag.clone();
        let running_clone = running.clone();
        // Wrap the sink in an Arc so cpal callbacks (which need 'static
        // lifetimes) can share it with the inference loop without lifetime
        // gymnastics.
        let sink = Arc::new(sink);
        let join = thread::Builder::new()
            .name("eri-voice".into())
            .spawn(move || {
                run_voice_thread(cfg, sink, stop_clone, running_clone);
            })
            .map_err(|error| anyhow!("spawn eri-voice thread: {error}"))?;
        Ok(Self {
            join: Some(join),
            stop_flag,
            running,
        })
    }

    /// Signal the worker to stop and wait for it to join. Returns when the
    /// thread has fully torn down the audio stream and inference worker.
    pub fn stop(mut self) -> Result<()> {
        self.stop_flag.store(true, Ordering::Relaxed);
        if let Some(handle) = self.join.take() {
            // Ignore JoinError; a panic in the worker would already have
            // been surfaced as `on_error` via the catch_unwind wrapper.
            let _ = handle.join();
        }
        Ok(())
    }

    /// True once the worker has finished bringing up cpal + whisper and is
    /// actively listening. False before bootstrap completes and after stop.
    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::Relaxed)
    }
}

impl Drop for VoiceEngine {
    fn drop(&mut self) {
        self.stop_flag.store(true, Ordering::Relaxed);
        if let Some(handle) = self.join.take() {
            let _ = handle.join();
        }
    }
}

/// Thread body for the `eri-voice` pinned thread. Wraps the cpal+whisper
/// bootstrap in `catch_unwind` so a panic in audio driver code is reported
/// via `sink.on_error` instead of aborting the dispatch process.
fn run_voice_thread(
    cfg: VoiceConfig,
    sink: Arc<VoiceSink>,
    stop: Arc<AtomicBool>,
    running: Arc<AtomicBool>,
) {
    let sink_for_panic = sink.clone();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        engine_bootstrap(&cfg, &sink, &stop, &running);
    }));
    if let Err(payload) = result {
        let message = panic_message(payload.as_ref());
        (sink_for_panic.on_error)(format!("voice worker panicked: {message}"));
    }
    running.store(false, Ordering::Relaxed);
}

fn panic_message(payload: &(dyn std::any::Any + Send)) -> String {
    if let Some(s) = payload.downcast_ref::<&str>() {
        (*s).to_string()
    } else if let Some(s) = payload.downcast_ref::<String>() {
        s.clone()
    } else {
        "unknown panic".to_string()
    }
}

/// Inner bootstrap: resolve model, open mic, build the cpal Stream, then
/// drive the whisper inference loop inline. The Stream is dropped at the
/// end of this function (when the loop exits) so it never escapes the
/// pinned thread.
fn engine_bootstrap(
    cfg: &VoiceConfig,
    sink: &Arc<VoiceSink>,
    stop: &Arc<AtomicBool>,
    running: &Arc<AtomicBool>,
) {
    let model_path = match resolve_model_path(cfg, sink) {
        Some(path) => path,
        None => return,
    };
    (sink.on_status)("Loading whisper model into memory.".to_string());
    let context = match WhisperContext::new_with_params(
        &model_path.to_string_lossy(),
        WhisperContextParameters::default(),
    ) {
        Ok(ctx) => ctx,
        Err(error) => {
            (sink.on_error)(format!("whisper context init failed: {error}"));
            return;
        }
    };

    // Open default input device. Returning gracefully on permission failure
    // is part of the public contract — the sidecar surfaces this as
    // `eri/voice/status { running: false, last_error: ... }`.
    let host = cpal::default_host();
    let device = match host.default_input_device() {
        Some(d) => d,
        None => {
            (sink.on_error)("microphone permission not granted".to_string());
            return;
        }
    };
    let device_name = device
        .name()
        .unwrap_or_else(|_| "unknown microphone".to_string());
    (sink.on_status)(format!("Opening microphone: {device_name}"));
    let device_config = match device.default_input_config() {
        Ok(c) => c,
        Err(error) => {
            (sink.on_error)(format!("default input config: {error}"));
            return;
        }
    };
    let input_sample_rate: u32 = device_config.sample_rate().0;
    let input_channels = device_config.channels() as usize;
    let sample_format = device_config.sample_format();

    let ring = Arc::new(Mutex::new(RingBuffer::new(
        (cfg.sample_rate as f32 * RING_BUFFER_SECONDS) as usize,
    )));
    let resampler = Arc::new(Mutex::new(Resampler::new(
        input_sample_rate,
        cfg.sample_rate,
        input_channels,
    )));

    // Build the cpal Stream INSIDE this thread. It MUST NOT escape.
    let stream_config: cpal::StreamConfig = device_config.into();
    let stream = match build_capture_stream(
        &device,
        &stream_config,
        sample_format,
        ring.clone(),
        resampler,
        sink.clone(),
    ) {
        Ok(s) => s,
        Err(error) => {
            (sink.on_error)(format!("build_input_stream: {error}"));
            return;
        }
    };
    if let Err(error) = stream.play() {
        (sink.on_error)(format!("audio stream play: {error}"));
        return;
    }
    (sink.on_status)("Listening. Speak any time.".to_string());
    running.store(true, Ordering::Relaxed);

    drive_inference(context, ring, sink, stop, cfg);

    // Drop the stream on exit. Explicit drop documents the intent.
    drop(stream);
    running.store(false, Ordering::Relaxed);
    (sink.on_status)("Voice capture stopped.".to_string());
}

fn resolve_model_path(cfg: &VoiceConfig, sink: &Arc<VoiceSink>) -> Option<PathBuf> {
    if let Some(path) = cfg.model_path.as_ref() {
        return Some(path.clone());
    }
    (sink.on_status)("Resolving whisper model.".to_string());
    let (tx, rx) = mpsc::channel();
    // Bridge the legacy `ensure_model_available` status stream into the new
    // sink callbacks. The function is synchronous so we drain `rx` afterwards.
    let result = ensure_model_available(&tx);
    drop(tx);
    while let Ok(event) = rx.recv() {
        match event {
            VoiceEvent::Status(message) => (sink.on_status)(message),
            VoiceEvent::Error(message) => (sink.on_error)(message),
            VoiceEvent::Partial(_) | VoiceEvent::Final(_) => {}
        }
    }
    match result {
        Ok(path) => Some(path),
        Err(error) => {
            (sink.on_error)(format!("could not resolve whisper model: {error}"));
            None
        }
    }
}

/// Build the cpal input stream with format-appropriate sample conversion.
/// Each arm captures owned Arcs so the cpal callback closures are 'static.
fn build_capture_stream(
    device: &cpal::Device,
    stream_config: &cpal::StreamConfig,
    sample_format: SampleFormat,
    ring: Arc<Mutex<RingBuffer>>,
    resampler: Arc<Mutex<Resampler>>,
    sink: Arc<VoiceSink>,
) -> Result<Stream> {
    match sample_format {
        SampleFormat::F32 => {
            let resampler_clone = resampler.clone();
            let err_sink = sink.clone();
            device
                .build_input_stream(
                    stream_config,
                    move |data: &[f32], _| {
                        let mut local = resampler_clone.lock();
                        local.push_f32(data, |sample| ring.lock().push(sample));
                    },
                    move |error| (err_sink.on_error)(format!("audio stream error: {error}")),
                    None,
                )
                .map_err(|error| anyhow!("f32: {error}"))
        }
        SampleFormat::I16 => {
            let resampler_clone = resampler.clone();
            let err_sink = sink.clone();
            device
                .build_input_stream(
                    stream_config,
                    move |data: &[i16], _| {
                        let mut local = resampler_clone.lock();
                        local.push_i16(data, |sample| ring.lock().push(sample));
                    },
                    move |error| (err_sink.on_error)(format!("audio stream error: {error}")),
                    None,
                )
                .map_err(|error| anyhow!("i16: {error}"))
        }
        SampleFormat::U16 => {
            let resampler_clone = resampler.clone();
            let err_sink = sink.clone();
            device
                .build_input_stream(
                    stream_config,
                    move |data: &[u16], _| {
                        let mut local = resampler_clone.lock();
                        local.push_u16(data, |sample| ring.lock().push(sample));
                    },
                    move |error| (err_sink.on_error)(format!("audio stream error: {error}")),
                    None,
                )
                .map_err(|error| anyhow!("u16: {error}"))
        }
        other => Err(anyhow!("unsupported sample format: {other:?}")),
    }
}

/// Drive the whisper inference loop. Routes events through the
/// `VoiceSink` callbacks rather than an mpsc channel (the legacy path used
/// by `VoiceCapture`).
fn drive_inference(
    context: WhisperContext,
    ring: Arc<Mutex<RingBuffer>>,
    sink: &Arc<VoiceSink>,
    stop: &Arc<AtomicBool>,
    cfg: &VoiceConfig,
) {
    let interval = Duration::from_millis(partial_interval_ms());
    let final_silence = Duration::from_millis(cfg.vad_silence_ms as u64);
    let energy_threshold = speech_energy_threshold();
    let language = cfg.language.clone();
    let sample_rate = cfg.sample_rate;
    let mut last_partial: Option<String> = None;
    let mut last_change_at = Instant::now();
    let mut state = match context.create_state() {
        Ok(state) => state,
        Err(error) => {
            (sink.on_error)(format!("whisper state init: {error}"));
            return;
        }
    };

    while !stop.load(Ordering::Relaxed) {
        thread::sleep(interval);

        let (samples, idle) = {
            let guard = ring.lock();
            (guard.snapshot(), guard.idle_for())
        };
        if samples.len() < sample_rate as usize / 2 {
            continue;
        }

        let trailing = trailing_samples(&samples, sample_rate as usize * TRANSCRIBE_WINDOW_SECONDS);
        let energy = rms_energy(&trailing);
        if energy <= energy_threshold {
            if let Some(previous) = last_partial.take()
                && !previous.trim().is_empty()
                && last_change_at.elapsed() >= final_silence
            {
                (sink.on_final)(previous);
                ring.lock().drain();
                last_change_at = Instant::now();
            }
            continue;
        }

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_no_context(true);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_special(false);
        params.set_print_timestamps(false);
        params.set_single_segment(true);
        params.set_n_threads(4);
        if let Some(lang) = language.as_deref() {
            params.set_language(Some(lang));
        }
        params.set_suppress_blank(true);
        params.set_suppress_non_speech_tokens(true);
        params.set_no_speech_thold(0.6);

        if let Err(error) = state.full(params, &trailing) {
            (sink.on_error)(format!("whisper full() failed: {error}"));
            continue;
        }

        let segments = match state.full_n_segments() {
            Ok(count) => count,
            Err(_) => continue,
        };
        let mut text = String::new();
        for segment_index in 0..segments {
            if let Ok(segment) = state.full_get_segment_text(segment_index) {
                text.push_str(&segment);
            }
        }
        let text = text.trim().to_string();
        if text.is_empty() || is_hallucination(&text) {
            if let Some(previous) = last_partial.take()
                && !previous.trim().is_empty()
                && !is_hallucination(&previous)
            {
                (sink.on_final)(previous);
                ring.lock().drain();
                last_change_at = Instant::now();
            }
            continue;
        }

        let changed = last_partial.as_deref() != Some(text.as_str());
        if changed {
            last_partial = Some(text.clone());
            last_change_at = Instant::now();
            (sink.on_partial)(text);
        } else if last_change_at.elapsed() >= final_silence
            && idle >= final_silence
            && let Some(previous) = last_partial.take()
        {
            (sink.on_final)(previous);
            ring.lock().drain();
            last_change_at = Instant::now();
        }
    }
}
