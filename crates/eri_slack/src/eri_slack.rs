//! Slack bot front-end for eri. Connects via Socket Mode, listens for
//! `app_mention` events and `/eri` slash commands in any channel, runs a
//! Mercury 2 build, deploys the result to Vercel, and replies in-thread with
//! the deployed URL.
//!
//! This binary is intentionally thin: the heavy lifting (Mercury streaming,
//! HTML extraction, Vercel CLI invocation) lives in `eri_inference`. The bot
//! is a Slack-flavored adapter on top of the same code path the CLI and the
//! Discord bot use.

use std::{
    env,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use anyhow::{Context, Result, anyhow};
use eri_core::{IterEvent, PromptCtx};
use eri_inference::{
    InferenceBackend, IterationRequest, MercuryBackend, MercuryConfig, TEMPLATES,
    costs::mercury_2_cost, deploy_to_vercel, extract_partial_html_body, template_by_slug,
};
use eri_iterator::RateLimiter;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::sync::Semaphore;
use tokio_tungstenite::tungstenite::Message as WsMessage;

mod parse;
use parse::{ParsedPrompt, parse_mention_prompt};

const DENOISING_STEPS: u32 = 24;
const MAX_CONCURRENT_BUILDS: usize = 4;
const BUILDS_DIR: &str = "./eri-slack-builds";
const SLACK_API: &str = "https://slack.com/api";

/// Slack client wrapping the bot token and an HTTP client. Holds the bot's
/// own user id so the mention parser can match `<@bot-id>` precisely.
#[derive(Clone)]
struct SlackClient {
    http: reqwest::Client,
    bot_token: String,
    bot_user_id: String,
}

impl SlackClient {
    fn new(http: reqwest::Client, bot_token: String, bot_user_id: String) -> Self {
        Self {
            http,
            bot_token,
            bot_user_id,
        }
    }

    /// POST to a Slack Web API method with a JSON body and bot-token auth.
    /// The workspace `reqwest` fork does not enable the `json` feature, so we
    /// serialize the body and parse responses manually.
    async fn call(&self, method: &str, body: Value) -> Result<Value> {
        let url = format!("{SLACK_API}/{method}");
        let serialized = serde_json::to_string(&body).context("serialize body")?;
        let response = self
            .http
            .post(&url)
            .bearer_auth(&self.bot_token)
            .header("Content-Type", "application/json; charset=utf-8")
            .body(serialized)
            .send()
            .await
            .with_context(|| format!("POST {method}"))?;
        let status = response.status();
        let body_text = response
            .text()
            .await
            .with_context(|| format!("read {method} response body"))?;
        let payload: Value = serde_json::from_str(&body_text)
            .with_context(|| format!("decode {method} response: {body_text}"))?;
        if !status.is_success() {
            return Err(anyhow!("slack {method} HTTP {status}: {payload}"));
        }
        if payload.get("ok").and_then(Value::as_bool) != Some(true) {
            let error = payload
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("unknown_error");
            return Err(anyhow!("slack {method} returned error: {error}"));
        }
        Ok(payload)
    }

    async fn post_message(
        &self,
        channel: &str,
        thread_ts: Option<&str>,
        text: &str,
    ) -> Result<String> {
        let mut body = json!({
            "channel": channel,
            "text": text,
        });
        if let Some(ts) = thread_ts {
            body["thread_ts"] = json!(ts);
        }
        let response = self.call("chat.postMessage", body).await?;
        let ts = response
            .get("ts")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("chat.postMessage missing ts"))?
            .to_string();
        Ok(ts)
    }

    async fn update_message(&self, channel: &str, ts: &str, text: &str) -> Result<()> {
        self.call(
            "chat.update",
            json!({ "channel": channel, "ts": ts, "text": text }),
        )
        .await?;
        Ok(())
    }

    async fn react(&self, channel: &str, ts: &str, name: &str) -> Result<()> {
        // Slack returns `already_reacted` if we double-react; treat that as
        // success so duplicate events from socket reconnects don't error.
        let body = json!({ "channel": channel, "timestamp": ts, "name": name });
        match self.call("reactions.add", body).await {
            Ok(_) => Ok(()),
            Err(error) => {
                if error.to_string().contains("already_reacted") {
                    Ok(())
                } else {
                    Err(error)
                }
            }
        }
    }

    async fn post_response(&self, response_url: &str, text: &str, in_channel: bool) -> Result<()> {
        // Slash command response_urls accept the same payload shape as
        // chat.postMessage but are unauthenticated webhooks.
        let body = json!({
            "response_type": if in_channel { "in_channel" } else { "ephemeral" },
            "text": text,
            "replace_original": false,
        });
        let serialized = serde_json::to_string(&body).context("serialize response body")?;
        let response = self
            .http
            .post(response_url)
            .header("Content-Type", "application/json; charset=utf-8")
            .body(serialized)
            .send()
            .await
            .context("POST response_url")?;
        if !response.status().is_success() {
            return Err(anyhow!(
                "response_url POST returned HTTP {}",
                response.status()
            ));
        }
        Ok(())
    }
}

