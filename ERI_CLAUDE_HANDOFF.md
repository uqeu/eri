# eri Claude Handoff

Date: 2026-05-14
Workspace: `/Users/khai/Desktop/eri`
Repository target: private GitHub repo `uqeu/eri`

## Read This First

This is a handoff for continuing the `eri` fork of Zed. The original plan came from Claude and described `eri` as a Zed hard fork whose core loop is:

`eyes select target -> voice expresses intent -> diffusion model continuously iterates code/actions -> preview updates -> user confirms edits hands-free`

I read that plan and then worked with Khai to adapt it into a practical MVP inside the existing Zed codebase. The user does not want another mock demo or passive plan. They want the app to feel like `eri` now, not Zed, and they want the camera, voice, and iterator loop to run automatically enough to begin testing immediately.

The emotional state matters here: Khai is frustrated because earlier builds still looked like Zed, the logo was broken, the iterator panel looked too mock/demo-like, camera did not turn on in the app, and voice did not capture speech. The next agent should not respond with high-level architecture only. Make the product behavior real and test it.

## User Goal

Build `eri` as a closed-source/private repo for now, then open-source it later after it works.

The immediate MVP goal is:

1. Launch the forked editor as `eri`, not Zed.
2. The UI should show `eri` branding everywhere important.
3. The iterator panel should be a real hands-free loop, not a static mock.
4. Camera/gaze should auto-start and show a live signal in the panel.
5. Voice capture should auto-start and stream partial speech into the prompt loop word-by-word.
6. Typing into the prompt should also stream partial text into the same loop.
7. Final speech / prompt commit should update `PromptCtx` and increase iteration budget.
8. Confirmation words like `accept`, `reject`, `try another`, etc. should drive the control grammar.
9. The demo path should eventually be: look at a preview button, say "make this red", see the likely target highlighted, see a candidate patch stream, say "accept".

## Hardware / Platform

Khai has a maxed-out M5 Max MacBook Pro.

Xcode was initially misconfigured to command-line tools only:

```sh
xcode-select -p
# /Library/Developer/CommandLineTools

xcrun -find metal
# unable to find utility "metal"
```

Khai then accepted the Xcode license and verified full Xcode:

```sh
xcrun -find metal
# /Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/metal

xcodebuild -version
# Xcode 26.5
# Build version 17F42
```

Assume macOS arm64 only for v1.

## Important Local Instructions

Read and follow `CLAUDE.md` in the repo. I read it before writing this handoff. Key rules:

- Rust correctness and clarity first.
- Avoid `unwrap()` when errors can be propagated.
- Do not silently discard fallible errors with `let _ =`.
- Prefer existing files unless a new logical component is needed.
- Do not create `mod.rs` paths.
- In GPUI code, use `cx.notify()` when state changes.
- Do not use `cargo clippy`; use `./script/clippy`.
- Use GPUI background executor timers in GPUI tests instead of `smol::Timer::after`.

Also avoid reverting user changes. The repo has many uncommitted edits from this session.

## Current Git State

Current branch is `main`.

Recent committed history:

```text
4ef549edc4 feat: add eri iterator panel
6c4fd21d9a feat: add eri runtime spine
7d8fe38b56 Bump Zed to v1.4.0 (#56653)
```

There are uncommitted changes. Do not assume the tree is clean.

Important modified files:

```text
.gitignore
Cargo.lock
crates/eri_core/src/eri_core.rs
crates/eri_core/tests/prompt_ctx.rs
crates/eri_inference/src/eri_inference.rs
crates/eri_iterator/tests/runtime.rs
crates/eri_ui/Cargo.toml
crates/eri_ui/src/eri_ui.rs
crates/eri_ui/tests/iterator_panel_state.rs
crates/feedback/src/feedback.rs
crates/icons/src/icons.rs
crates/install_cli/src/install_cli_binary.rs
crates/onboarding/src/basics_page.rs
crates/onboarding/src/onboarding.rs
crates/paths/src/paths.rs
crates/release_channel/src/lib.rs
crates/workspace/src/welcome.rs
crates/zed/Cargo.toml
crates/zed/resources/app-icon*.png
crates/zed/src/main.rs
crates/zed/src/zed.rs
crates/zed/src/zed/app_menus.rs
crates/zed/src/zed/mac_only_instance.rs
crates/zed/src/zed/move_to_applications.rs
```

