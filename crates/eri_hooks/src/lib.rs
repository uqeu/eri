//! `eri_hooks` — deterministic, sidecar-side lifecycle hooks modelled on
//! Claude Code. A `Hooks` instance is loaded from a workspace's
//! `.eri/hooks.json` (or per-event files under `.eri/hooks/<event>.json`)
//! and exposes a single `fire(event)` entry point.
//!
//! Hooks run shell commands via `sh -c` (Unix) or `cmd /C` (Windows). They
//! are best-effort: timeouts kill long runs and errors are returned in the
//! `HookOutcome`, never bubbled up as panics. Callers (the sidecar dispatch
//! loop) are expected to fire-and-log, not block dispatch on hook output.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Context, Result};
use regex::Regex;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::time::timeout;

const DEFAULT_TIMEOUT_MS: u64 = 30_000;

/// Per-event hook bucket on disk. We deserialize from a permissive raw form
/// and then compile regex matchers eagerly so syntax errors surface at load
/// time, not first-fire time.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "PascalCase", default)]
struct RawConfig {
    session_start: Vec<RawHook>,
    session_end: Vec<RawHook>,
    user_prompt_submit: Vec<RawHook>,
    pre_tool_use: Vec<RawHook>,
    post_tool_use: Vec<RawHook>,
    post_tool_error: Vec<RawHook>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawHook {
    #[serde(default)]
    matcher: Option<String>,
    command: String,
    #[serde(default)]
    background: bool,
    #[serde(default)]
    timeout_ms: Option<u64>,
    #[serde(default)]
    env: HashMap<String, String>,
    #[serde(default = "default_capture")]
    capture_output: bool,
}

fn default_capture() -> bool {
    true
}

/// A compiled, ready-to-fire hook. Regex matchers are pre-compiled.
#[derive(Debug, Clone)]
pub struct Hook {
    pub matcher: Option<Regex>,
    pub command: String,
    pub background: bool,
    pub timeout: Duration,
    pub env: HashMap<String, String>,
    pub capture_output: bool,
}

/// Lifecycle events fired by the sidecar. The payload carries the data the
/// matcher checks against and the env vars exported to the hook process.
#[derive(Debug, Clone)]
pub enum HookEvent {
    SessionStart,
    SessionEnd,
    UserPromptSubmit {
        source: String,
        prompt: String,
    },
    PreToolUse {
        method: String,
        params: serde_json::Value,
    },
    PostToolUse {
        method: String,
        result: serde_json::Value,
    },
    PostToolError {
        method: String,
        error: String,
    },
}

impl HookEvent {
    pub fn name(&self) -> &'static str {
        match self {
            HookEvent::SessionStart => "SessionStart",
            HookEvent::SessionEnd => "SessionEnd",
            HookEvent::UserPromptSubmit { .. } => "UserPromptSubmit",
            HookEvent::PreToolUse { .. } => "PreToolUse",
            HookEvent::PostToolUse { .. } => "PostToolUse",
            HookEvent::PostToolError { .. } => "PostToolError",
        }
    }

    /// String used as the matcher target (method name, prompt text, …).
    fn matcher_target(&self) -> &str {
        match self {
            HookEvent::SessionStart | HookEvent::SessionEnd => "",
            HookEvent::UserPromptSubmit { prompt, .. } => prompt.as_str(),
            HookEvent::PreToolUse { method, .. }
            | HookEvent::PostToolUse { method, .. }
            | HookEvent::PostToolError { method, .. } => method.as_str(),
        }
    }
}

/// Result of one hook invocation. `timed_out` is set when the command was
/// killed for exceeding its budget; `exit_code` is `None` in that case.
#[derive(Debug, Clone)]
pub struct HookOutcome {
    pub event: String,
    pub command_preview: String,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub duration_ms: u64,
    pub timed_out: bool,
    pub spawn_error: Option<String>,
    pub backgrounded: bool,
}

/// Compiled hook configuration. Cheap to clone (commands are short strings)
/// but typically held by reference on the sidecar's `Services` registry.
#[derive(Debug, Clone, Default)]
pub struct HookConfig {
    pub session_start: Vec<Hook>,
    pub session_end: Vec<Hook>,
    pub user_prompt_submit: Vec<Hook>,
    pub pre_tool_use: Vec<Hook>,
    pub post_tool_use: Vec<Hook>,
    pub post_tool_error: Vec<Hook>,
}