/// Open a Socket Mode WebSocket URL via Slack's `apps.connections.open`
/// endpoint. The URL is short-lived; we request a fresh one on every reconnect.
async fn open_socket_url(http: &reqwest::Client, app_token: &str) -> Result<String> {
    let response = http
        .post(format!("{SLACK_API}/apps.connections.open"))
        .bearer_auth(app_token)
        .send()
        .await
        .context("apps.connections.open")?;
    let status = response.status();
    let body_text = response
        .text()
        .await
        .context("read apps.connections.open response body")?;
    let payload: Value = serde_json::from_str(&body_text)
        .with_context(|| format!("decode apps.connections.open response: {body_text}"))?;
    if !status.is_success()
        || payload.get("ok").and_then(Value::as_bool) != Some(true)
    {
        return Err(anyhow!(
            "apps.connections.open failed (HTTP {status}): {payload}"
        ));
    }
    let url = payload
        .get("url")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("apps.connections.open missing url"))?
        .to_string();
    Ok(url)
}

/// Fetch the bot's own Slack user id. Required to recognise `<@bot-id>`
/// mentions; `auth.test` returns `user_id` for the token in use.
async fn fetch_bot_user_id(http: &reqwest::Client, bot_token: &str) -> Result<String> {
    let response = http
        .post(format!("{SLACK_API}/auth.test"))
        .bearer_auth(bot_token)
        .send()
        .await
        .context("auth.test")?;
    let body_text = response.text().await.context("read auth.test body")?;
    let payload: Value = serde_json::from_str(&body_text)
        .with_context(|| format!("decode auth.test: {body_text}"))?;
    if payload.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(anyhow!("auth.test failed: {payload}"));
    }
    let user_id = payload
        .get("user_id")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("auth.test missing user_id"))?
        .to_string();
    Ok(user_id)
}

#[derive(Debug, Deserialize)]
struct SocketEnvelope {
    #[serde(rename = "type")]
    kind: String,
    envelope_id: Option<String>,
    payload: Option<Value>,
}

fn main() -> Result<()> {
    // Install a tiny stderr logger only if no global logger is already
    // configured. Matches the Discord bot's reliance on the `log` facade.
    let _ = log::set_logger(&LOGGER).map(|_| log::set_max_level(log::LevelFilter::Info));
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .context("building tokio runtime")?;
    runtime.block_on(async_main())
}

struct StderrLogger;
static LOGGER: StderrLogger = StderrLogger;

impl log::Log for StderrLogger {
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        metadata.level() <= log::Level::Info
    }
    fn log(&self, record: &log::Record) {
        if self.enabled(record.metadata()) {
            eprintln!("[{}] {}", record.level(), record.args());
        }
    }
    fn flush(&self) {}
}

async fn async_main() -> Result<()> {
    let app_token = env::var("SLACK_APP_TOKEN")
        .map_err(|_| anyhow!("SLACK_APP_TOKEN environment variable is not set"))?;
    let bot_token = env::var("SLACK_BOT_TOKEN")
        .map_err(|_| anyhow!("SLACK_BOT_TOKEN environment variable is not set"))?;
    if app_token.trim().is_empty() {
        return Err(anyhow!("SLACK_APP_TOKEN is empty"));
    }
    if bot_token.trim().is_empty() {
        return Err(anyhow!("SLACK_BOT_TOKEN is empty"));
    }
    if !app_token.starts_with("xapp-") {
        return Err(anyhow!(
            "SLACK_APP_TOKEN must start with `xapp-` (app-level token from Socket Mode)"
        ));
    }
    if !bot_token.starts_with("xoxb-") {
        return Err(anyhow!(
            "SLACK_BOT_TOKEN must start with `xoxb-` (bot user OAuth token)"
        ));
    }

    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .context("building reqwest client")?;
    let bot_user_id = fetch_bot_user_id(&http, &bot_token).await?;
    log::info!("eri-slack ready as bot user {bot_user_id}");
    let client = SlackClient::new(http.clone(), bot_token, bot_user_id);
    let slots = Arc::new(Semaphore::new(MAX_CONCURRENT_BUILDS));
    let rate_limiter = Arc::new(RateLimiter::from_env());

    // Outer reconnect loop. Slack rotates Socket Mode URLs aggressively
    // (~hourly) and disconnects intermediate proxies; this loop keeps the
    // bot online indefinitely as long as the app token stays valid.
    loop {
        if let Err(error) =
            run_socket(&http, &app_token, &client, slots.clone(), rate_limiter.clone()).await
        {
            log::warn!("socket loop ended: {error:#}; reconnecting in 3s");
            tokio::time::sleep(Duration::from_secs(3)).await;
        }
    }
}

