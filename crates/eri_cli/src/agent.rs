//! `eri ask`, `eri plan`, `eri ship`, `eri test`, `eri refactor`,
//! `eri explain` — agent-mode subcommands. All route through
//! `/api/v1/agent/run` with different persona / intent envelopes so
//! the backend's brain layer can pick the right model + budget.

use std::io::{self, Write};
use std::path::Path;

use anyhow::{Context, Result};
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::client::Client;
use crate::config;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentRunBody<'a> {
    intent: &'a str,
    prompt: &'a str,
    workspace_root: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    persona: Option<&'a str>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    targets: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, clap::ValueEnum)]
#[value(rename_all = "kebab-case")]
pub enum AgentOutputMode {
    Text,
    ArtifactJson,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentEvent {
    kind: String,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    tokens_in: Option<u64>,
    #[serde(default)]
    tokens_out: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentArtifactEvent<'a> {
    kind: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tokens_in: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tokens_out: Option<u64>,
}

pub async fn ask(prompt: &str) -> Result<()> {
    run_intent("ask", prompt, None, &[], AgentOutputMode::Text).await
}

/// `eri ask --image <PATH>`: analyze one or more local images with the prompt.
///
/// This is eri's vision path — the desktop app captures the screen (e.g. with
/// macOS `screencapture`) and calls `eri ask --image /tmp/shot.png "what's on my
/// screen"`. Each image is read, base64-encoded, and attached as an Anthropic
/// image content block in a single user message alongside the text prompt. We
/// run ONE non-tool turn through the same vision-capable Claude engine the
/// control loop's `look` tool uses (`ClaudeControlTurn`), which streams the
/// answer to stdout in eri's persona/human voice.
pub async fn ask_with_image(prompt: &str, images: &[std::path::PathBuf]) -> Result<()> {
    if images.is_empty() {
        // No image after all — behave exactly like a normal ask.
        return ask(prompt).await;
    }
    let prompt = prompt.trim();
    if prompt.is_empty() {
        anyhow::bail!(
            "ask needs a question to go with the image, e.g. eri ask --image shot.png \"what's on my screen\""
        );
    }

    // Build the image blocks first (fail fast on a bad path / unknown type).
    let mut content: Vec<Value> = Vec::with_capacity(images.len() + 1);
    for path in images {
        content.push(image_block(path)?);
    }
    content.push(json!({ "type": "text", "text": prompt }));

    let messages = vec![json!({ "role": "user", "content": content })];

    // eri's persona/voice — the same shared brand blocks the control loop uses,
    // so vision answers read like every other eri reply.
    let system = vec![
        json!({ "type": "text", "text": ASK_VISION_SYSTEM }),
        json!({ "type": "text", "text": eri_inference::brand::GUARDRAIL }),
        json!({ "type": "text", "text": eri_inference::brand::HUMAN_VOICE }),
    ];

    // Vision needs a vision-capable engine. Claude is that engine (the same one
    // the control `look` tool routes images to). Run a single no-tool turn; the
    // adapter streams tokens to stdout as they arrive.
    use crate::control_turn::ControlTurn as _;
    let model = crate::build_agent::DEFAULT_MODEL;
    let engine = crate::control_turn::ClaudeControlTurn::signed_in(model)
        .context("eri ask --image needs a vision-capable engine — run `eri auth login` first")?;
    let no_tools = json!([]);
    let out = engine.run(&system, &messages, &no_tools).await?;

    // The adapter already streamed the text; finish the line. If nothing
    // streamed (rare), print whatever the turn returned so the user isn't left
    // with a blank reply.
    let mut stdout = io::stdout();
    if !out.text.trim().is_empty() {
        writeln!(stdout)?;
    } else {
        writeln!(stdout, "[eri] (no answer returned for the image)")?;
    }
    Ok(())
}

/// System prompt for the image-analysis path: keep it grounded in what's
/// actually visible. eri's voice + guardrails are layered on top by the caller.
const ASK_VISION_SYSTEM: &str = "You are eri. The user has attached one or more \
images (often a screenshot of their screen). Answer their question by describing \
what is actually visible. Be concrete and specific; do not invent UI, text, or \
details that aren't in the image. If something is unreadable or cut off, say so.";

/// Read an image file and build an Anthropic image content block (base64).
/// Media type is inferred from the extension (png/jpeg/webp/gif); anything else
/// is rejected with a clear error rather than mislabeled.
fn image_block(path: &Path) -> Result<Value> {
    let bytes =
        std::fs::read(path).with_context(|| format!("could not read image {}", path.display()))?;
    let media_type = media_type_for(path)
        .with_context(|| format!("unsupported image type for {}", path.display()))?;
    let data = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(json!({
        "type": "image",
        "source": { "type": "base64", "media_type": media_type, "data": data },
    }))
}

/// Map a file extension to an Anthropic-supported image media type. `None` for
/// anything we don't support (don't guess — a wrong media type makes the API
/// reject the request).
fn media_type_for(path: &Path) -> Option<&'static str> {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("png") => Some("image/png"),
        Some("jpg") | Some("jpeg") => Some("image/jpeg"),
        Some("webp") => Some("image/webp"),
        Some("gif") => Some("image/gif"),
        _ => None,
    }
}