impl HookConfig {
    fn bucket(&self, event: &HookEvent) -> &[Hook] {
        match event {
            HookEvent::SessionStart => &self.session_start,
            HookEvent::SessionEnd => &self.session_end,
            HookEvent::UserPromptSubmit { .. } => &self.user_prompt_submit,
            HookEvent::PreToolUse { .. } => &self.pre_tool_use,
            HookEvent::PostToolUse { .. } => &self.post_tool_use,
            HookEvent::PostToolError { .. } => &self.post_tool_error,
        }
    }
}

/// Workspace-scoped hook registry.
#[derive(Debug)]
pub struct Hooks {
    workspace_root: PathBuf,
    config: HookConfig,
}

impl Hooks {
    /// Load hooks from `<workspace>/.eri/hooks.json` and any per-event
    /// files under `<workspace>/.eri/hooks/<event>.json`. Missing files
    /// are tolerated (returns an empty registry); malformed JSON or invalid
    /// regex/denylisted commands are surfaced as errors.
    pub fn load(workspace_root: &Path) -> Result<Self> {
        let workspace_root = workspace_root.to_path_buf();
        ensure_safe_workspace(&workspace_root)?;

        let mut raw = RawConfig::default();

        let single = workspace_root.join(".eri").join("hooks.json");
        if single.exists() {
            let body = std::fs::read_to_string(&single)
                .with_context(|| format!("reading {}", single.display()))?;
            let parsed: RawConfig = serde_json::from_str(&body)
                .with_context(|| format!("parsing {}", single.display()))?;
            merge_raw(&mut raw, parsed);
        }

        let per_event_dir = workspace_root.join(".eri").join("hooks");
        if per_event_dir.is_dir() {
            for event_name in [
                "SessionStart",
                "SessionEnd",
                "UserPromptSubmit",
                "PreToolUse",
                "PostToolUse",
                "PostToolError",
            ] {
                let path = per_event_dir.join(format!("{event_name}.json"));
                if !path.exists() {
                    continue;
                }
                let body = std::fs::read_to_string(&path)
                    .with_context(|| format!("reading {}", path.display()))?;
                // Per-event file may be either an object keyed by event
                // name, or a bare array of hook entries.
                let parsed = parse_per_event_file(event_name, &body)
                    .with_context(|| format!("parsing {}", path.display()))?;
                merge_raw(&mut raw, parsed);
            }
        }

        let config = compile_config(raw)?;
        Ok(Self {
            workspace_root,
            config,
        })
    }

    /// Empty registry — useful for tests and as a default.
    pub fn empty(workspace_root: &Path) -> Self {
        Self {
            workspace_root: workspace_root.to_path_buf(),
            config: HookConfig::default(),
        }
    }

    pub fn config(&self) -> &HookConfig {
        &self.config
    }

    pub fn workspace_root(&self) -> &Path {
        &self.workspace_root
    }

    /// Flat listing of `(event_name, hook)` pairs in the order they were
    /// loaded. Used by the `eri/hooks/list` JSON-RPC handler.
    pub fn list(&self) -> Vec<(&'static str, &Hook)> {
        let mut out = Vec::new();
        for h in &self.config.session_start {
            out.push(("SessionStart", h));
        }
        for h in &self.config.session_end {
            out.push(("SessionEnd", h));
        }
        for h in &self.config.user_prompt_submit {
            out.push(("UserPromptSubmit", h));
        }
        for h in &self.config.pre_tool_use {
            out.push(("PreToolUse", h));
        }
        for h in &self.config.post_tool_use {
            out.push(("PostToolUse", h));
        }
        for h in &self.config.post_tool_error {
            out.push(("PostToolError", h));
        }
        out
    }

    /// Fire all hooks matching `event`. Always returns — never panics.
    /// Background hooks are spawned and a stub outcome is recorded.
    pub async fn fire(&self, event: HookEvent) -> Vec<HookOutcome> {
        let bucket = self.config.bucket(&event);
        if bucket.is_empty() {
            return Vec::new();
        }
        let target = event.matcher_target();
        let mut outcomes = Vec::with_capacity(bucket.len());
        for hook in bucket {
            if !matcher_allows(hook, target) {
                continue;
            }
            let outcome = run_hook(&self.workspace_root, hook, &event).await;
            let _ = append_audit(&self.workspace_root, &outcome);
            outcomes.push(outcome);
        }
        outcomes
    }
}

// ---------------------------------------------------------------------------
// Parsing / compilation
// ---------------------------------------------------------------------------