Important untracked files:

```text
assets/icons/eri-text-black.png
assets/icons/eri-text-white.png
assets/icons/logo-black.svg
assets/models/face_landmarker.task
script/eri_gaze_mediapipe.py
script/eri_gaze_sidecar
script/eri_gaze_vision.swift
script/eri_voice_sidecar
ERI_CLAUDE_HANDOFF.md
```

## Branding Work Already Done

The user complained that the app still said "Welcome to Zed" and that all Zed branding needed to go. Several high-signal branding paths were changed.

### Binary / App Identity

`crates/zed/Cargo.toml`

- Added a binary named `eri` using `src/main.rs`.
- Set `default-run = "eri"`.
- Changed macOS bundle names / identifiers / URL schemes toward `eri`.

`crates/release_channel/src/lib.rs`

- Display names changed to:
  - `eri Dev`
  - `eri Nightly`
  - `eri Preview`
  - `eri`
- Bundle IDs changed to:
  - `dev.eri.Eri-Dev`
  - `dev.eri.Eri-Nightly`
  - `dev.eri.Eri-Preview`
  - `dev.eri.Eri`

`crates/paths/src/paths.rs`

- `APP_NAME` changed to `eri`, so local app data/config/cache paths use `eri` instead of `Zed`.

`crates/install_cli/src/install_cli_binary.rs`

- CLI install path was changed toward `/usr/local/bin/eri`.
- Prompt text was adjusted toward eri.

`crates/feedback/src/feedback.rs`

- Bug / feature / repo URLs changed to `https://github.com/uqeu/eri`.

### Welcome / Onboarding UI

`crates/onboarding/src/onboarding.rs`

- Header now says `Welcome to eri`.
- Subtitle now says `Diffusion IDE for hands-free building`.
- Uses `eri_logo_image(cx)` with:
  - `assets/icons/eri-text-black.png`
  - `assets/icons/eri-text-white.png`
- Chooses black/white wordmark based on theme.

`crates/workspace/src/welcome.rs`

- Replaced the obvious welcome page branding with `Welcome to eri`.
- Uses the eri wordmark image instead of the Zed logo.
- Adds an eri/sparkle identity instead of a Zed identity.

`crates/onboarding/src/basics_page.rs`

- Changed user-visible `Zed` strings in the first setup path to `eri`.
- Changed the agent card from `Zed Agent` to `eri Agent`.
- Swapped out the broken custom icon path for a built-in sparkle icon so it no longer shows a bad square.

### Logo / Icon Work

Khai saved:

```text
assets/icons/eri.svg
assets/icons/logo-black.svg
assets/icons/eri-text-black.png
assets/icons/eri-text-white.png
```

Important detail:

- `assets/icons/logo-black.svg` is the proper source for the app icon.
- The first attempt using an SVG in the onboarding/welcome UI rendered as a blank/broken square.
- The wordmark PNGs are now used for the welcome/onboarding visual branding because they render reliably in the GPUI image path.
- The app icon PNG resources under `crates/zed/resources/app-icon*.png` were regenerated from `assets/icons/logo-black.svg`.

Known remaining branding problem:

- There are still many `Zed` strings in the repo, including comments, test fixtures, keymaps, docs, scripts, and some user-visible areas.
- `crates/zed/resources/info/Permissions.plist` still says things like `An application in Zed wants to use the camera/microphone/speech recognition.` This should be changed to `eri`.
- Do a targeted product-facing branding pass. Do not blindly replace every `Zed` in the repo because many names are crate/action/type names or upstream compatibility paths.

## Runtime / Iterator Architecture Already Added

The following crates already exist from the previous committed work:

```text
crates/eri_core
crates/eri_iterator
crates/eri_inference
crates/eri_control
crates/eri_ui
```

These represent the first spine of the original Claude plan:

