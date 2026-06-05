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

use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::Instant;

use anyhow::Context as _;
use clap::{Parser, Subcommand};
use eri_core::{IterEvent, PromptCtx};
use eri_inference::{
    InferenceBackend, InferenceError, IterationRequest, MercuryBackend, MercuryConfig, TEMPLATES,
    costs, deploy_to_vercel, extract_partial_html_body, template_by_slug,
};

mod admin;
mod agent;
mod agent_cmd;
mod auth;
mod build_agent;
mod chat;
mod checkpoint;
mod client;
mod commands;
mod config;
mod eri_config;
mod genui;
mod memory;
mod project;
mod repl;
mod search;
mod session;
mod skills;
mod update;

const ERI_CLI_VERSION: &str = env!("CARGO_PKG_VERSION");
const DEFAULT_OUTPUT_FILE: &str = "index.html";
const DEFAULT_DENOISING_STEPS: u32 = 12;
/// `iterate` requires a current draft to operate on. `12` mirrors the GUI's
/// default iteration budget when no explicit budget is set.
const ITERATE_DENOISING_STEPS: u32 = 12;

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
    /// Permission posture: plan (read-only) | accept-edits (default, writes, no
    /// shell) | workspace-write (writes + shell) | bypass. When set, this is the
    /// source of truth and overrides --plan / --allow-shell.
    #[arg(long, value_enum, value_name = "MODE")]
    pub permission_mode: Option<PermissionModeArg>,
    #[command(subcommand)]
    pub command: Option<Command>,
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
        /// The question to ask.
        prompt: Vec<String>,
    },
    /// Generate a step-by-step plan for a goal (Architect persona).
    Plan {
        /// Render the agent event stream as plain text or artifact JSON.
        #[arg(long, value_enum, default_value_t = agent::AgentOutputMode::Text)]
        output: agent::AgentOutputMode,
        /// The goal to plan.
        prompt: Vec<String>,
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
    /// Show the resolved .eri/config.toml defaults for this directory.
    Config,
    /// List SKILL.md skills eri can run (project + global, any agent CLI).
    Skills,
    /// Inspect local setup for auth, agents, MCP, and workflow files.
    Doctor,
    /// Show the active sign-in + tier + remaining quota. Alias of
    /// `eri auth status`.
    Status,
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
    /// Drop an observation by id, or "all" to clear everything.
    Forget { target: String },
}

#[derive(Subcommand, Debug, PartialEq, Eq)]
pub enum McpCommand {
    /// Show configured local MCP servers.
    List,
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

fn main() -> ExitCode {
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
        )) {
            Ok(code) => ExitCode::from(code),
            Err(error) => {
                eprintln!("error: {error}");
                ExitCode::FAILURE
            }
        };
    }
    match rt.block_on(dispatch(cli.command)) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("error: {error}");
            ExitCode::FAILURE
        }
    }
}

async fn dispatch(command: Option<Command>) -> anyhow::Result<()> {
    let Some(command) = command else {
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
            run_build_metered(&prompt, deploy, &output, model_for_mode(m)).await
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
            chat::run(resume_mode, model_for_mode(m)).await
        }
        Command::Sessions => chat::list_sessions(),
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
                    )
                    .await
                }
            }
        }
        // -- new agent-mode commands (async) --
        Command::Ask { prompt } => agent::ask(&prompt.join(" ")).await,
        Command::Plan { prompt, output } => {
            agent::plan_with_output(&prompt.join(" "), output).await
        }
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
        Command::Memory(MemoryCommand::Recall { query, limit }) => {
            memory::recall(&query, limit).await
        }
        Command::Memory(MemoryCommand::Remember { text }) => memory::remember(&text).await,
        Command::Memory(MemoryCommand::Forget { target }) => memory::forget(&target).await,
        Command::Mcp(McpCommand::List) => repl::print_mcp_status(),
        Command::Update(UpdateCommand::Check { channel, output }) => {
            update::check(update::UpdateCheckOptions { channel, output }).await
        }
        Command::Init => run_init(),
        Command::Admin(AdminCommand::Usage { days, top }) => admin::usage(days, top).await,
        Command::Config => {
            run_config();
            Ok(())
        }
        Command::Skills => {
            skills::print_list(&skills::discover(&cwd()));
            Ok(())
        }
        Command::Doctor => repl::print_doctor(),
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