fn parse_per_event_file(event_name: &str, body: &str) -> Result<RawConfig> {
    let value: serde_json::Value = serde_json::from_str(body)?;
    let entries: Vec<RawHook> = match value {
        serde_json::Value::Array(_) => serde_json::from_value(value)?,
        serde_json::Value::Object(mut map) => {
            if let Some(arr) = map.remove(event_name) {
                serde_json::from_value(arr)?
            } else {
                // Object without the matching key — treat as empty.
                Vec::new()
            }
        }
        _ => {
            return Err(anyhow!(
                "per-event hook file must be an array or an object"
            ));
        }
    };
    let mut cfg = RawConfig::default();
    match event_name {
        "SessionStart" => cfg.session_start = entries,
        "SessionEnd" => cfg.session_end = entries,
        "UserPromptSubmit" => cfg.user_prompt_submit = entries,
        "PreToolUse" => cfg.pre_tool_use = entries,
        "PostToolUse" => cfg.post_tool_use = entries,
        "PostToolError" => cfg.post_tool_error = entries,
        _ => return Err(anyhow!("unknown event: {event_name}")),
    }
    Ok(cfg)
}

fn merge_raw(dst: &mut RawConfig, mut src: RawConfig) {
    dst.session_start.append(&mut src.session_start);
    dst.session_end.append(&mut src.session_end);
    dst.user_prompt_submit.append(&mut src.user_prompt_submit);
    dst.pre_tool_use.append(&mut src.pre_tool_use);
    dst.post_tool_use.append(&mut src.post_tool_use);
    dst.post_tool_error.append(&mut src.post_tool_error);
}

fn compile_config(raw: RawConfig) -> Result<HookConfig> {
    Ok(HookConfig {
        session_start: compile_bucket(raw.session_start, "SessionStart")?,
        session_end: compile_bucket(raw.session_end, "SessionEnd")?,
        user_prompt_submit: compile_bucket(raw.user_prompt_submit, "UserPromptSubmit")?,
        pre_tool_use: compile_bucket(raw.pre_tool_use, "PreToolUse")?,
        post_tool_use: compile_bucket(raw.post_tool_use, "PostToolUse")?,
        post_tool_error: compile_bucket(raw.post_tool_error, "PostToolError")?,
    })
}

fn compile_bucket(items: Vec<RawHook>, event: &str) -> Result<Vec<Hook>> {
    items
        .into_iter()
        .enumerate()
        .map(|(i, raw)| compile_one(raw, event, i))
        .collect()
}

fn compile_one(raw: RawHook, event: &str, idx: usize) -> Result<Hook> {
    let matcher = match raw.matcher.as_deref() {
        Some(s) if !s.is_empty() => Some(
            Regex::new(s)
                .with_context(|| format!("{event}[{idx}] matcher regex invalid: {s}"))?,
        ),
        _ => None,
    };
    let command = raw.command.trim().to_string();
    if command.is_empty() {
        return Err(anyhow!("{event}[{idx}] command is empty"));
    }
    if let Some(reason) = denylist_match(&command) {
        return Err(anyhow!(
            "{event}[{idx}] refused: command matches denylist ({reason})"
        ));
    }
    let timeout = Duration::from_millis(raw.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS));
    Ok(Hook {
        matcher,
        command,
        background: raw.background,
        timeout,
        env: raw.env,
        capture_output: raw.capture_output,
    })
}

// ---------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------

fn ensure_safe_workspace(path: &Path) -> Result<()> {
    let s = path.to_string_lossy();
    if s.contains('~') {
        return Err(anyhow!(
            "workspace root contains unexpanded '~' — refusing to load hooks"
        ));
    }
    if s.contains('$') {
        return Err(anyhow!(
            "workspace root contains unexpanded '$' — refusing to load hooks"
        ));
    }
    Ok(())
}