- `eri_core`: central data types and state.
- `eri_iterator`: runtime that accepts typed inputs and asks a backend to iterate.
- `eri_inference`: mock and sidecar backend contracts.
- `eri_control`: permission/action gateway foundation.
- `eri_ui`: GPUI iterator panel.

### `eri_core`

Key types implemented:

- `PromptCtx`
- `GazeTarget`
- `IdeAction`
- `CandidatePatch`
- `ControlCommand`
- patch staging/status types

`ControlCommand::parse` currently supports:

```text
accept
undo
reject
try another
focus editor
focus preview
send to builder
```

Important recent change:

- `PromptCtx::restart_iteration()` now clears stale candidate patches. This fixed repeated demo runs accumulating many `ProposePatch #1` actions.

### `eri_iterator`

`IteratorRuntime<B>` accepts:

```rust
RuntimeInput::OpenFile { path, text }
RuntimeInput::Gaze(GazeTarget)
RuntimeInput::PartialSpeech(String)
RuntimeInput::CommitSpeech(String)
RuntimeInput::EditorSelection(SourceRange)
```

It applies input to `PromptCtx`, computes denoising steps from the context, calls the backend, and applies streamed events back to `PromptCtx`.

### `eri_inference`

`InferenceBackend` exists.

`MockDiffusionBackend` exists and is deterministic.

Important recent change:

- The mock backend now reads both committed transcript and `partial_transcript`, so live typing/speech partials can drive draft/patch generation before the user commits the prompt.

Current mock behavior:

- If transcript/partial includes `red`, it drafts: `Preparing a red styling patch for the targeted preview element.`
- If transcript includes both `red` and `button`, and the open file contains `button { background: blue; }`, it proposes:
  - path: `src/App.tsx`
  - old text: `button { background: blue; }`
  - new text: `button { background: red; }`

`DreamSidecarBackend` exists as a contract layer:

- Builds payload containing `PromptCtx`, denoising steps, and current draft.
- Posts JSON to `/iterate` through a `SidecarTransport`.
- Decodes streamed/returned `IterEvent` values.

This is not a full real diffusion model yet.

## Iterator Panel Work Already Done

Main file:

```text
crates/eri_ui/src/eri_ui.rs
```

The iterator panel currently:

- Registers itself in every workspace.
- Lives in a dock panel, default right side.
- Has an `eri` header with sparkle icon.
- Shows iteration budget.
- Shows target signal and confidence meter.
- Shows camera card.
- Shows prompt stream card.
- Shows diffusion draft card.
- Shows candidate patch card.
- Shows confirmation/status card.
- Shows model actions.
- Has buttons:
  - `Prime target`
  - `Commit`
  - `Accept`
  - `Reject`

Recent UI cleanup:

- The old ugly mock layout was replaced with a more structured panel.
- Repeated `ProposePatch #1` spam was fixed by clearing stale patches on new iteration.
- Accept/reject now update a status message without polluting the draft text.
- The prompt stream uses a real Zed/GPUI single-line `Editor`, not a fake text box.
- Typing in that editor sends `RuntimeInput::PartialSpeech` on every edit.
- Pressing newline or clicking `Commit` sends `RuntimeInput::CommitSpeech`, clears the editor, and increments the prompt context budget.

Current limitation:

- Voice sidecar is not yet wired into `EriIteratorPanel`.
- Camera sidecar is wired to a manual `Start camera` button, not auto-start.
- The panel still uses `Prime target` for the MVP target instead of resolving real preview/source targets.
- Candidate patch apply/undo are not actually mutating workspace files yet.

## Tests Already Added / Updated

`crates/eri_ui/tests/iterator_panel_state.rs`

Tests include:

- Panel state starts empty.
- Demo target populates target, draft, action, and patch summary.
- Partial prompt text drives live candidate patch.
- Repeated demo runs do not accumulate stale actions.
- Accept/reject update status without polluting draft.
- Partial transcript updates without spending iteration budget.

`crates/eri_iterator/tests/runtime.rs`

- Added coverage that partial speech can drive mock candidate generation.

`crates/eri_core/tests/prompt_ctx.rs`

- Updated for restart/candidate behavior.

Verification already run before the most recent handoff file:

```sh
cargo test -p eri_core -p eri_control -p eri_inference -p eri_iterator -p eri_ui
cargo check -p zed
git diff --check
```

