//! Headless one-shot CLI for eri.
//!
//! Lets users drive Mercury 2 from a terminal without booting the IDE:
//!
//! ```text
//! eri build "make me a coffee shop and deploy it"
//! eri iterate "swap the hero photo for an espresso shot"
//! eri scaffold portfolio
//! eri ship
//! ```
//!
//! The CLI reuses `eri_inference` end-to-end — same env vars, same Mercury
//! backend, same Vercel deploy path, same cost telemetry — so behavior stays
//! identical to the GUI for the subset of flows it exposes. The only thing
//! the CLI does differently is render progress as a single `\r`-updated
//! status line on stdout instead of a panel.

use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::Instant;

use clap::{Parser, Subcommand};
use eri_core::{IterEvent, PromptCtx};
use eri_inference::{
    InferenceBackend, InferenceError, IterationRequest, MercuryBackend, MercuryConfig, TEMPLATES,
    costs, deploy_to_vercel, extract_partial_html_body, template_by_slug,
};

mod agent;
mod agent_cmd;
mod auth;
mod client;
mod config;
mod memory;

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
    about = "Headless eri — Mercury 2 from your terminal.",
    long_about = "One-shot CLI for eri. Build, iterate, scaffold from a template, \
                  and deploy a single self-contained HTML page using the same \
                  Mercury 2 backend the eri IDE uses."
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Command,
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
    },
    /// Apply a surgical edit to ./index.html based on an instruction.
    Iterate {
        /// What to change about the current file.
        instruction: String,
        /// Edit this file instead of ./index.html.
        #[arg(long, default_value = DEFAULT_OUTPUT_FILE)]
        file: PathBuf,
    },
    /// List every template slug eri can scaffold from.
    ListTemplates,
    /// Drop a template's HTML into ./index.html with no Mercury call.
    Scaffold {
        /// Slug from `eri list-templates` (e.g. `portfolio`, `coffee-shop`).
        slug: String,
        /// Write the template HTML here instead of ./index.html.
        #[arg(long, default_value = DEFAULT_OUTPUT_FILE)]
        output: PathBuf,
    },
    /// Deploy whatever's at ./index.html to Vercel (--prod --yes), OR
    /// run the agent's tandem ship pipeline when an intent is given.
    Ship {
        /// What to ship — when given, runs the tandem builder/checker.
        /// Empty → deploy ./index.html to Vercel (old behaviour).
        intent: Option<String>,
        /// Use this directory as the deploy root instead of the cwd
        /// (Vercel mode only).
        #[arg(long)]
        dir: Option<PathBuf>,
    },
    /// Deploy ./index.html to Vercel (--prod --yes). Same as
    /// `eri ship` without an intent.
    Deploy {
        #[arg(long)]
        dir: Option<PathBuf>,
    },
    /// Send a one-off question through eri's brain router.
    Ask {
        /// The question to ask.
        prompt: Vec<String>,
    },
    /// Generate a step-by-step plan for a goal (Architect persona).
    Plan {
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
    /// Mercury sketch — fast HTML draft from a description.
    Sketch {
        /// What to sketch.
        prompt: Vec<String>,
    },
    /// eri.dev authentication commands.
    #[command(subcommand)]
    Auth(AuthCommand),
    /// Persona / agent switcher mirrors the IDE's /agent slash command.
    #[command(subcommand)]
    Agent(AgentCommand),
    /// Memory — recall, remember, forget.
    #[command(subcommand)]
    Memory(MemoryCommand),
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
    match rt.block_on(dispatch(cli.command)) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("error: {error}");
            ExitCode::FAILURE
        }
    }
}