/// Tiny typo-protection denylist. Not a real security boundary — users can
/// trivially rename their commands — but it blocks the obvious accidents.
fn denylist_match(command: &str) -> Option<&'static str> {
    let normalized = command.to_lowercase();
    let needles: &[(&str, &str)] = &[
        ("rm -rf /", "destructive root delete"),
        ("rm -rf /*", "destructive root delete"),
        ("rm -rf ~", "destructive home delete"),
        ("rm -rf $home", "destructive home delete"),
        (":(){:|:&};:", "fork bomb"),
        ("mkfs", "filesystem format"),
        ("dd if=/dev/zero of=/dev/sda", "disk wipe"),
        ("dd if=/dev/random of=/dev/sda", "disk wipe"),
        ("> /dev/sda", "raw disk write"),
        ("chmod -r 000 /", "root permission wipe"),
    ];
    for (needle, reason) in needles {
        if normalized.contains(needle) {
            return Some(reason);
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Matching / execution
// ---------------------------------------------------------------------------

fn matcher_allows(hook: &Hook, target: &str) -> bool {
    match &hook.matcher {
        None => true,
        Some(re) => re.is_match(target),
    }
}

fn command_preview(cmd: &str) -> String {
    const MAX: usize = 80;
    if cmd.chars().count() <= MAX {
        return cmd.to_string();
    }
    let mut out: String = cmd.chars().take(MAX).collect();
    out.push('…');
    out
}

fn event_env_vars(event: &HookEvent) -> Vec<(String, String)> {
    let mut out = vec![("ERI_EVENT".to_string(), event.name().to_string())];
    match event {
        HookEvent::SessionStart | HookEvent::SessionEnd => {}
        HookEvent::UserPromptSubmit { source, prompt } => {
            out.push(("ERI_PROMPT".into(), prompt.clone()));
            out.push(("ERI_PROMPT_SOURCE".into(), source.clone()));
        }
        HookEvent::PreToolUse { method, params } => {
            out.push(("ERI_METHOD".into(), method.clone()));
            out.push(("ERI_PARAMS_JSON".into(), params.to_string()));
        }
        HookEvent::PostToolUse { method, result } => {
            out.push(("ERI_METHOD".into(), method.clone()));
            out.push(("ERI_RESULT_JSON".into(), result.to_string()));
        }
        HookEvent::PostToolError { method, error } => {
            out.push(("ERI_METHOD".into(), method.clone()));
            out.push(("ERI_ERROR".into(), error.clone()));
        }
    }
    out
}

#[cfg(unix)]
fn build_command(cwd: &Path, hook: &Hook) -> Command {
    let mut cmd = Command::new("sh");
    cmd.arg("-c").arg(&hook.command).current_dir(cwd);
    cmd
}

#[cfg(windows)]
fn build_command(cwd: &Path, hook: &Hook) -> Command {
    let mut cmd = Command::new("cmd");
    cmd.arg("/C").arg(&hook.command).current_dir(cwd);
    cmd
}

async fn run_hook(workspace_root: &Path, hook: &Hook, event: &HookEvent) -> HookOutcome {
    let start = Instant::now();
    let preview = command_preview(&hook.command);
    let mut cmd = build_command(workspace_root, hook);
    for (k, v) in event_env_vars(event) {
        cmd.env(k, v);
    }
    for (k, v) in &hook.env {
        cmd.env(k, v);
    }
    if hook.capture_output {
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    } else {
        cmd.stdout(Stdio::null()).stderr(Stdio::null());
    }
    cmd.stdin(Stdio::null());

    if hook.background {
        let spawn_err = match cmd.spawn() {
            Ok(_child) => None,
            Err(e) => Some(e.to_string()),
        };
        return HookOutcome {
            event: event.name().to_string(),
            command_preview: preview,
            stdout: String::new(),
            stderr: String::new(),
            exit_code: None,
            duration_ms: start.elapsed().as_millis() as u64,
            timed_out: false,
            spawn_error: spawn_err,
            backgrounded: true,
        };
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            return HookOutcome {
                event: event.name().to_string(),
                command_preview: preview,
                stdout: String::new(),
                stderr: String::new(),
                exit_code: None,
                duration_ms: start.elapsed().as_millis() as u64,
                timed_out: false,
                spawn_error: Some(e.to_string()),
                backgrounded: false,
            };
        }
    };

    // Close stdin promptly so commands that read it don't hang.
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.shutdown().await;
    }

    let wait = child.wait_with_output();
    match timeout(hook.timeout, wait).await {
        Ok(Ok(output)) => HookOutcome {
            event: event.name().to_string(),
            command_preview: preview,
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
            exit_code: output.status.code(),
            duration_ms: start.elapsed().as_millis() as u64,
            timed_out: false,
            spawn_error: None,
            backgrounded: false,
        },
        Ok(Err(e)) => HookOutcome {
            event: event.name().to_string(),
            command_preview: preview,
            stdout: String::new(),
            stderr: String::new(),
            exit_code: None,
            duration_ms: start.elapsed().as_millis() as u64,
            timed_out: false,
            spawn_error: Some(e.to_string()),
            backgrounded: false,
        },
        Err(_) => HookOutcome {
            event: event.name().to_string(),
            command_preview: preview,
            stdout: String::new(),
            stderr: String::new(),
            exit_code: None,
            duration_ms: start.elapsed().as_millis() as u64,
            timed_out: true,
            spawn_error: None,
            backgrounded: false,
        },
    }
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

fn append_audit(workspace_root: &Path, outcome: &HookOutcome) -> Result<()> {
    use std::io::Write;
    let dir = workspace_root.join(".eri");
    std::fs::create_dir_all(&dir)?;
    let path = dir.join("audit.log");
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)?;
    let entry = AuditEntry {
        kind: "hook_fired",
        event: &outcome.event,
        command_preview: &outcome.command_preview,
        exit_code: outcome.exit_code,
        duration_ms: outcome.duration_ms,
        timed_out: outcome.timed_out,
        backgrounded: outcome.backgrounded,
        spawn_error: outcome.spawn_error.as_deref(),
    };
    let line = serde_json::to_string(&entry)?;
    writeln!(file, "{line}")?;
    Ok(())
}