/// Conservative pre-flight cost estimate used when gating a Slack request.
/// Mirrors the Discord adapter's heuristic so the two bots agree on what a
/// "typical" build is worth before the Mercury stream actually starts.
fn estimate_request_cost_usd(prompt: &str) -> f64 {
    let prompt_tokens = (prompt.len() / 4).clamp(256, 8_000) as u32;
    mercury_2_cost(prompt_tokens, 4_000)
}

async fn run_socket(
    http: &reqwest::Client,
    app_token: &str,
    client: &SlackClient,
    slots: Arc<Semaphore>,
    rate_limiter: Arc<RateLimiter>,
) -> Result<()> {
    let url = open_socket_url(http, app_token).await?;
    log::info!("connecting to Slack Socket Mode");
    let (stream, _response) = tokio_tungstenite::connect_async(&url)
        .await
        .context("ws connect")?;
    let (mut sink, mut source) = stream.split();

    while let Some(message) = source.next().await {
        let frame = match message {
            Ok(frame) => frame,
            Err(error) => return Err(anyhow!("ws read: {error}")),
        };
        match frame {
            WsMessage::Text(text) => {
                let envelope: SocketEnvelope = match serde_json::from_str(&text) {
                    Ok(env) => env,
                    Err(error) => {
                        log::warn!("malformed envelope: {error}");
                        continue;
                    }
                };
                match envelope.kind.as_str() {
                    "hello" => log::info!("socket hello received"),
                    "disconnect" => {
                        log::info!("socket disconnect requested; reconnecting");
                        return Ok(());
                    }
                    "events_api" | "slash_commands" | "interactive" => {
                        if let Some(id) = envelope.envelope_id.clone() {
                            let ack = json!({ "envelope_id": id });
                            if let Err(error) =
                                sink.send(WsMessage::Text(ack.to_string().into())).await
                            {
                                log::warn!("ack failed: {error}");
                            }
                        }
                        if let Some(payload) = envelope.payload {
                            dispatch_envelope(
                                envelope.kind.as_str(),
                                payload,
                                client.clone(),
                                slots.clone(),
                                rate_limiter.clone(),
                            );
                        }
                    }
                    other => log::debug!("ignoring envelope type: {other}"),
                }
            }
            WsMessage::Ping(data) => {
                let _ = sink.send(WsMessage::Pong(data)).await;
            }
            WsMessage::Close(_) => {
                log::info!("socket closed by server");
                return Ok(());
            }
            _ => {}
        }
    }
    Ok(())
}

fn dispatch_envelope(
    kind: &str,
    payload: Value,
    client: SlackClient,
    slots: Arc<Semaphore>,
    rate_limiter: Arc<RateLimiter>,
) {
    match kind {
        "events_api" => {
            tokio::spawn(async move {
                if let Err(error) = handle_event(&payload, &client, slots, rate_limiter).await {
                    log::warn!("event handler error: {error:#}");
                }
            });
        }
        "slash_commands" => {
            tokio::spawn(async move {
                if let Err(error) = handle_slash(&payload, &client, slots, rate_limiter).await {
                    log::warn!("slash handler error: {error:#}");
                }
            });
        }
        _ => {}
    }
}

