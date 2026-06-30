//! Terminal-native CLI for eri.
//!
//! Lets users drive Eri from a terminal:
//!
//! ```text
//! eri
//! eri plan "add Stripe checkout"
//! eri build "make me a coffee shop and deploy it"
//! eri iterate "swap the hero photo for an espresso shot"
//! eri scaffold portfolio
//! eri ship
//! ```
//!
//! The CLI reuses the same build, iteration, deploy, and agent routing paths
//! as the GUI. The only thing the CLI does differently is render progress as a
//! single `\r`-updated status line on stdout instead of a panel.

use anyhow::Context as _;
use clap::{CommandFactory, Parser, Subcommand};
use eri_inference::{InferenceError, TEMPLATES, deploy_to_vercel, template_by_slug};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

mod action_log;
mod admin;
mod agent;
mod agent_cmd;
mod assistant;
mod auth;
mod awareness;
mod background;
mod build_agent;
mod build_turn;
mod chat;
mod checkpoint;
mod client;
mod coding_agent;
mod coding_control;
mod commands;
mod composio;
mod composio_session;
mod config;
mod connections;
mod control_agent;
mod control_envelope;
#[cfg(test)]
mod control_eval;
mod control_safety;
mod control_turn;
mod credential_vault;
mod engine_ladder;
mod eri_config;
mod gaze_focus;
mod genui;
mod git_tools;
mod intent;
mod line_editor;
mod local_eval;
mod mcp_server;
mod memory;
mod memory_tools;
mod openai_turn;
mod phone;
mod plan_tui;
mod plugins;
mod predict;
mod proactive;
mod project;
mod reflection;
mod remote;
mod remote_recall;
mod repl;
mod research;
mod sandbox;
mod sdk_tools;
mod search;
mod session;
mod sia;
mod skills;
mod sync;
mod totp;
mod trace;
mod update;
mod voice_control;
mod weather;
mod workflow;
mod worktree;

const ERI_CLI_VERSION: &str = env!("CARGO_PKG_VERSION");
const DEFAULT_OUTPUT_FILE: &str = "index.html";

#[derive(Parser, Debug)]
#[command(
    name = "eri",
    bin_name = "eri",
    version = ERI_CLI_VERSION,
    about = "Terminal-native Eri agent.",
    long_about = "Run Eri from any project. Start an interactive session, ask, plan, \
                  build, iterate, scaffold, remember, and ship from the terminal."
)]
pub struct Cli {
    /// Headless one-shot: run PROMPT (or read stdin if given with no value)
    /// through the agentic loop, print the result, and exit. Non-interactive --
    /// for pipes, scripts, and CI.
    #[arg(short = 'p', long = "print", value_name = "PROMPT", num_args = 0..=1, default_missing_value = "")]
    pub print: Option<String>,
    /// Headless output format: text | json | stream-json.
    #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
    pub output_format: OutputFormat,
    /// Headless: cap agentic turns. Exits non-zero (2) if the cap is hit before
    /// completion -- useful as a CI budget guard.
    #[arg(long, value_name = "N")]
    pub max_turns: Option<usize>,
    /// Headless inference depth: fast | thinking | auto (default from
    /// .eri/config.toml, else thinking).
    #[arg(long, value_enum)]
    pub mode: Option<Mode>,
    /// Headless plan mode: read-only -- eri plans the work without writing any
    /// files (write tools are refused).
    #[arg(long)]
    pub plan: bool,
    /// Allow the agent to run shell commands (bash tool). OFF by default --
    /// shell is privileged and NOT sandboxed, so opt in explicitly.
    #[arg(long)]
    pub allow_shell: bool,
    /// Run the bash tool inside an OS sandbox (writes confined to the workspace,
    /// no network). macOS only; refuses to run shell unsandboxed elsewhere.
    #[arg(long)]
    pub sandbox: bool,
    /// Permission posture: plan (read-only) | accept-edits (default, writes, no
    /// shell) | workspace-write (writes + shell) | bypass. When set, this is the
    /// source of truth and overrides --plan / --allow-shell.
    #[arg(long, value_enum, value_name = "MODE")]
    pub permission_mode: Option<PermissionModeArg>,
    /// Output style / persona: builder (default) | reviewer | explainer |
    /// concise. Same tools + safety, different posture.
    #[arg(long, value_enum, value_name = "STYLE")]
    pub style: Option<StyleArg>,
    #[command(subcommand)]
    pub command: Option<Command>,
}

/// CLI spelling of `build_agent::SystemStyle`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, clap::ValueEnum)]
pub enum StyleArg {
    Builder,
    Reviewer,
    Explainer,
    Concise,
}

impl From<StyleArg> for build_agent::SystemStyle {
    fn from(a: StyleArg) -> Self {
        match a {
            StyleArg::Builder => build_agent::SystemStyle::Builder,
            StyleArg::Reviewer => build_agent::SystemStyle::Reviewer,
            StyleArg::Explainer => build_agent::SystemStyle::Explainer,
            StyleArg::Concise => build_agent::SystemStyle::Concise,
        }
    }
}

/// CLI spelling of `build_agent::PermissionMode`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, clap::ValueEnum)]
pub enum PermissionModeArg {
    /// Read-only: explore + plan, no writes, no shell.
    Plan,
    /// Default: file writes allowed; shell off.
    AcceptEdits,
    /// Writes + shell, scoped to the workspace.
    WorkspaceWrite,
    /// Writes + shell, no extra friction.
    Bypass,
}

impl From<PermissionModeArg> for build_agent::PermissionMode {
    fn from(a: PermissionModeArg) -> Self {
        match a {
            PermissionModeArg::Plan => build_agent::PermissionMode::Plan,
            PermissionModeArg::AcceptEdits => build_agent::PermissionMode::AcceptEdits,
            PermissionModeArg::WorkspaceWrite => build_agent::PermissionMode::WorkspaceWrite,
            PermissionModeArg::Bypass => build_agent::PermissionMode::Bypass,
        }
    }
}

/// Output format for headless (`-p`) runs.
#[derive(Clone, Copy, Debug, PartialEq, Eq, clap::ValueEnum)]
pub enum OutputFormat {
    /// Human-readable narration + a summary line (default).
    Text,
    /// A single pretty-printed JSON result object.
    Json,
    /// Newline-delimited JSON (currently one `result` event).
    StreamJson,
}

/// CLI inference mode. `--mode` selects the reasoning tier (fast/thinking/auto),
/// not the underlying engine -- the CLI runs the agentic tool-use loop
/// throughout. The concrete engine/tier is an internal detail.
#[derive(Clone, Copy, Debug, PartialEq, Eq, clap::ValueEnum)]
pub enum Mode {
    /// Cheapest, fastest tier -- quick edits, low token burn.
    Fast,
    /// Default. Deeper reasoning -- multi-file builds, real thinking.
    Thinking,
    /// Smart default (currently Thinking; intent-routed in a future release).
    Auto,
}

pub(crate) fn model_for_mode(mode: Mode) -> &'static str {
    match mode {
        Mode::Fast => "claude-haiku-4-5-20251001",
        Mode::Thinking | Mode::Auto => build_agent::DEFAULT_MODEL,
    }
}

/// The workspace a path lives in (its parent, or cwd).
fn workspace_of(path: &Path) -> PathBuf {
    path.parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."))
}

/// Resolve the effective mode: explicit flag wins, else `.eri/config.toml`,
/// else the built-in default (thinking).
fn resolve_mode(flag: Option<Mode>, workspace: &Path) -> Mode {
    if let Some(m) = flag {
        return m;
    }
    match eri_config::load(workspace).mode.as_deref() {
        Some("fast") => Mode::Fast,
        Some("auto") => Mode::Auto,
        _ => Mode::Thinking,
    }
}