async fn dispatch(command: Command) -> anyhow::Result<()> {
    match command {
        // -- existing Mercury HTML commands (sync) --
        Command::Build {
            prompt,
            deploy,
            output,
        } => run_build(&prompt, deploy, &output).map_err(anyhow::Error::from),
        Command::Iterate { instruction, file } => {
            run_iterate(&instruction, &file).map_err(anyhow::Error::from)
        }
        Command::ListTemplates => {
            print_templates();
            Ok(())
        }
        Command::Scaffold { slug, output } => {
            run_scaffold(&slug, &output).map_err(anyhow::Error::from)
        }
        Command::Deploy { dir } => {
            run_deploy(dir.as_deref()).map_err(anyhow::Error::from)
        }
        Command::Ship { intent, dir } => {
            // `eri ship` with no args → legacy Vercel deploy. With an
            // intent → agent tandem ship.
            match intent {
                None => run_deploy(dir.as_deref()).map_err(anyhow::Error::from),
                Some(intent) => agent::ship(intent.trim()).await,
            }
        }
        // -- new agent-mode commands (async) --
        Command::Ask { prompt } => agent::ask(&prompt.join(" ")).await,
        Command::Plan { prompt } => agent::plan(&prompt.join(" ")).await,
        Command::Test { scope } => agent::test(&scope).await,
        Command::Refactor { scope } => agent::refactor(&scope).await,
        Command::Explain { target } => agent::explain(&target).await,
        Command::Sketch { prompt } => agent::sketch(&prompt.join(" ")).await,
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
    }
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
        } => run_build(&prompt, deploy, &output),
        Command::Iterate { instruction, file } => run_iterate(&instruction, &file),
        Command::ListTemplates => {
            print_templates();
            Ok(())
        }
        Command::Scaffold { slug, output } => run_scaffold(&slug, &output),
        Command::Ship { intent: None, dir } => run_deploy(dir.as_deref()),
        Command::Ship { intent: Some(_), .. }
        | Command::Deploy { .. }
        | Command::Ask { .. }
        | Command::Plan { .. }
        | Command::Test { .. }
        | Command::Refactor { .. }
        | Command::Explain { .. }
        | Command::Sketch { .. }
        | Command::Auth(_)
        | Command::Agent(_)
        | Command::Memory(_)
        | Command::Status => Err(CliError::User(
            "agent-mode commands require the async dispatcher (`main`)".into(),
        )),
    }
}

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
        final_html.ok_or_else(|| CliError::Mercury("Mercury returned no HTML body".into()))?;

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
    // callback (Mercury applies edits to the existing draft). For fall-back
    // full-rewrites it emerges from the fenced response. If neither produced
    // anything (Mercury said the file was already good), keep the original.
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
        CliError::User(
            "MERCURY_API_KEY not set — export it (or INCEPTION_API_KEY) and retry".into(),
        )
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
    // Mercury Edit 2 and Mercury 2 bill at different rates; choose the cost
    // function by model name so the dollar figure matches the dashboard.
    let dollars = if usage.model.contains("edit") {
        costs::mercury_edit_2_cost(usage.prompt_tokens, usage.completion_tokens)
    } else {
        costs::mercury_2_cost(usage.prompt_tokens, usage.completion_tokens)
    };
    println!(
        "tokens: prompt={} completion={} total={} (model={}) ~${:.4}",
        usage.prompt_tokens, usage.completion_tokens, usage.total_tokens, usage.model, dollars
    );
}

/// Single-line progress display. Uses `\r` to overwrite itself, then a final
/// newline on completion so subsequent log lines start on a fresh row.
struct ProgressLine {
    verb: String,
    // We only flush every ~5 ticks to keep the terminal from thrashing —
    // Mercury can emit hundreds of tiny chunks per second on a hot SSE stream.
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
        // Throttle: redraw at most every 5 chunks. Mercury emits tokens fast
        // enough that one redraw per chunk pegs a terminal at 30% CPU.
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
    /// Mercury / inference layer reported an error.
    Mercury(String),
}

