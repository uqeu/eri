//! In-process voice transcription for eri.
//!
//! Captures microphone audio with `cpal`, feeds a sliding window into
//! `whisper-rs` (Metal-accelerated whisper.cpp), and emits `VoiceEvent`s
//! over an mpsc channel for the GPUI panel to consume. Replaces the
//! Swift Speech-framework sidecar that lived at
//! `script/eri_voice_sidecar`.

use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    thread,
    time::{Duration, Instant},
};

use anyhow::{Context, Result, anyhow};
use cpal::{
    SampleFormat, Stream,
    traits::{DeviceTrait, HostTrait, StreamTrait},
};
use parking_lot::Mutex;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

const TARGET_SAMPLE_RATE: u32 = 16_000;
// 30s ring buffer + 30s transcription window so long sentences don't get
// truncated to "just the last few seconds." Earlier 10s/8s setup was eating
// the beginning of every multi-sentence prompt.
const RING_BUFFER_SECONDS: f32 = 30.0;
const TRANSCRIBE_WINDOW_SECONDS: usize = 28;

/// How often the inference loop wakes up to consider a partial. Tightened
/// from 600ms → 300ms so first-token latency for a spoken phrase lands
/// inside the 300-400ms Mercury hot-loop budget. Each tick still runs the
/// VAD gate before invoking whisper, so silent ticks remain cheap.
const DEFAULT_PARTIAL_INTERVAL_MS: u64 = 300;
/// Silence window after which the last partial commits as Final. Was 500ms;
/// 400ms keeps the "build amazon" → pause → "build walmart" split-into-two
/// behaviour while shaving a tick off perceived latency. Long enough to
/// still ignore normal mid-sentence breathing.
const DEFAULT_FINAL_SILENCE_MS: u64 = 400;
/// RMS energy gate below which a window is treated as silence and whisper
/// is skipped entirely. Pulled in from 0.005 → 0.004 so quiet talkers
/// aren't gated out; the hallucination filter (called after whisper) picks
/// up any noise that sneaks through.
const DEFAULT_SPEECH_ENERGY_THRESHOLD: f32 = 0.004;

/// Friendly default. `large-v3-turbo-q5_0` is ~3x faster than `large-v3-q5_0`
/// on M-series with only a small accuracy delta on clean English speech,
/// which matches the voice-driven-IDE workload (short commands, native
/// speakers, low noise). For accented or noisy audio, switch to
/// `large-v3-q5_0` via `ERI_WHISPER_MODEL`.
const DEFAULT_MODEL_KEY: &str = "large-v3-turbo-q5_0";

/// Maps the friendly `ERI_WHISPER_MODEL` key the user sets to the actual
/// ggml filename on Hugging Face. Accepting friendly keys (rather than
/// raw filenames) means we can swap the underlying file later without
/// breaking user configs. The raw filename is still accepted as a
/// fallback so power users aren't locked out.
///
/// Trade-offs (measured rough first-partial latency on M-series, clean
/// English speech):
/// - `large-v3-q5_0`         best accuracy, ~600ms first partial
/// - `large-v3-turbo-q5_0`   ~3x faster, slightly worse on accents
/// - `medium.en-q5_0`        ~2x faster than large, English-only, very good
/// - `small.en-q5_0`         ~4x faster, ok accuracy for short commands
#[doc(hidden)]
pub fn whisper_model_filename() -> String {
    let key = std::env::var("ERI_WHISPER_MODEL").unwrap_or_else(|_| DEFAULT_MODEL_KEY.to_string());
    match key.as_str() {
        "large-v3-q5_0" => "ggml-large-v3-q5_0.bin".to_string(),
        "large-v3-turbo-q5_0" => "ggml-large-v3-turbo-q5_0.bin".to_string(),
        "medium.en-q5_0" => "ggml-medium.en-q5_0.bin".to_string(),
        "small.en-q5_0" => "ggml-small.en-q5_0.bin".to_string(),
        // Accept a raw ggml filename verbatim so users can target models
        // we haven't aliased.
        other if other.ends_with(".bin") => other.to_string(),
        other => format!("ggml-{other}.bin"),
    }
}

fn env_u64(name: &str, fallback: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|raw| raw.parse::<u64>().ok())
        .unwrap_or(fallback)
}

fn env_f32(name: &str, fallback: f32) -> f32 {
    std::env::var(name)
        .ok()
        .and_then(|raw| raw.parse::<f32>().ok())
        .unwrap_or(fallback)
}