fn cwd() -> PathBuf {
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

/// Write a shell completion script for `eri` to `out`. Factored out so it is
/// unit-testable without touching stdout.
fn generate_completions(shell: clap_complete::Shell, out: &mut impl io::Write) {
    let mut cmd = Cli::command();
    clap_complete::generate(shell, &mut cmd, "eri", out);
}

#[derive(Subcommand, Debug, PartialEq, Eq)]
pub enum Command {
    /// Generate a fresh ./index.html from a natural-language prompt.
    Build {
        /// The build prompt — what eri should make.
        prompt: String,
        /// Also run `vercel --prod --yes` against the cwd after writing the file.
        #[arg(long)]
        deploy: bool,
        /// Write the resulting HTML to this path instead of ./index.html.
        #[arg(long, default_value = DEFAULT_OUTPUT_FILE)]
        output: PathBuf,
        /// Inference depth: fast | thinking | auto (default from
        /// .eri/config.toml, else thinking).
        #[arg(long, value_enum)]
        mode: Option<Mode>,
    },
    /// Apply a surgical edit to ./index.html based on an instruction.
    Iterate {
        /// What to change about the current file.
        instruction: String,
        /// Edit this file instead of ./index.html.
        #[arg(long, default_value = DEFAULT_OUTPUT_FILE)]
        file: PathBuf,
        /// Inference depth: fast | thinking | auto (default from
        /// .eri/config.toml, else thinking).
        #[arg(long, value_enum)]
        mode: Option<Mode>,
    },
    /// Multi-turn agentic chat session with persistent, retained context.
    /// Each message runs the metered tool-use loop; the full conversation is
    /// saved so it can be resumed later with --continue / --resume.
    Chat {
        /// Continue the most recently updated session.
        #[arg(long = "continue")]
        continue_: bool,
        /// Resume a specific session by id or id-prefix (takes precedence
        /// over --continue).
        #[arg(long, value_name = "ID")]
        resume: Option<String>,
        /// Inference depth: fast | thinking | auto (default from
        /// .eri/config.toml, else thinking).
        #[arg(long, value_enum)]
        mode: Option<Mode>,
    },
    /// List saved chat sessions, newest first.
    Sessions,
    /// Summarize where a session left off (defaults to the most recent).
    Recap {
        /// Session id or unambiguous prefix; omit for the latest session.
        id: Option<String>,
    },
    /// Branch a session into a new one that starts from its full history.
    Fork {
        /// Session id or unambiguous prefix to fork.
        id: String,
    },
    /// List every template slug eri can scaffold from.
    ListTemplates,
    /// Drop a template's HTML into ./index.html with no network call.
    Scaffold {
        /// Slug from `eri list-templates` (e.g. `portfolio`, `coffee-shop`).
        slug: String,
        /// Write the template HTML here instead of ./index.html.
        #[arg(long, default_value = DEFAULT_OUTPUT_FILE)]
        output: PathBuf,
    },
    /// Deploy whatever's at ./index.html to Vercel (--prod --yes), OR
    /// run Eri's shipping loop when an intent is given.
    Ship {
        /// What to ship — when given, runs the tandem builder/checker.
        /// Empty → deploy ./index.html to Vercel (old behaviour).
        intent: Option<String>,
        /// Use this directory as the deploy root instead of the cwd
        /// (Vercel mode only).
        #[arg(long)]
        dir: Option<PathBuf>,
        /// Render the agent event stream as plain text or artifact JSON.
        #[arg(long, value_enum, default_value_t = agent::AgentOutputMode::Text)]
        output: agent::AgentOutputMode,
    },
    /// Deploy ./index.html to Vercel (--prod --yes). Same as
    /// `eri ship` without an intent.
    Deploy {
        #[arg(long)]
        dir: Option<PathBuf>,
    },
    /// Ask Eri a one-off question about the current project.
    Ask {
        /// Attach an image (screenshot/photo) for eri to analyze. Repeatable.
        /// PNG/JPEG/WEBP/GIF; routes the question to eri's vision engine.
        #[arg(long, value_name = "PATH")]
        image: Vec<PathBuf>,
        /// The question to ask.
        prompt: Vec<String>,
    },
    /// Generate a step-by-step plan for a goal (Architect persona).
    Plan {
        /// Render the agent event stream as plain text or artifact JSON.
        #[arg(long, value_enum, default_value_t = agent::AgentOutputMode::Text)]
        output: agent::AgentOutputMode,
        /// Open the interactive plan TUI (arrow-nav questions, notes, tasks)
        /// and hand the approved plan to the build loop. Ignored when stdout
        /// isn't a TTY or with --output artifact-json.
        #[arg(short, long)]
        interactive: bool,
        /// The goal to plan.
        prompt: Vec<String>,
    },
    /// Control the computer hands-free toward a goal (eyes/voice → actions).
    /// Defaults to a SAFE dry-run that shows the planned actions without
    /// actuating; pass --live once the macOS control bridge is granted.
    Control {
        /// Actually actuate the computer (mouse/keyboard/apps). Without this,
        /// eri only prints what it WOULD do.
        #[arg(long)]
        live: bool,
        /// Auto-confirm risky actions (quit/send/etc.) without prompting. For
        /// trusted/headless runs only — off by default.
        #[arg(long)]
        yes: bool,
        /// Speed/quality tier for the control loop's reasoning model.
        #[arg(long, value_enum)]
        mode: Option<Mode>,
        /// Reverse eri's most recent reversible action (e.g. re-quit an app it
        /// opened). Pair with --live to actuate the undo; without it, shows what
        /// it would reverse. No goal needed.
        #[arg(long)]
        undo: bool,
        /// Show the trail of what eri has done ("what did eri just do?") and
        /// exit. No goal needed.
        #[arg(long)]
        history: bool,
        /// Proactively suggest what you'll likely want next, learned from what
        /// you've done before. No goal needed.
        #[arg(long)]
        suggest: bool,
        /// The goal, e.g. "open YouTube and search lofi".
        goal: Vec<String>,
    },
    /// Drive eri hands-free from recognized speech. The macOS app pipes
    /// transcripts here; eri classifies wake/stop/command/noise and acts,
    /// speaking a short reply back. e.g. eri voice "hey eri, open Spotify".
    Voice {
        /// Actually actuate (same as `eri control --live`).
        #[arg(long)]
        live: bool,
        /// Auto-confirm risky actions.
        #[arg(long)]
        yes: bool,
        /// The recognized speech.
        transcript: Vec<String>,
    },
    /// Ambient awareness: watch the screen locally and narrate what changes.
    /// Token-frugal (reads the cheap accessibility tree, not pixels). Needs the
    /// eri app's control bridge (launch it from the app).
    Watch {
        /// Stop after N seconds (0 = run until Ctrl-C).
        #[arg(long, default_value_t = 0)]
        seconds: u64,
    },
    /// Manage the per-app control denylist — apps eri must not look at or touch.
    /// `eri apps` lists them; `eri apps deny Discord` adds one; `eri apps allow
    /// Discord` removes one. Denied apps are refused before any open/quit.
    Apps {
        /// `deny <app>`, `allow <app>`, or omit (or `list`) to show the denylist.
        action: Vec<String>,
    },
    /// A "here's your day" recap from what eri remembers (local memory only).
    /// No fabrication — reports only what's actually on record. Your calendar
    /// and email join this once you connect them.
    Brief,
    /// Web research from the live web — eri searches and answers with sources.
    /// Needs a provider key (set ANTHROPIC_API_KEY). Never fabricates an answer.
    Research {
        /// The question, e.g. "what is pgvector?".
        query: Vec<String>,
    },
    /// Email assistant over a connected email MCP server (Gmail, etc.). With no
    /// server connected it shows you how to add one — it never invents an inbox.
    Email {
        /// Optional action: `summarize`, `draft`, `triage` (or omit).
        action: Vec<String>,
    },
    /// Calendar assistant over a connected calendar MCP server. With no server
    /// connected it shows you how to add one — it never invents a schedule.
    Calendar {
        /// Optional action: `status`, `ready-check` (or omit).
        action: Vec<String>,
    },
    /// Add tests for a path or the whole workspace (Tester persona).
    Test {
        /// Optional scope — a file or directory.
        #[arg(default_value = "")]
        scope: String,
    },
    /// Suggest a refactor for a scope (Architect persona).
    Refactor {
        /// Optional scope — a file, function, or directory.
        #[arg(default_value = "")]
        scope: String,
    },
    /// Explain a file, function, or `file:line` range.
    Explain {
        /// The target — `src/foo.ts`, `src/foo.ts:42`, or `MyClass#method`.
        target: String,
    },
    /// Fast HTML draft from a description.
    Sketch {
        /// What to sketch.
        prompt: Vec<String>,
    },
    /// Generate an Eri GenUI component contract for streamed interface output.
    Ui {
        /// Render as text or artifact JSON.
        #[arg(long, value_enum, default_value_t = genui::GenUiOutputMode::Text)]
        output: genui::GenUiOutputMode,
        /// Open the desktop Eri workbench with this UI intent.
        #[arg(long)]
        open: bool,
        /// Interface to generate.
        prompt: Vec<String>,
    },
    /// eri.dev authentication commands.
    #[command(subcommand)]
    Auth(AuthCommand),
    /// Persona / agent switcher for this workspace.
    #[command(subcommand)]
    Agent(AgentCommand),
    /// Memory — recall, remember, forget.
    #[command(subcommand)]
    Memory(MemoryCommand),
    /// Saved-login vault: store credentials eri can fill hands-free without ever
    /// exposing the secret to the model. Values are never printed.
    #[command(subcommand)]
    Vault(VaultCommand),
    /// MCP server setup and local connector status.
    #[command(subcommand)]
    Mcp(McpCommand),
    /// Check for a server-published CLI update manifest.
    #[command(subcommand)]
    Update(UpdateCommand),
    /// Scaffold an AGENTS.md in the current directory so eri learns this
    /// project's conventions, commands, and gotchas.
    Init,
    /// Owner-only: per-user usage analytics.
    #[command(subcommand)]
    Admin(AdminCommand),
    /// Link your phone so you can text eri (iMessage via Sendblue).
    #[command(subcommand)]
    Phone(PhoneCommand),
    /// Connect your apps (Gmail, GitHub, …) through Composio so eri can use them.
    #[command(subcommand)]
    Composio(ComposioCommand),
    /// Sync memory to the cloud: Tier-B blob (cross-device) + Tier-A profile
    /// (so phone eri knows your day).
    Sync,
    /// Run the remote-control daemon: let phone eri dispatch goals to THIS
    /// computer (it runs them through the control stack and texts back).
    Remote {
        /// Inference depth for control turns: fast | thinking | auto.
        #[arg(long, value_enum)]
        mode: Option<Mode>,
        /// Seconds to wait between polls when the queue is empty.
        #[arg(long, default_value_t = 5)]
        interval: u64,
    },
    /// Show the resolved .eri/config.toml defaults for this directory.
    Config,
    /// List SKILL.md skills eri can run (project + global, any agent CLI).
    Skills,
    /// List installed plugins (.eri/plugins/<name>/: commands, skills, hooks, mcp).
    Plugins,
    /// Manage isolated git worktrees for parallel sessions.
    #[command(subcommand)]
    Worktree(WorktreeCommand),
    /// Run or list dynamic multi-step workflows (.eri/workflows/<name>.json).
    #[command(subcommand)]
    Workflow(WorkflowCommand),
    /// Print a shell completion script (bash | zsh | fish | powershell | elvish).
    Completions {
        /// The shell to generate completions for.
        shell: clap_complete::Shell,
    },
    /// Inspect local setup for auth, agents, MCP, and workflow files.
    Doctor,
    /// Show the active sign-in + tier + remaining quota. Alias of
    /// `eri auth status`.
    Status,
    /// Catch-all: any invocation whose first token isn't a known subcommand is
    /// captured here as a free-text prompt (e.g. `eri what is on my calendar`).
    /// WHY: the top UX priority is `eri <natural language>` with NO subcommand
    /// and NO required quotes — eri decides its own mode (build/control/answer/
    /// chat) via the intent router. Explicit subcommands stay unchanged
    /// overrides; this only fires when nothing else matched.
    #[command(external_subcommand)]
    External(Vec<String>),
}

#[derive(Subcommand, Debug, PartialEq, Eq)]
pub enum AuthCommand {
    /// Open a browser, sign in via the device-code flow, store the
    /// bearer at `~/.config/eri/credentials.json`.
    Login,
    /// Show the active sign-in + tier + remaining quota.
    Status,
    /// Drop the local credentials. Server-side bearer revoke is best-
    /// effort (run `eri auth login` again to refresh).
    Logout,
}

#[derive(Subcommand, Debug, PartialEq, Eq)]
pub enum AgentCommand {
    /// List built-in + workspace personas.
    List,
    /// Set the active persona for this workspace.
    Set { name: String },
}

#[derive(Subcommand, Debug, PartialEq, Eq)]
pub enum MemoryCommand {
    /// Keyword-search the memory store.
    Recall {
        query: String,
        #[arg(long, default_value_t = 20)]
        limit: usize,
    },
    /// Pin a fact to memory.
    Remember { text: String },
    /// Ask the world model who you work with on a project.
    Who { project: String },
    /// Run one cold-path reflection flush: the base engine reads your recent
    /// observations and writes the entities/relations it infers into your world
    /// model (provenance-tagged). A manual batch flush; an automatic cadence is a
    /// later refinement.
    Reflect {
        #[arg(long, default_value_t = 50)]
        limit: usize,
    },
    /// Backfill the world model from your episodic memory: extract the
    /// people/projects/relations in everything you've remembered into the world
    /// graph (additive — your memories are untouched; idempotent — safe to re-run).
    Ingest,
    /// Auto-index the last N months of your connected accounts (Gmail/Calendar) into
    /// the world model — privacy-screened (sensitive dropped before storage), capped,
    /// one reflect pass. Phase A: runs on-device (indexes while the computer is on).
    Backfill {
        #[arg(long, default_value_t = 6)]
        months: u32,
        #[arg(long, default_value_t = 0)]
        max: usize,
    },
    /// Drop an observation by id, or "all" to clear everything.
    Forget { target: String },
}

#[derive(Subcommand, Debug, PartialEq, Eq)]
pub enum VaultCommand {
    /// Save a login so eri can sign you in hands-free. Prompts for the password
    /// WITHOUT echo; the value goes straight to the macOS Keychain and is never
    /// printed or logged. Re-saving a site updates the stored login.
    Add {
        /// The site origin, e.g. "github.com".
        origin: String,
        /// The username / email for the login.
        #[arg(long)]
        username: String,
    },
    /// List saved logins — origins + usernames only, never the secret.
    List,
    /// Bulk-import logins from a password-manager CSV export (Chrome, 1Password,
    /// Bitwarden, …). Passwords + any 2FA seeds go straight to the Keychain;
    /// nothing is printed. Reports how many were imported and skipped.
    Import {
        /// Path to the exported CSV file.
        file: String,
    },
    /// Attach a 2FA (TOTP) seed to a saved login so eri fills the current code at
    /// sign-in. Prompts for the base32 seed WITHOUT echo; the seed stays in the
    /// Keychain and the code is generated locally — neither is ever shown.
    Totp {
        /// The site origin the 2FA belongs to, e.g. "github.com".
        origin: String,
    },
    /// Trust a site for hands-free sign-in: eri fills your saved login there
    /// WITHOUT asking each time (the persisted per-origin "always" grant).
    Trust {
        /// The site origin to trust, e.g. "github.com".
        origin: String,
    },
    /// Untrust a site: eri asks again before signing you in. The login is kept.
    Untrust {
        /// The site origin to untrust, e.g. "github.com".
        origin: String,
    },
    /// Forget a saved login: delete the Keychain secret (+ any 2FA seed), the
    /// metadata entry, and any "always sign in here" grant for that site.
    Forget {
        /// The site origin to forget, e.g. "github.com".
        origin: String,
    },
}

#[derive(Subcommand, Debug, PartialEq, Eq)]
pub enum McpCommand {
    /// Show configured local MCP servers.
    List,
    /// Run eri AS an MCP server (stdio) so other agents (Claude Desktop, …) can
    /// call eri's local memory tools. Add to a client config with
    /// `command: "eri", args: ["mcp", "serve"]`.
    Serve,
}

#[derive(Subcommand, Debug, PartialEq, Eq)]
pub enum AdminCommand {
    /// Per-user usage analytics over a recent window (owner-only).
    Usage {
        /// Window in days (1..365).
        #[arg(long, default_value_t = 30)]
        days: u32,
        /// Show the top N users by cost.
        #[arg(long, default_value_t = 50)]
        top: u32,
    },
}

#[derive(Subcommand, Debug, PartialEq, Eq)]
pub enum PhoneCommand {
    /// Mint a pairing code; text it to the eri number to link this account.
    Link,
}

#[derive(Subcommand, Debug, PartialEq, Eq)]
pub enum ComposioCommand {
    /// Start connecting a toolkit (opens its authorize page), e.g. `connect gmail`.
    Connect {
        /// Composio toolkit slug (gmail, github, googlecalendar, …).
        toolkit: String,
    },
    /// List which apps are connected or pending.
    Apps,
}

#[derive(Subcommand, Debug, PartialEq, Eq)]
pub enum WorktreeCommand {
    /// Create an isolated worktree on a new branch (forked from HEAD).
    Add {
        /// New branch name for the worktree.
        branch: String,
        /// Where to create the worktree (default: ../<repo>-<branch>).
        #[arg(long)]
        path: Option<PathBuf>,
    },
    /// List the repository's worktrees.
    List,
    /// Remove a worktree by path.
    Remove {
        /// The worktree path to remove.
        path: PathBuf,
        /// Remove even with uncommitted changes.
        #[arg(long)]
        force: bool,
    },
}

#[derive(Subcommand, Debug, PartialEq, Eq)]
pub enum WorkflowCommand {
    /// List available workflows.
    List,
    /// Run a workflow by name.
    Run {
        /// Workflow name (file stem under .eri/workflows/).
        name: String,
        /// Inference depth for the steps.
        #[arg(long, value_enum)]
        mode: Option<Mode>,
    },
}

#[derive(Subcommand, Debug, PartialEq, Eq)]
pub enum UpdateCommand {
    /// Check the Eri update manifest without installing anything.
    Check {
        /// Release channel to query.
        #[arg(long, value_enum, default_value_t = update::UpdateChannel::Stable)]
        channel: update::UpdateChannel,
        /// Render as text or JSON.
        #[arg(long, value_enum, default_value_t = update::UpdateOutputMode::Text)]
        output: update::UpdateOutputMode,
    },
}

/// Initialize crash reporting when `SENTRY_DSN` is set. PII is OFF and a
/// before-send scrubber strips anything that could carry user content (request
/// data, headers, server name, the user object) — we report crashes, never
/// prompts/code/secrets. Returns the guard, which must live for the process so
/// queued events flush on exit. No-op (None) when the DSN is unset.
fn init_sentry() -> Option<sentry::ClientInitGuard> {
    let dsn = std::env::var("SENTRY_DSN").ok().filter(|d| !d.is_empty())?;
    Some(sentry::init((
        dsn,
        sentry::ClientOptions {
            release: sentry::release_name!(),
            send_default_pii: false,
            before_send: Some(std::sync::Arc::new(
                |mut event: sentry::protocol::Event<'static>| {
                    event.request = None;
                    event.user = None;
                    event.server_name = None;
                    Some(event)
                },
            )),
            ..Default::default()
        },
    )))
}

