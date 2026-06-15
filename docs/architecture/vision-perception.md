# eri vision & perception — golden eyes for computer-use, camera, and gaze

Status: Design (research-validated 2026-06-15) · See the approved plan + `[[project_composio_brain_execution]]`. eri is macOS, commercial, local-first, token-frugal.

## Core principle: vision REASONS on Claude; eri EXTRACTS locally

**Vision always routes to Claude** — Claude leads GUI grounding (ScreenSpot-Pro **0.879**, ahead of every open model), so eri must NOT ship a grounding VLM to "do vision." eri's job is the opposite: **on-device extractors turn each frame into clean structured data** (UI elements + bboxes + roles + text) that is fed to Claude, so Claude clicks more accurately, with fewer tokens and fewer mis-clicks. eri-brain (text dense model) is not a VLM → any vision-requiring task bypasses eri-brain → Claude (a routing rule to add to the classifier/EngineLadder).

## ⚠️ LocateAnything (NVIDIA) CANNOT SHIP — replace it

`scripts/eri_vision_sidecar.py` currently uses NVIDIA LocateAnything-3B. It is a **dead end for the product**: NVIDIA license is **non-commercial only**, and it runs **CUDA/Linux/BF16 only** — eri is commercial + macOS, no NVIDIA GPU. Keep it for internal eval/benchmarking ONLY; it must never be in the shipped binary. The user's "way more" = replace it with a license-clean, macOS-runnable stack (below).

## Screen-extractor pipeline (computer-use) — license-clean, macOS-native

Per captured frame, all on-device (mirror the existing `gaze.rs` ↔ Swift-sidecar pattern; actuate via the existing computer-use MCP):
1. **Capture** — `ScreenCaptureKit` (Swift), focus-free window/screen grab.
2. **AX harvest** — `AXUIElement` walk: role + name + bounds + value. Free, exact, token-cheap — the PRIMARY signal. (Gaps: ~40% of apps expose no AX, Electron/canvas/custom-drawn.)
3. **OCR** — **Apple Vision `VNRecognizeTextRequest`** (`.accurate`): text + bounding boxes for what AX missed. System framework, ANE-accelerated, nothing to ship.
4. **Vision gap-fill** — a **permissive** detector for interactable elements AX missed: **Florence-2 (MIT)** or a Screen2AX-style YOLOv11+caption head **retrained off AGPL**. This is the direct LocateAnything replacement.
5. **Fuse + dedupe** — AX ∪ Vision ∪ OCR → one normalized list `{id, role, label, bbox, interactable, text, source}` (AX wins geometry; OCR/vision win labels AX lacks).
6. **Set-of-Mark** — overlay numbered boxes on the screenshot (reuse `crates/eri_images`).
7. **→ Claude** — send the annotated screenshot + compact numbered element list; Claude reasons and returns "click #N"; eri maps #N → bbox center → MCP click.

**Blueprint to port:** **Peekaboo** (MIT, Swift — ScreenCaptureKit + AX + ScreenCapture, ships as CLI/MCP). **Shippable licenses:** Apple Vision (system) · Florence-2 (MIT) · RapidOCR (Apache, cross-platform fallback) · Peekaboo (MIT). **Avoid in binary:** LocateAnything (NVIDIA NC + CUDA), OmniParser YOLO detector (AGPL), GTA1 dataset (CC-BY-NC-SA). Optional offline-mode local grounding fallback: **Holo1.5-7B (Apache-2.0)** via MLX — not the default path.

**Phased:** P0 AX + Apple Vision OCR + Set-of-Mark (no ML download — ships today, already beats raw-screenshot Claude on tokens/mis-clicks) → P1 Florence-2 gap-fill (replace LocateAnything) → P2 hierarchy + cross-frame element-memory caching → P3 optional Holo1.5-7B offline fallback.

## Eye-tracking / gaze — best-of-the-best, local

Current gaze (`crates/eri_coreutils/src/services/gaze.rs` + `scripts/eri_gaze_mediapipe.py`) is an **un-calibrated magic-gain geometric guess** with a **no-op `calibrate()`** (gaze.rs:143). The sidecar architecture (frames stay local, JSON-per-line → Rust broadcast) is sound; the model + calibration are the gap. No ARKit gaze on macOS → Vision/AVFoundation + Core ML/ANE only.

**Phased:** P0 **real 9-point calibration** + ridge/poly regressor + one-euro smoothing (biggest win, smallest change — replace the magic gains + the boolean) → P1 model = **WebEyeTrack** (MIT, screen point-of-gaze ~2.3 cm, on-device 9-shot personalization; keep MediaPipe as fallback) → P2 **continuous implicit recalibration** from eri's own click/dwell/voice-confirm events (`action_log.rs` = free labels) → P3 **Core ML/ANE** via a Swift sidecar (extend `eri_gaze_vision.swift`) or ONNX via the `ort` crate + CoreML EP. Expect ~2-3° on-screen → **snap to nearest UI element + pair with voice ("click that")**, not pixel-exact.

## Camera side-signals (local extractors → Claude reasons)

Generalize `gaze.rs` from gaze-only to a multi-signal perception service (same JSON-line contract; raw frames never cross to Rust), via MediaPipe (Apache) / Apple Vision:
- **Presence** → gate `proactive.rs` (don't interrupt an empty chair).
- **Head gesture (nod/shake)** → hands-free confirm/cancel for `control_safety.rs` allowlist (huge for a hands-free agent).
- **Attention** (gaze-on-screen vs away) → interruption timing.
- **Blendshape affect** (52 coefficients) → frustration/confusion cue → offer help. **Hand gestures** (MediaPipe) → optional select/scroll/confirm.

## Build order across the vision workstream
1. **vision→Claude routing rule** (small Rust: classifier/EngineLadder forces Claude for vision tasks + captures the frame). 2. Gaze **P0 calibration**. 3. Screen-extractor **P0** (AX+OCR+Set-of-Mark Swift sidecar). 4. Screen **P1** Florence-2 (retire LocateAnything from the shipped path). 5. Camera side-signals (nod-confirm, presence). Each green-gated, license-checked, committed.

## References
Screen: ScreenSpot-Pro leaderboard gui-agent.github.io/grounding-leaderboard · OmniParser-v2 (MSR) · Florence-2 (MIT) hf.co/microsoft/Florence-2-large · Screen2AX arxiv 2507.16704 + github.com/MacPaw/Screen2AX · Peekaboo github.com/openclaw/Peekaboo · Apple Vision VNRecognizeTextRequest · LocateAnything hf.co/nvidia/LocateAnything-3B (NC). Gaze: WebEyeTrack arxiv 2508.19544 + github.com/RedForestAI/WebEyeTrack (MIT) · L2CS-Net (MIT) · MobileGaze ONNX github.com/yakhyo/gaze-estimation · vGaze implicit calib arxiv 2209.15196 · ort crate github.com/pykeio/ort.