#[derive(Debug, Serialize)]
struct AuditEntry<'a> {
    kind: &'static str,
    event: &'a str,
    command_preview: &'a str,
    exit_code: Option<i32>,
    duration_ms: u64,
    timed_out: bool,
    backgrounded: bool,
    spawn_error: Option<&'a str>,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn write_hooks(dir: &Path, body: &str) {
        let eri = dir.join(".eri");
        fs::create_dir_all(&eri).expect("mkdir .eri");
        fs::write(eri.join("hooks.json"), body).expect("write hooks.json");
    }

    #[tokio::test]
    async fn load_parses_hooks_json() {
        let tmp = tempdir().unwrap();
        write_hooks(
            tmp.path(),
            r#"{
                "PreToolUse": [
                    { "matcher": "eri/apply/.*", "command": "echo hi" }
                ],
                "SessionStart": [
                    { "command": "echo session" }
                ]
            }"#,
        );
        let hooks = Hooks::load(tmp.path()).expect("load");
        assert_eq!(hooks.config().pre_tool_use.len(), 1);
        assert_eq!(hooks.config().session_start.len(), 1);
        assert!(hooks.config().pre_tool_use[0].matcher.is_some());
        assert_eq!(hooks.list().len(), 2);
    }

    #[tokio::test]
    async fn load_tolerates_missing_file() {
        let tmp = tempdir().unwrap();
        let hooks = Hooks::load(tmp.path()).expect("load");
        assert!(hooks.list().is_empty());
    }

    #[tokio::test]
    async fn load_supports_per_event_files() {
        let tmp = tempdir().unwrap();
        let dir = tmp.path().join(".eri").join("hooks");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("SessionStart.json"),
            r#"[{ "command": "echo per-event" }]"#,
        )
        .unwrap();
        let hooks = Hooks::load(tmp.path()).expect("load");
        assert_eq!(hooks.config().session_start.len(), 1);
    }

    #[tokio::test]
    async fn fire_session_start_runs_matching_hooks() {
        let tmp = tempdir().unwrap();
        write_hooks(
            tmp.path(),
            r#"{ "SessionStart": [ { "command": "echo hello" } ] }"#,
        );
        let hooks = Hooks::load(tmp.path()).unwrap();
        let outcomes = hooks.fire(HookEvent::SessionStart).await;
        assert_eq!(outcomes.len(), 1);
        assert_eq!(outcomes[0].exit_code, Some(0));
        assert!(outcomes[0].stdout.contains("hello"));
    }

    #[tokio::test]
    async fn fire_skips_when_matcher_does_not_match() {
        let tmp = tempdir().unwrap();
        write_hooks(
            tmp.path(),
            r#"{ "PreToolUse": [
                { "matcher": "eri/apply/.*", "command": "echo should-not-run" }
            ] }"#,
        );
        let hooks = Hooks::load(tmp.path()).unwrap();
        let outcomes = hooks
            .fire(HookEvent::PreToolUse {
                method: "eri/index/sync".into(),
                params: serde_json::json!({}),
            })
            .await;
        assert!(outcomes.is_empty());
    }

    #[tokio::test]
    async fn fire_matches_when_matcher_matches() {
        let tmp = tempdir().unwrap();
        write_hooks(
            tmp.path(),
            r#"{ "PreToolUse": [
                { "matcher": "eri/apply/.*", "command": "echo match" }
            ] }"#,
        );
        let hooks = Hooks::load(tmp.path()).unwrap();
        let outcomes = hooks
            .fire(HookEvent::PreToolUse {
                method: "eri/apply/run".into(),
                params: serde_json::json!({}),
            })
            .await;
        assert_eq!(outcomes.len(), 1);
        assert!(outcomes[0].stdout.contains("match"));
    }

    #[tokio::test]
    async fn timeout_kills_long_running_commands() {
        let tmp = tempdir().unwrap();
        write_hooks(
            tmp.path(),
            r#"{ "SessionStart": [ { "command": "sleep 5", "timeoutMs": 200 } ] }"#,
        );
        let hooks = Hooks::load(tmp.path()).unwrap();
        let outcomes = hooks.fire(HookEvent::SessionStart).await;
        assert_eq!(outcomes.len(), 1);
        assert!(outcomes[0].timed_out, "expected timeout flag");
        assert!(outcomes[0].duration_ms < 2_000);
    }

    #[tokio::test]
    async fn background_returns_immediately() {
        let tmp = tempdir().unwrap();
        write_hooks(
            tmp.path(),
            r#"{ "SessionStart": [
                { "command": "sleep 5", "background": true, "timeoutMs": 30000 }
            ] }"#,
        );
        let hooks = Hooks::load(tmp.path()).unwrap();
        let started = Instant::now();
        let outcomes = hooks.fire(HookEvent::SessionStart).await;
        assert_eq!(outcomes.len(), 1);
        assert!(outcomes[0].backgrounded);
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[tokio::test]
    async fn env_variables_propagated() {
        let tmp = tempdir().unwrap();
        write_hooks(
            tmp.path(),
            r#"{ "UserPromptSubmit": [
                { "command": "printf '%s' \"$ERI_PROMPT|$ERI_HOOK_SOURCE\"",
                  "env": { "ERI_HOOK_SOURCE": "voice" } }
            ] }"#,
        );
        let hooks = Hooks::load(tmp.path()).unwrap();
        let outcomes = hooks
            .fire(HookEvent::UserPromptSubmit {
                source: "voice".into(),
                prompt: "hello world".into(),
            })
            .await;
        assert_eq!(outcomes.len(), 1);
        assert_eq!(outcomes[0].stdout, "hello world|voice");
    }

    #[tokio::test]
    async fn capture_output_records_stdout_stderr() {
        let tmp = tempdir().unwrap();
        write_hooks(
            tmp.path(),
            r#"{ "SessionStart": [
                { "command": "printf out; printf err 1>&2; exit 3" }
            ] }"#,
        );
        let hooks = Hooks::load(tmp.path()).unwrap();
        let outcomes = hooks.fire(HookEvent::SessionStart).await;
        assert_eq!(outcomes.len(), 1);
        assert_eq!(outcomes[0].stdout, "out");
        assert_eq!(outcomes[0].stderr, "err");
        assert_eq!(outcomes[0].exit_code, Some(3));
    }

    #[tokio::test]
    async fn matcher_regex_compile_error_surfaces_at_load() {
        let tmp = tempdir().unwrap();
        write_hooks(
            tmp.path(),
            r#"{ "PreToolUse": [
                { "matcher": "(unclosed", "command": "echo x" }
            ] }"#,
        );
        let err = Hooks::load(tmp.path()).expect_err("expected regex error");
        let msg = format!("{err:#}");
        assert!(msg.contains("matcher regex invalid"), "got: {msg}");
    }

    #[tokio::test]
    async fn denylist_refuses_dangerous_patterns() {
        let tmp = tempdir().unwrap();
        write_hooks(
            tmp.path(),
            r#"{ "SessionStart": [ { "command": "rm -rf /" } ] }"#,
        );
        let err = Hooks::load(tmp.path()).expect_err("expected denylist refusal");
        let msg = format!("{err:#}");
        assert!(msg.contains("denylist"), "got: {msg}");
    }

    #[tokio::test]
    async fn audit_log_appended() {
        let tmp = tempdir().unwrap();
        write_hooks(
            tmp.path(),
            r#"{ "SessionStart": [ { "command": "echo audit" } ] }"#,
        );
        let hooks = Hooks::load(tmp.path()).unwrap();
        let _ = hooks.fire(HookEvent::SessionStart).await;
        let log = fs::read_to_string(tmp.path().join(".eri").join("audit.log"))
            .expect("audit log");
        assert!(log.contains("hook_fired"));
        assert!(log.contains("SessionStart"));
    }
}