fn main() -> ExitCode {
    // Held for the whole process so panics are captured + flushed on exit.
    let _sentry = init_sentry();
    let cli = Cli::parse();
    let rt = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(err) => {
            eprintln!("error: build tokio runtime: {err}");
            return ExitCode::FAILURE;
        }
    };
    // Headless one-shot (`-p` / `--print`) bypasses the subcommand dispatcher and
    // returns its own exit code (non-zero when a turn cap is hit).
    if let Some(prompt) = cli.print.clone() {
        return match rt.block_on(run_headless(
            prompt,
            cli.output_format,
            cli.max_turns,
            model_for_mode(resolve_mode(cli.mode, &cwd())),
            // --permission-mode wins; else derive from legacy --plan/--allow-shell.
            cli.permission_mode.map(Into::into).unwrap_or_else(|| {
                build_agent::PermissionMode::from_legacy_flags(cli.plan, cli.allow_shell)
            }),
            // --style flag wins; else .eri/config.toml style; else builder.
            cli.style.map(Into::into).unwrap_or_else(|| {
                eri_config::load(&cwd())
                    .style
                    .as_deref()
                    .map(build_agent::SystemStyle::parse)
                    .unwrap_or_default()
            }),
            cli.sandbox,
        )) {
            Ok(code) => ExitCode::from(code),
            Err(error) => {
                eprintln!("error: {error}");
                ExitCode::FAILURE
            }
        };
    }
    match rt.block_on(dispatch(cli)) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("error: {error}");
            ExitCode::FAILURE
        }
    }
}

/// The loop-capability flags resolved from the top-level CLI, so `eri build`
/// honors the same `--permission-mode` / `--style` / `--sandbox` as headless.
#[derive(Clone, Copy)]
struct LoopFlags {
    permission: build_agent::PermissionMode,
    style: build_agent::SystemStyle,
    sandbox: bool,
}