fn partial_interval_ms() -> u64 {
    env_u64("ERI_VOICE_PARTIAL_MS", DEFAULT_PARTIAL_INTERVAL_MS)
}

fn final_silence_ms() -> u64 {
    env_u64("ERI_VOICE_FINAL_MS", DEFAULT_FINAL_SILENCE_MS)
}

fn speech_energy_threshold() -> f32 {
    env_f32("ERI_VOICE_THRESHOLD", DEFAULT_SPEECH_ENERGY_THRESHOLD)
}

fn whisper_model_url(filename: &str) -> String {
    format!(
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{}",
        filename
    )
}

/// Substrings whisper.cpp invents during silence (sourced from YouTube
/// training data). Matched case-insensitively as either an exact or
/// substring match against the trimmed transcription. See
/// [`is_hallucination`] for the full filter rules.
const HALLUCINATION_PATTERNS: &[&str] = &[
    "thank you.",
    "thanks for watching.",
    "thanks for watching!",
    "thanks for watching",
    "thank you for watching.",
    "thank you for watching!",
    "subscribe.",
    "subscribe!",
    "please subscribe.",
    "like and subscribe.",
    "like and subscribe!",
    "don't forget to subscribe.",
    "see you next time.",
    "see you in the next video.",
    "thank you very much.",
    "thanks.",
    "thank you so much.",
    "thank you so much for watching.",
    "bye.",
    "bye!",
    "goodbye.",
    "okay.",
    "ok.",
    "yeah.",
    "no.",
    "yes.",
    "uh-huh.",
    "uh huh.",
    "right.",
    "alright.",
    "*click*",
    "meow.",
    "[music]",
    "[applause]",
    "[blank_audio]",
    "[silence]",
    "♪",
    "♪♪",
    "♪♪♪",
    "♪ ♪",
    "♪ ♪ ♪",
    // Common whisper hallucinations from background music / room noise:
    "did you turn around?",
    "did you turn around",
    "are you there?",
    "are you there",
    "can you hear me?",
    "can you hear me",
    "what?",
    "what's up?",
    "hello?",
    "hello.",
    "hi.",
    "hi there.",
    "i'm sorry.",
    "i don't know.",
    "i don't understand.",
    "you know what i mean?",
    "you know.",
    "i mean.",
    "i guess.",
    "i see.",
    "good.",
    "great.",
    "nice.",
    "cool.",
    "wow.",
    "huh?",
    "huh.",
    "oh.",
    "oh yeah.",
    "oh okay.",
    "mm-hmm.",
    "mhm.",
    "mm.",
    "so.",
    "well.",
    "i'm still here, ready to help!",
    "i'm here.",
    "sure.",
    "sure!",
];

#[derive(Clone, Debug, PartialEq)]
pub enum VoiceEvent {
    Status(String),
    Partial(String),
    Final(String),
    Error(String),
}

pub struct VoiceCapture {
    stop: Arc<AtomicBool>,
    _stream: Stream,
    _inference_thread: Option<thread::JoinHandle<()>>,
}

mod engine;
pub use engine::{VoiceConfig, VoiceEngine, VoiceSink};

pub mod dictation;