pub async fn plan_with_output(prompt: &str, output: AgentOutputMode) -> Result<()> {
    run_intent("plan", prompt, Some("architect"), &[], output).await
}

/// Interactive plan mode: stream the Architect's plan, then open the TUI so the
/// user can refine it (answer multi-select questions, add notes, check tasks).
/// Returns `Some(build_prompt)` — the plan plus the user's decisions, ready to
/// hand to the build loop — when approved, or `None` when cancelled.
pub async fn plan_interactive(prompt: &str) -> Result<Option<String>> {
    if prompt.is_empty() {
        anyhow::bail!("plan needs a goal to plan for");
    }
    eprintln!("[eri] drafting a plan…");
    let plan_text = capture_intent_text("plan", prompt, Some("architect")).await?;
    if plan_text.trim().is_empty() {
        anyhow::bail!("the planner returned no content");
    }

    let mut state = crate::plan_tui::PlanState::new("eri plan", plan_text.trim())
        .with_questions(default_plan_questions())
        .with_tasks(parse_tasks(&plan_text));
    if let Some(code) = first_code_block(&plan_text) {
        state = state.with_preview(code);
    }
    let outcome = crate::plan_tui::run(state)?;
    if !outcome.approved {
        return Ok(None);
    }

    let mut build_prompt = format!("{prompt}\n\n## Agreed plan\n{}", plan_text.trim());
    if !outcome.decisions.trim().is_empty() {
        build_prompt.push_str(&format!("\n\n## Decisions\n{}", outcome.decisions.trim()));
    }
    Ok(Some(build_prompt))
}

/// A small, generally-useful refinement question set for the planner. Mixes a
/// single-select (radio) and multi-select to exercise both interaction modes.
fn default_plan_questions() -> Vec<crate::plan_tui::Question> {
    use crate::plan_tui::{PlanOption, Question};
    vec![
        Question::new(
            "How thorough should the build be?",
            vec![
                PlanOption::new("Just what's asked"),
                PlanOption::new("Thorough (tests + polish)"),
                PlanOption::new("Exhaustive (edge cases + docs)"),
            ],
            false,
        ),
        Question::new(
            "Extras to include",
            vec![
                PlanOption::new("Unit tests"),
                PlanOption::new("README / docs"),
                PlanOption::new("Error handling"),
                PlanOption::new("Example usage"),
            ],
            true,
        ),
    ]
}

/// Best-effort: pull checklist items out of the plan prose. Bullet lines
/// (`- `, `* `) and numbered steps (`1.`, `2)`) become tasks; capped so the
/// checklist stays scannable.
fn parse_tasks(plan_text: &str) -> Vec<crate::plan_tui::Task> {
    let mut tasks = Vec::new();
    for raw in plan_text.lines() {
        let line = raw.trim();
        let item = line
            .strip_prefix("- ")
            .or_else(|| line.strip_prefix("* "))
            .or_else(|| numbered_item(line));
        if let Some(text) = item {
            let text = text.trim();
            if !text.is_empty() && text.len() <= 120 {
                tasks.push(crate::plan_tui::Task::new(text));
            }
        }
        if tasks.len() >= 8 {
            break;
        }
    }
    tasks
}

/// The contents of the first fenced ``` code block in the plan, for the TUI's
/// preview pane. `None` when the plan has no fenced code.
fn first_code_block(plan_text: &str) -> Option<String> {
    let mut lines = plan_text.lines();
    // Find the opening fence.
    lines.by_ref().find(|l| l.trim_start().starts_with("```"))?;
    let mut body = Vec::new();
    for line in lines {
        if line.trim_start().starts_with("```") {
            break;
        }
        body.push(line);
    }
    if body.is_empty() {
        None
    } else {
        Some(body.join("\n"))
    }
}

/// `12. foo` / `3) bar` -> the text after the marker, else None.
fn numbered_item(line: &str) -> Option<&str> {
    let digits: String = line.chars().take_while(char::is_ascii_digit).collect();
    if digits.is_empty() {
        return None;
    }
    let rest = &line[digits.len()..];
    rest.strip_prefix(". ").or_else(|| rest.strip_prefix(") "))
}