async fn dispatch(cli: Cli) -> anyhow::Result<()> {
    // Resolve the loop flags up front (used by the build/ship paths).
    let flags = LoopFlags {
        permission: cli.permission_mode.map(Into::into).unwrap_or_else(|| {
            build_agent::PermissionMode::from_legacy_flags(cli.plan, cli.allow_shell)
        }),
        style: cli.style.map(Into::into).unwrap_or_else(|| {
            eri_config::load(&cwd())
                .style
                .as_deref()
                .map(build_agent::SystemStyle::parse)
                .unwrap_or_default()
        }),
        sandbox: cli.sandbox,
    };
    let Some(command) = cli.command else {
        return repl::run().await;
    };
    match command {
        // -- existing Eri HTML commands (sync) --
        Command::Build {
            prompt,
            deploy,
            output,
            mode,
        } => {
            let m = resolve_mode(mode, &workspace_of(&output));
            run_build_metered(&prompt, deploy, &output, model_for_mode(m), flags).await
        }
        Command::Iterate {
            instruction,
            file,
            mode,
        } => {
            let m = resolve_mode(mode, &workspace_of(&file));
            run_iterate_metered(&instruction, &file, model_for_mode(m)).await
        }
        Command::Chat {
            continue_,
            resume,
            mode,
        } => {
            let resume_mode = if let Some(id) = resume {
                chat::ResumeMode::Resume(id)
            } else if continue_ {
                chat::ResumeMode::Continue
            } else {
                chat::ResumeMode::New
            };
            let m = resolve_mode(mode, &cwd());
            // chat honors the same loop-capability flags (sandbox/permission/style)
            // and the per-tier context window — all via the one assembly seam.
            let opts =
                build_agent::LoopOpts::for_run(flags.style, flags.sandbox, flags.permission, true);
            chat::run(resume_mode, model_for_mode(m), opts).await
        }
        Command::Sessions => chat::list_sessions(),
        Command::Recap { id } => {
            let sess = match id {
                Some(id) => session::resolve(&id)?,
                None => session::latest()?.ok_or_else(|| {
                    anyhow::anyhow!("no sessions yet -- start one with `eri chat`")
                })?,
            };
            println!("{}", sess.recap());
            Ok(())
        }
        Command::Fork { id } => {
            let parent = session::resolve(&id)?;
            let branch = parent.fork();
            branch.save()?;
            println!(
                "[eri] forked {} -> {}. Continue it with `eri chat --resume {}`.",
                parent.id.chars().take(8).collect::<String>(),
                branch.id.chars().take(8).collect::<String>(),
                branch.id
            );
            Ok(())
        }
        Command::ListTemplates => {
            print_templates();
            Ok(())
        }
        Command::Scaffold { slug, output } => {
            run_scaffold(&slug, &output).map_err(anyhow::Error::from)
        }
        Command::Deploy { dir } => run_deploy(dir.as_deref()).map_err(anyhow::Error::from),
        Command::Ship {
            intent,
            dir,
            output,
        } => {
            // `eri ship` with no args → legacy Vercel deploy. With an
            // intent → agent tandem ship.
            let _ = output; // output mode unused on the metered build path
            match intent {
                // No intent -> legacy: just deploy whatever is already built.
                None => run_deploy(dir.as_deref()).map_err(anyhow::Error::from),
                // Intent -> build it for real via the metered agentic loop, then deploy.
                Some(intent) => {
                    run_build_metered(
                        intent.trim(),
                        true,
                        Path::new(DEFAULT_OUTPUT_FILE),
                        model_for_mode(Mode::Thinking),
                        flags,
                    )
                    .await
                }
            }
        }
        // -- new agent-mode commands (async) --
        Command::Ask { image, prompt } => {
            // With --image, route through the vision engine; otherwise the
            // existing text-only ask path (no regression).
            if image.is_empty() {
                agent::ask(&prompt.join(" ")).await
            } else {
                agent::ask_with_image(&prompt.join(" "), &image).await
            }
        }
        Command::Plan {
            prompt,
            output,
            interactive,
        } => {
            let goal = prompt.join(" ");
            // Interactive TUI only when asked AND on a real terminal AND not
            // emitting machine output; otherwise fall back to plain streaming.
            let use_tui = interactive
                && output == agent::AgentOutputMode::Text
                && std::io::IsTerminal::is_terminal(&std::io::stdout());
            if use_tui {
                run_plan_interactive(&goal).await
            } else {
                agent::plan_with_output(&goal, output).await
            }
        }
        Command::Control {
            live,
            yes,
            mode,
            undo,
            history,
            suggest,
            goal,
        } => {
            run_control(
                &goal.join(" "),
                live,
                yes,
                mode,
                undo,
                history,
                suggest,
                false,
            )
            .await
        }
        Command::Voice {
            live,
            yes,
            transcript,
        } => run_voice(&transcript.join(" "), live, yes).await,
        Command::Apps { action } => run_apps(&action),
        Command::Brief => memory::brief(),
        Command::Research { query } => research::research(&query.join(" ")),
        Command::Email { action } => assistant::email(&action.join(" ")).await,
        Command::Calendar { action } => assistant::calendar(&action.join(" ")).await,
        Command::Watch { seconds } => run_watch(seconds).await,
        Command::Test { scope } => agent::test(&scope).await,
        Command::Refactor { scope } => agent::refactor(&scope).await,
        Command::Explain { target } => agent::explain(&target).await,
        Command::Sketch { prompt } => agent::sketch(&prompt.join(" ")).await,
        Command::Ui {
            output,
            open,
            prompt,
        } => genui::run_with_open(&prompt.join(" "), output, open),
        Command::Auth(AuthCommand::Login) => auth::login().await.map(|_| ()),
        Command::Auth(AuthCommand::Status) => auth::status().await,
        Command::Auth(AuthCommand::Logout) => auth::logout(),
        Command::Status => auth::status().await,
        Command::Agent(AgentCommand::List) => agent_cmd::list(),
        Command::Agent(AgentCommand::Set { name }) => agent_cmd::set(&name),
        Command::Memory(MemoryCommand::Recall { query, limit }) => memory::recall(&query, limit),
        Command::Memory(MemoryCommand::Remember { text }) => {
            let result = memory::remember(&text);
            // A new fact is exactly what phone eri should learn — push it to the
            // cloud in the background (best-effort; never blocks or fails the
            // local remember). `forget` syncs too so a tombstone propagates.
            sync::spawn_best_effort();
            result
        }
        Command::Memory(MemoryCommand::Who { project }) => memory::who(&project),
        Command::Memory(MemoryCommand::Reflect { limit }) => memory::reflect(limit).await,
        Command::Memory(MemoryCommand::Ingest) => memory::ingest(),
        Command::Memory(MemoryCommand::Backfill { months, max }) => {
            connections::run(months, max).await
        }
        Command::Memory(MemoryCommand::Forget { target }) => {
            let result = memory::forget(&target);
            sync::spawn_best_effort();
            result
        }
        Command::Vault(VaultCommand::Add { origin, username }) => {
            credential_vault::cli_add(&origin, &username)
        }
        Command::Vault(VaultCommand::List) => credential_vault::cli_list(),
        Command::Vault(VaultCommand::Import { file }) => credential_vault::cli_import(&file),
        Command::Vault(VaultCommand::Totp { origin }) => credential_vault::cli_set_totp(&origin),
        Command::Vault(VaultCommand::Trust { origin }) => credential_vault::cli_trust(&origin),
        Command::Vault(VaultCommand::Untrust { origin }) => credential_vault::cli_untrust(&origin),
        Command::Vault(VaultCommand::Forget { origin }) => credential_vault::cli_forget(&origin),
        Command::Mcp(McpCommand::List) => repl::print_mcp_status(),
        Command::Mcp(McpCommand::Serve) => {
            let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
            match memory_tools::MemoryCtx::open(&cwd, None) {
                Some(ctx) => mcp_server::serve(&ctx),
                None => anyhow::bail!("could not open eri memory store for the MCP server"),
            }
        }
        Command::Update(UpdateCommand::Check { channel, output }) => {
            update::check(update::UpdateCheckOptions { channel, output }).await
        }
        Command::Init => run_init(),
        Command::Admin(AdminCommand::Usage { days, top }) => admin::usage(days, top).await,
        Command::Phone(PhoneCommand::Link) => phone::link().await,
        Command::Composio(ComposioCommand::Connect { toolkit }) => {
            composio::connect(&toolkit).await
        }
        Command::Composio(ComposioCommand::Apps) => composio::apps().await,
        Command::Sync => sync::run().await,
        Command::Remote { mode, interval } => {
            let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
            let model = model_for_mode(resolve_mode(mode, &cwd));
            remote::serve(model, std::time::Duration::from_secs(interval)).await
        }
        Command::Config => {
            run_config();
            Ok(())
        }
        Command::Skills => {
            skills::print_list(&skills::discover(&cwd()));
            Ok(())
        }
        Command::Plugins => {
            plugins::print_list(&plugins::discover(&cwd()));
            Ok(())
        }
        Command::Worktree(wc) => match wc {
            WorktreeCommand::Add { branch, path } => worktree::add(&branch, path),
            WorktreeCommand::List => worktree::list(),
            WorktreeCommand::Remove { path, force } => worktree::remove(&path, force),
        },
        Command::Completions { shell } => {
            generate_completions(shell, &mut io::stdout());
            Ok(())
        }
        Command::Workflow(wc) => match wc {
            WorkflowCommand::List => {
                workflow::print_list(&cwd());
                Ok(())
            }
            WorkflowCommand::Run { name, mode } => {
                let m = resolve_mode(mode, &cwd());
                workflow::run(&cwd(), &name, model_for_mode(m)).await
            }
        },
        Command::Doctor => repl::print_doctor(),
        // Bare natural-language prompt with no subcommand. The intent router
        // (0-token, sub-ms) decides the mode and we hand off to the SAME handler
        // the matching explicit subcommand would use — no reimplementation.
        Command::External(words) => dispatch_external(&words.join(" "), flags).await,
    }
}

/// Route a bare prompt (`eri <natural language>`) to the right existing handler
/// using the deterministic intent classifier.
///
/// WHY a dedicated helper: keeps the big dispatch match readable and gives the
/// routing one clear, testable seam. Each branch reuses an existing handler with
/// the same defaults its explicit subcommand uses (no deploy for Build, the
/// non-live SAFE default for Control, the tool-carrying one-shot for Answer).
async fn dispatch_external(prompt: &str, flags: LoopFlags) -> anyhow::Result<()> {
    // Empty after join → fall back to the bare-`eri` interactive session.
    if prompt.trim().is_empty() {
        return repl::run().await;
    }
    let intent = intent::classify_intent(prompt);
    if std::env::var("ERI_DEBUG").is_ok() {
        eprintln!("[eri-intent] {}", intent_label(intent));
    }
    match intent {
        // Same path as `Command::Build` (no deploy, default output + model).
        intent::Intent::Build => {
            run_build_metered(
                prompt,
                false,
                Path::new(DEFAULT_OUTPUT_FILE),
                model_for_mode(resolve_mode(None, &cwd())),
                flags,
            )
            .await
        }
        // Same path as `Command::Control` with goal=prompt and its SAFE defaults
        // (non-live dry-run, no auto-yes, no undo/history/suggest, not spoken).
        intent::Intent::Control => {
            run_control(prompt, false, false, None, false, false, false, false).await
        }
        // The agentic one-shot path that carries the connected tools.
        intent::Intent::Answer => agent::ask(prompt).await,
        // Open-ended conversation: the one-shot agentic path also just talks, so
        // it's the feasible single-message handler here (a full interactive chat
        // seeded with this prompt is the future refinement).
        intent::Intent::Chat => agent::ask(prompt).await,
    }
}