impl VoiceCapture {
    /// Spawn the capture + transcription pipeline. Returns a [`VoiceCapture`]
    /// handle that stops everything when dropped, plus a receiver of
    /// [`VoiceEvent`]s.
    pub fn start() -> Result<(Self, mpsc::Receiver<VoiceEvent>)> {
        let (sender, receiver) = mpsc::channel();
        let _ = sender.send(VoiceEvent::Status("Resolving whisper model.".to_string()));

        let model_path = match ensure_model_available(&sender) {
            Ok(path) => path,
            Err(error) => {
                let _ = sender.send(VoiceEvent::Error(format!(
                    "could not resolve whisper model: {error}"
                )));
                return Err(error);
            }
        };

        let _ = sender.send(VoiceEvent::Status(
            "Loading whisper model into memory.".to_string(),
        ));
        let context = WhisperContext::new_with_params(
            &model_path.to_string_lossy(),
            WhisperContextParameters::default(),
        )
        .map_err(|error| anyhow!("whisper context init failed: {error}"))?;
        let _ = sender.send(VoiceEvent::Status("Whisper model loaded.".to_string()));

        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or_else(|| anyhow!("no default input device available"))?;
        let device_name = device
            .name()
            .unwrap_or_else(|_| "unknown microphone".to_string());
        let _ = sender.send(VoiceEvent::Status(format!(
            "Opening microphone: {device_name}"
        )));
        let config = device
            .default_input_config()
            .map_err(|error| anyhow!("default input config: {error}"))?;
        let input_sample_rate: u32 = config.sample_rate().0;
        let input_channels = config.channels() as usize;
        let sample_format = config.sample_format();

        let ring = Arc::new(Mutex::new(RingBuffer::new(
            (TARGET_SAMPLE_RATE as f32 * RING_BUFFER_SECONDS) as usize,
        )));
        let stop = Arc::new(AtomicBool::new(false));

        let stream_config: cpal::StreamConfig = config.into();
        let ring_for_stream = ring.clone();
        let resampler = Resampler::new(input_sample_rate, TARGET_SAMPLE_RATE, input_channels);
        let resampler = Arc::new(Mutex::new(resampler));
        let resampler_clone = resampler.clone();
        let error_sender = sender.clone();
        let stream = match sample_format {
            SampleFormat::F32 => device
                .build_input_stream(
                    &stream_config,
                    move |data: &[f32], _| {
                        let mut local = resampler_clone.lock();
                        local.push_f32(data, |sample| {
                            ring_for_stream.lock().push(sample);
                        });
                    },
                    move |error| {
                        let _ = error_sender
                            .send(VoiceEvent::Error(format!("audio stream error: {error}")));
                    },
                    None,
                )
                .map_err(|error| anyhow!("build_input_stream f32: {error}"))?,
            SampleFormat::I16 => {
                let ring_for_stream = ring.clone();
                let resampler_clone = resampler.clone();
                let error_sender = sender.clone();
                device
                    .build_input_stream(
                        &stream_config,
                        move |data: &[i16], _| {
                            let mut local = resampler_clone.lock();
                            local.push_i16(data, |sample| {
                                ring_for_stream.lock().push(sample);
                            });
                        },
                        move |error| {
                            let _ = error_sender
                                .send(VoiceEvent::Error(format!("audio stream error: {error}")));
                        },
                        None,
                    )
                    .map_err(|error| anyhow!("build_input_stream i16: {error}"))?
            }
            SampleFormat::U16 => {
                let ring_for_stream = ring.clone();
                let resampler_clone = resampler.clone();
                let error_sender = sender.clone();
                device
                    .build_input_stream(
                        &stream_config,
                        move |data: &[u16], _| {
                            let mut local = resampler_clone.lock();
                            local.push_u16(data, |sample| {
                                ring_for_stream.lock().push(sample);
                            });
                        },
                        move |error| {
                            let _ = error_sender
                                .send(VoiceEvent::Error(format!("audio stream error: {error}")));
                        },
                        None,
                    )
                    .map_err(|error| anyhow!("build_input_stream u16: {error}"))?
            }
            other => return Err(anyhow!("unsupported sample format: {other:?}")),
        };
        stream
            .play()
            .map_err(|error| anyhow!("audio stream play: {error}"))?;
        let _ = sender.send(VoiceEvent::Status("Listening. Speak any time.".to_string()));

        let inference_stop = stop.clone();
        let inference_ring = ring.clone();
        let inference_sender = sender.clone();
        let inference_thread = thread::Builder::new()
            .name("eri-voice-inference".into())
            .spawn(move || {
                run_inference_loop(context, inference_ring, inference_sender, inference_stop);
            })
            .map_err(|error| anyhow!("spawn inference thread: {error}"))?;

        Ok((
            Self {
                stop,
                _stream: stream,
                _inference_thread: Some(inference_thread),
            },
            receiver,
        ))
    }
}

impl Drop for VoiceCapture {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(handle) = self._inference_thread.take() {
            let _ = handle.join();
        }
    }
}

#[derive(Debug)]
struct RingBuffer {
    samples: Vec<f32>,
    capacity: usize,
    last_active: Instant,
}

impl RingBuffer {
    fn new(capacity: usize) -> Self {
        Self {
            samples: Vec::with_capacity(capacity),
            capacity,
            last_active: Instant::now(),
        }
    }

    fn push(&mut self, sample: f32) {
        if self.samples.len() == self.capacity {
            self.samples.remove(0);
        }
        self.samples.push(sample);
        if sample.abs() > 0.02 {
            self.last_active = Instant::now();
        }
    }

    fn snapshot(&self) -> Vec<f32> {
        self.samples.clone()
    }

    fn drain(&mut self) {
        self.samples.clear();
    }

