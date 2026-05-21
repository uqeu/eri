//! Discord bot front-end for eri. Listens for `@bot <prompt>` mentions and
//! `!eri <prompt>` shouts in any channel, runs a Mercury 2 build, deploys
//! the result to Vercel, and replies with the deployed URL.
//!
//! This binary is intentionally thin: the heavy lifting (Mercury streaming,
//! HTML extraction, Vercel CLI invocation) lives in `eri_inference`. The bot
//! is a Discord-flavored adapter on top of the same code path the CLI uses.

use std::{
    env,
    path::{Path, PathBuf},
    sync::Arc,
};

use anyhow::{Context as AnyhowContext, Result, anyhow};
use eri_core::{IterEvent, PromptCtx};
use eri_inference::{
    InferenceBackend, IterationRequest, MercuryBackend, MercuryConfig, TEMPLATES,
    costs::mercury_2_cost, deploy_to_vercel, extract_partial_html_body, template_by_slug,
};
use eri_iterator::RateLimiter;
use serenity::{
    all::{
        Command, CommandInteraction, CommandOptionType, CreateCommand, CreateCommandOption,
        CreateInteractionResponse, CreateInteractionResponseFollowup,
        CreateInteractionResponseMessage, EditMessage, Interaction, Message, Ready,
    },
    async_trait,
    client::{Client, Context as SerenityContext, EventHandler},
    prelude::GatewayIntents,
};
use tokio::sync::Semaphore;

mod parse;
use parse::{ParsedPrompt, parse_mention_prompt};

const DENOISING_STEPS: u32 = 24;
const MAX_CONCURRENT_BUILDS: usize = 4;
const BUILDS_DIR: &str = "./eri-discord-builds";

struct Handler {
    /// Caps how many concurrent Mercury builds we'll run, regardless of
    /// how many users hammer the bot at once. Each permit costs real money
    /// (Mercury 2 API + Vercel deploy quota), so unbounded spawning would
    /// be a wallet-bricking footgun.
    build_slots: Arc<Semaphore>,
    /// Per-user cooldown + daily count/$$ caps. The global semaphore above
    /// only protects against concurrent fan-out; the limiter is what stops
    /// a single user from queuing thousands of serial builds and running up
    /// the Mercury bill.
    rate_limiter: Arc<RateLimiter>,
}

impl Handler {
    fn new() -> Self {
        Self {
            build_slots: Arc::new(Semaphore::new(MAX_CONCURRENT_BUILDS)),
            rate_limiter: Arc::new(RateLimiter::from_env()),
        }
    }
}

/// Conservative pre-flight cost estimate used when gating a request. The real
/// Mercury bill is only known after the stream completes, so we charge the
/// limiter for what a long generation could cost (1.5k input tokens + 4k
/// output tokens at Mercury 2 rates ≈ $0.027). Wildly cheaper than reality
/// rarely matters; wildly more expensive would let bad actors slip past the
/// USD cap.
fn estimate_request_cost_usd(prompt: &str) -> f64 {
    let prompt_tokens = (prompt.len() / 4).clamp(256, 8_000) as u32;
    mercury_2_cost(prompt_tokens, 4_000)
}

#[async_trait]
impl EventHandler for Handler {
    async fn ready(&self, ctx: SerenityContext, ready: Ready) {
        log::info!("eri-discord ready as {}", ready.user.name);
        if let Err(error) = register_global_commands(&ctx).await {
            log::error!("failed to register slash commands: {error:#}");
        }
    }