/// Lowercase one-word label for the debug trace.
fn intent_label(intent: intent::Intent) -> &'static str {
    match intent {
        intent::Intent::Build => "build",
        intent::Intent::Control => "control",
        intent::Intent::Answer => "answer",
        intent::Intent::Chat => "chat",
    }
}

/// Print the resolved `.eri/config.toml` defaults for the cwd.
fn run_config() {
    let dir = cwd();
    let cfg = eri_config::load(&dir);
    let effective = resolve_mode(None, &dir);
    println!("eri config (resolved for {})", dir.display());
    println!(
        "  mode       {} (effective: {:?})",
        cfg.mode.as_deref().unwrap_or("(unset -> thinking)"),
        effective
    );
    println!(
        "  max_turns  {}",
        cfg.max_turns
            .map(|n| n.to_string())
            .unwrap_or_else(|| "(unset)".to_string())
    );
    println!("  files      .eri/config.toml (project), ~/.config/eri/config.toml (global)");
    println!("  precedence CLI flag > project > global > built-in");
}

/// Scaffold AGENTS.md in the cwd so eri picks up project conventions.
fn run_init() -> anyhow::Result<()> {
    let cwd = std::env::current_dir().context("read current directory")?;
    let (path, created) = project::scaffold(&cwd)?;
    if created {
        println!("[eri] wrote {}", path.display());
        println!("Fill in the build/test/run commands and conventions -- eri reads it every turn.");
    } else {
        println!(
            "[eri] {} already exists -- left it untouched.",
            path.display()
        );
    }
    Ok(())
}

/// Headless one-shot (`eri -p "..."`). Runs the agentic loop without the
/// interactive UI and emits a result in the requested format. Returns the
/// process exit code (2 when a turn cap is hit before completion).
async fn run_headless(
    prompt: String,
    format: OutputFormat,
    max_turns: Option<usize>,
    model: &str,
    permission: build_agent::PermissionMode,
    style: build_agent::SystemStyle,
    sandbox: bool,
) -> anyhow::Result<u8> {
    // Prompt comes from the flag value, or stdin when `-p` is passed bare.
    let prompt = if prompt.trim().is_empty() {
        let mut buf = String::new();
        std::io::Read::read_to_string(&mut io::stdin(), &mut buf).context("read stdin")?;
        buf
    } else {
        prompt
    };
    if prompt.trim().is_empty() {
        anyhow::bail!("no prompt -- pass `-p \"...\"` or pipe text into `eri -p`");
    }

    let workspace = std::env::current_dir().context("read current directory")?;

    let mut opts =
        build_agent::LoopOpts::for_run(style, sandbox, permission, format == OutputFormat::Text);
    // --max-turns flag wins; else .eri/config.toml; else built-in default.
    if let Some(n) = max_turns.or_else(|| eri_config::load(&workspace).max_turns) {
        opts.max_turns = n.max(1);
    }

    let outcome = build_agent::run_headless(prompt.trim(), &workspace, model, &opts).await?;

    match format {
        OutputFormat::Text => {
            // The raw token line is noisy and *overstates* real usage — it sums
            // cache-read/creation tokens that bill at ~0.1x, so it never matches
            // the credits on `eri usage`. Keep it for diagnostics only; the
            // dashboard / `eri usage` is the source of truth for what's metered.
            if std::env::var("ERI_DEBUG").is_ok() {
                eprintln!(
                    "[eri] {} file(s) in {} turn(s) -- {} in / {} out raw tokens (incl. cache; see `eri usage` for billed credits)",
                    outcome.files_written.len(),
                    outcome.turns,
                    outcome.tokens_in,
                    outcome.tokens_out
                );
            }
            for f in &outcome.files_written {
                println!("  {}", f.display());
            }
        }
        OutputFormat::Json | OutputFormat::StreamJson => {
            let result = serde_json::json!({
                "type": "result",
                "files": outcome.files_written.iter().map(|p| p.display().to_string()).collect::<Vec<_>>(),
                "turns": outcome.turns,
                "tokens_in": outcome.tokens_in,
                "tokens_out": outcome.tokens_out,
                "credits": outcome.tokens_in + 5 * outcome.tokens_out,
                "final_text": outcome.final_text,
                "halted": outcome.halted,
                "hit_turn_cap": outcome.hit_turn_cap,
            });
            // `json` pretty-prints; `stream-json` emits a single compact line.
            let line = if format == OutputFormat::Json {
                serde_json::to_string_pretty(&result)
            } else {
                serde_json::to_string(&result)
            }
            .context("serialize result")?;
            println!("{line}");
        }
    }

    Ok(if outcome.hit_turn_cap { 2 } else { 0 })
}

/// Default `eri build`: the metered, client-side agentic loop. Inference goes
/// through `/api/v1/inference/messages` (billed against the plan); tools run
/// locally and materialize real files. Multi-file builds work because tools
/// execute on disk here, not in a server relay.
async fn run_build_metered(
    prompt: &str,
    deploy: bool,
    output: &Path,
    model: &str,
    flags: LoopFlags,
) -> anyhow::Result<()> {
    let workspace = output
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    // Honor the same loop-capability flags as headless (permission/style/sandbox)
    // plus the per-tier context window — assembled in one place.
    let opts = build_agent::LoopOpts::for_run(flags.style, flags.sandbox, flags.permission, true);
    let outcome = build_agent::run_headless(prompt, &workspace, model, &opts).await?;
    println!(
        "\n[eri] {} file(s) in {} turn(s) -- {} in / {} out tokens (metered)",
        outcome.files_written.len(),
        outcome.turns,
        outcome.tokens_in,
        outcome.tokens_out
    );
    for f in &outcome.files_written {
        println!("  {}", f.display());
    }
    // Stopped early (quota / capacity): files are saved, but the build isn't
    // complete -- don't deploy a partial result.
    if outcome.halted.is_some() {
        return Ok(());
    }
    if deploy {
        let url = deploy_to_vercel(&workspace).map_err(anyhow::Error::from)?;
        println!("deployed: {url}");
    }
    Ok(())
}

/// Default `eri iterate`: a surgical edit via the metered agentic loop. The
/// loop reads the target file and applies a str_replace (or rewrite) on disk,
/// billed through `/api/v1/inference/messages`. (A cheaper Mercury turn-metered
/// lane via `/api/v1/inference/iterate` is a future optimization.)
async fn run_iterate_metered(instruction: &str, file: &Path, model: &str) -> anyhow::Result<()> {
    let instruction = instruction.trim();
    if instruction.is_empty() {
        anyhow::bail!("iterate instruction is empty");
    }
    if !file.exists() {
        anyhow::bail!("{} does not exist -- run `eri build` first", file.display());
    }
    let workspace = file
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    let name = file
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| file.display().to_string());
    let prompt = format!(
        "Make this change to the existing file `{name}` in the workspace: {instruction}\n\n\
         Read `{name}` first, then apply a surgical edit with str_replace (or rewrite it \
         with write_file if the change is large). Do not create new files unless strictly \
         necessary. Call done when finished."
    );
    let outcome = build_agent::run_build_agent(&prompt, &workspace, model).await?;
    println!(
        "\n[eri] iterate: {} file(s) touched in {} turn(s) -- {} in / {} out tokens (metered)",
        outcome.files_written.len(),
        outcome.turns,
        outcome.tokens_in,
        outcome.tokens_out
    );
    Ok(())
}

/// `eri plan -i`: open the interactive planner, then offer to hand the agreed
/// plan + the user's decisions straight to the build loop.
async fn run_plan_interactive(goal: &str) -> anyhow::Result<()> {
    let Some(build_prompt) = agent::plan_interactive(goal).await? else {
        println!("[eri] plan discarded.");
        return Ok(());
    };

    // Approved. Offer the handoff explicitly — a `plan` shouldn't silently
    // start spending on a build.
    print!("[eri] Build this plan now? [y/N] ");
    io::Write::flush(&mut io::stdout())?;
    let mut answer = String::new();
    io::stdin().read_line(&mut answer)?;
    if !matches!(answer.trim().to_ascii_lowercase().as_str(), "y" | "yes") {
        println!("[eri] plan approved but not built. Run `eri build` when ready.");
        return Ok(());
    }

    let workspace = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let model = model_for_mode(resolve_mode(None, &workspace));
    let outcome = build_agent::run_build_agent(&build_prompt, &workspace, model).await?;
    println!(
        "\n[eri] build: {} file(s) in {} turn(s) -- {} in / {} out tokens",
        outcome.files_written.len(),
        outcome.turns,
        outcome.tokens_in,
        outcome.tokens_out
    );
    Ok(())
}

