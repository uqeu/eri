# eri Flow — voice/dictation/flow layer (beat Wispr Flow)

Status: Design (research-validated 2026-06-15). eri Flow = talk to eri, it captures/cleans/acts,
and shows you your patterns — one feature of the personal OS, not the whole product. Wispr
*dictates*; **eri dictates AND acts AND learns you.**

## The wedge: on-device + private (Wispr can't)
Wispr Flow is **cloud-only, no offline mode** — audio always leaves the device. eri's edge:
**fully on-device STT + on-device cleanup (eri's own model) + local-only insights.** Nothing
leaves the machine. That's the lead message.

## eri Flow is ~60% already built (reuse, don't rebuild)
- `crates/eri_voice/src/engine.rs` — cpal capture → whisper-rs streaming → RMS-VAD endpointing →
  partial/final events. (**STT model is swapped here.**)
- `crates/eri_voice/src/dictation.rs` — deterministic cleanup (fillers, caps, punct), user
  **dictionary**, **snippets**, "fix last word," + a 4-tone LLM **style transform**
  (Verbatim/Clean/Formal/Concise), injection-hardened. Unit-tested. **Reuse as-is.**
- `crates/eri_cli/src/voice_control.rs` — wake/stop/control routing. (Extend for Command Mode.)
- `crates/eri_cli/src/control_agent.rs` — `ControlBridge::type_text()` / `key()` (CGEvent/AX) =
  the **dictate-anywhere injection primitive, already solved.**
- `crates/eri_coreutils/src/services/memory.rs` — notes store target for quick-capture.
- CONTEXT.md already names **Voice** as a first-class mode of the morph pad.

## STT decision (replace ggml-whisper)
- **Primary: NVIDIA Parakeet-TDT-0.6B on the Apple Neural Engine via FluidAudio CoreML** —
  ~6.05% WER, ~66MB on ANE, 150×+ real-time on M1; beats Wispr on privacy/offline/latency.
  ⚠️ **License: Parakeet weights are CC-BY-4.0 → must attribute NVIDIA** (the FluidAudio/
  parakeet-mlx wrapper code is Apache-2.0 — don't conflate). Chunked pseudo-streaming (fine for
  push-to-talk).
- **Fallback: WhisperKit large-v3-turbo (MIT)** — true token-level streaming, 99 languages, zero
  attribution. **Rust-native option: sherpa-onnx** (Apache-2.0; streaming Zipformer ~44ms +
  Parakeet offline; ONNX Runtime + Metal). **Keep whisper-rs as universal fallback.** Avoid
  faster-whisper/CTranslate2 on Mac (CPU-only, no Metal).
- **Cleanup = eri's own model, NOT the STT** (the edge): deterministic local layer (already in
  dictation.rs, 0 tokens) → optional Tier-1 small-local-model rewrite for tone/format (0 cloud
  tokens) → cloud only when explicitly asked.

## OSS to reuse (provenance flagged — matters)
- **FORK target: `cjpais/Handy` (MIT, Rust+Tauri)** — essentially this exact product (cpal →
  Silero VAD → transcribe-rs [Whisper+Parakeet] → enigo/clipboard injection). Maps onto eri_voice.
- Permissive crates: **transcribe-rs** (MIT), **sherpa-onnx** (Apache), **earshot** (MIT/Apache
  pure-Rust VAD), **enigo** (MIT, CGEvent typing), **global-hotkey** (MIT/Apache — Carbon hotkey,
  NO Accessibility permission needed), **arboard** (MIT/Apache, clipboard).
- **AVOID for code (copyleft):** VoiceInk (GPL-3.0), whisper-writer/nerd-dictation/blurt (GPL),
  Speech Note (MPL). WhisperX diarization weights gated/sometimes non-commercial — don't bundle.
- **Injection on macOS:** clipboard + simulated ⌘V (primary, atomic — save/restore clipboard) →
  CGEvent typing (fallback) → AX direct insert (opportunistic, unreliable in Word/Electron).
  Permissions: mic (low) + **Accessibility (high friction — the one unavoidable prompt; isolate
  to the inject step)**. Trigger via Carbon global-hotkey to avoid an extra permission.

## Insights dashboard (beat Wispr by being honest + local-only)
Log **metadata-only** per dictation (NEVER store transcript text):
`DictationEvent { id, started_at, ended_at, duration_ms, raw_word_count, final_word_count,
edit_count, app_bundle_id, category, wpm }`. Category from the frontmost app bundle-id at inject
time (eri's control layer already knows it) via a user-editable lookup: Email/Chat/AI-prompts/
Code/Docs/Other. Cards (in the Voice mode of the morph pad + website):
1. **Time Saved** (hero) — *Wispr lacks this.* `words × (1/typing_baseline − 1/measured_wpm)`,
   measured WPM + user-set baseline (default 40), assumptions shown inline (honest, no fake).
2. WPM + sparkline + "×faster than typing". 3. **Streak + 12-month heatmap** (calm; counter
   optional/togglable; 48h grace). 4. **Per-app usage**. 5. **Category breakdown** (email/chat/
   ai/code/docs) — *Wispr lacks.* 6. Cleanup stats. 7. Cadence + Voice Profile (most-used/
   corrected word, archetype, peak time). 8. Milestones (off by default). No public leaderboard
   by default (privacy product). All from the local log — zero server.

## Quick-capture notes (hands-free)
Hold-to-talk hotkey (release=stop) or "hey eri, take a note" → Silero VAD (thresh 0.6, 800ms
trailing silence, 300ms pre-roll) → Tier-1 cleanup + **auto-title** → spoken leading-keyword
routing ("groceries…", "todo…") against a destination registry, else default inbox → lands in
eri's notes/memory store (markdown daily-note + SQLite index) → waveform pill + toast + optional
spoken confirm. Tier-2 (summary/action-items/tags) opt-in, anchored to the user's words.

## Phased build (TDD + ADR per phase, on-device-first)
- **P0 — STT upgrade:** swap ggml-whisper → Parakeet-TDT-on-ANE (FluidAudio) behind a transport
  seam (mirror the ControlTurn adapter pattern), keep whisper-rs fallback; NVIDIA attribution;
  validate WER on REAL dictation (accents/noise/jargon), not leaderboard read-speech.
- **P1 — Dictate-anywhere (Flow mode):** new injection sink → `ControlBridge::type_text()`;
  Carbon global-hotkey hold-to-talk; clipboard-paste primary + CGEvent fallback; partial/final →
  `DictationRules::process` (built) → inject at cursor. Headline parity feature, reuses 2 systems.
- **P2 — App-aware tone + Command Mode:** auto-select StyleTone (built) by frontmost app category
  + Tier-1 rewrite; Command-Mode hotkey for selection transforms ("make concise", "summarize").
- **P3 — Insights dashboard + streaks:** DictationEvent logging on the inject path; local agg;
  render the 8 cards (lead Time Saved + category breakdown). 
- **P4 — Quick-capture notes:** the hands-free flow above → eri notes.
- **P5 — Polish/parity:** dictionary auto-learns from corrections; multilingual tone (beat
  Wispr's English-only); per-word code-switching (beat per-session); generous free tier.

## Beat-Wispr scorecard
On-device/offline STT ✓ (Wispr ✗) · on-device cleanup ✓ (✗) · local-only insights ✓ · Time-Saved
card ✓ (✗) · category breakdown ✓ (✗) · multilingual tone ✓ (Wispr EN-only) · per-word
code-switch ✓ (per-session) · and eri *acts + learns you*, not just dictation.