impl std::fmt::Display for CliError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CliError::User(msg) => write!(f, "{msg}"),
            CliError::Mercury(msg) => write!(f, "mercury: {msg}"),
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
    use clap::Parser;

    #[test]
    fn parses_build_with_prompt_and_deploy() {
        let cli = Cli::parse_from(["eri", "build", "make me a coffee shop", "--deploy"]);
        match cli.command {
            Command::Build {
                prompt,
                deploy,
                output,
            } => {
                assert_eq!(prompt, "make me a coffee shop");
                assert!(deploy);
                assert_eq!(output, PathBuf::from(DEFAULT_OUTPUT_FILE));
            }
            other => panic!("expected Build, got {other:?}"),
        }
    }

    #[test]
    fn parses_build_default_output_when_not_provided() {
        let cli = Cli::parse_from(["eri", "build", "anything"]);
        match cli.command {
            Command::Build { deploy, output, .. } => {
                assert!(!deploy);
                assert_eq!(output, PathBuf::from(DEFAULT_OUTPUT_FILE));
            }
            other => panic!("expected Build, got {other:?}"),
        }
    }

    #[test]
    fn parses_build_with_explicit_output_path() {
        let cli = Cli::parse_from([
            "eri",
            "build",
            "ship me a page",
            "--output",
            "dist/page.html",
        ]);
        match cli.command {
            Command::Build { output, .. } => {
                assert_eq!(output, PathBuf::from("dist/page.html"));
            }
            other => panic!("expected Build, got {other:?}"),
        }
    }

    #[test]
    fn parses_iterate_with_default_file() {
        let cli = Cli::parse_from(["eri", "iterate", "make hero photo darker"]);
        match cli.command {
            Command::Iterate { instruction, file } => {
                assert_eq!(instruction, "make hero photo darker");
                assert_eq!(file, PathBuf::from(DEFAULT_OUTPUT_FILE));
            }
            other => panic!("expected Iterate, got {other:?}"),
        }
    }

    #[test]
    fn parses_list_templates() {
        let cli = Cli::parse_from(["eri", "list-templates"]);
        assert_eq!(cli.command, Command::ListTemplates);
    }

    #[test]
    fn parses_scaffold_with_slug() {
        let cli = Cli::parse_from(["eri", "scaffold", "portfolio"]);
        match cli.command {
            Command::Scaffold { slug, output } => {
                assert_eq!(slug, "portfolio");
                assert_eq!(output, PathBuf::from(DEFAULT_OUTPUT_FILE));
            }
            other => panic!("expected Scaffold, got {other:?}"),
        }
    }

    #[test]
    fn parses_ship_without_dir() {
        let cli = Cli::parse_from(["eri", "ship"]);
        match cli.command {
            Command::Ship { dir, intent } => {
                assert!(dir.is_none());
                assert!(intent.is_none());
            }
            other => panic!("expected Ship, got {other:?}"),
        }
    }

    #[test]
    fn parses_ship_with_dir() {
        let cli = Cli::parse_from(["eri", "ship", "--dir", "build/"]);
        match cli.command {
            Command::Ship { dir, intent } => {
                assert_eq!(dir, Some(PathBuf::from("build/")));
                assert!(intent.is_none());
            }
            other => panic!("expected Ship, got {other:?}"),
        }
    }

    #[test]
    fn parses_ship_with_intent_routes_to_tandem() {
        let cli = Cli::parse_from(["eri", "ship", "add stripe checkout"]);
        match cli.command {
            Command::Ship { intent, dir } => {
                assert_eq!(intent.as_deref(), Some("add stripe checkout"));
                assert!(dir.is_none());
            }
            other => panic!("expected Ship, got {other:?}"),
        }
    }

    #[test]
    fn parses_ask_subcommand() {
        let cli = Cli::parse_from(["eri", "ask", "what", "is", "tokio?"]);
        match cli.command {
            Command::Ask { prompt } => {
                assert_eq!(prompt, vec!["what", "is", "tokio?"]);
            }
            other => panic!("expected Ask, got {other:?}"),
        }
    }

    #[test]
    fn parses_memory_recall_with_limit() {
        let cli = Cli::parse_from(["eri", "memory", "recall", "blue", "--limit", "5"]);
        match cli.command {
            Command::Memory(MemoryCommand::Recall { query, limit }) => {
                assert_eq!(query, "blue");
                assert_eq!(limit, 5);
            }
            other => panic!("expected Memory(Recall), got {other:?}"),
        }
    }

    #[test]
    fn parses_auth_login() {
        let cli = Cli::parse_from(["eri", "auth", "login"]);
        assert_eq!(cli.command, Command::Auth(AuthCommand::Login));
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
