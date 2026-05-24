use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use thiserror::Error;

// Local stub for the old `eri_theme` crate. The GPUI-era theme/font catalog was
// retired with the VSCodium pivot — theme + font choices are now driven from
// the IDE's TS extension. These stubs keep the voice-command intent surface
// callable; they always return None until the IDE binding wires real lookups
// back in via the JSON-RPC sidecar protocol.
mod eri_theme {
    pub fn match_theme(_: &str) -> Option<&'static str> {
        None
    }
    pub fn match_display_font(_: &str) -> Option<&'static str> {
        None
    }
    pub fn match_body_font(_: &str) -> Option<&'static str> {
        None
    }
    pub fn match_mono_font(_: &str) -> Option<&'static str> {
        None
    }
}

const STEPS_PER_COMMITTED_SPEECH_TURN: u32 = 16;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PromptCtx {
    transcript: Vec<String>,
    partial_transcript: Option<String>,
    gaze_target: GazeTarget,
    editor_selection: Option<SourceRange>,
    open_files: Vec<FileContext>,
    current_draft: String,
    candidate_patches: Vec<CandidatePatch>,
    decisions: Vec<PatchDecision>,
    iteration_budget: u32,
    active_iteration: u64,
}

impl Default for PromptCtx {
    fn default() -> Self {
        Self {
            transcript: Vec::new(),
            partial_transcript: None,
            gaze_target: GazeTarget::Unknown { confidence: 0.0 },
            editor_selection: None,
            open_files: Vec::new(),
            current_draft: String::new(),
            candidate_patches: Vec::new(),
            decisions: Vec::new(),
            iteration_budget: 0,
            active_iteration: 0,
        }
    }
}

impl PromptCtx {
    pub fn active_iteration(&self) -> u64 {
        self.active_iteration
    }

    pub fn transcript(&self) -> &[String] {
        &self.transcript
    }

    pub fn partial_transcript(&self) -> Option<&str> {
        self.partial_transcript.as_deref()
    }

    pub fn gaze_target(&self) -> &GazeTarget {
        &self.gaze_target
    }

    pub fn editor_selection(&self) -> Option<&SourceRange> {
        self.editor_selection.as_ref()
    }

    pub fn current_draft(&self) -> &str {
        &self.current_draft
    }

    pub fn candidate_patches(&self) -> &[CandidatePatch] {
        &self.candidate_patches
    }

    pub fn iteration_budget(&self) -> u32 {
        self.iteration_budget
    }

    pub fn set_file_context(&mut self, path: PathBuf, text: String) -> u64 {
        if let Some(file) = self.open_files.iter_mut().find(|file| file.path == path) {
            file.text = text;
        } else {
            self.open_files.push(FileContext { path, text });
        }
        self.restart_iteration()
    }

    pub fn open_files(&self) -> &[FileContext] {
        &self.open_files
    }

    pub fn commit_transcript_chunk(&mut self, chunk: impl Into<String>) -> u64 {
        let chunk = chunk.into();
        if !chunk.trim().is_empty() {
            self.transcript.push(chunk);
            self.iteration_budget = self
                .iteration_budget
                .saturating_add(STEPS_PER_COMMITTED_SPEECH_TURN);
        }
        self.partial_transcript = None;
        self.restart_iteration()
    }

    pub fn update_partial_transcript(&mut self, chunk: impl Into<String>) -> u64 {
        let chunk = chunk.into();
        self.partial_transcript = (!chunk.trim().is_empty()).then_some(chunk);
        self.restart_iteration()
    }

    /// Update gaze target without invalidating the current draft or
    /// candidate patches. Gaze is a UI hint, not a prompt change — a
    /// 12 Hz gaze stream should not wipe Mercury's response.
    pub fn set_gaze_target(&mut self, target: GazeTarget) -> u64 {
        self.gaze_target = target;
        self.active_iteration
    }

    pub fn set_editor_selection(&mut self, selection: SourceRange) -> u64 {
        self.gaze_target = GazeTarget::Editor {
            path: selection.path.clone(),
            line_range: selection.line_range.clone(),
            confidence: 1.0,
        };
        self.editor_selection = Some(selection);
        self.restart_iteration()
    }

    pub fn is_current_iteration(&self, iteration: u64) -> bool {
        self.active_iteration == iteration
    }

    pub fn apply_iter_event(
        &mut self,
        iteration: u64,
        event: IterEvent,
    ) -> Result<(), EriCoreError> {
        if !self.is_current_iteration(iteration) {
            return Ok(());
        }

        match event {
            IterEvent::DraftToken { text } => self.current_draft.push_str(&text),
            IterEvent::CandidatePatch { patch } => self.candidate_patches.push(patch),
            IterEvent::Error { message } => return Err(EriCoreError::Iteration(message)),
            IterEvent::DenoisingStep { .. }
            | IterEvent::TargetClarification { .. }
            | IterEvent::CandidateAction { .. }
            | IterEvent::Usage { .. }
            | IterEvent::Done => {}
        }

        Ok(())
    }

    /// Apply a remote-backend event without iteration gating. Use this for
    /// Mercury (and other slower remote LLMs) where the iteration counter
    /// may have advanced because of in-flight partial-transcript updates,
    /// but the user still wants to see the result.
    pub fn apply_remote_event(&mut self, event: IterEvent) -> Result<(), EriCoreError> {
        match event {
            IterEvent::DraftToken { text } => {
                self.current_draft = text;
            }
            IterEvent::CandidatePatch { patch } => {
                self.candidate_patches
                    .retain(|existing| existing.id != patch.id);
                self.candidate_patches.push(patch);
            }
            IterEvent::Error { message } => return Err(EriCoreError::Iteration(message)),
            IterEvent::DenoisingStep { .. }
            | IterEvent::TargetClarification { .. }
            | IterEvent::CandidateAction { .. }
            | IterEvent::Usage { .. }
            | IterEvent::Done => {}
        }
        Ok(())
    }