Those passed before the newly added `script/eri_voice_sidecar` handoff-era work. Re-run all verification after finishing the sidecar wiring.

## Camera / Gaze Work Already Done

The user explicitly said we can use GitHub repos / external packages for gaze tracking and do not have to rely only on local macOS APIs.

I researched practical options and settled on a local sidecar approach:

- Primary implementation: Python + MediaPipe + OpenCV.
- Fallback implementation: Swift + AVFoundation + Vision.

### Python Environment

Created a project-local virtualenv:

```text
.venv-gaze
```

Updated `.gitignore` to ignore:

```text
.cache
.venv-gaze
```

Installed dependencies with `uv`:

```sh
uv --cache-dir .uv-cache venv --python 3.12 .venv-gaze
uv --cache-dir .uv-cache pip install --python .venv-gaze/bin/python mediapipe opencv-python
```

The current `mediapipe` package does not expose the old `mp.solutions` path we initially expected, so the code uses MediaPipe Tasks:

```python
from mediapipe.tasks import python as mp_tasks
from mediapipe.tasks.python import vision
```

### MediaPipe Model

Downloaded:

```text
assets/models/face_landmarker.task
```

This is required by the MediaPipe Tasks `FaceLandmarker`.

### Sidecar Wrapper

`script/eri_gaze_sidecar`

- zsh wrapper.
- If `.venv-gaze/bin/python` and `script/eri_gaze_mediapipe.py` exist, it execs the Python sidecar.
- Otherwise it execs the Swift fallback `script/eri_gaze_vision.swift`.

### Python Sidecar

`script/eri_gaze_mediapipe.py`

Behavior:

- Opens camera with OpenCV.
- Runs MediaPipe FaceLandmarker in video mode.
- Reads iris landmark indices.
- Emits JSON lines to stdout.
- Emits status/error/gaze events.
- Supports `--preview` to show a debug OpenCV window with a point overlay.

Example event shape:

```json
{"type":"status","message":"Camera active. MediaPipe Iris is tracking locally."}
{"type":"gaze","target":"camera","label":"MediaPipe Iris","x":0.52,"y":0.47,"confidence":0.72}
{"type":"error","message":"Could not open camera index 0."}
```

Known needed cleanup:

- It currently uses `os.getcwd()` for cache/model paths. This works from repo root but should be changed to derive the repo root from `__file__`, so it still works if spawned from another current directory or app bundle.

### Swift Fallback

`script/eri_gaze_vision.swift`

Behavior:

- Uses AVFoundation camera capture.
- Uses Vision face landmarks.
- Emits JSON lines.
- Requests camera access.
- Estimates gaze coarsely from eye/face landmarks.

It was typechecked successfully with:

```sh
xcrun swiftc -frontend -typecheck \
  -target arm64-apple-macosx15.0 \
  -sdk /Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk \
  -primary-file script/eri_gaze_vision.swift
```

### Direct Camera Test

After fixing MediaPipe model/API usage, direct run was tested:

```sh
script/eri_gaze_sidecar --run
```

It emitted:

```text
Starting MediaPipe Iris gaze sidecar.
Camera active. MediaPipe Iris is tracking locally.
Camera active. No face detected.
```

The process stayed alive until killed manually. This means the sidecar can open the camera locally, but the app UI still needs the auto-start and live wiring completed.

### Current App Camera Wiring

`EriIteratorPanel` currently has:

```rust
camera_process: Option<Child>
camera_status: SharedString
camera_point: Option<(f32, f32)>
camera_reader_task: Option<Task<()>>
```

It can spawn:

```text
script/eri_gaze_sidecar --run
```

It reads stdout JSON lines on a background thread, sends them through an `mpsc` channel, and then uses `cx.spawn` / `cx.background_spawn` to update GPUI state.

It parses:

```rust
GazeSidecarEvent::Status
GazeSidecarEvent::Error
GazeSidecarEvent::Gaze
```

On a gaze event, it updates `camera_point`, submits `RuntimeInput::Gaze(...)`, and updates the camera status.

Current problem:

- The panel does not auto-start the sidecar.
- The UI screenshot showed `camera sidecar stopped` because an earlier broken MediaPipe run exited. The Python sidecar was fixed after that screenshot, but the app was not rebuilt/relaunched and reverified after auto-start wiring.

## Voice Work Started But Not Finished

A Swift speech sidecar was added:

```text
script/eri_voice_sidecar
```

It uses:

- `AVFoundation`
- `Speech`
- `SFSpeechRecognizer`
- `AVAudioEngine`
- `SFSpeechAudioBufferRecognitionRequest`

It emits JSON lines:

```json
{"type":"status","message":"Voice capture active. Speak to stream into eri."}
{"type":"partial","text":"make this"}
{"type":"final","text":"make this red"}
{"type":"error","message":"Speech recognition permission denied."}
```

Current state:

- The file exists.
- It still needs executable bit set with `chmod +x script/eri_voice_sidecar`.
- It still needs Swift typechecking.
- It still needs to be wired into `crates/eri_ui/src/eri_ui.rs`.
- It probably needs macOS microphone and speech recognition permission prompts.
- `Permissions.plist` already includes `NSMicrophoneUsageDescription` and `NSSpeechRecognitionUsageDescription`, but they still say Zed and should be changed to eri.

Suggested Swift typecheck command:

```sh
xcrun swiftc -frontend -typecheck \
  -target arm64-apple-macosx15.0 \
  -sdk /Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk \
  -primary-file script/eri_voice_sidecar
```

## Exact Next Implementation Goal

Make the iterator panel automatically start both sidecars and feed real events into `PromptCtx`.

Do this before spending time on bigger model/backend work.

### 1. Patch macOS permission strings

File:

```text
crates/zed/resources/info/Permissions.plist
```

Change user-facing strings from `Zed` to `eri`, especially:

- camera
- microphone
- speech recognition
- AppleScript
- admin/elevated permissions

### 2. Make gaze sidecar path robust

File:

```text
script/eri_gaze_mediapipe.py
```

Replace `os.getcwd()` model/cache assumptions with repo-root-from-script:

```python
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
```

Then:

```python
model_path = os.path.join(ROOT_DIR, "assets", "models", "face_landmarker.task")
```

And use repo-local cache directories from `ROOT_DIR`.

### 3. Finish voice sidecar validation

File:

```text
script/eri_voice_sidecar
```

Do:

```sh
chmod +x script/eri_voice_sidecar
xcrun swiftc -frontend -typecheck ... -primary-file script/eri_voice_sidecar
```

Fix any Swift compiler errors.

### 4. Wire voice sidecar into `EriIteratorPanel`

File:

```text
crates/eri_ui/src/eri_ui.rs
```

Add import:

```rust
use eri_core::ControlCommand;
```

Add enum:

```rust
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum VoiceSidecarEvent {
    Status { message: String },
    Partial { text: String },
    Final { text: String },
    Error { message: String },
}
```

Add fields to `EriIteratorPanel`:

```rust
voice_process: Option<Child>,
voice_status: SharedString,
voice_reader_task: Option<Task<()>>,
```

Add methods similar to camera:

- `start_voice_sidecar(&mut self, cx: &mut Context<Self>)`
- `start_voice(&mut self, _: &ClickEvent, _: &mut Window, cx: &mut Context<Self>)`
- `spawn_voice_reader(receiver: mpsc::Receiver<String>, cx: &mut Context<Self>) -> Task<()>`
- `voice_process_is_running(&mut self) -> bool`
- `handle_voice_sidecar_line(&mut self, line: &str)`

`handle_voice_sidecar_line` should:

- On `Status`, update `voice_status`.
- On `Error`, update `voice_status`.
- On `Partial { text }`, call `self.state.update_partial_transcript(text)` and notify.
- On `Final { text }`:
  - First parse with `ControlCommand::parse(&text)`.
  - If `Accept`, call `self.state.accept_candidate()`.
  - If `Reject`, call `self.state.reject_candidate()`.
  - If `Undo`, set status for now unless undo is wired.
  - If `TryAnother`, clear/restart or set status for now.
  - If `FocusEditor` / `FocusPreview` / `SendToBuilder`, map to status or real action if available.
  - Otherwise call `self.state.commit_transcript(text)`.