/// `eri control`: hands-free computer control toward a goal. Defaults to a
/// SAFE dry-run (shows the planned actions, actuates nothing); `--live` is
/// reserved for once the macOS control bridge is granted (next increment).
/// `eri apps` — manage the per-app control denylist. With no args (or `list`),
/// print the denied apps; `deny <app>` adds one; `allow <app>` removes one.
/// Persists to the same store as control permissions. Local-only, no network.
/// Enforcement lives in the control gate (a denied app is refused before any
/// open/quit), so this command is the user's switch for that boundary.
fn run_apps(action: &[String]) -> anyhow::Result<()> {
    let Some(path) = control_safety::PermissionStore::default_path() else {
        anyhow::bail!("could not resolve the eri config directory");
    };
    let mut store = control_safety::PermissionStore::load(&path);

    let verb = action.first().map(|s| s.to_ascii_lowercase());
    let rest = action.get(1..).map(|r| r.join(" ")).unwrap_or_default();
    let rest = rest.trim();

    match verb.as_deref() {
        None | Some("list") | Some("ls") => {
            let apps: Vec<&String> = store.denied_apps().collect();
            if apps.is_empty() {
                println!("[eri] no apps are off-limits — eri may look at and control any app.");
                println!("      add one with:  eri apps deny <app>   (e.g. eri apps deny Discord)");
            } else {
                println!("[eri] off-limits apps (eri won't open, quit, or touch these):");
                for a in apps {
                    println!("  · {a}");
                }
            }
        }
        Some("deny") | Some("block") => {
            if rest.is_empty() {
                anyhow::bail!("which app? e.g. eri apps deny Discord");
            }
            store.deny_app(rest);
            store.save(&path)?;
            println!("[eri] off-limits: I won't open, quit, or touch {rest}.");
        }
        Some("allow") | Some("unblock") => {
            if rest.is_empty() {
                anyhow::bail!("which app? e.g. eri apps allow Discord");
            }
            if store.allow_app(rest) {
                store.save(&path)?;
                println!("[eri] {rest} is allowed again.");
            } else {
                println!("[eri] {rest} wasn't on the denylist.");
            }
        }
        Some(other) => {
            anyhow::bail!(
                "unknown action {other:?}. use:  eri apps [list | deny <app> | allow <app>]"
            );
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)] // CLI flag handler: each arg is a distinct `eri control` flag.
async fn run_control(
    goal: &str,
    live: bool,
    yes: bool,
    mode: Option<Mode>,
    undo: bool,
    history: bool,
    suggest: bool,
    spoken: bool,
) -> anyhow::Result<()> {
    // Trust layer: "what did eri do?" and undo, both read the persisted trail.
    let log_path = action_log::default_log_path();
    if suggest {
        let log = log_path
            .as_ref()
            .map(|p| action_log::ActionLog::load(p))
            .unwrap_or_default();
        let history = log.descriptions();
        let current = history.last().map(String::as_str);
        match proactive::proactive_suggestion(&history, current) {
            Some(s) => println!(
                "[eri] want me to {}? ({} — {:.0}% sure)",
                s.action,
                s.reason,
                s.confidence * 100.0
            ),
            None => println!("[eri] nothing to suggest yet — I learn your patterns as you go."),
        }
        return Ok(());
    }
    if history {
        let log = log_path
            .as_ref()
            .map(|p| action_log::ActionLog::load(p))
            .unwrap_or_default();
        if log.is_empty() {
            println!("[eri] no recorded actions yet.");
        } else {
            println!("[eri] what eri did:");
            for line in log.trail() {
                println!("  {line}");
            }
        }
        return Ok(());
    }
    if undo {
        return run_control_undo(live, log_path.as_deref()).await;
    }
    if goal.trim().is_empty() {
        anyhow::bail!("control needs a goal, e.g. eri control \"open YouTube and search lofi\"");
    }
    let workspace = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let model = model_for_mode(resolve_mode(mode, &workspace));
    // Honor any permissions the user has already granted ("you can do this next
    // time") so eri doesn't re-ask for categories they've blessed. Refusals are
    // never in this store — they can't be granted away.
    let permissions = control_safety::PermissionStore::default_path()
        .map(|p| control_safety::PermissionStore::load(&p))
        .unwrap_or_default();
    if !permissions.is_empty() {
        let labels: Vec<&str> = permissions.granted().map(|p| p.label()).collect();
        println!("[eri] granted permissions: {}", labels.join(", "));
    }
    let gate = control_agent::ControlGate::with_permissions(yes, permissions);
    // Confirm prompt with a Claude-style "allow always" option: y = once,
    // a = always (persist the grant so eri won't re-ask next time), N = no.
    // "always" is only offered when the action maps to a grantable permission;
    // sensitive refusals never reach here, so they can't be granted away.
    let mut confirm = |desc: &str, perm: Option<control_safety::Permission>| -> bool {
        let prompt = if perm.is_some() {
            format!("[eri] confirm: {desc}? [y]es once / [a]lways / [N]o ")
        } else {
            format!("[eri] confirm: {desc}? [y/N] ")
        };
        print!("{prompt}");
        let _ = io::Write::flush(&mut io::stdout());
        let mut s = String::new();
        if io::stdin().read_line(&mut s).is_err() {
            return false;
        }
        match s.trim().to_ascii_lowercase().as_str() {
            "y" | "yes" => true,
            "a" | "always" => {
                if let Some(p) = perm
                    && let Some(path) = control_safety::PermissionStore::default_path()
                {
                    let mut store = control_safety::PermissionStore::load(&path);
                    store.grant(p);
                    match store.save(&path) {
                        Ok(()) => println!("[eri] remembered: I can {} from now on.", p.label()),
                        Err(e) => eprintln!("[eri] could not save permission: {e}"),
                    }
                }
                true
            }
            _ => false,
        }
    };

    // Live actuation needs the macOS app's control endpoint (it does the real
    // AX/CGEvent work). Standalone `--live` can't actuate, so it falls back to
    // dry-run with a clear note rather than silently doing nothing.
    // Trust layer: load the running trail and wrap whatever bridge we use in a
    // LoggingBridge so every actuation is recorded for --history / --undo.
    let log = std::sync::Arc::new(std::sync::Mutex::new(
        log_path
            .as_ref()
            .map(|p| action_log::ActionLog::load(p))
            .unwrap_or_default(),
    ));
    // Credential vault (P0): saved-login autofill that never exposes the secret.
    // Metadata sits next to the permission file; secrets live in the Keychain;
    // fills are audited into the SAME `log` so they show in `--history`. With no
    // saved entry (the common case today) every `fill_credential` hands back, so
    // nothing changes until the user saves a login.
    let gate = {
        let vault = credential_vault::default_metadata_path()
            .and_then(|path| credential_vault::open_vault(&path, std::sync::Arc::clone(&log)));
        gate.with_vault(vault)
    };
    let live_bridge = if live {
        control_agent::HttpBridge::from_env()
    } else {
        None
    };
    let actuated = live_bridge.is_some();
    let summary = if let Some(inner) = live_bridge {
        println!("[eri] live control: actuating via the eri app.\n");
        let bridge = control_agent::LoggingBridge::new(&inner, std::sync::Arc::clone(&log));
        control_agent::run_control_agent(goal, model, &bridge, &gate, &mut confirm, 24)
            .await?
            .text
    } else {
        if live {
            println!(
                "[eri] --live needs the eri app's control bridge (ERI_CONTROL_ENDPOINT). \
                 Launch control from the app to actuate; showing a dry-run here.\n"
            );
        } else {
            println!(
                "[eri] dry-run: planning actions only (no actuation). Use --live from the eri app to actuate.\n"
            );
        }
        let inner = control_agent::DryRunBridge;
        let bridge = control_agent::LoggingBridge::new(&inner, std::sync::Arc::clone(&log));
        control_agent::run_control_agent(goal, model, &bridge, &gate, &mut confirm, 24)
            .await?
            .text
    };
    // Persist only REAL actions (dry-run "would do" must not become undoable).
    if actuated && let Some(p) = &log_path {
        let recorded = log.lock().map(|l| l.len()).unwrap_or(0);
        if let Ok(l) = log.lock() {
            let _ = l.save(p);
        }
        if recorded > 0 {
            println!(
                "[eri] (recorded {recorded} action(s) — `eri control --history` to review, `--undo` to reverse)"
            );
        }
    }
    if !summary.trim().is_empty() {
        // `[eri-result]` is a marker line: the app switches to "answer mode" and
        // renders everything after it (until end) as eri's final reply — distinct
        // from the [eri-status] chips that streamed during the run.
        println!("\n[eri-result]");
        if actuated {
            println!("{summary}");
        } else {
            // Dry-run actuated nothing — never present the model's summary as if
            // the work was done. Frame it as the plan it actually is.
            println!("dry-run — nothing was actuated. This is what eri would do:\n{summary}");
        }
        // Hands-free: emit a short, TTS-ready line the app speaks back.
        if spoken {
            println!("[eri:speak] {}", voice_control::spoken_reply(&summary));
        }
    }
    Ok(())
}

/// `eri voice "<transcript>"`: drive eri hands-free from recognized speech. The
/// macOS app's speech recognizer pipes transcripts here; this classifies the
/// utterance (wake / stop / command / noise) and acts — speaking a short reply
/// for the Control path.
async fn run_voice(transcript: &str, live: bool, yes: bool) -> anyhow::Result<()> {
    match voice_control::classify_utterance(transcript) {
        voice_control::VoiceIntent::Wake => {
            println!("[eri] listening — what would you like?");
            println!("[eri:speak] I'm listening.");
        }
        voice_control::VoiceIntent::Stop => {
            println!("[eri] okay, stopped.");
            println!("[eri:speak] Okay, stopped.");
        }
        voice_control::VoiceIntent::Ignore(reason) => {
            // Heard noise, not a command — stay quiet (just a log line).
            println!("[eri] (ignored speech: {reason})");
        }
        voice_control::VoiceIntent::Control(goal) => {
            println!("[eri] heard: {goal:?}");
            run_control(&goal, live, yes, None, false, false, false, true).await?;
        }
    }
    Ok(())
}

/// `eri control --undo`: reverse eri's most recent reversible action. Honest by
/// design — typing/clicking can't be auto-undone, so eri hands those back rather
/// than faking it. The undone mark is only persisted if the inverse actually
/// actuates (live), so a dry-run preview leaves the trail intact.
async fn run_control_undo(live: bool, log_path: Option<&std::path::Path>) -> anyhow::Result<()> {
    let Some(path) = log_path else {
        anyhow::bail!("no data directory for the action log");
    };
    let mut log = action_log::ActionLog::load(path);
    match log.undo_last() {
        action_log::UndoOutcome::Nothing => {
            println!("[eri] nothing to undo.");
        }
        action_log::UndoOutcome::CantUndo(msg) => {
            println!("[eri] {msg}");
        }
        action_log::UndoOutcome::Undo(inverse, desc) => {
            let bridge = if live {
                control_agent::HttpBridge::from_env()
            } else {
                None
            };
            if let Some(bridge) = bridge {
                // The user typed --undo, so auto-confirm the inverse (it may be a
                // gated action like quitting an app eri opened).
                let gate = control_agent::ControlGate::with_permissions(true, Default::default());
                match gate.submit(&bridge, &inverse).await? {
                    control_agent::Disposition::Executed(result) => {
                        println!("[eri] undid: {desc} → {result}");
                        let _ = log.save(path); // persist the undone mark
                        // P8 Meta-Policy Reflexion: if the user keeps undoing the
                        // same action, learn to ASK before it next time (persist a
                        // caution the gate consults). Reflect over the trail's
                        // outcomes; 2 undos of one action is enough signal.
                        if let Some(perm_path) = control_safety::PermissionStore::default_path() {
                            let mut perms = control_safety::PermissionStore::load(&perm_path);
                            if perms.absorb_cautions(log.cautioned_patterns(2)) > 0 {
                                let _ = perms.save(&perm_path);
                                println!(
                                    "[eri] noted — I'll check with you before \"{desc}\" next time."
                                );
                            }
                        }
                        // P3 Slice 3a: undo is the strongest negative signal. Fold
                        // it into the one outcome stream, then propose RAISING the
                        // confidence floor for this pattern — gated by sia::accept
                        // (earns its keep + the canonical refusal re-check), applied
                        // user-scoped + reversible. sia can only tighten: the floor
                        // rises (asks more), never loosens.
                        {
                            use crate::control_turn::ControlTurnSink as _;
                            let user_id = config::load().ok().and_then(|c| c.user_id);
                            let sink = control_turn::MemorySink::new(user_id.clone());
                            sink.record_outcome(&control_turn::Outcome {
                                action: desc.clone(),
                                disposition: control_turn::OutcomeKind::Undone,
                            });
                            let proposal = sia::Proposal::RaiseFloor {
                                pattern: desc.clone(),
                            };
                            if let sia::Verdict::Accept(prov) =
                                sia::accept(&proposal, log.undone_count(&desc))
                            {
                                let mut policy = sia::LiveRefinablePolicy::new(user_id.clone());
                                sia::apply(&mut policy, &proposal, &prov);
                                println!(
                                    "[eri] learning: I'll be more careful before \"{desc}\" (floor raised)."
                                );
                            }
                            // Close the loop (Slice 3b): re-measure the active
                            // floors against the trail — keep the ones that reduced
                            // repeat undos, revert (bi-temporal supersede) the ones
                            // that didn't. A floor ALSO covered by a caution is
                            // confounded and left untouched, so calibration never
                            // credits the floor for the caution's work.
                            let perms = control_safety::PermissionStore::default_path()
                                .map(|p| control_safety::PermissionStore::load(&p))
                                .unwrap_or_default();
                            let reverted = sia::calibrate_floors(
                                user_id.as_deref(),
                                |p| log.undone_count(p),
                                |p| perms.is_cautioned(p),
                            );
                            if reverted > 0 {
                                println!(
                                    "[eri] re-checked my learning — reverted {reverted} floor(s) that weren't helping."
                                );
                            }
                        }
                    }
                    other => {
                        println!("[eri] couldn't complete the undo ({other:?}); trail unchanged.");
                    }
                }
            } else {
                // Dry-run: show what we'd reverse, but DON'T save → trail intact.
                println!(
                    "[eri] would undo: {desc} (the inverse is {}). Run `eri control --undo --live` \
                     from the eri app to actuate.",
                    inverse.describe()
                );
            }
        }
    }
    Ok(())
}

/// `eri watch`: ambient awareness preview. Polls the control bridge's cheap AX
/// snapshot on a cadence and narrates meaningful changes — local + token-frugal
/// (no model calls; pixels only when the policy escalates, which this preview
/// doesn't do). Needs the eri app's control bridge.
async fn run_watch(seconds: u64) -> anyhow::Result<()> {
    use crate::control_agent::ControlBridge;
    let Some(bridge) = control_agent::HttpBridge::from_env() else {
        anyhow::bail!(
            "ambient awareness needs the control bridge (ERI_CONTROL_ENDPOINT) — launch `watch` from the eri app."
        );
    };
    let mut aware = awareness::Awareness::new(2_000, 8);
    let started = std::time::Instant::now();
    println!("[eri] watching the screen locally (token-frugal; Ctrl-C to stop).");
    loop {
        if seconds > 0 && started.elapsed().as_secs() >= seconds {
            break;
        }
        match bridge.snapshot().await {
            Ok(graph) => {
                let now_ms = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);
                let observed = aware.observe(&graph, now_ms);
                if observed.note_updated
                    && let Some(note) = aware.latest()
                {
                    println!("[eri] {note}");
                }
            }
            Err(e) => eprintln!("[eri] snapshot error: {e}"),
        }
        tokio::time::sleep(std::time::Duration::from_millis(800)).await;
    }
    println!("[eri] watched {} situation(s).", aware.note_count());
    // The fenced ambient context (what eri would inject into chat/control).
    if let Some(context) = aware.context_note() {
        println!("\n{context}");
    }
    Ok(())
}