#[allow(dead_code)]
pub fn run(command: Command) -> Result<(), CliError> {
    // Legacy sync entry-point kept for tests + back-compat. New async
    // surface is `dispatch`.
    match command {
        Command::Build {
            prompt,
            deploy,
            output,
            mode: _,
        } => run_build(&prompt, deploy, &output),
        Command::Iterate {
            instruction,
            file,
            mode: _,
        } => run_iterate(&instruction, &file),
        Command::ListTemplates => {
            print_templates();
            Ok(())
        }
        Command::Scaffold { slug, output } => run_scaffold(&slug, &output),
        Command::Ship {
            intent: None, dir, ..
        } => run_deploy(dir.as_deref()),
        Command::Ship {
            intent: Some(_), ..
        }
        | Command::Chat { .. }
        | Command::Sessions
        | Command::Deploy { .. }
        | Command::Ask { .. }
        | Command::Plan { .. }
        | Command::Test { .. }
        | Command::Refactor { .. }
        | Command::Explain { .. }
        | Command::Sketch { .. }
        | Command::Ui { .. }
        | Command::Auth(_)
        | Command::Agent(_)
        | Command::Memory(_)
        | Command::Mcp(_)
        | Command::Update(_)
        | Command::Init
        | Command::Admin(_)
        | Command::Config
        | Command::Skills
        | Command::Doctor
        | Command::Status => Err(CliError::User(
            "agent-mode commands require the async dispatcher (`main`)".into(),
        )),
    }
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

    let mut opts = build_agent::LoopOpts {
        narrate: format == OutputFormat::Text,
        ..Default::default()
    };
    permission.apply(&mut opts);
    // --max-turns flag wins; else .eri/config.toml; else built-in default.
    if let Some(n) = max_turns.or_else(|| eri_config::load(&workspace).max_turns) {
        opts.max_turns = n.max(1);
    }

    let outcome = build_agent::run_headless(prompt.trim(), &workspace, model, &opts).await?;

    match format {
        OutputFormat::Text => {
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
) -> anyhow::Result<()> {
    let workspace = output
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    let outcome = build_agent::run_build_agent(prompt, &workspace, model).await?;
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

/// Legacy local build via the on-device Mercury backend. Unmetered — kept only
/// as a dev / BYOK fallback (needs a local `MERCURY_API_KEY`). Not the default
/// path; `run_build_metered` is.
#[allow(dead_code)]
fn run_build(prompt: &str, deploy: bool, output: &Path) -> Result<(), CliError> {
    let prompt = prompt.trim();
    if prompt.is_empty() {
        return Err(CliError::User("build prompt is empty".into()));
    }
    let backend = build_backend()?;

    let mut ctx = PromptCtx::default();
    ctx.commit_transcript_chunk(prompt);

    let request = IterationRequest::new(DEFAULT_DENOISING_STEPS, None);
    let IterationOutcome { final_html, usage } =
        stream_iteration(&backend, &ctx, request, "Generating")?;

    let final_html =
        final_html.ok_or_else(|| CliError::Mercury("Eri returned no HTML body".into()))?;

    write_file(output, &final_html)?;
    println!("wrote {} ({} bytes)", output.display(), final_html.len());
    print_usage_line(usage.as_ref());

    if deploy {
        let deploy_dir = output
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("."));
        let url = deploy_to_vercel(&deploy_dir).map_err(CliError::from)?;
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

/// Legacy local iterate via the on-device Mercury backend. Unmetered dev/BYOK
/// fallback; `run_iterate_metered` is the default.
#[allow(dead_code)]
fn run_iterate(instruction: &str, file: &Path) -> Result<(), CliError> {
    let instruction = instruction.trim();
    if instruction.is_empty() {
        return Err(CliError::User("iterate instruction is empty".into()));
    }
    let current_draft = std::fs::read_to_string(file)
        .map_err(|err| CliError::User(format!("cannot read {}: {err}", file.display())))?;
    if current_draft.trim().is_empty() {
        return Err(CliError::User(format!(
            "{} is empty — run `eri build` or `eri scaffold` first",
            file.display()
        )));
    }
    let backend = build_backend()?;

    let mut ctx = PromptCtx::default();
    ctx.commit_transcript_chunk(instruction);

    let request = IterationRequest::new(ITERATE_DENOISING_STEPS, Some(current_draft.clone()));
    let IterationOutcome { final_html, usage } =
        stream_iteration(&backend, &ctx, request, "Iterating")?;

    // For surgical iterations, the HTML body emerges from the partial-html
    // callback (the edit path applies edits to the existing draft). For fall-back
    // full-rewrites it emerges from the fenced response. If neither produced
    // anything (the file was already good), keep the original.
    let final_html = final_html.unwrap_or(current_draft);
    write_file(file, &final_html)?;
    println!("updated {} ({} bytes)", file.display(), final_html.len());
    print_usage_line(usage.as_ref());
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

fn build_backend() -> Result<MercuryBackend, CliError> {
    let config = MercuryConfig::from_env().ok_or_else(|| {
        CliError::User("build key not set — configure Eri inference and retry".into())
    })?;
    Ok(MercuryBackend::new(config))
}

struct IterationOutcome {
    final_html: Option<String>,
    usage: Option<UsageSummary>,
}

struct UsageSummary {
    model: String,
    prompt_tokens: u32,
    completion_tokens: u32,
    total_tokens: u32,
}

fn stream_iteration(
    backend: &MercuryBackend,
    ctx: &PromptCtx,
    request: IterationRequest,
    verb: &str,
) -> Result<IterationOutcome, CliError> {
    let mut progress = ProgressLine::new(verb);
    let mut accumulated_text = String::new();
    let mut latest_partial_html: Option<String> = None;
    let mut usage: Option<UsageSummary> = None;
    let mut error_message: Option<String> = None;
    let started = Instant::now();

    let result = {
        let mut on_event = |event: IterEvent| match event {
            IterEvent::DraftToken { text } => {
                accumulated_text.push_str(&text);
                progress.tick(accumulated_text.len(), started);
            }
            IterEvent::Usage {
                model,
                prompt_tokens,
                completion_tokens,
                total_tokens,
                ..
            } => {
                usage = Some(UsageSummary {
                    model,
                    prompt_tokens,
                    completion_tokens,
                    total_tokens,
                });
            }
            IterEvent::Error { message } => {
                error_message = Some(message);
            }
            IterEvent::Done
            | IterEvent::DenoisingStep { .. }
            | IterEvent::TargetClarification { .. }
            | IterEvent::CandidatePatch { .. }
            | IterEvent::CandidateAction { .. } => {}
        };
        let mut on_partial = |html: &str| {
            latest_partial_html = Some(html.to_string());
        };
        backend.iterate_stream(ctx, request, &mut on_event, &mut on_partial)
    };
    progress.finish();
    result.map_err(CliError::from)?;

    if let Some(message) = error_message {
        return Err(CliError::Mercury(message));
    }

    // Prefer the structured partial-html callback (already de-fenced) so the
    // chat path and the surgical path resolve to the same value. Fall back to
    // parsing the accumulated raw text for diff fences if the backend never
    // emitted a partial-html update (rare; happens when the response was a
    // tool-call-only surgical apply that materialized in one shot).
    let final_html = latest_partial_html.or_else(|| extract_partial_html_body(&accumulated_text));

    Ok(IterationOutcome { final_html, usage })
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

fn print_usage_line(usage: Option<&UsageSummary>) {
    let Some(usage) = usage else {
        return;
    };
    // The build and edit paths bill at different rates; choose the cost
    // function by route name so the dollar figure matches the dashboard.
    let dollars = if usage.model.contains("edit") {
        costs::mercury_edit_2_cost(usage.prompt_tokens, usage.completion_tokens)
    } else {
        costs::mercury_2_cost(usage.prompt_tokens, usage.completion_tokens)
    };
    println!(
        "tokens: prompt={} completion={} total={} ~${:.4}",
        usage.prompt_tokens, usage.completion_tokens, usage.total_tokens, dollars
    );
}

/// Single-line progress display. Uses `\r` to overwrite itself, then a final
/// newline on completion so subsequent log lines start on a fresh row.
struct ProgressLine {
    verb: String,
    // We only flush every ~5 ticks to keep the terminal from thrashing —
    // The build stream can emit hundreds of tiny chunks per second.
    tick_counter: u32,
    last_chars: usize,
    enabled: bool,
}

impl ProgressLine {
    fn new(verb: &str) -> Self {
        // Only animate when stderr is a TTY; otherwise (CI logs, pipes) we'd
        // emit a wall of `\r` garbage. Stderr because that's where the
        // progress line lives — stdout is reserved for the structured result
        // so it remains pipe-safe.
        let enabled = std::io::IsTerminal::is_terminal(&std::io::stderr());
        let initial = format!("{verb}…");
        if enabled {
            let mut stderr = io::stderr().lock();
            let _ = write!(stderr, "{initial}");
            let _ = stderr.flush();
        }
        Self {
            verb: verb.to_string(),
            tick_counter: 0,
            last_chars: 0,
            enabled,
        }
    }

    fn tick(&mut self, accumulated_chars: usize, started: Instant) {
        self.last_chars = accumulated_chars;
        self.tick_counter = self.tick_counter.wrapping_add(1);
        // Throttle: redraw at most every 5 chunks; hot streams otherwise peg
        // the terminal.
        if !self.enabled || !self.tick_counter.is_multiple_of(5) {
            return;
        }
        let elapsed = started.elapsed().as_secs_f32();
        let mut stderr = io::stderr().lock();
        let _ = write!(
            stderr,
            "\r{}… {} chars  {:.1}s   ",
            self.verb, accumulated_chars, elapsed
        );
        let _ = stderr.flush();
    }

    fn finish(&mut self) {
        if !self.enabled {
            return;
        }
        let mut stderr = io::stderr().lock();
        let _ = writeln!(
            stderr,
            "\r{} done — {} chars         ",
            self.verb, self.last_chars
        );
        let _ = stderr.flush();
    }
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
            Command::Plan { prompt, output } => {
                assert_eq!(prompt, vec!["fix", "billing"]);
                assert_eq!(output, agent::AgentOutputMode::ArtifactJson);
            }
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
    fn parses_ask_subcommand() {
        match parsed_command(["eri", "ask", "what", "is", "tokio?"]) {
            Command::Ask { prompt } => {
                assert_eq!(prompt, vec!["what", "is", "tokio?"]);
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