    fn restart_iteration(&mut self) -> u64 {
        self.active_iteration = self.active_iteration.saturating_add(1);
        self.current_draft.clear();
        self.candidate_patches.clear();
        self.active_iteration
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileContext {
    pub path: PathBuf,
    pub text: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LineRange {
    pub start: u32,
    pub end: u32,
}

impl LineRange {
    pub fn new(start: u32, end: u32) -> Self {
        Self { start, end }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SourceRange {
    pub path: PathBuf,
    pub line_range: LineRange,
}

impl SourceRange {
    pub fn new(path: PathBuf, line_range: LineRange) -> Self {
        Self { path, line_range }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Bounds {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

impl Bounds {
    pub fn new(x: f32, y: f32, width: f32, height: f32) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SourceHint {
    pub path: PathBuf,
    pub line_range: LineRange,
    pub component_label: Option<String>,
}

impl SourceHint {
    pub fn new(path: PathBuf, line_range: LineRange, component_label: Option<String>) -> Self {
        Self {
            path,
            line_range,
            component_label,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum GazeTarget {
    Editor {
        path: PathBuf,
        line_range: LineRange,
        confidence: f32,
    },
    Preview {
        element_label: Option<String>,
        bounds: Bounds,
        source_hint: Option<SourceHint>,
        confidence: f32,
    },
    Panel {
        panel_id: String,
        confidence: f32,
    },
    Unknown {
        confidence: f32,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CandidatePatch {
    pub id: u64,
    pub path: PathBuf,
    pub old_text: String,
    pub new_text: String,
}

impl CandidatePatch {
    pub fn replace_text(
        id: u64,
        path: PathBuf,
        old_text: impl Into<String>,
        new_text: impl Into<String>,
    ) -> Self {
        Self {
            id,
            path,
            old_text: old_text.into(),
            new_text: new_text.into(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum PatchDecision {
    Accepted { patch_id: u64 },
    Rejected { patch_id: u64 },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum IdeAction {
    FocusPanel { panel_id: String },
    SelectSourceRange { range: SourceRange },
    HighlightTarget { target: GazeTarget },
    ProposePatch { patch: CandidatePatch },
    ApplyPatch { patch_id: u64 },
    RejectPatch { patch_id: u64 },
    UndoLastPatch,
    OpenTerminal,
    SendToBuilder { command: Option<String> },
}

impl IdeAction {
    pub fn requires_confirmation(&self) -> bool {
        matches!(
            self,
            Self::ApplyPatch { .. } | Self::OpenTerminal | Self::SendToBuilder { .. }
        )
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum IterEvent {
    DraftToken {
        text: String,
    },
    DenoisingStep {
        step: u32,
        total: u32,
    },
    TargetClarification {
        message: String,
    },
    CandidatePatch {
        patch: CandidatePatch,
    },
    CandidateAction {
        action: IdeAction,
    },
    Usage {
        /// Identifies which paid endpoint produced this usage line so the
        /// panel can charge against the right pricing column. Examples:
        /// `mercury-2`, `mercury-edit-2`. Older callers that didn't tag the
        /// emission deserialize as empty via `serde(default)`.
        #[serde(default)]
        model: String,
        prompt_tokens: u32,
        completion_tokens: u32,
        reasoning_tokens: u32,
        total_tokens: u32,
    },
    Done,
    Error {
        message: String,
    },
}

#[derive(Clone, Debug, PartialEq)]
pub enum ControlCommand {
    Accept,
    Undo,
    /// "redo" / "forward" — move forward one iteration in the scrubber and
    /// restore that snapshot as the active build.
    Redo,
    /// "go to iteration N" / "load N" — jump the scrubber to the given
    /// 1-based iteration index and restore that snapshot.
    GoToIteration(u64),
    Reject,
    TryAnother,
    /// "try again" / "retry" / "do it again" — rerun Mercury with the last
    /// committed transcript turn. Used after a timeout, a Mercury error, or
    /// when the previous draft missed the mark. Distinct from `TryAnother`,
    /// which clears the partial and waits for a fresh prompt.
    Retry,
    FocusEditor,
    FocusPreview,
    SendToBuilder,
    /// "new project foo" — create a fresh persistent project named `foo` and
    /// make it the active build dir.
    NewProject(String),
    /// "open foo" / "load foo" — switch the active build dir to an existing
    /// persistent project that slug-matches `foo`.
    OpenProject(String),
    /// "list projects" — emit a status line listing every persistent project
    /// the user has on disk.
    ListProjects,
    /// "list templates" / "what can you build" / "show templates" — emit a
    /// status line listing every known project starter.
    ListTemplates,
    /// "use the portfolio template" / "start with the coffee shop template" —
    /// drop the named template into the current project's `index.html`
    /// directly (no Mercury call needed). Iterations refine on top.
    UseTemplate(String),
    /// "make this async" / "rewrite this to use map" / "add error handling
    /// here" — inline rewrite of an editor selection via Mercury Edit 2.
    /// Carries the natural-language instruction; only fires when the panel
    /// has an active editor selection. Use [`ControlCommand::parse_with_selection`]
    /// to opt into the deictic-intent path; the plain parser stays
    /// build-focused so existing call sites that don't know about selection
    /// continue to behave the same.
    RewriteSelection(String),
    /// "accept" / "apply" / "keep it" — apply the pending inline rewrite.
    /// Distinct from [`ControlCommand::Accept`], which still maps to the
    /// existing candidate-patch flow. The UI layer disambiguates: if there's
    /// a pending inline rewrite, `AcceptPatch` wins; otherwise the plain
    /// `Accept` continues to mean "accept the proposed file patch".
    AcceptPatch,
    /// "reject" / "discard" / "cancel" / "no" — dismiss the pending inline
    /// rewrite without applying it. Same disambiguation rule as
    /// `AcceptPatch` vs `Reject`.
    RejectPatch,
    /// "list mcp tools" / "what tools do you have" / "show tools" — emit a
    /// status line listing the tools exposed by every MCP server currently
    /// configured in `~/.eri/mcp.json`.
    ListMcpTools,
    /// "reload mcp" / "reload tools" — re-read `~/.eri/mcp.json` and rebuild
    /// the MCP client pool, picking up edits without restarting eri.
    ReloadMcpConfig,
    /// "enable mcp tools" / "use mcp tools" / "give mercury the tools" — flip
    /// the panel-level MCP-enabled flag so future Mercury fires include every
    /// configured MCP server's tools alongside `edit_html`. Default OFF for
    /// safety — without this flag, MCP tools are NEVER passed to Mercury.
    EnableMcp,
    /// "disable mcp tools" / "stop using mcp tools" — clear the MCP-enabled
    /// flag so future Mercury fires omit MCP tools.
    DisableMcp,
    /// "edit rules" / "show project rules" / "open the rules file" — open
    /// `<project>/.eri/rules.md` in the user's preferred editor. If the file
    /// is absent the handler creates the starter scaffold first so the editor
    /// has something to load.
    EditRules,
    /// "start recording" / "record this" / "start demo" — begin capturing
    /// screen + mic + system audio into a single MP4 under
    /// `~/Desktop/eri-demos/`. v1 is macOS-only; the panel shells out to the
    /// `eri_record_sidecar` ffmpeg wrapper. Used to grab pitch-quality demos
    /// without leaving eri.
    StartRecording,
    /// "stop recording" / "stop demo" / "end recording" — finalize the
    /// in-flight MP4 (SIGTERM to ffmpeg) and surface its on-disk path through
    /// the brain → TTS path.
    StopRecording,
    /// "show history" / "show commits" / "git log" / "show iterations" —
    /// surface the per-project git log so users can see what's been built
    /// and pick a commit to revert to.
    ShowHistory,
    /// "go back to last commit" / "revert to <hash-or-fragment>" — checkout
    /// a specific commit in the per-project git repo and restore its
    /// `index.html` as the live preview. The payload is either a commit hash
    /// (or prefix that uniquely matches), or the literal token `"last"`
    /// meaning "the commit just before HEAD".
    RevertToCommit(String),
    /// "publish this" / "share this" / "publish to eri.dev" — bundle the
    /// active project's iteration history (every `iter NNNN: <prompt>` commit
    /// from `eri_git`) and POST it to the eri.dev publish endpoint. The
    /// resulting `eri.dev/p/<slug>` URL is spoken back through the brain →
    /// TTS path so the user gets the share link without leaving the panel.
    PublishProject,
    /// "check seo" / "lighthouse check" / "audit accessibility" — run a focused
    /// SEO + a11y + production-cleanup audit against the live `index.html`.
    /// Distinct from `SendToBuilder` (which redesigns and ships) — `SeoCheck`
    /// preserves layout and content and only fixes correctness issues.
    SeoCheck,
    /// "use goose" / "use claude" / "switch to goose" / "switch to claude" —
    /// flip the active autonomous-agent backend that drives polish, ship-it,
    /// and SEO audit. Payload is the lowercased agent name (`"claude"` or
    /// `"goose"`). The panel handler dispatches to
    /// `eri_inference::AgentBackend::select` and surfaces an
    /// `agent_switched` brain event so the brain → TTS path can confirm.
    SwitchAgent(String),
    /// "use gpt-4o" / "switch to claude haiku" / "use gemini flash" / "switch
    /// back to mercury" — pick the LLM model that drives the next inference
    /// call. Payload is the canonical model id resolved by
    /// `eri_inference::canonical_model_id` (e.g. `"gpt-4o"`,
    /// `"claude-sonnet-4-5"`, `"gemini-flash-2"`, `"mercury-2"`). Distinct
    /// from [`ControlCommand::SwitchAgent`], which flips the polish/ship-it
    /// CLI (claude / goose) rather than the inner-loop inference model.
    SwitchModel(String),
    /// "list models" / "what models can I use" / "show models" — emit a status
    /// line listing every model id `eri_inference::list_providers` knows
    /// about (mercury-2, gpt-4o, claude-sonnet-4-5, gemini-flash-2, …).
    ListModels,
    /// "preview as phone" / "tablet preview" / "preview as desktop" — toggle
    /// the eri preview sidecar between desktop (full width), tablet (768px),
    /// and phone (375px) viewports so the user can verify responsive design
    /// during voice iteration without leaving the panel.
    SetPreviewWidth(PreviewWidth),
    /// "pause spending" / "stop spending" / "pause" — flip the cost guard
    /// into the paused state so the panel refuses every Mercury fire and
    /// every Claude polish/ship-it subprocess until `ResumeSpending` lands.
    PauseSpending,
    /// "resume" / "resume spending" / "go ahead" — clear the paused flag set
    /// by `PauseSpending` or by hitting the session cap.
    ResumeSpending,
    /// "raise the limit to <N> dollars" / "set spending limit to <N>" —
    /// bump the session $$ cap to `N`, clear the latched warning flags so
    /// 50/80% warnings re-fire, and unpause if we were paused. Payload is
    /// the new dollar amount, parsed from the user's spoken digits.
    RaiseSpendingLimit(f64),
    /// "what's my spending" / "show cost" / "how much have I spent" — emit a
    /// status line with the running $$ breakdown.
    ShowSpending,
    /// "clone my voice" / "use my voice" / "make eri sound like me" — kick off
    /// the ElevenLabs Instant Voice Clone wizard. The panel spawns
    /// `script/eri_voice_clone`, streams its progress into the status line, and
    /// — once a `voice_id` lands on disk — restarts the TTS sidecar with the
    /// new voice so eri speaks back in the user's own voice.
    CloneMyVoice,
    /// "use stripe colors" / "make it look like linear" / "use the cyberpunk
    /// palette" / "theme it like a coffee shop" — pin a curated color palette
    /// (background / foreground / accent / muted hex codes) onto the NEXT
    /// Mercury fire. The payload is the lowercased palette query as spoken;
    /// the handler in the UI crate resolves it via
    /// `eri_inference::match_theme_palette` and prepends a `# Theme directive`
    /// block to the next user prompt. Unknown palette names surface as a
    /// status line rather than triggering a fire.
    SetTheme(String),
    /// "use the midnight theme" / "switch to eri noir theme" / "use eri-paper
    /// theme" — change the IDE-wide visual theme (chrome, panel surfaces,
    /// editor background) by id or name. Distinct from
    /// [`ControlCommand::SetTheme`], which only pins a *design directive* for
    /// the next Mercury fire. The payload is the lowercased theme query as
    /// spoken; the UI handler resolves it via `eri_theme::match_theme` and
    /// persists it to `~/.eri/settings.toml`.
    SetUiTheme(String),
    /// "use dark mode" / "switch to dark mode" / "light mode" — flip the
    /// IDE between the default dark theme (`eri-midnight`) and the default
    /// light theme (`eri-paper`). Payload is the lowercased mode word
    /// (`"dark"` or `"light"`). Routed through [`ControlCommand::SetUiTheme`]
    /// in the UI layer.
    SetUiThemeMode(String),
    /// "list themes" / "show themes" / "what themes do you have" — emit a
    /// status line listing every theme id `eri_theme::all_themes` knows.
    ListThemes,
    /// "use Fraunces" / "switch display font to Geist" / "set the display
    /// font to Inter" — change the IDE's display/headline font. Payload is
    /// the user-spoken font name; the UI handler resolves it via
    /// `eri_theme::match_display_font`.
    SetDisplayFont(String),
    /// "use IBM Plex Sans for the body" / "set the body font to Inter" —
    /// change the IDE's body/UI font.
    SetBodyFont(String),
    /// "switch the mono font to Berkeley Mono" / "use JetBrains Mono" / "use
    /// Cascadia Code for code" — change the IDE's monospace font.
    SetMonoFont(String),
    /// "add motion" / "add animations" / "make it animated" — inject a
    /// Framer-Motion-style motion directive (hero fade-up, button hover lift,
    /// smooth scroll, staggered grids) into the next Mercury user prompt.
    /// Mercury then references the `MOTION PRESETS` snippets in its system
    /// prompt verbatim, so animations stay consistent across builds.
    AddMotion,
    /// "generate a hero image of a coffee shop on a rainy night" / "make a
    /// hero photo of mountains at sunrise" / "add a hero image showing
    /// downtown Tokyo" — fire Flux (via Replicate) for a single hero image
    /// and splice it into the active build through Mercury Edit 2. Payload is
    /// the user's natural-language description of the image.
    GenerateHeroImage(String),
    /// "regenerate the images" / "replace the placeholder images" / "swap the
    /// stock photos" — scan the active `index.html` for placeholder Unsplash
    /// URLs and replace each one with a freshly-generated Flux image whose
    /// prompt is derived from the surrounding `alt` text.
    RegenerateImages,
    /// "add auth0" / "add clerk" / "wire up supabase auth" — spawn a Claude
    /// Code CLI background job that installs the named auth SDK, scaffolds a
    /// login button + callback handler, and prints next-steps for the user.
    /// Payload is a lowercased provider id; the UI handler translates it into
    /// `eri_inference::AuthProvider` and surfaces an `integration_starting`
    /// brain event so the TTS sidecar speaks "wiring up auth0".
    AddAuth(AuthProviderKind),
    /// "add a database" / "set up postgres" / "use supabase for the db" —
    /// spawn a Claude Code CLI background job that installs the right
    /// Postgres SDK (Neon or Supabase), writes a `lib/db.*` module, and
    /// prints next-steps. Bare "add a database" / "set up postgres" defaults
    /// to [`DbProviderKind::Neon`]; mentioning supabase routes to
    /// [`DbProviderKind::Supabase`].
    AddDatabase(DbProviderKind),
    /// "add stripe" / "add a stripe checkout" / "add stripe for $20 a month"
    /// — spawn a Claude Code CLI background job that installs Stripe,
    /// scaffolds the Checkout Session endpoint + webhook, and prints
    /// next-steps. The payload is the monthly USD price if the user voiced
    /// one (e.g. "$20 a month" → 20.0), otherwise 0.0 to fall back to a
    /// `STRIPE_PRICE_LABEL` env var.
    AddPayments(f64),
    /// "post about this" / "write a thread about this" / "make a tweet about
    /// this build" / "generate social" — bundle the just-finished recording
    /// (or, if none, a text-only description) plus the session intents and
    /// hand the package to Claude Code CLI, which produces a 6-8 tweet
    /// thread + alt-text + suggested posting window. The UI handler stores
    /// the result on the panel and speaks "thread ready" via brain → TTS.
    GenerateSocialThread,
    /// "copy the thread" / "copy that thread" / "copy thread" — push the
    /// most recently generated social thread to the system clipboard, joined
    /// with blank lines between tweets so the user can paste straight into a
    /// Twitter/X composer.
    CopyLastThread,
    /// "clear the reference" / "remove the image" / "ignore the screenshot" —
    /// drop the pending reference image that the user attached to the iterator
    /// panel via drag-and-drop, so the next Mercury fire stops embedding the
    /// `data:image/...` URL in the user prompt.
    ClearReferenceImage,
    /// "rebuild index" / "reindex" / "scan the project" — kick off a fresh
    /// [`eri_index::Index::build`](../../eri_index/struct.Index.html#method.build)
    /// against the active project dir so voice @-mentions ("rewrite the
    /// contact form") resolve against the current codebase rather than a
    /// stale snapshot. The handler runs the scan on a background task and
    /// writes `<project>/.eri-index.json` when it completes.
    RebuildIndex,
    /// "find bugs" / "audit my code" / "what's broken" / "look for problems" —
    /// kick off the background bug-finder pass against the active build.
    /// Spawns a Claude Code CLI subprocess in the background and stashes the
    /// resulting `Vec<Bug>` on the panel for the "Bugs" card. Reusing the
    /// background-agent slot rather than the polish slot so a long-running
    /// audit doesn't lock out an in-flight polish/ship-it.
    FindBugs,
    /// "fix bug 2" / "fix the first bug" / "apply the first fix" — apply the
    /// fix for the bug at the given 1-based index in the panel's current
    /// `Vec<Bug>`. When the bug carries a `suggested_fix` search/replace
    /// block, the panel applies it directly via `apply_search_replace_blocks`
    /// against the current HTML; otherwise it queues a Mercury Edit 2 call
    /// using the bug's `message` as the instruction.
    FixBug(usize),
    /// "fix all bugs" / "fix everything" — apply every bug in the current
    /// list in order. Bugs with `suggested_fix` blocks apply directly;
    /// remaining ones queue through Mercury Edit 2.
    FixAllBugs,
    /// "start a background agent to <task>" / "run in the background <task>" /
    /// "kick off a background task to <task>" — launch a long-running Claude
    /// Code CLI subprocess that works on `<task>` in parallel with the
    /// foreground voice-iterate loop. Status row "Background: <task>"
    /// appears at the top of the panel; the dot flips green on completion.
    /// Payload is the user's natural-language task description, trimmed and
    /// stripped of the trigger phrase.
    StartBackgroundAgent(String),
    /// "write tests for this" / "generate tests" / "test this" / "add tests" —
    /// hand the active editor file (or visible code region) to Claude Code
    /// CLI with the test-generation prompt from
    /// `eri_inference::code_assist::build_test_generation_prompt`. Claude
    /// returns a complete test file as one fenced code block; the panel
    /// strips the fences and writes it adjacent to the source.
    WriteTests,
    /// "explain this" / "explain this code" / "what does this do" / "walk me
    /// through this" — hand the active code to Claude Code CLI with the
    /// explainer prompt. Claude returns 3-5 sentences of plain prose, which
    /// the panel pipes directly into the TTS sidecar.
    ExplainThis,
    /// "refactor this to <X>" / "clean this up by <X>" / "rewrite this to use
    /// <X>" — apply a behavior-preserving refactor. Payload is the
    /// post-trigger tail (the "<X>" the user voiced) — for example, the
    /// utterance "refactor this to use async await" carries the payload
    /// "use async await". Claude returns the refactored code as one fenced
    /// code block; the panel applies it as a patch.
    RefactorThis(String),
    /// "document this" / "add docs" / "generate docs" / "add jsdoc" / "add
    /// docstrings" / "add rustdoc" — generate inline documentation comments
    /// for the active code. Payload is a lowercased doc-style hint
    /// (`"jsdoc"`, `"docstring"`, `"rustdoc"`, or empty for "default to
    /// inline / file-extension-derived"). The handler picks the actual
    /// `DocStyle` via `eri_inference::DocStyle::from_path` when the payload
    /// is empty.
    DocumentThis(String),
    /// "open a pr" / "create a pull request" / "open a pull request" /
    /// "make a pr" — bundle the recent iteration history into a Claude
    /// prompt, generate a polished title + body, push the current branch
    /// to the configured remote, and shell out to `gh pr create`. The PR
    /// URL is spoken back through the brain → TTS path.
    OpenPullRequest,
    /// "amend the commit message" / "rewrite the commit message" / "rewrite
    /// that commit" / "write a better commit message" — re-run Claude over
    /// the diff at HEAD~1..HEAD and amend the most recent commit's message
    /// with the result. Used to swap the formulaic `iter NNNN: <prompt>`
    /// subject for a richer, imperative-mood description after the fact.
    BetterCommitMessage,
    /// "subscribe to starter" / "upgrade to pro" / "go pro" — kick off a
    /// Stripe Checkout Session for the named plan and open the resulting URL
    /// in the user's default browser. The payload is the lowercased plan
    /// name as spoken (`"starter"` or `"pro"`); the UI handler resolves it
    /// via `eri_billing::Plan::from_spoken`.
    OpenCheckout(String),
    /// "manage billing" / "open billing portal" / "billing settings" — fetch
    /// a one-shot Stripe Customer Portal URL via `eri_billing` and open it
    /// in the user's default browser so they can update card, cancel, or
    /// download invoices without leaving eri.
    ManageBilling,
    /// "show usage" / "how much have i used" / "monthly usage" — request the
    /// current monthly usage rollup (tokens + dollars) from the billing API
    /// and speak it through the brain → TTS path.
    ShowUsage,
    /// "check my subscription" / "am i subscribed" — request the current
    /// subscription tier + status from the billing API and surface it
    /// through the brain → TTS path.
    CheckSubscription,
    /// "what's my brain" / "what tier am i on" / "what's my eri brain" /
    /// "am i on personalized" — brain-tier-focused alias of
    /// [`ControlCommand::CheckSubscription`]. Resolves to a status print of
    /// the current tier name plus the Adaptive / Frontier / Personalized
    /// label. The UI handler routes both `WhatsMyBrain` and
    /// `CheckSubscription` to the same backend call, but uses
    /// brain-focused response wording for this variant.
    WhatsMyBrain,
    /// "log in" / "sign in" / "login" — start the eri.dev account login flow.
    /// Carries no payload; the UI handler prompts for email + password via
    /// the panel (or hands off to a system browser when SSO lands). Distinct
    /// from [`ControlCommand::AddAuth`], which scaffolds an auth provider
    /// inside the user's *build*; `Login` authenticates the user against
    /// eri.dev itself.
    Login,
    /// "sign up" / "create an account" / "register" — start the eri.dev
    /// account signup flow. Same payload-free shape as
    /// [`ControlCommand::Login`]; the UI handler routes the email + password
    /// through `eri_auth::AuthClient::signup`.
    Signup,
    /// "log out" / "sign out" — drop the in-memory access token, call the
    /// `/api/auth/logout` endpoint with the stored refresh token, and clear
    /// the keychain slot via `eri_auth::clear_refresh_token`.
    Logout,
    /// "who am i" / "whoami" / "what's my account" — emit a status line with
    /// the currently signed-in user's email + subscription tier. Falls back
    /// to "signed out" via the brain → TTS path when no session is loaded.
    WhoAmI,
    /// "upgrade" / "upgrade my account" / "go pro" — surface the upgrade
    /// path. The UI handler picks the right destination: when no session is
    /// loaded, it fires [`ControlCommand::Login`] first; otherwise it
    /// delegates to [`ControlCommand::OpenCheckout`] with the user's
    /// next-tier default.
    UpgradeAccount,
}

/// Auth provider id carried by [`ControlCommand::AddAuth`]. Kept in
/// `eri_core` (rather than pulling `eri_inference::AuthProvider`) so the
/// core crate stays free of the inference crate dependency. The UI layer
/// maps this enum onto `eri_inference::AuthProvider` when building the
/// integration prompt.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AuthProviderKind {
    Auth0,
    Clerk,
    SupabaseAuth,
}

impl AuthProviderKind {
    pub fn slug(self) -> &'static str {
        match self {
            AuthProviderKind::Auth0 => "auth0",
            AuthProviderKind::Clerk => "clerk",
            AuthProviderKind::SupabaseAuth => "supabase",
        }
    }
}

/// Database provider id carried by [`ControlCommand::AddDatabase`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DbProviderKind {
    Neon,
    Supabase,
}

impl DbProviderKind {
    pub fn slug(self) -> &'static str {
        match self {
            DbProviderKind::Neon => "neon",
            DbProviderKind::Supabase => "supabase",
        }
    }
}

/// Viewport preset for the eri preview sidecar. Pixel widths track the
/// standard responsive breakpoints: `Phone` = 375 (iPhone portrait),
/// `Tablet` = 768 (iPad portrait), `Desktop` = window-fill.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PreviewWidth {
    Desktop,
    Tablet,
    Phone,
}

impl PreviewWidth {
    /// Pixel width to render the WKWebView at. `Desktop` returns `0`, which
    /// the sidecar interprets as "fill the window" instead of a fixed width.
    pub fn pixels(self) -> u32 {
        match self {
            PreviewWidth::Desktop => 0,
            PreviewWidth::Tablet => 768,
            PreviewWidth::Phone => 375,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            PreviewWidth::Desktop => "Desktop",
            PreviewWidth::Tablet => "Tablet · 768px",
            PreviewWidth::Phone => "Mobile · 375px",
        }
    }

    /// One-word handle used by the brain → TTS path so eri can say
    /// "switched to phone" / "switched to tablet" / "switched to desktop".
    pub fn spoken_name(self) -> &'static str {
        match self {
            PreviewWidth::Desktop => "desktop",
            PreviewWidth::Tablet => "tablet",
            PreviewWidth::Phone => "phone",
        }
    }
}

impl ControlCommand {
    pub fn parse(input: &str) -> Option<Self> {
        Self::parse_with_selection(input, false)
    }

    /// Selection-aware parser. When `has_editor_selection` is true, eri's
    /// deictic-rewrite vocabulary ("make this async", "refactor this to use
    /// map", "add error handling here") routes to
    /// [`ControlCommand::RewriteSelection`] instead of falling through to the
    /// generic build path. Without a selection, those phrases stay
    /// uninterpreted so the build flow handles them.
    ///
    /// Accept / reject phrasings expand: when a selection (and by extension
    /// a pending inline rewrite) is in scope, the panel also recognizes
    /// "apply", "keep it", "yes", "discard", "cancel", and "no" — phrasings
    /// that would be too noisy in the normal flow but are unambiguous when
    /// the user is staring at a ghost-text suggestion.
    pub fn parse_with_selection(input: &str, has_editor_selection: bool) -> Option<Self> {
        // Normalize: lowercase, trim, drop trailing punctuation (whisper often
        // ends commands with "." or "!").
        let trimmed = input.trim().trim_end_matches(['.', '!', '?']);
        let lowered = trimmed.to_ascii_lowercase();

        // Git history view. Match before the scrubber jump arms so "show
        // commits" isn't mis-parsed by a later prefix.
        match lowered.as_str() {
            "show history"
            | "show commits"
            | "show commit history"
            | "show iterations"
            | "show the history"
            | "git log"
            | "git history" => return Some(Self::ShowHistory),
            _ => {}
        }

        // Pull-request flow. Matched before the generic build path so phrases
        // like "open a pull request" / "make a pr" are never mistaken for a
        // fresh project intent. The "amend / rewrite commit message" arms sit
        // here too because they share the git/PR context: both fan out to
        // Claude through `eri_inference::pr` and surface their result via the
        // same brain → TTS path.
        match lowered.as_str() {
            "open a pr"
            | "open pr"
            | "open the pr"
            | "open a pull request"
            | "open pull request"
            | "open the pull request"
            | "create a pr"
            | "create pr"
            | "create a pull request"
            | "create pull request"
            | "make a pr"
            | "make pr"
            | "make a pull request"
            | "make pull request"
            | "submit a pr"
            | "submit a pull request"
            | "send a pr"
            | "send a pull request"
            | "raise a pr"
            | "raise a pull request" => return Some(Self::OpenPullRequest),
            "amend the commit"
            | "amend the commit message"
            | "amend commit"
            | "amend commit message"
            | "amend the message"
            | "rewrite the commit"
            | "rewrite the commit message"
            | "rewrite that commit"
            | "rewrite that commit message"
            | "rewrite commit message"
            | "rewrite the message"
            | "write a better commit message"
            | "write a better commit"
            | "better commit message"
            | "improve the commit message"
            | "improve commit message"
            | "fix the commit message" => return Some(Self::BetterCommitMessage),
            _ => {}
        }

        // Publish to eri.dev. Matched before the "share <project>" /
        // "publish <name>" prefix arms below so the bare confirmation
        // phrasings ("publish this", "share this") always win.
        match lowered.as_str() {
            "publish"
            | "publish this"
            | "publish it"
            | "publish project"
            | "publish this project"
            | "publish to eri"
            | "publish to eri dev"
            | "publish to eri.dev"
            | "publish to the web"
            | "share"
            | "share it"
            | "share this"
            | "share this project"
            | "share project"
            | "share to eri"
            | "share to eri dev"
            | "share to eri.dev" => return Some(Self::PublishProject),
            _ => {}
        }

        // Social thread generator. Matched before TEMPLATE_PREFIXES /
        // NEW_PREFIXES so "write a thread about this" doesn't get parsed as
        // "write a thread" (a template seed) and so "make a tweet about this
        // build" isn't mistaken for a new-project intent. Pair phrasing:
        // `GenerateSocialThread` produces the thread; `CopyLastThread` pushes
        // it to the clipboard.
        match lowered.as_str() {
            "post about this"
            | "post about this build"
            | "post about that"
            | "post about that build"
            | "tweet about this"
            | "tweet about this build"
            | "tweet about that"
            | "tweet about that build"
            | "write a thread"
            | "write a thread about this"
            | "write a thread about this build"
            | "write a thread about that"
            | "write a thread about that build"
            | "write the thread"
            | "make a tweet"
            | "make a tweet about this"
            | "make a tweet about this build"
            | "make a tweet about that"
            | "make a tweet about that build"
            | "make a thread"
            | "make a thread about this"
            | "make a thread about this build"
            | "generate a thread"
            | "generate a thread about this"
            | "generate a tweet"
            | "generate social"
            | "generate social thread"
            | "generate the thread"
            | "draft a thread"
            | "draft a tweet"
            | "draft the thread"
            | "social post"
            | "social thread" => return Some(Self::GenerateSocialThread),
            "copy the thread"
            | "copy that thread"
            | "copy this thread"
            | "copy thread"
            | "copy the tweet"
            | "copy the tweets"
            | "copy the social"
            | "copy the social thread"
            | "copy the post"
            | "copy social"
            | "copy social thread" => return Some(Self::CopyLastThread),
            _ => {}
        }

        // Drop the pending reference image attached via drag-and-drop on the
        // iterator panel. Matched before the open/template prefix loops below
        // so "remove the image" / "clear the reference" can never be misread
        // as a project name. The handler nukes
        // `EriIteratorPanel::pending_reference_image` and any prepended design
        // directive containing the embedded `data:image/...` URL.
        match lowered.as_str() {
            "clear the reference"
            | "clear reference"
            | "clear the reference image"
            | "clear reference image"
            | "clear the image"
            | "clear image"
            | "remove the reference"
            | "remove reference"
            | "remove the reference image"
            | "remove the image"
            | "remove image"
            | "remove the screenshot"
            | "remove screenshot"
            | "drop the reference"
            | "drop the image"
            | "drop the screenshot"
            | "ignore the reference"
            | "ignore the image"
            | "ignore the screenshot"
            | "forget the image"
            | "forget the reference"
            | "forget the screenshot" => return Some(Self::ClearReferenceImage),
            _ => {}
        }

        // Codebase semantic indexer. Matched before the TEMPLATE / NEW
        // prefix arms (which both consume bare verbs like "scan ..." /
        // "rebuild ...") so the user can refresh the @-mention index
        // without it being mistaken for a project name.
        match lowered.as_str() {
            "rebuild index" | "rebuild the index" | "reindex" | "re-index" | "re index"
            | "refresh index" | "refresh the index" | "update index" | "update the index"
            | "scan the project" | "scan project" | "rescan the project" | "rescan project"
            | "index the project" | "index project" => return Some(Self::RebuildIndex),
            _ => {}
        }

        // Voice cloning wizard. Matched before any prefix arms so phrasings
        // like "use my voice" never get treated as a template-seed command
        // ("use the <name> template").
        match lowered.as_str() {
            "clone my voice"
            | "clone voice"
            | "clone my own voice"
            | "use my voice"
            | "use my own voice"
            | "make eri sound like me"
            | "make eri talk like me"
            | "make you sound like me"
            | "sound like me"
            | "talk like me"
            | "voice clone"
            | "start voice clone"
            | "start the voice clone"
            | "start voice cloning"
            | "record my voice"
            | "record my own voice" => return Some(Self::CloneMyVoice),
            _ => {}
        }

        // eri.dev account voice commands. Matched well before NEW_PREFIXES /
        // OPEN_PREFIXES so phrasings like "create an account" / "sign in" /
        // "log in" never get mistaken for project intents ("create a new
        // <thing>" or "open <project>"). The UI handler in a later pass wires
        // these to `eri_auth::AuthClient` and the keychain helpers; here we
        // only parse them.
        match lowered.as_str() {
            "log in" | "login" | "log me in" | "sign in" | "sign me in" | "log into eri"
            | "log into eri dev" | "log into eri.dev" | "sign into eri" | "sign into eri dev"
            | "sign into eri.dev" | "log in to eri" | "log in to eri dev" | "log in to eri.dev"
            | "sign in to eri" | "sign in to eri dev" | "sign in to eri.dev" => {
                return Some(Self::Login);
            }
            "sign up"
            | "signup"
            | "sign me up"
            | "register"
            | "register me"
            | "register an account"
            | "create an account"
            | "create account"
            | "create my account"
            | "create a new account"
            | "make an account"
            | "make me an account"
            | "make a new account"
            | "make account"
            | "open an account"
            | "open account"
            | "start an account"
            | "start account" => return Some(Self::Signup),
            "log out"
            | "logout"
            | "log me out"
            | "sign out"
            | "sign me out"
            | "log out of eri"
            | "log out of eri dev"
            | "log out of eri.dev"
            | "sign out of eri"
            | "sign out of eri dev"
            | "sign out of eri.dev" => return Some(Self::Logout),
            "who am i"
            | "whoami"
            | "what's my account"
            | "what is my account"
            | "show my account"
            | "show me my account"
            | "what account am i on"
            | "what account am i using"
            | "am i logged in"
            | "am i signed in" => return Some(Self::WhoAmI),
            "upgrade"
            | "upgrade me"
            | "upgrade my account"
            | "upgrade the account"
            | "upgrade my plan"
            | "upgrade plan"
            | "go pro"
            | "go to pro" => return Some(Self::UpgradeAccount),
            _ => {}
        }

        // Cost guard voice commands. Matched before the JUMP_PREFIXES below
        // so "raise the limit to 5 dollars" never gets mis-parsed as a
        // scrubber jump. The bare confirmation phrasings ("pause", "resume",
        // "go ahead") sit in the main match arm further down.
        match lowered.as_str() {
            "pause spending" | "stop spending" | "pause the spending" | "stop the spending"
            | "pause spend" | "pause cost" | "pause costs" | "halt spending" => {
                return Some(Self::PauseSpending);
            }
            "resume spending"
            | "resume the spending"
            | "resume cost"
            | "resume costs"
            | "unpause spending"
            | "unpause"
            | "continue spending"
            | "go ahead" => return Some(Self::ResumeSpending),
            "what is my spending"
            | "what's my spending"
            | "what is my spend"
            | "what's my spend"
            | "show spending"
            | "show my spending"
            | "show cost"
            | "show costs"
            | "show the cost"
            | "show the costs"
            | "show budget"
            | "show my budget"
            | "how much have i spent"
            | "how much have i spent so far"
            | "how much did i spend"
            | "what have i spent" => return Some(Self::ShowSpending),
            _ => {}
        }

        // Billing voice commands. Matched here (before the generic build path)
        // so phrases like "subscribe to starter" / "upgrade to pro" never get
        // mis-parsed as a fresh project intent. Pairs with the `eri_billing`
        // crate, which handles the actual Stripe / API calls.
        if let Some(cmd) = parse_billing_command(lowered.as_str()) {
            return Some(cmd);
        }

        // Regenerate placeholder images — match literal phrasings BEFORE any
        // template/build prefix can claim the "regenerate ..." / "replace ..."
        // verbs. Triggers a scan of `<session>/index.html` for placeholder
        // Unsplash URLs and a Flux re-render per `<img>`.
        match lowered.as_str() {
            "regenerate images"
            | "regenerate the images"
            | "regenerate all images"
            | "regenerate all the images"
            | "regen images"
            | "regen the images"
            | "replace images"
            | "replace the images"
            | "replace placeholder images"
            | "replace the placeholder images"
            | "replace stock images"
            | "replace the stock images"
            | "replace stock photos"
            | "replace the stock photos"
            | "swap images"
            | "swap the images"
            | "swap stock photos"
            | "swap the stock photos"
            | "refresh images"
            | "refresh the images"
            | "generate real images"
            | "generate the images" => return Some(Self::RegenerateImages),
            _ => {}
        }

        // Generate a single hero image — prefix arms ahead of TEMPLATE_PREFIXES
        // / NEW_PREFIXES so "make a hero image of ..." / "generate a hero
        // photo of ..." land here instead of being mis-parsed as a fresh
        // project or template seed. The payload is the description that
        // follows the deictic anchor ("of <description>" / "showing
        // <description>"). Order matters: the longer, more specific prefixes
        // come first so they win over their shorter siblings.
        const HERO_IMAGE_PREFIXES: &[&str] = &[
            "generate a hero image of ",
            "generate a hero image showing ",
            "generate a hero photo of ",
            "generate a hero photo showing ",
            "generate hero image of ",
            "generate hero image showing ",
            "generate hero photo of ",
            "generate hero photo showing ",
            "make a hero image of ",
            "make a hero image showing ",
            "make a hero photo of ",
            "make a hero photo showing ",
            "make hero image of ",
            "make hero image showing ",
            "make hero photo of ",
            "make hero photo showing ",
            "create a hero image of ",
            "create a hero image showing ",
            "create a hero photo of ",
            "create a hero photo showing ",
            "create hero image of ",
            "create hero image showing ",
            "create hero photo of ",
            "create hero photo showing ",
            "add a hero image of ",
            "add a hero image showing ",
            "add a hero photo of ",
            "add a hero photo showing ",
            "add hero image of ",
            "add hero image showing ",
            "add hero photo of ",
            "add hero photo showing ",
            "draw a hero image of ",
            "draw a hero photo of ",
        ];
        for prefix in HERO_IMAGE_PREFIXES {
            if let Some(rest) = lowered.strip_prefix(prefix) {
                let description = rest.trim();
                if !description.is_empty() {
                    return Some(Self::GenerateHeroImage(description.to_string()));
                }
            }
        }

        // Motion directive — short literal arms matched BEFORE the build path
        // ("add a pricing section") and BEFORE the TEMPLATE_PREFIXES loop ("add
        // ...") so "add motion" / "make it animated" never falls through to a
        // generic build. The handler injects the MOTION_DIRECTIVE_BLOCK into
        // the next Mercury user prompt.
        match lowered.as_str() {
            "add motion"
            | "add animation"
            | "add animations"
            | "add some motion"
            | "add some animations"
            | "make it animated"
            | "make it animate"
            | "animate it"
            | "animate this"
            | "add transitions"
            | "make it move"
            | "with motion"
            | "with animations" => return Some(Self::AddMotion),
            _ => {}
        }

        // Integration scaffolding voice commands. Matched BEFORE the
        // TEMPLATE_PREFIXES / OPEN_PREFIXES loops (which both consume "add ..."
        // and "use ..." shapes) so "add auth0" / "set up postgres" / "add
        // stripe for $20 a month" never get treated as project / template
        // names.
        if let Some(cmd) = parse_integration_command(&lowered) {
            return Some(cmd);
        }

        // IDE theme + font commands. Matched BEFORE the SetTheme block below
        // (which feeds Mercury a design directive) so phrases like "list
        // themes", "use dark mode", and "use Fraunces" are routed to the
        // `eri_theme` IDE-wide system rather than baked into the next Mercury
        // user prompt.
        match lowered.as_str() {
            "list themes"
            | "show themes"
            | "list all themes"
            | "show all themes"
            | "what themes do you have"
            | "what themes are there"
            | "what themes can i use" => return Some(Self::ListThemes),
            "dark mode"
            | "use dark mode"
            | "switch to dark mode"
            | "go dark"
            | "make it dark"
            | "make it dark mode" => return Some(Self::SetUiThemeMode("dark".into())),
            "light mode"
            | "use light mode"
            | "switch to light mode"
            | "go light"
            | "make it light"
            | "make it light mode" => return Some(Self::SetUiThemeMode("light".into())),
            _ => {}
        }

        // IDE font picker. "use Fraunces" / "switch display font to Geist" /
        // "set the body font to Inter" / "use JetBrains Mono". We resolve
        // against `eri_theme` catalogs so a generic "use foo" only routes
        // here if `foo` actually names a known font.
        if let Some(cmd) = parse_font_command(&lowered) {
            return Some(cmd);
        }

        // Theme directive — "use stripe colors" / "use the cyberpunk palette" /
        // "theme it like a coffee shop" / "make it look like linear". Matched
        // BEFORE the TEMPLATE_PREFIXES loop ("use the X template") and the
        // OPEN_PREFIXES loop ("load X") so a palette name beats project / template
        // resolution. The handler resolves the payload via
        // `eri_inference::match_theme_palette`; unknown names surface a status
        // line without triggering a Mercury fire.
        const THEME_PREFIXES: &[&str] = &[
            "use the ",
            "use ",
            "theme it like the ",
            "theme it like ",
            "theme like ",
            "make it look like the ",
            "make it look like ",
            "look like the ",
            "look like ",
            "make it like ",
            "style it like the ",
            "style it like ",
            "style like ",
            "give it the ",
            "give it ",
            "apply the ",
            "apply ",
            "switch to the ",
            "switch to ",
        ];
        // Suffix tokens that disambiguate a theme command from a template /
        // project name. The presence of any of these tokens AFTER stripping the
        // prefix is what tells us the user is asking for a palette.
        const THEME_SUFFIX_TOKENS: &[&str] = &[
            " colors",
            " color",
            " colours",
            " colour",
            " palette",
            " palettes",
            " theme",
            " themes",
            " color scheme",
            " color schemes",
            " colour scheme",
            " vibe",
            " vibes",
            " aesthetic",
            " look",
            " style",
            " styling",
        ];
        for prefix in THEME_PREFIXES {
            if let Some(rest) = lowered.strip_prefix(prefix) {
                let rest = rest.trim();
                if rest.is_empty() {
                    continue;
                }
                // Strip a trailing theme suffix so the payload is just the
                // palette name. "use stripe colors" → "stripe"; "use the
                // cyberpunk neon palette" → "cyberpunk neon".
                let mut name = rest.to_string();
                let mut matched_suffix = false;
                let mut suffix_was_theme = false;
                for suffix in THEME_SUFFIX_TOKENS {
                    if let Some(stripped) = name.strip_suffix(suffix) {
                        name = stripped.trim().to_string();
                        matched_suffix = true;
                        suffix_was_theme = *suffix == " theme" || *suffix == " themes";
                        break;
                    }
                }
                // Theme-by-resemblance phrasings ("make it look like X",
                // "theme it like X") don't always include a suffix token.
                // Accept them when the prefix itself signals a theme intent.
                let prefix_signals_theme = prefix.contains("like")
                    || prefix.contains("style")
                    || prefix.contains("look")
                    || prefix.contains("theme");
                if !matched_suffix && !prefix_signals_theme {
                    continue;
                }
                if name.is_empty() {
                    continue;
                }
                // If the user said "X theme" / "X themes" AND `X` resolves to
                // a known eri-built-in theme, route to the IDE-wide theme
                // switcher rather than feeding Mercury a design directive.
                if suffix_was_theme && eri_theme::match_theme(&name).is_some() {
                    return Some(Self::SetUiTheme(name));
                }
                return Some(Self::SetTheme(name));
            }
        }

        // "raise the limit to <N> dollars" / "set the limit to <N>" / "set
        // spending limit to <N>" — accept a positive dollar amount, allowing
        // an optional trailing "dollars"/"dollar"/"$" word.
        const RAISE_PREFIXES: &[&str] = &[
            "raise the limit to ",
            "raise limit to ",
            "raise the spending limit to ",
            "raise spending limit to ",
            "raise the cap to ",
            "raise cap to ",
            "raise the budget to ",
            "raise budget to ",
            "set the limit to ",
            "set limit to ",
            "set the spending limit to ",
            "set spending limit to ",
            "set the cap to ",
            "set cap to ",
            "set the budget to ",
            "set budget to ",
            "bump the limit to ",
            "bump limit to ",
            "increase the limit to ",
            "increase limit to ",
            "increase the budget to ",
            "increase budget to ",
        ];
        for prefix in RAISE_PREFIXES {
            if let Some(rest) = lowered.strip_prefix(prefix)
                && let Some(amount) = parse_dollar_amount(rest)
            {
                return Some(Self::RaiseSpendingLimit(amount));
            }
        }

        // Git revert by commit. "go back to last commit" / "revert to last
        // commit" / "revert to commit <hash>" / "go back to commit <hash>".
        // Match before the scrubber JUMP_PREFIXES below — "revert to <int>"
        // still wins because we only fire RevertToCommit when the suffix is
        // either "last commit" or a non-numeric hash-like token.
        const COMMIT_PREFIXES: &[&str] = &[
            "go back to commit ",
            "revert to commit ",
            "checkout commit ",
            "go to commit ",
            "load commit ",
        ];
        for prefix in COMMIT_PREFIXES {
            if let Some(rest) = lowered.strip_prefix(prefix) {
                let hash = rest.trim();
                if !hash.is_empty() {
                    return Some(Self::RevertToCommit(hash.to_string()));
                }
            }
        }
        match lowered.as_str() {
            "go back to last commit"
            | "revert to last commit"
            | "back to last commit"
            | "go to last commit"
            | "load last commit" => return Some(Self::RevertToCommit("last".to_string())),
            _ => {}
        }

        // Scrubber jump: "go to iteration N" / "load iteration N" / "jump to
        // N" / "revert to N". Numeric suffix must parse as u64. Matched before
        // the literal "go back"/"revert"/"load <project>" arms so the number
        // shape wins over the project-name shape.
        const JUMP_PREFIXES: &[&str] = &[
            "go to iteration ",
            "go to step ",
            "jump to iteration ",
            "jump to step ",
            "jump to ",
            "load iteration ",
            "load step ",
            "revert to iteration ",
            "revert to step ",
            "revert to ",
        ];
        for prefix in JUMP_PREFIXES {
            if let Some(rest) = lowered.strip_prefix(prefix)
                && let Ok(index) = rest.trim().parse::<u64>()
            {
                return Some(Self::GoToIteration(index));
            }
        }
        // "load N" — ambiguous against "load <project>"; only take it if the
        // suffix is a bare integer.
        if let Some(rest) = lowered.strip_prefix("load ")
            && let Ok(index) = rest.trim().parse::<u64>()
        {
            return Some(Self::GoToIteration(index));
        }

        // Selection-scoped accept/reject vocabulary. When the panel has a
        // pending inline rewrite (signaled by `has_editor_selection`), short
        // confirmation words like "apply" / "yes" / "keep it" route to
        // `AcceptPatch`; "discard" / "cancel" / "no" route to `RejectPatch`.
        // Without a selection, these phrases either fall through to the
        // pre-existing `Accept` / `Reject` arms below or stay unrecognized.
        if has_editor_selection {
            match lowered.as_str() {
                "accept" | "apply" | "apply it" | "apply this" | "apply patch" | "keep it"
                | "keep this" | "keep that" | "yes" | "yeah" | "yep" | "looks good"
                | "ship that" | "take it" => {
                    return Some(Self::AcceptPatch);
                }
                "reject" | "reject it" | "reject this" | "reject patch" | "discard"
                | "discard it" | "discard this" | "cancel" | "cancel it" | "cancel that" | "no"
                | "nope" | "nah" | "throw it out" | "scrap it" | "scrap that" => {
                    return Some(Self::RejectPatch);
                }
                _ => {}
            }
            // Rewrite intents: must start with a verb the user pairs with a
            // deictic anchor ("this" / "here" / "the selected ..." /
            // "the selection"). The presence of the anchor is what
            // distinguishes a rewrite ("make this async") from a build
            // ("build me a coffee shop"). Without the anchor we fall
            // through and let the build path handle it.
            if looks_like_rewrite_intent(&lowered) {
                let instruction = trimmed.trim();
                if !instruction.is_empty() {
                    return Some(Self::RewriteSelection(instruction.to_string()));
                }
            }
        }

        match lowered.as_str() {
            "accept" => return Some(Self::Accept),
            // Cost-guard bare confirmations. "pause" and "resume" appear here
            // (and not in the cost-guard block above) so they sit alongside
            // the other one-word global commands; the multi-word phrasings
            // are already handled before the JUMP_PREFIXES block.
            "pause" => return Some(Self::PauseSpending),
            "resume" => return Some(Self::ResumeSpending),
            "undo" | "go back" | "revert" | "step back" => return Some(Self::Undo),
            "redo" | "forward" | "go forward" | "step forward" => return Some(Self::Redo),
            "reject" => return Some(Self::Reject),
            "try another" => return Some(Self::TryAnother),
            "try again" | "retry" | "try that again" | "do it again" | "do that again"
            | "run it again" | "run that again" | "again" => return Some(Self::Retry),
            "focus editor" => return Some(Self::FocusEditor),
            "focus preview" => return Some(Self::FocusPreview),
            "list projects" | "list project" | "show projects" | "show project list" => {
                return Some(Self::ListProjects);
            }
            "list templates"
            | "list template"
            | "show templates"
            | "show template list"
            | "what can you build"
            | "what templates do you have"
            | "what templates are available"
            | "what starters do you have" => {
                return Some(Self::ListTemplates);
            }
            "list mcp tools"
            | "list mcp"
            | "list tools"
            | "show tools"
            | "show mcp tools"
            | "what tools do you have"
            | "what tools are available"
            | "what tools do i have" => {
                return Some(Self::ListMcpTools);
            }
            "reload mcp" | "reload mcp config" | "reload tools" | "refresh mcp"
            | "refresh tools" => {
                return Some(Self::ReloadMcpConfig);
            }
            // Enable MCP tool calling for Mercury. Default OFF for safety —
            // these phrasings flip the panel-level `mcp_enabled` flag on so
            // the next Mercury fire ships MCP tools alongside `edit_html`.
            "enable mcp"
            | "enable mcp tools"
            | "enable the mcp tools"
            | "use mcp"
            | "use mcp tools"
            | "use the mcp tools"
            | "use the github mcp"
            | "give mercury the tools"
            | "give mercury the mcp tools"
            | "give mercury mcp tools"
            | "give mercury tools"
            | "turn on mcp"
            | "turn on mcp tools"
            | "turn on the mcp tools"
            | "let mercury use tools"
            | "let mercury use the tools"
            | "let mercury use mcp"
            | "let mercury use mcp tools" => {
                return Some(Self::EnableMcp);
            }
            "disable mcp"
            | "disable mcp tools"
            | "disable the mcp tools"
            | "stop using mcp"
            | "stop using mcp tools"
            | "stop using the mcp tools"
            | "turn off mcp"
            | "turn off mcp tools"
            | "turn off the mcp tools" => {
                return Some(Self::DisableMcp);
            }
            // Open the per-project rules.md. Phrasings cover both directives
            // ("edit rules", "open the rules file") and inspection
            // ("show project rules", "what are the rules"). Matched here so
            // the bare verb "edit" doesn't slip through to a build prefix.
            "edit rules"
            | "edit the rules"
            | "edit project rules"
            | "edit the project rules"
            | "edit rules file"
            | "edit the rules file"
            | "open rules"
            | "open the rules"
            | "open rules file"
            | "open the rules file"
            | "open project rules"
            | "open the project rules"
            | "show rules"
            | "show the rules"
            | "show project rules"
            | "show the project rules"
            | "what are the rules"
            | "what are the project rules"
            | "show rules file"
            | "show the rules file" => {
                return Some(Self::EditRules);
            }
            // Demo recording: capture screen + mic + system audio to an MP4.
            // Matched before the project NEW_PREFIXES below so "start
            // recording" / "start demo" never get treated as new-project names.
            "start recording" | "record this" | "record" | "start demo" | "start the demo"
            | "begin recording" | "begin demo" => return Some(Self::StartRecording),
            "stop recording" | "end recording" | "stop demo" | "end demo" | "stop the demo"
            | "finish recording" | "finish demo" => return Some(Self::StopRecording),
            // Bug finder. Matched before SEO + ship-it so "audit my code"
            // and "what's broken" don't get swallowed by accessibility-audit
            // or the generic ship-it path. "fix all bugs" / "fix everything"
            // are literal-only here; the indexed "fix bug N" form is parsed
            // by the dedicated `parse_fix_bug_command` helper below.
            "find bugs" | "find the bugs" | "find any bugs" | "audit my code"
            | "audit the code" | "audit the build" | "audit this" | "audit this build"
            | "audit this project" | "what's broken" | "whats broken" | "what is broken"
            | "look for problems" | "look for bugs" | "look for issues" | "scan for bugs"
            | "scan for issues" | "check for bugs" | "check for issues" | "run the bug finder"
            | "run bug finder" | "bug finder" => return Some(Self::FindBugs),
            "fix all bugs"
            | "fix all the bugs"
            | "fix everything"
            | "fix all of them"
            | "fix all"
            | "fix them all"
            | "apply all fixes"
            | "apply all the fixes"
            | "apply every fix" => return Some(Self::FixAllBugs),
            // SEO + accessibility audit. Matched before the ship-it arm so
            // "check seo" / "audit accessibility" never falls through to a
            // generic build path. Runs `ClaudeCliBackend::run_seo_audit`,
            // which preserves layout/content and only fixes correctness.
            "check seo"
            | "seo check"
            | "run seo check"
            | "run a seo check"
            | "lighthouse check"
            | "run lighthouse"
            | "run a lighthouse check"
            | "audit seo"
            | "audit accessibility"
            | "accessibility audit"
            | "a11y check"
            | "check accessibility"
            | "check a11y" => return Some(Self::SeoCheck),
            // Multi-LLM model listing. Matched before the model-switch prefix
            // and before the agent-backend arms so the user can ask "what
            // models can I use" without colliding with `SwitchAgent`.
            "list models"
            | "show models"
            | "show the models"
            | "what models"
            | "what models can i use"
            | "what models do you support"
            | "which models can i use"
            | "which models do you support"
            | "list the models"
            | "list providers" => return Some(Self::ListModels),
            _ => {}
        }

        // Model-switch prefix arms. We accept "use <X>", "switch to <X>",
        // "switch model to <X>", "switch back to <X>" — but ONLY when the
        // tail names a known LLM family (gpt, claude haiku/opus/sonnet,
        // gemini, mercury). The bare "use claude" / "switch to claude"
        // literals continue to route to `SwitchAgent` below because those
        // affect the polish/ship-it agent; "switch to claude haiku" / "use
        // claude opus" route here because they name a specific model.
        if let Some(model) = parse_model_switch(&lowered) {
            return Some(Self::SwitchModel(model));
        }

        match lowered.as_str() {
            // Agent-backend switch. Literal-only arms so they never collide
            // with the template/open prefixes ("use the X template",
            // "switch to <project>"). The handler dispatches on the lowercased
            // tail and ignores unknown names.
            "use goose"
            | "switch to goose"
            | "switch agent to goose"
            | "use the goose agent"
            | "use the goose backend"
            | "switch backend to goose" => return Some(Self::SwitchAgent("goose".into())),
            "use claude"
            | "use claude code"
            | "switch to claude"
            | "switch to claude code"
            | "switch agent to claude"
            | "use the claude agent"
            | "use the claude backend"
            | "switch backend to claude" => return Some(Self::SwitchAgent("claude".into())),
            // Responsive preview toggle. Phone and "mobile" map to the same
            // 375px viewport. Bare "phone preview" / "tablet preview" /
            // "desktop preview" are accepted so the user can say either
            // "preview as phone" or "phone preview" — both feel natural.
            "preview as phone"
            | "preview as mobile"
            | "phone preview"
            | "mobile preview"
            | "show phone preview"
            | "show mobile preview"
            | "switch to phone"
            | "switch to mobile" => return Some(Self::SetPreviewWidth(PreviewWidth::Phone)),
            "preview as tablet" | "tablet preview" | "show tablet preview" | "switch to tablet" => {
                return Some(Self::SetPreviewWidth(PreviewWidth::Tablet));
            }
            "preview as desktop"
            | "desktop preview"
            | "show desktop preview"
            | "full width"
            | "full width preview"
            | "switch to desktop" => return Some(Self::SetPreviewWidth(PreviewWidth::Desktop)),
            // Ship-it / done / finalize: hand the whole session to Claude polish.
            // Mercury keeps doing fast iterations during the speak loop;
            // Claude only runs when the user explicitly asks to wrap up.
            "send to builder" | "ship it" | "ship this" | "ship" | "done" | "i'm done"
            | "im done" | "finalize" | "finalize it" | "finalize this" | "polish" | "polish it"
            | "polish this" | "wrap it up" | "wrap this up" | "deploy" | "deploy it"
            | "deploy this" => return Some(Self::SendToBuilder),
            // Cursor-style code-assist literals. Matched here so "explain this"
            // never falls through to RewriteSelection's deictic intent path —
            // explainer is read-only and runs without a selection.
            "write tests"
            | "write tests for this"
            | "write tests for that"
            | "write tests for this code"
            | "write tests for this file"
            | "write a test"
            | "write the tests"
            | "generate tests"
            | "generate a test"
            | "generate the tests"
            | "generate tests for this"
            | "generate tests for this file"
            | "test this"
            | "test this code"
            | "test this file"
            | "add tests"
            | "add a test"
            | "add tests for this"
            | "add tests for this file"
            | "make tests"
            | "make a test" => return Some(Self::WriteTests),
            "explain this"
            | "explain that"
            | "explain this code"
            | "explain that code"
            | "explain this file"
            | "explain the code"
            | "explain it"
            | "what does this do"
            | "what does that do"
            | "what does this code do"
            | "what is this doing"
            | "what is this code doing"
            | "walk me through this"
            | "walk me through this code"
            | "walk me through it"
            | "walk through this" => return Some(Self::ExplainThis),
            "document this"
            | "document that"
            | "document this code"
            | "document this file"
            | "document it"
            | "add docs"
            | "add documentation"
            | "add the docs"
            | "generate docs"
            | "generate documentation"
            | "generate the docs"
            | "write docs"
            | "write documentation" => return Some(Self::DocumentThis(String::new())),
            "add jsdoc" | "add jsdocs" | "add jsdoc comments" | "generate jsdoc"
            | "generate jsdocs" => return Some(Self::DocumentThis("jsdoc".into())),
            "add docstring"
            | "add docstrings"
            | "add doc strings"
            | "generate docstring"
            | "generate docstrings" => {
                return Some(Self::DocumentThis("docstring".into()));
            }
            "add rustdoc"
            | "add rust docs"
            | "add rustdoc comments"
            | "generate rustdoc"
            | "generate rust docs" => return Some(Self::DocumentThis("rustdoc".into())),
            _ => {}
        }

        // Refactor prefixes capture the trailing instruction. Matched here so
        // "refactor this to use map" routes to RefactorThis rather than to
        // RewriteSelection (which only fires with a live editor selection).
        // The captured tail is the "<X>" the user voiced — for "refactor this
        // to use async await" the payload is "use async await".
        const REFACTOR_PREFIXES: &[&str] = &[
            "refactor this to ",
            "refactor that to ",
            "refactor this code to ",
            "refactor this file to ",
            "refactor it to ",
            "clean this up by ",
            "clean that up by ",
            "clean this code up by ",
            "clean it up by ",
            "rewrite this to ",
            "rewrite that to ",
            "rewrite this code to ",
            "rewrite it to ",
        ];
        for prefix in REFACTOR_PREFIXES {
            if let Some(rest) = lowered.strip_prefix(prefix) {
                let instruction = rest.trim();
                if instruction.is_empty() {
                    continue;
                }
                return Some(Self::RefactorThis(instruction.to_string()));
            }
        }

        // Indexed bug fix ("fix bug 2", "fix the first bug", "apply the first
        // fix"). Matched before NEW_PREFIXES / OPEN_PREFIXES so phrasings like
        // "fix the second bug" can't get mis-parsed as a project name.
        if let Some(index) = parse_fix_bug_command(&lowered) {
            return Some(Self::FixBug(index));
        }

        // Background-agent kickoff ("start a background agent to <task>",
        // "run in the background <task>", "kick off a background task to
        // <task>"). Captures the trailing task so the panel can spawn a
        // long-running Claude job in parallel with the foreground iterate
        // loop. Trim trailing periods that came in through whisper.
        if let Some(task) = parse_background_agent_command(&lowered) {
            return Some(Self::StartBackgroundAgent(task));
        }

        // Prefix-matched commands that carry a project name argument. Strip
        // trailing "project" if the user said "start a new portfolio project".
        const NEW_PREFIXES: &[&str] = &[
            "new project ",
            "start a new project ",
            "start a new ",
            "start new project ",
            "start new ",
            "create project ",
            "create a new project ",
            "create new project ",
            "make a new project ",
            "make new project ",
        ];
        for prefix in NEW_PREFIXES {
            if let Some(rest) = lowered.strip_prefix(prefix) {
                let name = strip_optional_trailing_project_word(rest);
                if name.trim().is_empty() {
                    return None;
                }
                return Some(Self::NewProject(name.trim().to_string()));
            }
        }

        // Template-seed commands. Match these BEFORE OPEN_PREFIXES so
        // "start with the portfolio template" doesn't get treated as
        // "start with the portfolio" → a (nonexistent) project named
        // "the portfolio template".
        const TEMPLATE_PREFIXES: &[&str] = &[
            "use the ",
            "use template ",
            "use ",
            "start with the ",
            "start with template ",
            "start with ",
            "seed with the ",
            "seed with template ",
            "seed with ",
            "apply the ",
            "apply template ",
        ];
        for prefix in TEMPLATE_PREFIXES {
            if let Some(rest) = lowered.strip_prefix(prefix) {
                let name = strip_optional_trailing_template_word(rest);
                if name.trim().is_empty() {
                    continue;
                }
                // The TEMPLATE_PREFIXES set is intentionally permissive ("use
                // ...") so we only accept it when the suffix explicitly
                // names a template — either via " template" suffix or by
                // appearing after a more specific prefix like
                // "use the X template". This avoids hijacking unrelated
                // voice commands.
                let mentions_template = rest.contains("template") || prefix.contains("template");
                if !mentions_template {
                    continue;
                }
                return Some(Self::UseTemplate(name.trim().to_string()));
            }
        }

        const OPEN_PREFIXES: &[&str] = &[
            "open project ",
            "open ",
            "load project ",
            "load ",
            "switch to project ",
            "switch to ",
            "resume project ",
            "resume ",
        ];
        for prefix in OPEN_PREFIXES {
            if let Some(rest) = lowered.strip_prefix(prefix) {
                let name = strip_optional_trailing_project_word(rest);
                if name.trim().is_empty() {
                    return None;
                }
                return Some(Self::OpenProject(name.trim().to_string()));
            }
        }

        None
    }
}

/// Parse an integration scaffolding voice command — `AddAuth`, `AddDatabase`,
/// or `AddPayments`. Returns `None` for any input that doesn't match so the
/// outer parser can fall through to the build path.
///
/// Stripe pricing handling: phrases like "add stripe for $20 a month",
/// "add stripe for 9.99 a month", or "add stripe at $5" extract the dollar
/// amount. Bare "add stripe" / "add stripe checkout" parse with 0.0 so the
/// handler falls back to the `STRIPE_PRICE_LABEL` env var.
/// Parse a model-switch utterance into a canonical LLM model id.
///
/// Recognized prefixes: `use`, `use the`, `switch to`, `switch back to`,
/// `switch model to`, `switch the model to`, `switch to the`. The tail must
/// name a known model family — `gpt` / `chatgpt`, `o1` / `o3` / `o4`,
/// `claude` (followed by an explicit `haiku` / `opus` / `sonnet`), `gemini`,
/// or `mercury`.
///
/// "switch to claude" / "use claude" deliberately return `None` so the bare
/// agent-backend arms continue to route to `SwitchAgent`. The user must say
/// "switch to claude sonnet" / "use claude haiku" / "use claude opus" to
/// switch the inference model.
fn parse_model_switch(lowered: &str) -> Option<String> {
    const PREFIXES: &[&str] = &[
        "use the model ",
        "use the ",
        "use ",
        "switch back to ",
        "switch model to ",
        "switch the model to ",
        "switch to the model ",
        "switch to the ",
        "switch to ",
    ];
    let tail = PREFIXES
        .iter()
        .find_map(|prefix| lowered.strip_prefix(prefix))?
        .trim()
        .trim_end_matches(" model")
        .trim();
    if tail.is_empty() {
        return None;
    }
    let bare_agent_only = matches!(
        tail,
        "claude" | "claude code" | "the claude agent" | "the claude backend" | "goose"
    );
    if bare_agent_only {
        return None;
    }
    let canonical = eri_inference_canonical(tail)?;
    Some(canonical.to_string())
}

/// Inline copy of `eri_inference::canonical_model_id`. `eri_core` can't
/// depend on `eri_inference` (the dependency arrow points the other way),
/// so the canonical-id table lives here too. The inference-side test
/// asserts the same model ids resolve so the two stay in sync.
fn eri_inference_canonical(choice: &str) -> Option<&'static str> {
    let lowered = choice.trim().to_ascii_lowercase();
    if lowered.is_empty() {
        return None;
    }
    let normalized: String = lowered
        .chars()
        .map(|c| {
            if c == '-' || c == '.' || c == '_' {
                ' '
            } else {
                c
            }
        })
        .collect();
    let squashed: String = normalized.split_whitespace().collect::<Vec<_>>().join(" ");
    let s = squashed.as_str();
    let canonical = [
        "mercury-2",
        "gpt-4o",
        "gpt-4o-mini",
        "o1-mini",
        "o3-mini",
        "o4",
        "claude-sonnet-4-5",
        "claude-haiku-4-5",
        "claude-opus-4-5",
        "gemini-flash-2",
        "gemini-thinking-2",
    ];
    for &id in &canonical {
        let id_norm: String = id.chars().map(|c| if c == '-' { ' ' } else { c }).collect();
        if s == id_norm {
            return Some(id);
        }
    }
    if s.contains("mercury") || s.contains("default") {
        return Some("mercury-2");
    }
    if s.contains("gemini") {
        if s.contains("think") {
            return Some("gemini-thinking-2");
        }
        return Some("gemini-flash-2");
    }
    if s.contains("claude") || s.contains("anthropic") {
        if s.contains("haiku") {
            return Some("claude-haiku-4-5");
        }
        if s.contains("opus") {
            return Some("claude-opus-4-5");
        }
        if s.contains("sonnet") {
            return Some("claude-sonnet-4-5");
        }
        return None;
    }
    if s == "o4" || s.contains("o 4") {
        return Some("o4");
    }
    if s.contains("o3") || s.contains("o 3") {
        return Some("o3-mini");
    }
    if s.contains("o1") || s.contains("o 1") {
        return Some("o1-mini");
    }
    if s.contains("gpt") || s.contains("chatgpt") || s.contains("openai") {
        if s.contains("mini") {
            return Some("gpt-4o-mini");
        }
        return Some("gpt-4o");
    }
    None
}

/// Parse "fix bug N" / "fix the first bug" / "apply the first fix" phrasings.
/// Returns the 1-based bug index when matched, `None` otherwise. Accepts
/// digits ("fix bug 2") and a small set of ordinal words ("first" through
/// "tenth") so the voice path doesn't need to round-trip through whisper's
/// digit transcription for the common cases.
fn parse_fix_bug_command(lowered: &str) -> Option<usize> {
    const NUMERIC_PREFIXES: &[&str] = &[
        "fix bug ",
        "fix the bug ",
        "apply bug ",
        "apply fix ",
        "apply the fix ",
        "fix issue ",
        "fix the issue ",
    ];
    for prefix in NUMERIC_PREFIXES {
        if let Some(rest) = lowered.strip_prefix(prefix) {
            let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
            if let Ok(n) = digits.parse::<usize>()
                && n > 0
            {
                return Some(n);
            }
            if let Some(ordinal) = ordinal_word_to_index(rest.trim()) {
                return Some(ordinal);
            }
        }
    }
    const ORDINAL_PREFIXES: &[&str] = &["fix the ", "apply the "];
    for prefix in ORDINAL_PREFIXES {
        if let Some(rest) = lowered.strip_prefix(prefix) {
            let trimmed = rest.trim();
            // Must end with "bug" or "fix" to count — keeps "fix the contact
            // form" out of the bug-finder path.
            let suffix_ok = trimmed.ends_with(" bug")
                || trimmed.ends_with(" fix")
                || trimmed.ends_with(" issue");
            if !suffix_ok {
                continue;
            }
            let head = trimmed
                .rsplit_once(' ')
                .map(|(head, _)| head)
                .unwrap_or(trimmed);
            if let Some(n) = ordinal_word_to_index(head) {
                return Some(n);
            }
        }
    }
    None
}

/// Map "first" / "second" / ... / "tenth" to a 1-based index. Returns `None`
/// for any other input so callers can fall through cleanly.
fn ordinal_word_to_index(word: &str) -> Option<usize> {
    match word.trim() {
        "first" | "1st" => Some(1),
        "second" | "2nd" => Some(2),
        "third" | "3rd" => Some(3),
        "fourth" | "4th" => Some(4),
        "fifth" | "5th" => Some(5),
        "sixth" | "6th" => Some(6),
        "seventh" | "7th" => Some(7),
        "eighth" | "8th" => Some(8),
        "ninth" | "9th" => Some(9),
        "tenth" | "10th" => Some(10),
        _ => None,
    }
}

/// Parse a background-agent kickoff command. Returns the trailing task
/// description (trimmed) when matched, `None` otherwise. The trigger phrases
/// are intentionally narrow — we want a clear "background" verb on the user's
/// side so a stray "start a refactor" doesn't accidentally spawn a long Claude
/// job.
fn parse_background_agent_command(lowered: &str) -> Option<String> {
    const PREFIXES: &[&str] = &[
        "start a background agent to ",
        "start the background agent to ",
        "start a background task to ",
        "start a background job to ",
        "run a background agent to ",
        "run a background task to ",
        "run a background job to ",
        "run in the background ",
        "run this in the background ",
        "run that in the background ",
        "kick off a background agent to ",
        "kick off a background task to ",
        "kick off a background job to ",
        "spawn a background agent to ",
        "in the background ",
    ];
    for prefix in PREFIXES {
        if let Some(rest) = lowered.strip_prefix(prefix) {
            let task = rest.trim();
            if task.is_empty() {
                return None;
            }
            return Some(task.to_string());
        }
    }
    None
}

fn parse_billing_command(lowered: &str) -> Option<ControlCommand> {
    // Customer portal — fixed phrasings, matched before checkout so
    // "billing settings" doesn't get caught by an "upgrade to ..." prefix.
    match lowered {
        "manage billing"
        | "manage my billing"
        | "manage subscription"
        | "manage my subscription"
        | "open billing"
        | "open my billing"
        | "open billing portal"
        | "open the billing portal"
        | "open customer portal"
        | "open the customer portal"
        | "billing portal"
        | "billing settings"
        | "subscription settings"
        | "update billing"
        | "update my billing"
        | "update payment"
        | "update payment method"
        | "update my card"
        | "change my card"
        | "cancel subscription"
        | "cancel my subscription" => return Some(ControlCommand::ManageBilling),
        "show usage"
        | "show my usage"
        | "show me my usage"
        | "show the usage"
        | "show monthly usage"
        | "monthly usage"
        | "current usage"
        | "current month usage"
        | "this month's usage"
        | "how much have i used"
        | "how much have i used so far"
        | "how much have i used this month"
        | "how much did i use"
        | "what's my usage"
        | "what is my usage" => return Some(ControlCommand::ShowUsage),
        "check my subscription"
        | "check subscription"
        | "check the subscription"
        | "am i subscribed"
        | "am i on a plan"
        | "what plan am i on"
        | "what's my plan"
        | "what is my plan"
        | "show my plan"
        | "show subscription"
        | "show my subscription" => return Some(ControlCommand::CheckSubscription),
        "what's my brain"
        | "what is my brain"
        | "whats my brain"
        | "what's my brain tier"
        | "what is my brain tier"
        | "what's my eri brain"
        | "what is my eri brain"
        | "whats my eri brain"
        | "what tier am i on"
        | "what's my tier"
        | "what is my tier"
        | "am i on adaptive"
        | "am i on frontier"
        | "am i on personalized"
        | "am i on the adaptive tier"
        | "am i on the frontier tier"
        | "am i on the personalized tier" => return Some(ControlCommand::WhatsMyBrain),
        // Bare plan-name shortcuts for the high-tier plans. These never
        // collide with project-creation prefixes ("new project ...") or build
        // verbs, so it's safe to short-circuit them here.
        "team plan" | "teams plan" | "the team plan" | "the teams plan" => {
            return Some(ControlCommand::OpenCheckout("teams".to_string()));
        }
        "pro plus plan" | "pro+ plan" | "the pro plus plan" | "the pro+ plan" => {
            return Some(ControlCommand::OpenCheckout("pro_plus".to_string()));
        }
        _ => {}
    }

    // Checkout — `subscribe to <plan>`, `upgrade to <plan>`, `go <plan>` and
    // the bare confirmations `go pro` / `go starter`. The payload is the
    // lowercased plan name as voiced; the UI layer resolves it through
    // `eri_billing::Plan::from_spoken`.
    const PREFIXES: &[&str] = &[
        "subscribe to ",
        "subscribe me to ",
        "subscribe to the ",
        "sign up for ",
        "sign me up for ",
        "sign up for the ",
        "upgrade to ",
        "upgrade me to ",
        "upgrade to the ",
        "upgrade my plan to ",
        "upgrade my subscription to ",
        "switch to ",
        "switch me to ",
        "switch to the ",
        "switch my plan to ",
        "change my plan to ",
        "go ",
    ];
    for prefix in PREFIXES {
        if let Some(rest) = lowered.strip_prefix(prefix) {
            let plan = rest.trim().trim_end_matches(" plan");
            // Normalize "the <plan>" to "<plan>" up front so the matcher stays
            // a single source of truth.
            let normalized = plan.trim_start_matches("the ").trim();
            // `pro_plus` is emitted as the canonical slug so the billing layer
            // and the website both agree on `body.plan = "pro_plus"`.
            let canonical: Option<&'static str> = match normalized {
                "starter" | "basic" => Some("starter"),
                "pro" | "premium" | "professional" => Some("pro"),
                "pro plus" | "pro+" | "pro_plus" => Some("pro_plus"),
                "teams" | "team" => Some("teams"),
                _ => None,
            };
            if let Some(slug) = canonical {
                return Some(ControlCommand::OpenCheckout(slug.to_string()));
            }
        }
    }
    None
}

fn parse_integration_command(lowered: &str) -> Option<ControlCommand> {
    // Auth providers.
    const AUTH0_PHRASES: &[&str] = &[
        "add auth0",
        "add auth zero",
        "wire up auth0",
        "wire auth0",
        "set up auth0",
        "setup auth0",
        "integrate auth0",
        "use auth0",
        "add auth0 login",
        "add auth0 auth",
        "add auth0 authentication",
    ];
    if AUTH0_PHRASES.contains(&lowered) {
        return Some(ControlCommand::AddAuth(AuthProviderKind::Auth0));
    }
    const CLERK_PHRASES: &[&str] = &[
        "add clerk",
        "wire up clerk",
        "wire clerk",
        "set up clerk",
        "setup clerk",
        "integrate clerk",
        "use clerk",
        "add clerk auth",
        "add clerk login",
        "add clerk authentication",
    ];
    if CLERK_PHRASES.contains(&lowered) {
        return Some(ControlCommand::AddAuth(AuthProviderKind::Clerk));
    }
    const SUPABASE_AUTH_PHRASES: &[&str] = &[
        "add supabase auth",
        "add supabase authentication",
        "wire up supabase auth",
        "wire supabase auth",
        "set up supabase auth",
        "setup supabase auth",
        "use supabase auth",
        "use supabase for auth",
        "use supabase for authentication",
        "use supabase for login",
        "integrate supabase auth",
    ];
    if SUPABASE_AUTH_PHRASES.contains(&lowered) {
        return Some(ControlCommand::AddAuth(AuthProviderKind::SupabaseAuth));
    }

    // Database providers. Supabase-for-the-db phrasings beat Neon defaults
    // so "use supabase for the db" doesn't fall through to the generic
    // postgres arm.
    const SUPABASE_DB_PHRASES: &[&str] = &[
        "add supabase",
        "add supabase database",
        "add supabase db",
        "add supabase postgres",
        "use supabase for the db",
        "use supabase for the database",
        "use supabase for db",
        "use supabase for database",
        "use supabase for postgres",
        "use supabase as the db",
        "use supabase as the database",
        "wire up supabase",
        "wire supabase",
        "set up supabase",
        "setup supabase",
    ];
    if SUPABASE_DB_PHRASES.contains(&lowered) {
        return Some(ControlCommand::AddDatabase(DbProviderKind::Supabase));
    }
    const NEON_PHRASES: &[&str] = &[
        "add neon",
        "add a neon database",
        "add neon database",
        "add neon postgres",
        "set up neon",
        "setup neon",
        "use neon",
        "use neon postgres",
        "wire up neon",
        "wire neon",
        // Default Postgres / generic database phrasings → Neon.
        "add postgres",
        "add a postgres",
        "add a postgres database",
        "add postgresql",
        "set up postgres",
        "setup postgres",
        "set up a postgres",
        "set up postgresql",
        "set up a postgresql database",
        "set up a postgres on neon",
        "add a database",
        "add database",
        "set up a database",
        "set up the database",
        "set up database",
        "setup a database",
        "setup database",
        "wire up a database",
        "wire up database",
    ];
    if NEON_PHRASES.contains(&lowered) {
        return Some(ControlCommand::AddDatabase(DbProviderKind::Neon));
    }

    // Stripe / payments. Two shapes: bare confirmation phrases (no price),
    // and "add stripe for $20 a month" / "add stripe at 9.99" with an
    // explicit price tail.
    const STRIPE_BARE_PHRASES: &[&str] = &[
        "add stripe",
        "add a stripe checkout",
        "add stripe checkout",
        "add stripe payments",
        "add payments",
        "add a paywall",
        "add paywall",
        "wire up stripe",
        "wire stripe",
        "set up stripe",
        "setup stripe",
        "integrate stripe",
        "use stripe",
        "use stripe for payments",
        "use stripe for checkout",
    ];
    if STRIPE_BARE_PHRASES.contains(&lowered) {
        return Some(ControlCommand::AddPayments(0.0));
    }
    // Priced stripe commands. Accept a handful of natural prefixes; trim a
    // trailing "a month" / "per month" / "/month" so the dollar parser sees
    // a clean amount.
    const STRIPE_PRICED_PREFIXES: &[&str] = &[
        "add stripe for ",
        "add stripe checkout for ",
        "add a stripe checkout for ",
        "add a paywall for ",
        "add paywall for ",
        "add payments for ",
        "add stripe at ",
        "add stripe priced at ",
        "set up stripe for ",
        "setup stripe for ",
    ];
    for prefix in STRIPE_PRICED_PREFIXES {
        if let Some(rest) = lowered.strip_prefix(prefix) {
            let trimmed = rest.trim();
            // Strip recurrence suffixes so the parser sees just the amount.
            let amount_slice = trimmed
                .trim_end_matches(" a month")
                .trim_end_matches(" per month")
                .trim_end_matches(" monthly")
                .trim_end_matches("/month")
                .trim_end_matches("/mo")
                .trim_end_matches(" a year")
                .trim_end_matches(" per year")
                .trim_end_matches(" yearly")
                .trim_end_matches("/year")
                .trim_end_matches("/yr")
                .trim();
            if let Some(amount) = parse_dollar_amount(amount_slice) {
                return Some(ControlCommand::AddPayments(amount));
            }
            // Couldn't parse a price — fall back to the bare command rather
            // than treating it as a build prompt.
            return Some(ControlCommand::AddPayments(0.0));
        }
    }

    None
}

/// Parse a dollar amount out of the tail of a "raise the limit to ..." voice
/// command. Accepts shapes like "5", "5 dollars", "$5", "$5.50", "5.50",
/// "5 bucks". Anything that doesn't reduce to a positive finite `f64` returns
/// `None` so the parser can fall through to other arms.
fn parse_dollar_amount(input: &str) -> Option<f64> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return None;
    }
    // Strip optional currency words and `$` prefix.
    let stripped = trimmed
        .trim_start_matches('$')
        .trim_end_matches(['.', '!', '?'])
        .trim();
    let without_unit = stripped
        .strip_suffix(" dollars")
        .or_else(|| stripped.strip_suffix(" dollar"))
        .or_else(|| stripped.strip_suffix(" bucks"))
        .or_else(|| stripped.strip_suffix(" buck"))
        .or_else(|| stripped.strip_suffix(" usd"))
        .unwrap_or(stripped)
        .trim_start_matches('$')
        .trim();
    let value: f64 = without_unit.parse().ok()?;
    if !value.is_finite() || value <= 0.0 {
        return None;
    }
    Some(value)
}

/// Parse an IDE font-picker voice command. Recognized shapes:
///
/// * "use Fraunces" / "use the Fraunces font" / "use JetBrains Mono"
/// * "switch to Fraunces" / "switch to the Fraunces font"
/// * "set the display font to Geist" / "set body font to Inter"
/// * "switch display font to Fraunces" / "switch mono font to Berkeley Mono"
/// * "use Geist for display" / "use Inter for the body" / "use Iosevka for
///   code"
///
/// The "category for X" / "category font to X" variants pin the request to a
/// single catalog (display / body / mono); a bare "use X" tries each catalog
/// in turn (mono → display → body) so unambiguous font names route to the
/// correct slot. Unknown fonts return `None` so the parser keeps falling
/// through to other arms.
fn parse_font_command(lowered: &str) -> Option<ControlCommand> {
    // Strip a few canonical "set ... font to" / "switch ... font to"
    // prefixes that explicitly name the category.
    const TYPED_PREFIXES: &[(&str, FontSlot)] = &[
        ("set the display font to ", FontSlot::Display),
        ("set display font to ", FontSlot::Display),
        ("switch the display font to ", FontSlot::Display),
        ("switch display font to ", FontSlot::Display),
        ("change the display font to ", FontSlot::Display),
        ("change display font to ", FontSlot::Display),
        ("use the display font ", FontSlot::Display),
        ("set the body font to ", FontSlot::Body),
        ("set body font to ", FontSlot::Body),
        ("switch the body font to ", FontSlot::Body),
        ("switch body font to ", FontSlot::Body),
        ("change the body font to ", FontSlot::Body),
        ("change body font to ", FontSlot::Body),
        ("use the body font ", FontSlot::Body),
        ("set the mono font to ", FontSlot::Mono),
        ("set mono font to ", FontSlot::Mono),
        ("set the monospace font to ", FontSlot::Mono),
        ("set monospace font to ", FontSlot::Mono),
        ("set the code font to ", FontSlot::Mono),
        ("set code font to ", FontSlot::Mono),
        ("switch the mono font to ", FontSlot::Mono),
        ("switch mono font to ", FontSlot::Mono),
        ("switch monospace font to ", FontSlot::Mono),
        ("change the mono font to ", FontSlot::Mono),
        ("change mono font to ", FontSlot::Mono),
        ("use the mono font ", FontSlot::Mono),
        ("use the monospace font ", FontSlot::Mono),
    ];
    for (prefix, slot) in TYPED_PREFIXES {
        if let Some(rest) = lowered.strip_prefix(prefix) {
            let name = rest.trim();
            if name.is_empty() {
                continue;
            }
            if let Some(cmd) = resolve_font_for_slot(*slot, name) {
                return Some(cmd);
            }
        }
    }

    // "use X for display" / "use X for the body" / "use X for code" — the
    // suffix names the slot.
    const TRAILING_SLOT: &[(&str, FontSlot)] = &[
        (" for display", FontSlot::Display),
        (" for the display", FontSlot::Display),
        (" for headlines", FontSlot::Display),
        (" for the headlines", FontSlot::Display),
        (" for body", FontSlot::Body),
        (" for the body", FontSlot::Body),
        (" for the body text", FontSlot::Body),
        (" for ui", FontSlot::Body),
        (" for the ui", FontSlot::Body),
        (" for code", FontSlot::Mono),
        (" for the code", FontSlot::Mono),
        (" for the editor", FontSlot::Mono),
        (" for monospace", FontSlot::Mono),
        (" for the monospace font", FontSlot::Mono),
    ];
    const USE_PREFIXES: &[&str] = &["use the ", "use ", "switch to the ", "switch to "];
    for (suffix, slot) in TRAILING_SLOT {
        if let Some(stem) = lowered.strip_suffix(suffix) {
            for prefix in USE_PREFIXES {
                if let Some(rest) = stem.strip_prefix(prefix) {
                    let name = rest
                        .trim()
                        .trim_end_matches(" font")
                        .trim_end_matches(" typeface")
                        .trim();
                    if name.is_empty() {
                        continue;
                    }
                    if let Some(cmd) = resolve_font_for_slot(*slot, name) {
                        return Some(cmd);
                    }
                }
            }
        }
    }

    // Bare "use X" / "use the X font" — try mono → display → body so a
    // mono-only font (e.g. "Iosevka") doesn't accidentally land in the display
    // slot. We only fire when the payload is a real catalog hit; otherwise
    // every "use X" utterance would wrongly route here.
    for prefix in USE_PREFIXES {
        if let Some(rest) = lowered.strip_prefix(prefix) {
            let candidate = rest
                .trim()
                .trim_end_matches(" font")
                .trim_end_matches(" typeface")
                .trim();
            if candidate.is_empty() {
                continue;
            }
            if let Some(name) = eri_theme::match_mono_font(candidate) {
                return Some(ControlCommand::SetMonoFont(name.to_string()));
            }
            if let Some(name) = eri_theme::match_display_font(candidate) {
                return Some(ControlCommand::SetDisplayFont(name.to_string()));
            }
            if let Some(name) = eri_theme::match_body_font(candidate) {
                return Some(ControlCommand::SetBodyFont(name.to_string()));
            }
        }
    }
    None
}

#[derive(Clone, Copy)]
enum FontSlot {
    Display,
    Body,
    Mono,
}

fn resolve_font_for_slot(slot: FontSlot, query: &str) -> Option<ControlCommand> {
    let trimmed = query.trim().trim_end_matches(" font").trim();
    if trimmed.is_empty() {
        return None;
    }
    match slot {
        FontSlot::Display => eri_theme::match_display_font(trimmed)
            .map(|name| ControlCommand::SetDisplayFont(name.to_string())),
        FontSlot::Body => eri_theme::match_body_font(trimmed)
            .map(|name| ControlCommand::SetBodyFont(name.to_string())),
        FontSlot::Mono => eri_theme::match_mono_font(trimmed)
            .map(|name| ControlCommand::SetMonoFont(name.to_string())),
    }
}

fn strip_optional_trailing_template_word(input: &str) -> &str {
    let trimmed = input.trim();
    trimmed
        .strip_suffix(" template")
        .map(str::trim_end)
        .unwrap_or(trimmed)
}

/// Classify a normalized voice command as an inline-rewrite intent. The
/// signal is a deictic anchor (`this` / `here` / `the selection` /
/// `the selected ...`) paired with one of a small set of edit verbs.
/// Without the anchor, the same verbs apply to a fresh build ("make me a
/// coffee shop") and stay outside this rewrite path.
///
/// The verb list is intentionally short — anything that sounds like a
/// targeted code edit:
///   - "make this <X>"
///   - "rewrite this to <X>" / "refactor this ..." / "convert this ..."
///   - "add <X> here" / "add <X> to this"
///   - "wrap this in <X>"
///   - "extract this into <X>"
///   - "fix this" / "clean this up" / "simplify this"
///
/// Build intents like "build me a coffee shop", "make a Pomodoro timer",
/// "create a landing page" never carry a deictic anchor for the same
/// reason a user wouldn't point at empty space — they're describing
/// something that doesn't exist yet.
fn looks_like_rewrite_intent(lowered: &str) -> bool {
    let has_deictic = lowered.contains(" this")
        || lowered.starts_with("this ")
        || lowered.contains(" here")
        || lowered.starts_with("here ")
        || lowered.contains("the selection")
        || lowered.contains("the selected ")
        || lowered.contains("this code")
        || lowered.contains("this block")
        || lowered.contains("this function")
        || lowered.contains("this loop");
    if !has_deictic {
        return false;
    }

    // Build verbs that would otherwise eat "make this" / "create this" —
    // when followed by an article-noun shape ("make this app", "build this
    // landing page", "create this site"), the deictic actually refers to a
    // fresh thing the user is asking to create, not to the selection. Treat
    // those as build intents.
    const BUILD_NOUNS: &[&str] = &[
        "app",
        "site",
        "website",
        "page",
        "landing page",
        "demo",
        "game",
        "timer",
        "tracker",
        "dashboard",
        "form",
        "shop",
        "store",
        "blog",
        "portfolio",
        "calculator",
    ];
    if let Some(idx) = lowered.find("this ") {
        let after = &lowered[idx + 5..];
        if BUILD_NOUNS.iter().any(|noun| after.starts_with(noun)) {
            return false;
        }
    }

    const REWRITE_VERBS: &[&str] = &[
        "make ",
        "rewrite ",
        "refactor ",
        "convert ",
        "change ",
        "turn ",
        "add ",
        "remove ",
        "delete ",
        "wrap ",
        "extract ",
        "inline ",
        "rename ",
        "fix ",
        "clean ",
        "simplify ",
        "shorten ",
        "split ",
        "merge ",
        "replace ",
        "swap ",
        "use ",
    ];
    REWRITE_VERBS.iter().any(|verb| lowered.starts_with(verb))
}

fn strip_optional_trailing_project_word(input: &str) -> &str {
    let trimmed = input.trim();
    trimmed
        .strip_suffix(" project")
        .map(str::trim_end)
        .unwrap_or(trimmed)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum PatchStatus {
    Proposed,
    Staged,
    Applied,
    Rejected,
    Undone,
}

#[derive(Debug, Default)]
pub struct PatchStage {
    files: HashMap<PathBuf, String>,
    patches: HashMap<u64, PatchRecord>,
    applied_stack: Vec<AppliedPatch>,
}

impl PatchStage {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_file(&mut self, path: PathBuf, text: impl Into<String>) {
        self.files.insert(path, text.into());
    }

    pub fn file_text(&self, path: &Path) -> Option<&str> {
        self.files.get(path).map(String::as_str)
    }

    pub fn propose_patch(&mut self, patch: CandidatePatch) -> Result<(), EriCoreError> {
        if self.patches.contains_key(&patch.id) {
            return Err(EriCoreError::DuplicatePatch(patch.id));
        }
        self.patches.insert(
            patch.id,
            PatchRecord {
                patch,
                status: PatchStatus::Proposed,
                original_text: None,
            },
        );
        Ok(())
    }

    pub fn stage_patch(&mut self, patch_id: u64) -> Result<String, EriCoreError> {
        let record = self
            .patches
            .get_mut(&patch_id)
            .ok_or(EriCoreError::UnknownPatch(patch_id))?;
        let file_text = self
            .files
            .get_mut(&record.patch.path)
            .ok_or_else(|| EriCoreError::MissingFile(record.patch.path.clone()))?;

        if record.status == PatchStatus::Staged || record.status == PatchStatus::Applied {
            return Ok(file_text.clone());
        }

        let original_text = file_text.clone();
        let staged_text = replace_once(
            &original_text,
            &record.patch.old_text,
            &record.patch.new_text,
        )
        .ok_or_else(|| EriCoreError::PatchTextNotFound {
            path: record.patch.path.clone(),
            old_text: record.patch.old_text.clone(),
        })?;
        *file_text = staged_text.clone();
        record.original_text = Some(original_text);
        record.status = PatchStatus::Staged;
        Ok(staged_text)
    }

    pub fn apply_patch(&mut self, patch_id: u64) -> Result<(), EriCoreError> {
        if self.patch_status(patch_id) == Some(PatchStatus::Proposed) {
            self.stage_patch(patch_id)?;
        }

        let record = self
            .patches
            .get_mut(&patch_id)
            .ok_or(EriCoreError::UnknownPatch(patch_id))?;
        let original_text = record
            .original_text
            .clone()
            .ok_or(EriCoreError::PatchNotStaged(patch_id))?;

        record.status = PatchStatus::Applied;
        self.applied_stack.push(AppliedPatch {
            patch_id,
            path: record.patch.path.clone(),
            original_text,
        });
        Ok(())
    }

    pub fn reject_patch(&mut self, patch_id: u64) -> Result<(), EriCoreError> {
        let record = self
            .patches
            .get_mut(&patch_id)
            .ok_or(EriCoreError::UnknownPatch(patch_id))?;

        if let Some(original_text) = record.original_text.take() {
            self.files.insert(record.patch.path.clone(), original_text);
        }
        record.status = PatchStatus::Rejected;
        Ok(())
    }

    pub fn undo_last_patch(&mut self) -> Result<(), EriCoreError> {
        let applied = self
            .applied_stack
            .pop()
            .ok_or(EriCoreError::NothingToUndo)?;
        self.files.insert(applied.path, applied.original_text);
        if let Some(record) = self.patches.get_mut(&applied.patch_id) {
            record.status = PatchStatus::Undone;
        }
        Ok(())
    }

    pub fn patch_status(&self, patch_id: u64) -> Option<PatchStatus> {
        self.patches.get(&patch_id).map(|record| record.status)
    }
}

#[derive(Debug)]
struct PatchRecord {
    patch: CandidatePatch,
    status: PatchStatus,
    original_text: Option<String>,
}

#[derive(Debug)]
struct AppliedPatch {
    patch_id: u64,
    path: PathBuf,
    original_text: String,
}

fn replace_once(text: &str, old_text: &str, new_text: &str) -> Option<String> {
    let start = text.find(old_text)?;
    let end = start + old_text.len();
    let mut result = String::with_capacity(text.len() - old_text.len() + new_text.len());
    result.push_str(&text[..start]);
    result.push_str(new_text);
    result.push_str(&text[end..]);
    Some(result)
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum EriCoreError {
    #[error("iteration failed: {0}")]
    Iteration(String),
    #[error("patch {0} already exists")]
    DuplicatePatch(u64),
    #[error("unknown patch {0}")]
    UnknownPatch(u64),
    #[error("missing file for patch: {0}")]
    MissingFile(PathBuf),
    #[error("patch {0} is not staged")]
    PatchNotStaged(u64),
    #[error("could not find text to replace in {path}: {old_text:?}")]
    PatchTextNotFound { path: PathBuf, old_text: String },
    #[error("there is no applied patch to undo")]
    NothingToUndo,
}