fn run_scaffold(slug: &str, output: &Path) -> Result<(), CliError> {
    let template = template_by_slug(slug).ok_or_else(|| {
        CliError::User(format!(
            "no template named {slug:?}. Run `eri list-templates` to see options."
        ))
    })?;
    write_file(output, template.html)?;
    println!(
        "scaffolded {} ({}) -> {} ({} bytes)",
        template.slug,
        template.name,
        output.display(),
        template.html.len()
    );
    Ok(())
}

fn run_deploy(dir: Option<&Path>) -> Result<(), CliError> {
    let cwd = PathBuf::from(".");
    let deploy_dir = dir.unwrap_or(&cwd);
    let url = deploy_to_vercel(deploy_dir).map_err(CliError::from)?;
    println!("deployed: {url}");
    Ok(())
}

fn print_templates() {
    let mut stdout = io::stdout().lock();
    for template in TEMPLATES {
        // Slug column is fixed width so the descriptions line up — most slugs
        // are <= 14 chars, and a small fixed pad reads better than dynamic
        // width that flickers between runs.
        let _ = writeln!(stdout, "{:<14}  {}", template.slug, template.name);
    }
}

fn write_file(path: &Path, content: &str) -> Result<(), CliError> {
    if let Some(parent) = path.parent()
        && !parent.as_os_str().is_empty()
        && !parent.exists()
    {
        std::fs::create_dir_all(parent)
            .map_err(|err| CliError::User(format!("mkdir {}: {err}", parent.display())))?;
    }
    std::fs::write(path, content)
        .map_err(|err| CliError::User(format!("write {}: {err}", path.display())))
}

/// CLI-facing error wrapper. The `Display` impl is what the user sees on
/// stderr, so messages stay short and actionable.
#[derive(Debug)]
pub enum CliError {
    /// User-facing input/IO problem the user can correct.
    User(String),
    /// Eri inference layer reported an error.
    Mercury(String),
}

impl std::fmt::Display for CliError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CliError::User(msg) => write!(f, "{msg}"),
            CliError::Mercury(msg) => write!(f, "eri: {msg}"),
        }
    }
}

impl std::error::Error for CliError {}