    fn idle_for(&self) -> Duration {
        self.last_active.elapsed()
    }
}

struct Resampler {
    input_rate: u32,
    output_rate: u32,
    channels: usize,
    accumulated: f32,
    pending_channel: usize,
    channel_buffer: Vec<f32>,
}

impl Resampler {
    fn new(input_rate: u32, output_rate: u32, channels: usize) -> Self {
        Self {
            input_rate,
            output_rate,
            channels: channels.max(1),
            accumulated: 0.0,
            pending_channel: 0,
            channel_buffer: vec![0.0; channels.max(1)],
        }
    }

    fn push_f32(&mut self, data: &[f32], mut sink: impl FnMut(f32)) {
        for sample in data {
            self.channel_buffer[self.pending_channel] = *sample;
            self.pending_channel += 1;
            if self.pending_channel == self.channels {
                self.pending_channel = 0;
                let mono = self.channel_buffer.iter().sum::<f32>() / self.channels as f32;
                self.accumulated += self.output_rate as f32 / self.input_rate as f32;
                while self.accumulated >= 1.0 {
                    sink(mono);
                    self.accumulated -= 1.0;
                }
            }
        }
    }

    fn push_i16(&mut self, data: &[i16], sink: impl FnMut(f32)) {
        let converted: Vec<f32> = data
            .iter()
            .map(|sample| *sample as f32 / i16::MAX as f32)
            .collect();
        self.push_f32(&converted, sink);
    }

    fn push_u16(&mut self, data: &[u16], sink: impl FnMut(f32)) {
        let converted: Vec<f32> = data
            .iter()
            .map(|sample| (*sample as f32 / u16::MAX as f32) * 2.0 - 1.0)
            .collect();
        self.push_f32(&converted, sink);
    }
}