    async fn message(&self, ctx: SerenityContext, msg: Message) {
        if msg.author.bot {
            return;
        }
        let bot_id = ctx.cache.current_user().id;
        let parsed = match parse_mention_prompt(&msg.content, bot_id.get()) {
            Some(parsed) => parsed,
            None => return,
        };

        let prompt = match parsed {
            ParsedPrompt::Build(prompt) => prompt,
            ParsedPrompt::Empty => {
                if let Err(error) = msg.reply(&ctx.http, "give me something to build — e.g. `@eri build me a coffee shop landing page`").await {
                    log::warn!("failed to reply empty-prompt: {error}");
                }
                return;
            }
        };

        let slots = self.build_slots.clone();
        let rate_limiter = self.rate_limiter.clone();
        let user_id = msg.author.id.get().to_string();
        let http = ctx.http.clone();
        let channel_id = msg.channel_id;
        let trigger_msg_id = msg.id;

        // Pre-flight rate-limit decision. We deny *before* burning a build
        // slot or making any expensive call.
        let decision = rate_limiter.check(&user_id, estimate_request_cost_usd(&prompt));
        if !decision.allow {
            if let Err(error) = msg
                .react(&ctx.http, serenity::all::ReactionType::Unicode("❌".to_string()))
                .await
            {
                log::warn!("failed to react with x: {error}");
            }
            if let Err(error) = msg.reply(&ctx.http, &decision.reason).await {
                log::warn!("failed to reply rate-limit deny: {error}");
            }
            return;
        }

        // React with the hammer to acknowledge the request before we start
        // shelling out to Mercury — this gives the user instant feedback that
        // the bot saw them, even if the build itself takes 10+ seconds.
        if let Err(error) = msg
            .react(&ctx.http, serenity::all::ReactionType::Unicode("🔨".to_string()))
            .await
        {
            log::warn!("failed to react with hammer: {error}");
        }

        tokio::spawn(async move {
            // Acquire concurrency permit before doing any expensive work. If
            // we're at the cap, the user's request queues here instead of
            // racing into Mercury.
            let _permit = match slots.acquire_owned().await {
                Ok(permit) => permit,
                Err(error) => {
                    log::error!("semaphore closed: {error}");
                    return;
                }
            };

            let mut status = match channel_id
                .say(&http, format!("building... `{}`", truncate_for_status(&prompt)))
                .await
            {
                Ok(message) => message,
                Err(error) => {
                    log::warn!("failed to post status message: {error}");
                    return;
                }
            };

            let outcome = run_build_and_deploy(&prompt, trigger_msg_id.get()).await;
            let body = match &outcome {
                Ok(success) => {
                    rate_limiter.record(&user_id, success.cost_usd);
                    format!("✅ done: {}", success.url)
                }
                Err(error) => format!("⚠️ build failed: {error}"),
            };

            if let Err(error) = status
                .edit(&http, EditMessage::new().content(body.clone()))
                .await
            {
                log::warn!("failed to edit status message ({error}); posting fresh reply");
                if let Err(send_error) = channel_id.say(&http, body).await {
                    log::error!("failed to post fallback reply: {send_error}");
                }
            }
        });
    }

    async fn interaction_create(&self, ctx: SerenityContext, interaction: Interaction) {
        let Interaction::Command(command) = interaction else {
            return;
        };
        if command.data.name != "eri" {
            return;
        }
        let slots = self.build_slots.clone();
        let rate_limiter = self.rate_limiter.clone();
        tokio::spawn(async move {
            if let Err(error) = dispatch_slash(&ctx, &command, slots, rate_limiter).await {
                log::warn!("slash command error: {error:#}");
                let _ = command
                    .create_followup(
                        &ctx.http,
                        CreateInteractionResponseFollowup::new()
                            .content(format!("⚠️ {error}")),
                    )
                    .await;
            }
        });
    }
}

async fn register_global_commands(ctx: &SerenityContext) -> Result<()> {
    let build_opt = CreateCommandOption::new(
        CommandOptionType::String,
        "prompt",
        "What should eri build?",
    )
    .required(true);
    let scaffold_opt = CreateCommandOption::new(
        CommandOptionType::String,
        "template",
        "Template slug (run /eri list-templates to see options)",
    )
    .required(true);
    let cmd = CreateCommand::new("eri")
        .description("Build a webpage with eri")
        .add_option(CreateCommandOption::new(
            CommandOptionType::SubCommand,
            "build",
            "Generate and deploy a new page from a natural-language prompt",
        ).add_sub_option(build_opt))
        .add_option(CreateCommandOption::new(
            CommandOptionType::SubCommand,
            "list-templates",
            "List the bundled template slugs",
        ))
        .add_option(CreateCommandOption::new(
            CommandOptionType::SubCommand,
            "scaffold",
            "Scaffold and deploy a built-in template by slug",
        ).add_sub_option(scaffold_opt));

    Command::create_global_command(&ctx.http, cmd)
        .await
        .context("registering /eri slash command")?;
    Ok(())
}