impl From<InferenceError> for CliError {
    fn from(err: InferenceError) -> Self {
        CliError::Mercury(err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::{CommandFactory, Parser};

    fn parsed_command(args: impl IntoIterator<Item = &'static str>) -> Command {
        Cli::parse_from(args)
            .command
            .expect("expected a parsed subcommand")
    }

    #[test]
    fn parses_no_subcommand_as_interactive_session() {
        let cli = Cli::parse_from(["eri"]);
        assert!(cli.command.is_none());
        assert!(cli.print.is_none());
        assert_eq!(cli.output_format, OutputFormat::Text);
    }

    #[test]
    fn parses_headless_print_with_format_and_cap() {
        let cli = Cli::parse_from([
            "eri",
            "-p",
            "build a CLI tool",
            "--output-format",
            "json",
            "--max-turns",
            "8",
            "--mode",
            "fast",
        ]);
        assert_eq!(cli.print.as_deref(), Some("build a CLI tool"));
        assert_eq!(cli.output_format, OutputFormat::Json);
        assert_eq!(cli.max_turns, Some(8));
        assert_eq!(cli.mode, Some(Mode::Fast));
    }

    #[test]
    fn print_flag_bare_means_read_stdin() {
        // `-p` with no value parses as Some("") -> the runner reads stdin.
        let cli = Cli::parse_from(["eri", "-p"]);
        assert_eq!(cli.print.as_deref(), Some(""));
    }

    #[test]
    fn parses_chat_continue_and_resume() {
        match parsed_command(["eri", "chat", "--continue", "--mode", "fast"]) {
            Command::Chat {
                continue_,
                resume,
                mode,
            } => {
                assert!(continue_);
                assert!(resume.is_none());
                assert_eq!(mode, Some(Mode::Fast));
            }
            other => panic!("expected Chat, got {other:?}"),
        }
        match parsed_command(["eri", "chat", "--resume", "s_abc"]) {
            Command::Chat {
                continue_, resume, ..
            } => {
                assert!(!continue_);
                assert_eq!(resume.as_deref(), Some("s_abc"));
            }
            other => panic!("expected Chat, got {other:?}"),
        }
    }

    #[test]
    fn parses_build_with_prompt_and_deploy() {
        match parsed_command(["eri", "build", "make me a coffee shop", "--deploy"]) {
            Command::Build {
                prompt,
                deploy,
                output,
                mode,
            } => {
                assert_eq!(prompt, "make me a coffee shop");
                assert!(deploy);
                assert_eq!(output, PathBuf::from(DEFAULT_OUTPUT_FILE));
                assert_eq!(mode, None, "no explicit --mode; resolved at dispatch");
            }
            other => panic!("expected Build, got {other:?}"),
        }
    }

    #[test]
    fn parses_build_default_output_when_not_provided() {
        match parsed_command(["eri", "build", "anything"]) {
            Command::Build { deploy, output, .. } => {
                assert!(!deploy);
                assert_eq!(output, PathBuf::from(DEFAULT_OUTPUT_FILE));
            }
            other => panic!("expected Build, got {other:?}"),
        }
    }

    #[test]
    fn parses_build_with_explicit_output_path() {
        match parsed_command([
            "eri",
            "build",
            "ship me a page",
            "--output",
            "dist/page.html",
        ]) {
            Command::Build { output, .. } => {
                assert_eq!(output, PathBuf::from("dist/page.html"));
            }
            other => panic!("expected Build, got {other:?}"),
        }
    }

    #[test]
    fn parses_iterate_with_default_file() {
        match parsed_command(["eri", "iterate", "make hero photo darker"]) {
            Command::Iterate {
                instruction,
                file,
                mode,
            } => {
                assert_eq!(instruction, "make hero photo darker");
                assert_eq!(file, PathBuf::from(DEFAULT_OUTPUT_FILE));
                assert_eq!(mode, None, "no explicit --mode; resolved at dispatch");
            }
            other => panic!("expected Iterate, got {other:?}"),
        }
    }

    #[test]
    fn parses_list_templates() {
        assert_eq!(
            parsed_command(["eri", "list-templates"]),
            Command::ListTemplates
        );
    }

    #[test]
    fn parses_scaffold_with_slug() {
        match parsed_command(["eri", "scaffold", "portfolio"]) {
            Command::Scaffold { slug, output } => {
                assert_eq!(slug, "portfolio");
                assert_eq!(output, PathBuf::from(DEFAULT_OUTPUT_FILE));
            }
            other => panic!("expected Scaffold, got {other:?}"),
        }
    }

    #[test]
    fn parses_ship_without_dir() {
        match parsed_command(["eri", "ship"]) {
            Command::Ship {
                dir,
                intent,
                output,
            } => {
                assert!(dir.is_none());
                assert!(intent.is_none());
                assert_eq!(output, agent::AgentOutputMode::Text);
            }
            other => panic!("expected Ship, got {other:?}"),
        }
    }

    #[test]
    fn parses_ship_with_dir() {
        match parsed_command(["eri", "ship", "--dir", "build/"]) {
            Command::Ship {
                dir,
                intent,
                output,
            } => {
                assert_eq!(dir, Some(PathBuf::from("build/")));
                assert!(intent.is_none());
                assert_eq!(output, agent::AgentOutputMode::Text);
            }
            other => panic!("expected Ship, got {other:?}"),
        }
    }

    #[test]
    fn parses_ship_with_intent_routes_to_tandem() {
        match parsed_command(["eri", "ship", "add stripe checkout"]) {
            Command::Ship {
                intent,
                dir,
                output,
            } => {
                assert_eq!(intent.as_deref(), Some("add stripe checkout"));
                assert!(dir.is_none());
                assert_eq!(output, agent::AgentOutputMode::Text);
            }
            other => panic!("expected Ship, got {other:?}"),
        }
    }

    #[test]
    fn parses_ship_with_artifact_output() {
        match parsed_command([
            "eri",
            "ship",
            "--output",
            "artifact-json",
            "add stripe checkout",
        ]) {
            Command::Ship {
                intent,
                dir,
                output,
            } => {
                assert_eq!(intent.as_deref(), Some("add stripe checkout"));
                assert!(dir.is_none());
                assert_eq!(output, agent::AgentOutputMode::ArtifactJson);
            }
            other => panic!("expected Ship, got {other:?}"),
        }
    }

    #[test]
    fn parses_plan_with_artifact_output() {
        match parsed_command(["eri", "plan", "--output", "artifact-json", "fix", "billing"]) {
            Command::Plan {
                prompt,
                output,
                interactive,
            } => {
                assert_eq!(prompt, vec!["fix", "billing"]);
                assert_eq!(output, agent::AgentOutputMode::ArtifactJson);
                assert!(!interactive);
            }
            other => panic!("expected Plan, got {other:?}"),
        }
    }

    #[test]
    fn parses_plan_interactive_flag() {
        match parsed_command(["eri", "plan", "-i", "build", "a", "thing"]) {
            Command::Plan { interactive, .. } => assert!(interactive),
            other => panic!("expected Plan, got {other:?}"),
        }
    }

    #[test]
    fn cli_help_does_not_expose_internal_engine_names() {
        let help = Cli::command().render_long_help().to_string();
        // Everything user-facing is "eri". No upstream vendor / model names may
        // leak into help text -- not the engines (Mercury / Inception), not the
        // frontier provider (Claude / Anthropic), not tier names (Sonnet /
        // Haiku / Opus), not wire ids (`claude-...`).
        for forbidden in [
            "Mercury",
            "MERCURY",
            "Inception",
            "model:",
            "Claude",
            "Anthropic",
            "Sonnet",
            "Haiku",
            "Opus",
            "claude-",
        ] {
            assert!(
                !help.contains(forbidden),
                "CLI help exposes forbidden engine/vendor term: {forbidden}"
            );
        }
    }

    #[test]
    fn generate_completions_emits_a_script() {
        for shell in [
            clap_complete::Shell::Bash,
            clap_complete::Shell::Zsh,
            clap_complete::Shell::Fish,
        ] {
            let mut buf: Vec<u8> = Vec::new();
            generate_completions(shell, &mut buf);
            let script = String::from_utf8(buf).unwrap();
            assert!(!script.is_empty(), "{shell} completion script is empty");
            // The script references the binary name and at least one subcommand.
            assert!(script.contains("eri"));
            assert!(
                script.contains("build") || script.contains("worktree"),
                "{shell} script should mention subcommands"
            );
        }
    }

    #[test]
    fn parses_recap_and_fork() {
        assert_eq!(
            parsed_command(["eri", "recap"]),
            Command::Recap { id: None }
        );
        assert_eq!(
            parsed_command(["eri", "recap", "s_abc"]),
            Command::Recap {
                id: Some("s_abc".into())
            }
        );
        assert_eq!(
            parsed_command(["eri", "fork", "s_abc"]),
            Command::Fork { id: "s_abc".into() }
        );
    }

    #[test]
    fn bare_prompt_routes_to_external_catch_all() {
        // `eri what is on my calendar` — no subcommand, no quotes — must be
        // captured as a free-text prompt, NOT error as an unknown subcommand.
        match parsed_command(["eri", "what", "is", "on", "my", "calendar"]) {
            Command::External(words) => {
                assert_eq!(words, vec!["what", "is", "on", "my", "calendar"]);
                assert_eq!(words.join(" "), "what is on my calendar");
            }
            other => panic!("expected External, got {other:?}"),
        }
    }

    #[test]
    fn bare_imperative_routes_to_external() {
        match parsed_command(["eri", "open", "Spotify", "and", "play", "jazz"]) {
            Command::External(words) => {
                assert_eq!(words.join(" "), "open Spotify and play jazz");
            }
            other => panic!("expected External, got {other:?}"),
        }
    }

    #[test]
    fn explicit_subcommands_override_the_catch_all() {
        // Known subcommands must still parse as themselves, not External.
        assert!(matches!(
            parsed_command(["eri", "build", "a site"]),
            Command::Build { .. }
        ));
        assert!(matches!(
            parsed_command(["eri", "control", "open Spotify"]),
            Command::Control { .. }
        ));
        assert!(matches!(
            parsed_command(["eri", "ask", "what is rust"]),
            Command::Ask { .. }
        ));
    }

    #[test]
    fn bare_eri_still_starts_interactive_session() {
        // The no-subcommand interactive path must be untouched by the catch-all.
        let cli = Cli::parse_from(["eri"]);
        assert!(cli.command.is_none());
    }

    #[test]
    fn parses_ask_subcommand() {
        match parsed_command(["eri", "ask", "what", "is", "tokio?"]) {
            Command::Ask { image, prompt } => {
                assert_eq!(prompt, vec!["what", "is", "tokio?"]);
                assert!(image.is_empty());
            }
            other => panic!("expected Ask, got {other:?}"),
        }
    }

    #[test]
    fn parses_ask_with_image_flag() {
        match parsed_command([
            "eri",
            "ask",
            "--image",
            "/tmp/shot.png",
            "what's on my screen",
        ]) {
            Command::Ask { image, prompt } => {
                assert_eq!(image, vec![PathBuf::from("/tmp/shot.png")]);
                assert_eq!(prompt, vec!["what's on my screen"]);
            }
            other => panic!("expected Ask, got {other:?}"),
        }
    }

    #[test]
    fn parses_ui_with_artifact_output() {
        match parsed_command([
            "eri",
            "ui",
            "--output",
            "artifact-json",
            "billing",
            "dashboard",
        ]) {
            Command::Ui {
                prompt,
                output,
                open,
            } => {
                assert_eq!(prompt, vec!["billing", "dashboard"]);
                assert_eq!(output, genui::GenUiOutputMode::ArtifactJson);
                assert!(!open);
            }
            other => panic!("expected Ui, got {other:?}"),
        }
    }

    #[test]
    fn parses_ui_open_flag() {
        match parsed_command(["eri", "ui", "--open", "billing", "dashboard"]) {
            Command::Ui { prompt, open, .. } => {
                assert_eq!(prompt, vec!["billing", "dashboard"]);
                assert!(open);
            }
            other => panic!("expected Ui, got {other:?}"),
        }
    }

    #[test]
    fn parses_memory_recall_with_limit() {
        match parsed_command(["eri", "memory", "recall", "blue", "--limit", "5"]) {
            Command::Memory(MemoryCommand::Recall { query, limit }) => {
                assert_eq!(query, "blue");
                assert_eq!(limit, 5);
            }
            other => panic!("expected Memory(Recall), got {other:?}"),
        }
    }

    #[test]
    fn parses_top_level_mcp_doctor_and_update() {
        assert_eq!(
            parsed_command(["eri", "mcp", "list"]),
            Command::Mcp(McpCommand::List)
        );
        assert_eq!(parsed_command(["eri", "doctor"]), Command::Doctor);
        match parsed_command([
            "eri",
            "update",
            "check",
            "--channel",
            "beta",
            "--output",
            "json",
        ]) {
            Command::Update(UpdateCommand::Check { channel, output }) => {
                assert_eq!(channel, update::UpdateChannel::Beta);
                assert_eq!(output, update::UpdateOutputMode::Json);
            }
            other => panic!("expected Update(Check), got {other:?}"),
        }
    }

    #[test]
    fn parses_auth_login() {
        assert_eq!(
            parsed_command(["eri", "auth", "login"]),
            Command::Auth(AuthCommand::Login)
        );
    }

    #[test]
    fn scaffold_writes_template_to_disk() {
        let dir = std::env::temp_dir().join(format!("eri-cli-scaffold-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("mkdir tempdir");
        let output = dir.join("index.html");
        run_scaffold("portfolio", &output).expect("scaffold ok");
        let content = std::fs::read_to_string(&output).expect("read output");
        assert!(content.contains("<!DOCTYPE html>") || content.contains("<!doctype html>"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn scaffold_unknown_slug_errors() {
        let dir = std::env::temp_dir().join(format!("eri-cli-bad-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("mkdir tempdir");
        let output = dir.join("index.html");
        let err = run_scaffold("this-template-does-not-exist", &output)
            .expect_err("should reject unknown slug");
        assert!(matches!(err, CliError::User(_)));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn version_constant_matches_cargo_manifest() {
        // Sanity check: the version we surface via `eri --version` is the one
        // from Cargo.toml, not a hand-typed constant that can drift.
        assert!(!ERI_CLI_VERSION.is_empty());
        assert!(ERI_CLI_VERSION.chars().next().unwrap().is_ascii_digit());
    }
}