fn run_inference_loop(
    context: WhisperContext,
    ring: Arc<Mutex<RingBuffer>>,
    sender: mpsc::Sender<VoiceEvent>,
    stop: Arc<AtomicBool>,
) {
    let interval = Duration::from_millis(partial_interval_ms());
    let final_silence = Duration::from_millis(final_silence_ms());
    let energy_threshold = speech_energy_threshold();
    let mut last_partial: Option<String> = None;
    let mut last_change_at = Instant::now();
    let mut state = match context.create_state() {
        Ok(state) => state,
        Err(error) => {
            let _ = sender.send(VoiceEvent::Error(format!("whisper state init: {error}")));
            return;
        }
    };

    let mut tick: u64 = 0;
    while !stop.load(Ordering::Relaxed) {
        thread::sleep(interval);
        tick += 1;

        let (samples, idle) = {
            let guard = ring.lock();
            (guard.snapshot(), guard.idle_for())
        };
        if samples.len() < TARGET_SAMPLE_RATE as usize / 2 {
            if tick.is_multiple_of(10) {
                eprintln!(
                    "[eri.voice] tick={tick} buffer={}s (waiting for >0.5s of audio)",
                    samples.len() as f32 / TARGET_SAMPLE_RATE as f32
                );
            }
            continue;
        }

        let trailing = trailing_samples(
            &samples,
            TARGET_SAMPLE_RATE as usize * TRANSCRIBE_WINDOW_SECONDS,
        );
        let energy = rms_energy(&trailing);
        // Lightweight VAD: an RMS-energy gate computed over the whisper
        // window. Cuts whisper invocations by ~70% during normal pauses,
        // which is the main win for first-partial latency (whisper itself
        // is the slow step). A neural VAD (Silero via the
        // `voice_activity_detector` crate) was considered but it pulls in
        // an ONNX runtime as a non-pure-Rust system dependency, which
        // violates the "no new system libraries" constraint and adds
        // ~30MB to the binary for marginal benefit on already-quiet
        // mic input. Energy gate + post-whisper hallucination filter
        // covers the same regression cases.
        let speech_present = energy > energy_threshold;

        if !speech_present {
            if tick.is_multiple_of(5) {
                eprintln!(
                    "[eri.voice] tick={tick} energy={:.4} (below {:.4}) — silent",
                    energy, energy_threshold
                );
            }
            if let Some(previous) = last_partial.take()
                && !previous.trim().is_empty()
                && last_change_at.elapsed() >= final_silence
            {
                eprintln!("[eri.voice] FINAL on silence: {previous:?}");
                let _ = sender.send(VoiceEvent::Final(previous));
                ring.lock().drain();
                last_change_at = Instant::now();
            }
            continue;
        }
        eprintln!(
            "[eri.voice] tick={tick} energy={:.4} — running whisper on {}s",
            energy,
            trailing.len() as f32 / TARGET_SAMPLE_RATE as f32
        );

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_no_context(true);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_special(false);
        params.set_print_timestamps(false);
        params.set_single_segment(true);
        params.set_n_threads(4);
        params.set_language(Some("en"));
        params.set_suppress_blank(true);
        params.set_suppress_non_speech_tokens(true);
        params.set_no_speech_thold(0.6);

        if let Err(error) = state.full(params, &trailing) {
            let _ = sender.send(VoiceEvent::Error(format!("whisper full() failed: {error}")));
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
        eprintln!("[eri.voice] whisper -> {text:?} (energy={energy:.4})");
        if text.is_empty() || is_hallucination(&text) {
            if !text.is_empty() {
                eprintln!("[eri.voice] dropped as hallucination: {text:?}");
            }
            if let Some(previous) = last_partial.take()
                && !previous.trim().is_empty()
                && !is_hallucination(&previous)
            {
                eprintln!("[eri.voice] FINAL on hallucination drop: {previous:?}");
                let _ = sender.send(VoiceEvent::Final(previous));
                ring.lock().drain();
                last_change_at = Instant::now();
            }
            continue;
        }

        let changed = last_partial.as_deref() != Some(text.as_str());
        if changed {
            last_partial = Some(text.clone());
            last_change_at = Instant::now();
            eprintln!("[eri.voice] PARTIAL: {text:?}");
            let _ = sender.send(VoiceEvent::Partial(text.clone()));
        } else if last_change_at.elapsed() >= final_silence
            && idle >= final_silence
            && let Some(previous) = last_partial.take()
        {
            eprintln!("[eri.voice] FINAL on stable: {previous:?}");
            let _ = sender.send(VoiceEvent::Final(previous));
            ring.lock().drain();
            last_change_at = Instant::now();
        }
    }
}

fn rms_energy(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum_squares: f32 = samples.iter().map(|sample| sample * sample).sum();
    (sum_squares / samples.len() as f32).sqrt()
}

/// Returns true if `text` matches a known whisper hallucination pattern
/// and should NOT be emitted as a partial/final.
///
/// Rules, in order:
///   1. Empty or whitespace-only → hallucination (whisper emitted nothing
///      meaningful).
///   2. Pure punctuation/ellipsis ("...", ". . . . . .", "—", etc.) →
///      hallucination. Whisper emits these for silent frames.
///   3. Bracketed noise tags like `[Music]`, `(silence)`, `[Applause]` →
///      hallucination. These are whisper's "no speech" markers from the
///      YouTube training set.
///   4. Known YouTube-trained noise phrases ("Thanks for watching!",
///      "Subscribe", "Like and subscribe") → hallucination.
///   5. Single-word ambient transcriptions that don't form an intent
///      ("um", "uh", "okay", "yeah") → hallucination. We rely on Mercury
///      to handle real commands so dropping these is safe.
///
/// Pure text predicate so it can be unit-tested without audio buffers.
#[doc(hidden)]
pub fn is_hallucination(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return true;
    }
    let normalized = trimmed.to_ascii_lowercase();

    // Rule 2: pure punctuation / ellipsis hallucinations. If no character
    // is alphanumeric, there's no command to act on.
    if !normalized
        .chars()
        .any(|character| character.is_alphanumeric())
    {
        return true;
    }

    // Rule 3: bracketed noise tags. Whisper emits these for silent or
    // music-only frames. Match either `[...]` or `(...)` wrapping a
    // single token like "music", "silence", "applause", "blank_audio".
    let bracket_pairs: &[(char, char)] = &[('[', ']'), ('(', ')')];
    for (open, close) in bracket_pairs {
        if normalized.starts_with(*open) && normalized.ends_with(*close) {
            let inner = &normalized[1..normalized.len() - 1];
            if matches!(
                inner,
                "music" | "silence" | "applause" | "blank_audio" | "noise" | "laughter"
            ) {
                return true;
            }
        }
    }

    // Rule 4: YouTube-trained noise phrases (substring match so trailing
    // punctuation variants are caught).
    if HALLUCINATION_PATTERNS
        .iter()
        .any(|pattern| normalized == *pattern || normalized.contains(pattern))
    {
        return true;
    }

    // Rule 5: single-word filler. Only drop when there's exactly one word
    // and it's a known filler — real one-word commands like "save" or
    // "run" must survive.
    const FILLERS: &[&str] = &[
        "um", "uh", "umm", "uhh", "hmm", "mm", "mhm", "mmhm", "huh", "okay", "ok", "yeah", "yep",
        "nope", "yup", "ah", "oh", "eh", "like", "so", "well",
    ];
    let word_count = normalized
        .split_whitespace()
        .filter(|word| !word.is_empty())
        .count();
    if word_count == 1 {
        let only = normalized.trim_matches(|character: char| !character.is_alphanumeric());
        if FILLERS.contains(&only) {
            return true;
        }
    }

    false
}