async fn dispatch_slash(
    ctx: &SerenityContext,
    command: &CommandInteraction,
    slots: Arc<Semaphore>,
    rate_limiter: Arc<RateLimiter>,
) -> Result<()> {
    let sub = command
        .data
        .options
        .first()
        .ok_or_else(|| anyhow!("no subcommand provided"))?;
    let user_id = command.user.id.get().to_string();

    match sub.name.as_str() {
        "list-templates" => {
            command
                .create_response(
                    &ctx.http,
                    CreateInteractionResponse::Message(
                        CreateInteractionResponseMessage::new()
                            .content(render_template_list()),
                    ),
                )
                .await
                .context("responding to list-templates")?;
            Ok(())
        }
        "build" => {
            let prompt = string_option(sub, "prompt")?;
            let decision = rate_limiter.check(&user_id, estimate_request_cost_usd(&prompt));
            if !decision.allow {
                command
                    .create_response(
                        &ctx.http,
                        CreateInteractionResponse::Message(
                            CreateInteractionResponseMessage::new()
                                .content(format!("❌ {}", decision.reason))
                                .ephemeral(true),
                        ),
                    )
                    .await
                    .context("responding to rate-limited build")?;
                return Ok(());
            }
            command
                .create_response(
                    &ctx.http,
                    CreateInteractionResponse::Defer(
                        CreateInteractionResponseMessage::new()
                            .content(format!("building... `{}`", truncate_for_status(&prompt))),
                    ),
                )
                .await
                .context("deferring build interaction")?;
            let _permit = slots.acquire_owned().await.context("semaphore closed")?;
            let result = run_build_and_deploy(&prompt, command.id.get()).await;
            let body = match &result {
                Ok(success) => {
                    rate_limiter.record(&user_id, success.cost_usd);
                    format!("✅ done: {}", success.url)
                }
                Err(error) => format!("⚠️ build failed: {error}"),
            };
            command
                .create_followup(
                    &ctx.http,
                    CreateInteractionResponseFollowup::new().content(body),
                )
                .await
                .context("posting build followup")?;
            Ok(())
        }
        "scaffold" => {
            let slug = string_option(sub, "template")?;
            // Scaffolds don't hit Mercury, but they still touch Vercel quota
            // and we want a consistent abuse story. Charge a tiny nominal
            // estimate so the per-user counters still tick.
            let decision = rate_limiter.check(&user_id, 0.0);
            if !decision.allow {
                command
                    .create_response(
                        &ctx.http,
                        CreateInteractionResponse::Message(
                            CreateInteractionResponseMessage::new()
                                .content(format!("❌ {}", decision.reason))
                                .ephemeral(true),
                        ),
                    )
                    .await
                    .context("responding to rate-limited scaffold")?;
                return Ok(());
            }
            command
                .create_response(
                    &ctx.http,
                    CreateInteractionResponse::Defer(
                        CreateInteractionResponseMessage::new()
                            .content(format!("scaffolding `{slug}`...")),
                    ),
                )
                .await
                .context("deferring scaffold interaction")?;
            let _permit = slots.acquire_owned().await.context("semaphore closed")?;
            let result = scaffold_and_deploy(&slug, command.id.get()).await;
            let body = match &result {
                Ok(url) => {
                    rate_limiter.record(&user_id, 0.0);
                    format!("✅ deployed `{slug}`: {url}")
                }
                Err(error) => format!("⚠️ scaffold failed: {error}"),
            };
            command
                .create_followup(
                    &ctx.http,
                    CreateInteractionResponseFollowup::new().content(body),
                )
                .await
                .context("posting scaffold followup")?;
            Ok(())
        }
        other => Err(anyhow!("unknown subcommand: {other}")),
    }
}

fn string_option(
    sub: &serenity::all::CommandDataOption,
    name: &str,
) -> Result<String> {
    let options = match &sub.value {
        serenity::all::CommandDataOptionValue::SubCommand(opts) => opts,
        _ => return Err(anyhow!("subcommand `{}` had unexpected shape", sub.name)),
    };
    let opt = options
        .iter()
        .find(|opt| opt.name == name)
        .ok_or_else(|| anyhow!("missing `{name}` option"))?;
    match &opt.value {
        serenity::all::CommandDataOptionValue::String(s) => Ok(s.clone()),
        _ => Err(anyhow!("`{name}` must be a string")),
    }
}

fn render_template_list() -> String {
    let mut buffer = String::from("**Templates** (use `/eri scaffold <slug>`):\n");
    for template in TEMPLATES {
        buffer.push_str(&format!("• `{}` — {}\n", template.slug, template.name));
    }
    buffer
}

/// Snip a status string so a one-paragraph prompt doesn't blow past Discord's
/// 2000-char message limit when we echo it in a holding message.
fn truncate_for_status(text: &str) -> String {
    const LIMIT: usize = 80;
    let trimmed = text.trim();
    if trimmed.chars().count() <= LIMIT {
        return trimmed.to_string();
    }
    let mut out: String = trimmed.chars().take(LIMIT).collect();
    out.push('…');
    out
}

/// Outcome of a successful build + deploy. Wraps both the deployed URL and
/// the actual Mercury spend so the caller can record real cost against the
/// per-user limiter (not the pre-flight estimate).
struct BuildSuccess {
    url: String,
    cost_usd: f64,
}