Important: partial voice text should appear live in the prompt stream area even when the text editor itself is empty.

### 5. Auto-start camera and voice

Currently the user has to click `Start camera`, which violates the product goal.

In `EriIteratorPanel::new`, after constructing `Self`, call internal start methods for both camera and voice.

Refactor camera:

- Keep button handler, but make it call `start_camera_sidecar`.
- `start_camera_sidecar` should be reusable from constructor.

Pseudo-shape:

```rust
let mut this = Self { ... };
this.start_camera_sidecar(cx);
this.start_voice_sidecar(cx);
this
```

The UI buttons can become `Restart camera` and `Restart voice`, but the default state should be automatic.

### 6. Render better live voice/camera state

In the panel:

- Add a `Voice` card or expand `Prompt stream`.
- Show `voice_status`.
- Show live partial transcript from `snapshot.partial_transcript` as text.
- Keep the text editor as a manual fallback path.
- Show `camera_point` as `x/y` and/or a simple small dot/meter so the user sees the gaze stream changing.

The user specifically wants to see that the camera is tracking and voice is being captured. If permission fails, the UI must say so clearly.

### 7. Rebuild and test

After wiring:

```sh
cargo fmt
.venv-gaze/bin/python -m py_compile script/eri_gaze_mediapipe.py
xcrun swiftc -frontend -typecheck ... -primary-file script/eri_gaze_vision.swift
xcrun swiftc -frontend -typecheck ... -primary-file script/eri_voice_sidecar
cargo test -p eri_core -p eri_control -p eri_inference -p eri_iterator -p eri_ui
cargo check -p zed
git diff --check
```

Then relaunch:

```sh
cargo run --bin eri
```

If an old app process is running, kill it first. Previous approved process tooling in Codex used:

```sh
pgrep -fl "target/debug/eri|eri$"
```

Then kill the specific PID.

## What Is Working Now

These are the pieces that exist and are either tested or partially verified:

- Private fork direction is set.
- GitHub target repo is `uqeu/eri`.
- Core `eri_*` crates exist.
- Prompt context accepts transcript, partial transcript, gaze, editor selection, open files, candidate patches, decisions, and iteration budget.
- Mock inference backend exists and can propose a red button patch.
- Partial transcript drives mock generation.
- Iterator panel exists in the app.
- Prompt text editor streams typed text into `PromptCtx`.
- Commit action sends a final prompt turn.
- Accept/reject update status.
- Repeated demo patch spam was fixed.
- App icon PNG resources were replaced with the eri logo.
- Welcome/onboarding obvious branding was changed to eri.
- MediaPipe gaze sidecar can open camera in a direct run.
- Swift Vision gaze fallback exists and typechecked.
- Swift Speech sidecar file exists but is not wired/tested yet.

## What Is Not Working Yet

Be direct about this:

- The app is not yet truly hands-free.
- Camera does not yet auto-start in the panel.
- Voice does not yet auto-start or stream into the panel.
- The current panel still has demo affordances (`Prime target`).
- Real preview-to-source mapping is not implemented.
- Real patch apply/undo to workspace files is not implemented.
- Real Whisper/local LLM/diffusion backend is not implemented.
- Current inference is still `MockDiffusionBackend`.
- Some Zed product strings remain.
- The permission prompt strings still mention Zed.

## Important UX Feedback From Khai

Khai explicitly said:

- The panel looked ugly/broken before and needs to feel "crazy", not like a debug mock.
- The product should be usable with voice and eyes, not keyboard/mouse.
- The prompt stream should update every time a new word is spoken or typed.
- The model should read the prompt while the user is still speaking/typing and iterate continuously.
- The camera should turn on automatically.
- Voice should capture automatically.
- The user wants to test it immediately, not wait for perfect architecture.
- The user is okay with this fork being stale relative to upstream Zed for now.
- The user is not distributing yet; this is private/internal for now.

## Suggested Claude Prompt / Goal

Paste this into Claude as the next goal:

```text
You are continuing the `eri` fork in `/Users/khai/Desktop/eri`. Read `CLAUDE.md` and `ERI_CLAUDE_HANDOFF.md` first.

Do not plan only. Implement the next runtime step.

Goal: make the existing eri iterator panel actually hands-free enough to test.

Requirements:
1. Patch macOS permission strings from Zed to eri.
2. Make `script/eri_gaze_mediapipe.py` derive repo paths from `__file__` instead of `os.getcwd()`.
3. Validate and chmod `script/eri_voice_sidecar`.
4. Wire `script/eri_voice_sidecar --run` into `crates/eri_ui/src/eri_ui.rs`.
5. Auto-start both camera and voice sidecars when `EriIteratorPanel` is created.
6. Stream voice partial events into `IteratorPanelState::update_partial_transcript`.
7. Stream voice final events into `IteratorPanelState::commit_transcript`, except when they match `ControlCommand` words like `accept` or `reject`.
8. Show live voice status and live partial transcript in the panel.
9. Show live camera status and gaze x/y in the panel.
10. Keep manual Start/Restart buttons as fallback, but default behavior must be automatic.
11. Rebuild and run tests/checks:
    - `cargo fmt`
    - `.venv-gaze/bin/python -m py_compile script/eri_gaze_mediapipe.py`
    - Swift typecheck for gaze and voice sidecars
    - `cargo test -p eri_core -p eri_control -p eri_inference -p eri_iterator -p eri_ui`
    - `cargo check -p zed`
    - `git diff --check`
12. Relaunch `cargo run --bin eri` and verify the panel no longer says camera stopped by default and has a real voice/camera status path.

Do not rip out the existing `eri_*` crate architecture. Work with it.
Do not replace all remaining Zed strings blindly. Prioritize user-visible product surfaces.
Do not use `unwrap()` in Rust changes unless there is no reasonable alternative.
Do not silently discard fallible errors.
```

## Recommended Follow-Up After Sidecars Work

Once camera + voice events actually stream into the UI:

1. Replace the fake `Prime target` flow with a real target resolver.
2. Capture active preview region metadata if available.
3. Add source-range selection/highlight in the editor.
4. Implement reversible patch staging and visible preview before file write.
5. Wire `ApplyPatch`, `RejectPatch`, and `UndoLastPatch` through `eri_control`.
6. Add a local LLM/Whisper backend path:
   - Speech can remain Apple Speech for immediate testing, or move to Whisper later.
   - The inference backend can remain mock until the UI loop is reliable.
7. Add builder handoff export for Claude/Codex/Kimi using serialized `PromptCtx`, transcript, gaze events, decisions, and candidate patch state.

## Notes On Whisper vs Apple Speech

Khai asked whether to use Whisper or some existing whisper-flow account.

For immediate local testing, Apple Speech sidecar is faster to wire because:

- It is already available on macOS.
- It supports streaming partial transcripts.
- It can request permissions through the app.
- It avoids model download/setup.

But the product plan still says `eri_voice` should use Whisper. Treat Apple Speech as the first working local capture path, not necessarily the final backend.

Later, add a provider abstraction:

```text
VoiceBackend
- AppleSpeechSidecarBackend
- WhisperCppSidecarBackend
- ExternalWhisperFlowBackend
```

## Notes On Gaze Accuracy

Do not promise pixel-perfect gaze. The original plan explicitly says confidence-based likely targets are okay.

The current sidecar should be treated as:

- local camera signal
- face/iris estimate
- coarse x/y confidence stream
- enough to drive likely target highlighting

The real product UX should show:

- likely target
- confidence
- visible highlight
- easy correction/confirmation

## Build / Verification Reminder

The user wants production momentum, but do not claim success without running the checks. At minimum after code changes:

```sh
cargo fmt
cargo test -p eri_core -p eri_control -p eri_inference -p eri_iterator -p eri_ui
cargo check -p zed
git diff --check
```

For sidecars:

```sh
.venv-gaze/bin/python -m py_compile script/eri_gaze_mediapipe.py
script/eri_gaze_sidecar --run
script/eri_voice_sidecar --run
```

The last two may require camera/microphone/speech permission prompts and may run indefinitely; test them carefully and stop them after confirming events.