async fn handle_event(
    payload: &Value,
    client: &SlackClient,
    slots: Arc<Semaphore>,
    rate_limiter: Arc<RateLimiter>,
) -> Result<()> {
    let event = payload
        .get("event")
        .ok_or_else(|| anyhow!("events_api payload missing `event`"))?;
    let event_type = event
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("event missing `type`"))?;
    if event_type != "app_mention" {
        return Ok(());
    }

    // Ignore bot-authored messages (including our own); Slack flags these
    // with `bot_id`. Without this guard the bot would loop on its own posts.
    if event.get("bot_id").is_some() {
        return Ok(());
    }

    let text = event
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let channel = event
        .get("channel")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("event missing channel"))?
        .to_string();
    let trigger_ts = event
        .get("ts")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("event missing ts"))?
        .to_string();
    // Slack's `app_mention` payload reliably ships the triggering user's id
    // (a U-prefixed slug). Fall back to a sentinel that still namespaces by
    // channel so missing-user events can't collapse onto a single counter.
    let user_id = event
        .get("user")
        .and_then(Value::as_str)
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("anon-{channel}"));
    // If the mention happened inside a thread, reply in-thread. Otherwise
    // start a new thread off the triggering message so chatter is contained.
    let thread_ts = event
        .get("thread_ts")
        .and_then(Value::as_str)
        .map(|s| s.to_string())
        .unwrap_or_else(|| trigger_ts.clone());

    let parsed = match parse_mention_prompt(text, &client.bot_user_id) {
        Some(parsed) => parsed,
        None => return Ok(()),
    };

    let prompt = match parsed {
        ParsedPrompt::Build(prompt) => prompt,
        ParsedPrompt::Empty => {
            client
                .post_message(
                    &channel,
                    Some(&thread_ts),
                    "give me something to build — e.g. `@eri build me a coffee shop landing page`",
                )
                .await?;
            return Ok(());
        }
    };

    // Gate the build behind the per-user limiter before we touch Mercury or
    // even react :hammer:. Denied users get the :x: reaction and a threaded
    // explanation; their counters don't tick.
    let decision = rate_limiter.check(&user_id, estimate_request_cost_usd(&prompt));
    if !decision.allow {
        if let Err(error) = client.react(&channel, &trigger_ts, "x").await {
            log::warn!("react with :x: failed: {error}");
        }
        client
            .post_message(&channel, Some(&thread_ts), &decision.reason)
            .await?;
        return Ok(());
    }

    if let Err(error) = client.react(&channel, &trigger_ts, "hammer").await {
        log::warn!("react with :hammer: failed: {error}");
    }

    let status_ts = client
        .post_message(
            &channel,
            Some(&thread_ts),
            &format!("building... `{}`", truncate_for_status(&prompt)),
        )
        .await?;

    let _permit = slots.acquire_owned().await.context("semaphore closed")?;
    let request_id = trigger_ts.replace('.', "");
    let outcome = run_build_and_deploy(&prompt, &request_id).await;
    let body = match &outcome {
        Ok(success) => {
            rate_limiter.record(&user_id, success.cost_usd);
            format!(":white_check_mark: done: {}", success.url)
        }
        Err(error) => format!(":warning: build failed: {error}"),
    };

    if let Err(error) = client.update_message(&channel, &status_ts, &body).await {
        log::warn!("chat.update failed ({error}); posting fresh reply");
        client
            .post_message(&channel, Some(&thread_ts), &body)
            .await?;
    }
    Ok(())
}