async fn run_build_and_deploy(prompt: &str, request_id: u64) -> Result<BuildSuccess> {
    let prompt = prompt.trim().to_string();
    if prompt.is_empty() {
        return Err(anyhow!("prompt is empty"));
    }
    let build_dir = build_dir_for(request_id)?;
    let output_path = build_dir.join("index.html");

    // Mercury + Vercel are both blocking IO; run them on the blocking pool so
    // we don't park a tokio worker for the full 5-10s build duration.
    let (html, cost_usd) = {
        let prompt = prompt.clone();
        tokio::task::spawn_blocking(move || generate_html(&prompt))
            .await
            .context("build task panicked")??
    };

    std::fs::create_dir_all(&build_dir)
        .with_context(|| format!("creating {}", build_dir.display()))?;
    std::fs::write(&output_path, &html)
        .with_context(|| format!("writing {}", output_path.display()))?;
    log::info!("wrote {} ({} bytes)", output_path.display(), html.len());

    let url = tokio::task::spawn_blocking(move || deploy_to_vercel(&build_dir))
        .await
        .context("deploy task panicked")?
        .map_err(|error| anyhow!("vercel deploy: {error}"))?;
    Ok(BuildSuccess { url, cost_usd })
}

async fn scaffold_and_deploy(slug: &str, request_id: u64) -> Result<String> {
    let template = template_by_slug(slug)
        .ok_or_else(|| anyhow!("no template named `{slug}` — try /eri list-templates"))?;
    let build_dir = build_dir_for(request_id)?;
    let output_path = build_dir.join("index.html");
    std::fs::create_dir_all(&build_dir)
        .with_context(|| format!("creating {}", build_dir.display()))?;
    std::fs::write(&output_path, template.html)
        .with_context(|| format!("writing {}", output_path.display()))?;

    let url = tokio::task::spawn_blocking(move || deploy_to_vercel(&build_dir))
        .await
        .context("deploy task panicked")?
        .map_err(|error| anyhow!("vercel deploy: {error}"))?;
    Ok(url)
}

fn build_dir_for(request_id: u64) -> Result<PathBuf> {
    let root = Path::new(BUILDS_DIR);
    let dir = root.join(format!("msg-{request_id}"));
    Ok(dir)
}

/// Blocking: drive Mercury through `iterate_stream` and return the final HTML
/// body plus the actual cost reported via Mercury usage events. Identical
/// semantics to the CLI's `run_build` path so the same env vars
/// (MERCURY_API_KEY, ERI_COST_LIMIT_USD, etc.) apply.
fn generate_html(prompt: &str) -> Result<(String, f64)> {
    let config = MercuryConfig::from_env()
        .ok_or_else(|| anyhow!("MERCURY_API_KEY not set"))?;
    let backend = MercuryBackend::new(config);

    let mut ctx = PromptCtx::default();
    ctx.commit_transcript_chunk(prompt);
    let request = IterationRequest::new(DENOISING_STEPS, None);

    let mut accumulated = String::new();
    let mut partial_html: Option<String> = None;
    let mut error_message: Option<String> = None;
    let mut total_cost_usd: f64 = 0.0;

    let stream_result = {
        let mut on_event = |event: IterEvent| match event {
            IterEvent::DraftToken { text } => accumulated.push_str(&text),
            IterEvent::Error { message } => error_message = Some(message),
            IterEvent::Usage {
                prompt_tokens,
                completion_tokens,
                ..
            } => {
                total_cost_usd += mercury_2_cost(prompt_tokens, completion_tokens);
            }
            _ => {}
        };
        let mut on_partial = |html: &str| {
            partial_html = Some(html.to_string());
        };
        backend.iterate_stream(&ctx, request, &mut on_event, &mut on_partial)
    };
    stream_result.map_err(|error| anyhow!("Mercury: {error}"))?;
    if let Some(message) = error_message {
        return Err(anyhow!("Mercury: {message}"));
    }
    let html = partial_html
        .or_else(|| extract_partial_html_body(&accumulated))
        .ok_or_else(|| anyhow!("Mercury returned no HTML body"))?;
    Ok((html, total_cost_usd))
}

fn main() -> Result<()> {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .context("building tokio runtime")?;
    runtime.block_on(async_main())
}

async fn async_main() -> Result<()> {
    let token = env::var("DISCORD_TOKEN")
        .map_err(|_| anyhow!("DISCORD_TOKEN environment variable is not set"))?;
    if token.trim().is_empty() {
        return Err(anyhow!("DISCORD_TOKEN is empty"));
    }

    let intents = GatewayIntents::GUILDS
        | GatewayIntents::GUILD_MESSAGES
        | GatewayIntents::DIRECT_MESSAGES
        | GatewayIntents::MESSAGE_CONTENT;

    let mut client = Client::builder(token, intents)
        .event_handler(Handler::new())
        .await
        .context("constructing serenity client")?;

    client.start().await.context("running serenity client")?;
    Ok(())
}