fn trailing_samples(samples: &[f32], window: usize) -> Vec<f32> {
    if samples.len() <= window {
        samples.to_vec()
    } else {
        samples[samples.len() - window..].to_vec()
    }
}

fn ensure_model_available(sender: &mpsc::Sender<VoiceEvent>) -> Result<PathBuf> {
    let dir = model_directory()?;
    fs::create_dir_all(&dir).with_context(|| format!("creating {}", dir.display()))?;
    let filename = whisper_model_filename();
    let path = dir.join(&filename);
    if path.exists()
        && fs::metadata(&path)
            .map(|meta| meta.len() > 1024 * 1024)
            .unwrap_or(false)
    {
        let _ = sender.send(VoiceEvent::Status(format!(
            "Whisper model cached at {}",
            path.display()
        )));
        return Ok(path);
    }
    let url = whisper_model_url(&filename);
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(15))
        .timeout(Duration::from_secs(600))
        .build();
    let response = agent
        .get(&url)
        .call()
        .map_err(|error| anyhow!("model download: {error}"))?;

    // Pull Content-Length up front so the first-run UX can show a size
    // estimate (~Xmb) and a percentage as we stream bytes. This is the
    // "first-run model download UX" requirement: the user must see
    // something within ~5s instead of a blank progress bar.
    let total_bytes = response
        .header("Content-Length")
        .and_then(|raw| raw.parse::<u64>().ok());
    let total_mb = total_bytes.map(|bytes| bytes / 1_048_576);
    let opening_message = match total_mb {
        Some(mb) => format!("Downloading {filename} (~{mb}mb)..."),
        None => format!("Downloading {filename}..."),
    };
    let _ = sender.send(VoiceEvent::Status(opening_message));

    let mut reader = response.into_reader();
    let temp_path = path.with_extension("partial");
    let mut file = fs::File::create(&temp_path)
        .with_context(|| format!("creating {}", temp_path.display()))?;

    // Chunked copy so we can emit a status line each second of download
    // progress, instead of blocking inside `std::io::copy` with no
    // feedback for the multi-second download.
    let mut buffer = vec![0u8; 64 * 1024];
    let mut downloaded: u64 = 0;
    let mut last_status_at = Instant::now();
    loop {
        let read = match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => read,
            Err(error) => {
                let _ = fs::remove_file(&temp_path);
                return Err(anyhow!("reading model body: {error}"));
            }
        };
        std::io::Write::write_all(&mut file, &buffer[..read])
            .with_context(|| "writing whisper model file")?;
        downloaded = downloaded.saturating_add(read as u64);
        if last_status_at.elapsed() >= Duration::from_secs(1) {
            let message = match total_bytes {
                Some(total) if total > 0 => {
                    let percent = (downloaded as f64 / total as f64 * 100.0) as u32;
                    format!(
                        "Downloading {filename}: {percent}% ({downloaded_mb}mb / {total_mb}mb)",
                        downloaded_mb = downloaded / 1_048_576,
                        total_mb = total / 1_048_576
                    )
                }
                _ => format!(
                    "Downloading {filename}: {downloaded_mb}mb",
                    downloaded_mb = downloaded / 1_048_576
                ),
            };
            let _ = sender.send(VoiceEvent::Status(message));
            last_status_at = Instant::now();
        }
    }

    fs::rename(&temp_path, &path)
        .with_context(|| format!("renaming {} to {}", temp_path.display(), path.display()))?;
    let _ = sender.send(VoiceEvent::Status(
        "Whisper model download complete.".to_string(),
    ));
    Ok(path)
}

fn model_directory() -> Result<PathBuf> {
    let home = std::env::var("HOME").map_err(|_| anyhow!("HOME not set"))?;
    Ok(Path::new(&home)
        .join("Library")
        .join("Application Support")
        .join("eri")
        .join("models"))
}