async fn handle_slash(
    payload: &Value,
    client: &SlackClient,
    slots: Arc<Semaphore>,
    rate_limiter: Arc<RateLimiter>,
) -> Result<()> {
    let command = payload
        .get("command")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if command != "/eri" {
        return Ok(());
    }
    let text = payload
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    let response_url = payload
        .get("response_url")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("slash payload missing response_url"))?
        .to_string();
    let trigger_id = payload
        .get("trigger_id")
        .and_then(Value::as_str)
        .unwrap_or("slash")
        .to_string();
    // Slack slash payloads carry `user_id` (U-prefixed). When missing we fall
    // back to the trigger_id so each request still has a distinct counter
    // rather than collapsing onto a shared "anon" bucket.
    let user_id = payload
        .get("user_id")
        .and_then(Value::as_str)
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("anon-{trigger_id}"));

    let (sub, rest) = match text.split_once(char::is_whitespace) {
        Some((sub, rest)) => (sub.to_string(), rest.trim().to_string()),
        None => (text.clone(), String::new()),
    };

    match sub.as_str() {
        "list-templates" | "templates" => {
            client
                .post_response(&response_url, &render_template_list(), false)
                .await?;
            Ok(())
        }
        "build" => {
            if rest.is_empty() {
                client
                    .post_response(
                        &response_url,
                        ":warning: usage: `/eri build <prompt>`",
                        false,
                    )
                    .await?;
                return Ok(());
            }
            let decision = rate_limiter.check(&user_id, estimate_request_cost_usd(&rest));
            if !decision.allow {
                client
                    .post_response(
                        &response_url,
                        &format!(":x: {}", decision.reason),
                        false,
                    )
                    .await?;
                return Ok(());
            }
            client
                .post_response(
                    &response_url,
                    &format!("building... `{}`", truncate_for_status(&rest)),
                    true,
                )
                .await?;
            let _permit = slots.acquire_owned().await.context("semaphore closed")?;
            let result = run_build_and_deploy(&rest, &trigger_id).await;
            let body = match &result {
                Ok(success) => {
                    rate_limiter.record(&user_id, success.cost_usd);
                    format!(":white_check_mark: done: {}", success.url)
                }
                Err(error) => format!(":warning: build failed: {error}"),
            };
            client.post_response(&response_url, &body, true).await?;
            Ok(())
        }
        "scaffold" => {
            if rest.is_empty() {
                client
                    .post_response(
                        &response_url,
                        ":warning: usage: `/eri scaffold <template>`",
                        false,
                    )
                    .await?;
                return Ok(());
            }
            // Scaffolds skip Mercury, so we charge $0 up-front but still
            // require the cooldown/daily-count gate to pass — same abuse
            // story as Discord.
            let decision = rate_limiter.check(&user_id, 0.0);
            if !decision.allow {
                client
                    .post_response(
                        &response_url,
                        &format!(":x: {}", decision.reason),
                        false,
                    )
                    .await?;
                return Ok(());
            }
            let slug = rest;
            client
                .post_response(
                    &response_url,
                    &format!("scaffolding `{slug}`..."),
                    true,
                )
                .await?;
            let _permit = slots.acquire_owned().await.context("semaphore closed")?;
            let result = scaffold_and_deploy(&slug, &trigger_id).await;
            let body = match &result {
                Ok(url) => {
                    rate_limiter.record(&user_id, 0.0);
                    format!(":white_check_mark: deployed `{slug}`: {url}")
                }
                Err(error) => format!(":warning: scaffold failed: {error}"),
            };
            client.post_response(&response_url, &body, true).await?;
            Ok(())
        }
        "" => {
            client
                .post_response(
                    &response_url,
                    "usage: `/eri build <prompt>`, `/eri list-templates`, or `/eri scaffold <template>`",
                    false,
                )
                .await?;
            Ok(())
        }
        other => {
            client
                .post_response(
                    &response_url,
                    &format!(":warning: unknown subcommand `{other}`"),
                    false,
                )
                .await?;
            Ok(())
        }
    }
}

fn render_template_list() -> String {
    let mut buffer = String::from("*Templates* (use `/eri scaffold <slug>`):\n");
    for template in TEMPLATES {
        buffer.push_str(&format!("• `{}` — {}\n", template.slug, template.name));
    }
    buffer
}

/// Snip a status string so a one-paragraph prompt doesn't bloat the holding
/// message. Slack's per-message limit is 40,000 chars, but echoing a wall of
/// text in a status update is just noise.
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

/// Successful build outcome: deployed URL plus the actual Mercury spend
/// reported by usage events. The Slack handler feeds `cost_usd` into the
/// per-user rate limiter so its daily $$ counter reflects real spend rather
/// than the pre-flight estimate.
struct BuildSuccess {
    url: String,
    cost_usd: f64,
}

async fn run_build_and_deploy(prompt: &str, request_id: &str) -> Result<BuildSuccess> {
    let prompt = prompt.trim().to_string();
    if prompt.is_empty() {
        return Err(anyhow!("prompt is empty"));
    }
    let build_dir = build_dir_for(request_id);
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

async fn scaffold_and_deploy(slug: &str, request_id: &str) -> Result<String> {
    let template = template_by_slug(slug)
        .ok_or_else(|| anyhow!("no template named `{slug}` — try /eri list-templates"))?;
    let build_dir = build_dir_for(request_id);
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

fn build_dir_for(request_id: &str) -> PathBuf {
    // Slack event ts has a dot ("1700000000.000123"); request_id is already
    // sanitised by the caller. Slash command trigger_ids are short opaque
    // tokens. Keep the directory name URL-safe by stripping anything
    // non-alphanumeric — Vercel's CLI is picky about project names.
    let safe: String = request_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    Path::new(BUILDS_DIR).join(format!("req-{safe}"))
}

/// Blocking: drive Mercury through `iterate_stream` and return the final HTML
/// body. Identical semantics to the CLI and Discord bot's `run_build` paths so
/// the same env vars (MERCURY_API_KEY, ERI_COST_LIMIT_USD, etc.) apply.
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