pub async fn ship_with_output(prompt: &str, output: AgentOutputMode) -> Result<()> {
    run_intent("ship", prompt, Some("shipper"), &[], output).await
}

pub async fn test(scope: &str) -> Result<()> {
    let prompt = if scope.is_empty() {
        "Add tests for any code without coverage in the current workspace.".to_string()
    } else {
        format!("Add tests for {scope}.")
    };
    let targets = scope_targets(scope);
    run_intent(
        "test",
        &prompt,
        Some("tester"),
        &targets,
        AgentOutputMode::Text,
    )
    .await
}

pub async fn refactor(scope: &str) -> Result<()> {
    let prompt = if scope.is_empty() {
        "Suggest a clean refactor for the active file or selection.".to_string()
    } else {
        format!("Refactor {scope}.")
    };
    let targets = scope_targets(scope);
    run_intent(
        "refactor",
        &prompt,
        Some("architect"),
        &targets,
        AgentOutputMode::Text,
    )
    .await
}

pub async fn explain(target: &str) -> Result<()> {
    if target.is_empty() {
        anyhow::bail!("explain needs a target — file path or `file:line` range");
    }
    let prompt = format!("Explain {target} in plain language. Include design intent + edge cases.");
    run_intent(
        "explain",
        &prompt,
        None,
        &[target.to_string()],
        AgentOutputMode::Text,
    )
    .await
}

pub async fn sketch(prompt: &str) -> Result<()> {
    if prompt.is_empty() {
        anyhow::bail!("sketch needs a description of what to draft");
    }
    run_intent("sketch", prompt, None, &[], AgentOutputMode::Text).await
}

fn scope_targets(scope: &str) -> Vec<String> {
    if scope.is_empty() {
        Vec::new()
    } else {
        vec![scope.to_string()]
    }
}

async fn run_intent(
    intent: &str,
    prompt: &str,
    persona: Option<&str>,
    targets: &[String],
    output: AgentOutputMode,
) -> Result<()> {
    let creds = config::load()?;
    if !creds.is_signed_in() {
        anyhow::bail!("not signed in — run `eri auth login` first");
    }
    let client = Client::from_credentials(&creds)?;
    let workspace_root = std::env::current_dir()
        .ok()
        .map(|p| p.to_string_lossy().to_string());

    let body = AgentRunBody {
        intent,
        prompt,
        workspace_root,
        persona,
        targets: targets.to_vec(),
    };
    let response = client
        .post_stream("/api/v1/agent/run", &body)
        .await
        // Map quota / capacity (402 / 429) to friendly, eri-branded messages;
        // other transport errors pass through with their original context.
        .map_err(crate::build_agent::friendly_proxy_error)?;

    stream_events(response, output).await
}

/// Run an intent but COLLECT the streamed `text` events into a string instead
/// of printing them — used by the interactive planner to capture the plan
/// prose before opening the TUI. Token totals are ignored here.
pub(crate) async fn capture_intent_text(
    intent: &str,
    prompt: &str,
    persona: Option<&str>,
) -> Result<String> {
    let creds = config::load()?;
    if !creds.is_signed_in() {
        anyhow::bail!("not signed in — run `eri auth login` first");
    }
    let client = Client::from_credentials(&creds)?;
    let workspace_root = std::env::current_dir()
        .ok()
        .map(|p| p.to_string_lossy().to_string());
    let body = AgentRunBody {
        intent,
        prompt,
        workspace_root,
        persona,
        targets: Vec::new(),
    };
    let mut response = client
        .post_stream("/api/v1/agent/run", &body)
        .await
        .map_err(crate::build_agent::friendly_proxy_error)?;

    let mut buffer = String::new();
    let mut text = String::new();
    while let Some(chunk) = response.chunk().await.context("read SSE stream")? {
        buffer.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(idx) = buffer.find('\n') {
            let line = buffer[..idx].trim_end_matches('\r').to_string();
            buffer.drain(..=idx);
            collect_text_line(&line, &mut text)?;
        }
    }
    if !buffer.is_empty() {
        let trailing = buffer.clone();
        collect_text_line(&trailing, &mut text)?;
    }
    Ok(text)
}

/// Parse one SSE/NDJSON line and append any `text` payload to `out`.
fn collect_text_line(line: &str, out: &mut String) -> Result<()> {
    let payload = if let Some(rest) = line.strip_prefix("data:") {
        rest.trim()
    } else if !line.is_empty() && !line.starts_with("event:") && !line.starts_with(':') {
        line.trim()
    } else {
        return Ok(());
    };
    if payload.is_empty() || payload == "[DONE]" {
        return Ok(());
    }
    match serde_json::from_str::<AgentEvent>(payload) {
        Ok(event) => {
            if event.kind == "error" {
                if let Some(msg) = event.message {
                    anyhow::bail!("agent error: {msg}");
                }
            } else if let Some(t) = event.text {
                out.push_str(&t);
            }
        }
        // Non-JSON lines from a plain backend: treat as raw prose.
        Err(_) => out.push_str(payload),
    }
    Ok(())
}

async fn stream_events(mut response: reqwest::Response, output: AgentOutputMode) -> Result<()> {
    let mut buffer = String::new();
    let mut stdout = io::stdout().lock();
    let mut totals_in: u64 = 0;
    let mut totals_out: u64 = 0;
    while let Some(chunk) = response.chunk().await.context("read SSE stream")? {
        buffer.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(idx) = buffer.find('\n') {
            let line = buffer[..idx].trim_end_matches('\r').to_string();
            buffer.drain(..=idx);
            handle_line(&line, &mut stdout, &mut totals_in, &mut totals_out, output)?;
        }
    }
    if !buffer.is_empty() {
        let trailing = buffer.clone();
        handle_line(
            &trailing,
            &mut stdout,
            &mut totals_in,
            &mut totals_out,
            output,
        )?;
    }
    writeln!(stdout)?;
    Ok(())
}

fn handle_line(
    line: &str,
    stdout: &mut impl Write,
    totals_in: &mut u64,
    totals_out: &mut u64,
    output: AgentOutputMode,
) -> Result<()> {
    let payload = if let Some(rest) = line.strip_prefix("data:") {
        rest.trim()
    } else if !line.is_empty() && !line.starts_with("event:") && !line.starts_with(":") {
        // Plain NDJSON fallback for non-SSE backends.
        line.trim()
    } else {
        return Ok(());
    };
    if payload.is_empty() || payload == "[DONE]" {
        return Ok(());
    }
    let event: AgentEvent = match serde_json::from_str(payload) {
        Ok(e) => e,
        Err(_) => {
            writeln!(stdout, "{payload}")?;
            return Ok(());
        }
    };
    if output == AgentOutputMode::ArtifactJson {
        if let Some(rendered) = render_artifact_event(&event)? {
            writeln!(stdout, "{rendered}")?;
        }
        if event.kind == "error" {
            if let Some(msg) = event.message {
                anyhow::bail!("agent error: {msg}");
            }
            anyhow::bail!("agent error (no message)");
        }
        return Ok(());
    }
    match event.kind.as_str() {
        "token" => {
            if let Some(t) = event.text {
                write!(stdout, "{t}")?;
                stdout.flush()?;
            }
        }
        "tool_call" => {
            if let Some(msg) = event.message {
                writeln!(stdout, "\n[tool] {msg}")?;
            }
        }
        "done" => {
            if let Some(t) = event.tokens_in {
                *totals_in = t;
            }
            if let Some(t) = event.tokens_out {
                *totals_out = t;
            }
            writeln!(stdout)?;
            eprintln!("done — tokens: {}→{}", *totals_in, *totals_out);
        }
        "error" => {
            writeln!(stdout)?;
            if let Some(msg) = event.message {
                anyhow::bail!("agent error: {msg}");
            }
            anyhow::bail!("agent error (no message)");
        }
        _ => {
            if let Some(msg) = event.message.or(event.text) {
                writeln!(stdout, "[{}] {msg}", event.kind)?;
            }
        }
    }
    Ok(())
}

fn render_artifact_event(event: &AgentEvent) -> Result<Option<String>> {
    let item = AgentArtifactEvent {
        kind: &event.kind,
        text: event.text.as_deref(),
        message: event.message.as_deref(),
        tokens_in: event.tokens_in,
        tokens_out: event.tokens_out,
    };
    Ok(Some(serde_json::to_string(&item)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn artifact_output_scrubs_route_names() {
        let event: AgentEvent = serde_json::from_str(
            r#"{"kind":"done","routedTo":"internal-engine","tokensIn":12,"tokensOut":34}"#,
        )
        .expect("event json");

        let rendered = render_artifact_event(&event)
            .expect("event should render")
            .expect("event should produce a line");

        assert!(rendered.contains("\"kind\":\"done\""));
        assert!(rendered.contains("\"tokensIn\":12"));
        assert!(rendered.contains("\"tokensOut\":34"));
        assert!(!rendered.contains("internal-engine"));
        assert!(!rendered.contains("routed"));
    }
}
