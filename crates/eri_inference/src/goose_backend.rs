//! Goose (Block's open-source local-first agent) CLI backend.
//!
//! Mirrors [`crate::ClaudeCliBackend`] so eri can swap between Claude Code and
//! Goose as the polish / ship-it engine without callers caring which agent
//! answered. The two backends share the same prompt builders
//! ([`crate::build_polish_prompt`], [`crate::build_ship_it_prompt`],
//! [`crate::build_seo_audit_prompt`]) — only the spawned binary differs.
//!
//! Selection is driven by the `ERI_AGENT_BACKEND` env var (`claude` or
//! `goose`); the panel boots the [`AgentBackend`] returned by
//! [`AgentBackend::detect`] and the voice command "use goose" / "use claude"
//! flips it at runtime.

use std::{
    env,
    path::{Path, PathBuf},
    sync::{Arc, atomic::{AtomicBool, Ordering}},
};

use crate::{
    ClaudeCliBackend, InferenceError, build_polish_prompt, build_seo_audit_prompt,
    build_ship_it_prompt, build_ship_it_prompt_with_target,
};

/// Parallel polish backend that drives the locally-installed `goose` CLI
/// (Block's open-source agent) as a subprocess. Same shape as
/// [`ClaudeCliBackend`] — uses the same prompt builders, returns the same
/// diff-block stdout so the existing extractor reuses cleanly. Invoked
/// non-interactively via `goose run -t "<prompt>"`.
#[derive(Debug, Clone)]
pub struct GooseCliBackend {
    binary: PathBuf,
    extra_args: Vec<String>,
}

impl GooseCliBackend {
    /// Detect whether `goose` is available on PATH. Returns `None` if not,
    /// in which case callers should fall back to Claude. Honors the
    /// `ERI_GOOSE_BIN` override for non-PATH installs.
    pub fn detect() -> Option<Self> {
        let _ = dotenvy::dotenv();
        let candidate = env::var("ERI_GOOSE_BIN").unwrap_or_else(|_| "goose".to_string());
        which_path(&candidate).map(|resolved| Self {
            binary: resolved,
            extra_args: Vec::new(),
        })
    }

    pub fn binary(&self) -> &Path {
        &self.binary
    }

    pub fn run_ship_it(
        &self,
        intents: &[String],
        final_html: &str,
        cancel: Arc<AtomicBool>,
    ) -> Result<String, InferenceError> {
        let prompt = build_ship_it_prompt(intents, final_html);
        self.run_with_prompt(&prompt, cancel)
    }

    pub fn run_ship_it_with_target(
        &self,
        intents: &[String],
        final_html: &str,
        target_url: Option<&str>,
        cancel: Arc<AtomicBool>,
    ) -> Result<String, InferenceError> {
        let prompt = build_ship_it_prompt_with_target(intents, final_html, target_url);
        self.run_with_prompt(&prompt, cancel)
    }

    pub fn run_seo_audit(
        &self,
        current_html: &str,
        target_url: Option<&str>,
        cancel: Arc<AtomicBool>,
    ) -> Result<String, InferenceError> {
        let prompt = build_seo_audit_prompt(current_html, target_url);
        self.run_with_prompt(&prompt, cancel)
    }

    pub fn run_polish(
        &self,
        user_request: &str,
        current_html: &str,
        cancel: Arc<AtomicBool>,
    ) -> Result<String, InferenceError> {
        let prompt = build_polish_prompt(user_request, current_html);
        self.run_with_prompt(&prompt, cancel)
    }

    /// Run `goose run -t "<prompt>"` in a blocking subprocess. The caller
    /// should invoke this from `cx.background_spawn` so the foreground
    /// thread stays responsive. `cancel` is checked before launching and
    /// while polling; killing the process aborts in-flight work.
    fn run_with_prompt(
        &self,
        prompt: &str,
        cancel: Arc<AtomicBool>,
    ) -> Result<String, InferenceError> {
        if cancel.load(Ordering::Relaxed) {
            return Err(InferenceError::Transport("polish cancelled".into()));
        }
        let mut cmd = std::process::Command::new(&self.binary);
        // `goose run -t "<prompt>"` is the non-interactive single-shot form:
        // it consumes the prompt as a one-off message and prints the model
        // response on stdout. No session is persisted.
        cmd.arg("run").arg("-t").arg(prompt);
        for arg in &self.extra_args {
            cmd.arg(arg);
        }
        cmd.stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        eprintln!(
            "[eri.goose] spawning polish: {} args + prompt of {} chars",
            self.extra_args.len(),
            prompt.len()
        );
        let mut child = cmd
            .spawn()
            .map_err(|err| InferenceError::Transport(format!("spawn goose failed: {err}")))?;
        loop {
            if cancel.load(Ordering::Relaxed) {
                let kill_err = child.kill();
                let wait_err = child.wait();
                if let Err(error) = kill_err {
                    log::warn!("goose kill failed during cancel: {error}");
                }
                if let Err(error) = wait_err {
                    log::warn!("goose wait failed after cancel: {error}");
                }
                return Err(InferenceError::Transport("polish cancelled".into()));
            }
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) => std::thread::sleep(std::time::Duration::from_millis(120)),
                Err(err) => {
                    return Err(InferenceError::Transport(format!(
                        "goose wait failed: {err}"
                    )));
                }
            }
        }
        let output = child
            .wait_with_output()
            .map_err(|err| InferenceError::Transport(format!("goose output: {err}")))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(InferenceError::Transport(format!(
                "goose exited with {}: {stderr}",
                output.status
            )));
        }
        let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
        eprintln!(
            "[eri.goose] polish done: exit={} stdout={} chars stderr={} chars",
            output.status,
            stdout.len(),
            output.stderr.len()
        );
        Ok(stdout)
    }
}

/// Which autonomous-agent CLI is driving polish / ship-it / SEO audit. The
/// rest of eri calls one of these dispatch methods; callers don't need to
/// know which agent answered. Cloned freely (each variant is a thin
/// `Arc`-of-`PathBuf` underneath).
#[derive(Debug, Clone)]
pub enum AgentBackend {
    Claude(ClaudeCliBackend),
    Goose(GooseCliBackend),
}

/// Which backend the user (or `ERI_AGENT_BACKEND`) prefers. Detection falls
/// back gracefully when the preferred binary isn't installed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentChoice {
    Claude,
    Goose,
}

impl AgentChoice {
    /// Parse `ERI_AGENT_BACKEND` (or the voice-command tail). Unknown values
    /// return `None` so callers fall back to the default-detect path.
    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "claude" | "claude-code" | "claude_code" | "anthropic" => Some(Self::Claude),
            "goose" | "block" | "block-goose" => Some(Self::Goose),
            _ => None,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Goose => "goose",
        }
    }
}

impl AgentBackend {
    /// Probe both CLIs and the env var, then pick the best available backend.
    ///
    /// Order:
    /// 1. If `ERI_AGENT_BACKEND` names a backend AND that backend is
    ///    installed, use it.
    /// 2. If the named backend is NOT installed, fall back to whichever is
    ///    available (preferring Claude as the historical default).
    /// 3. With no env preference, prefer Claude when both are available.
    pub fn detect() -> Option<Self> {
        let _ = dotenvy::dotenv();
        let env_choice = env::var("ERI_AGENT_BACKEND")
            .ok()
            .as_deref()
            .and_then(AgentChoice::parse);
        Self::detect_with(env_choice, ClaudeCliBackend::detect, GooseCliBackend::detect)
    }

    /// Test seam: same selection logic as [`Self::detect`] but with explicit
    /// detector closures so unit tests can simulate "claude missing" /
    /// "goose missing" without touching PATH.
    pub fn detect_with<C, G>(
        env_choice: Option<AgentChoice>,
        detect_claude: C,
        detect_goose: G,
    ) -> Option<Self>
    where
        C: FnOnce() -> Option<ClaudeCliBackend>,
        G: FnOnce() -> Option<GooseCliBackend>,
    {
        match env_choice {
            Some(AgentChoice::Goose) => {
                if let Some(goose) = detect_goose() {
                    return Some(Self::Goose(goose));
                }
                detect_claude().map(Self::Claude)
            }
            Some(AgentChoice::Claude) => {
                if let Some(claude) = detect_claude() {
                    return Some(Self::Claude(claude));
                }
                detect_goose().map(Self::Goose)
            }
            None => {
                if let Some(claude) = detect_claude() {
                    return Some(Self::Claude(claude));
                }
                detect_goose().map(Self::Goose)
            }
        }
    }

    /// Pick a specific backend if its binary is installed. Used by the
    /// "use goose" / "use claude" voice command — when the named backend
    /// isn't installed, returns `None` so the caller can surface a clear
    /// "<name> not installed" status without flipping silently.
    pub fn select(choice: AgentChoice) -> Option<Self> {
        match choice {
            AgentChoice::Claude => ClaudeCliBackend::detect().map(Self::Claude),
            AgentChoice::Goose => GooseCliBackend::detect().map(Self::Goose),
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            Self::Claude(_) => "claude",
            Self::Goose(_) => "goose",
        }
    }

    pub fn choice(&self) -> AgentChoice {
        match self {
            Self::Claude(_) => AgentChoice::Claude,
            Self::Goose(_) => AgentChoice::Goose,
        }
    }

    pub fn run_polish(
        &self,
        user_request: &str,
        current_html: &str,
        cancel: Arc<AtomicBool>,
    ) -> Result<String, InferenceError> {
        match self {
            Self::Claude(c) => c.run_polish(user_request, current_html, cancel),
            Self::Goose(g) => g.run_polish(user_request, current_html, cancel),
        }
    }

    pub fn run_ship_it(
        &self,
        intents: &[String],
        final_html: &str,
        cancel: Arc<AtomicBool>,
    ) -> Result<String, InferenceError> {
        match self {
            Self::Claude(c) => c.run_ship_it(intents, final_html, cancel),
            Self::Goose(g) => g.run_ship_it(intents, final_html, cancel),
        }
    }

    pub fn run_ship_it_with_target(
        &self,
        intents: &[String],
        final_html: &str,
        target_url: Option<&str>,
        cancel: Arc<AtomicBool>,
    ) -> Result<String, InferenceError> {
        match self {
            Self::Claude(c) => c.run_ship_it_with_target(intents, final_html, target_url, cancel),
            Self::Goose(g) => g.run_ship_it_with_target(intents, final_html, target_url, cancel),
        }
    }

    pub fn run_seo_audit(
        &self,
        current_html: &str,
        target_url: Option<&str>,
        cancel: Arc<AtomicBool>,
    ) -> Result<String, InferenceError> {
        match self {
            Self::Claude(c) => c.run_seo_audit(current_html, target_url, cancel),
            Self::Goose(g) => g.run_seo_audit(current_html, target_url, cancel),
        }
    }

    /// Run an integration scaffolding prompt (Auth0 / Clerk / Supabase / Neon
    /// / Stripe). Only Claude supports this today — the integration prompts
    /// rely on Claude Code's file-system access pattern. Goose users get a
    /// clear "switch to claude" error rather than a silent failure.
    pub fn run_integration(
        &self,
        prompt: &str,
        cancel: Arc<AtomicBool>,
    ) -> Result<String, InferenceError> {
        match self {
            Self::Claude(c) => c.run_integration(prompt, cancel),
            Self::Goose(_) => Err(InferenceError::Transport(
                "integration scaffolding requires Claude Code — say \"use claude\" first".into(),
            )),
        }
    }

    /// Generate the social-thread (Twitter/X) prompt. Claude-only today; the
    /// Goose path just runs Goose with the same prompt body since the prompt
    /// is a self-contained one-shot ask. Returns raw stdout — the caller
    /// pipes it through [`crate::social::parse_social_thread`].
    pub fn run_social_thread(
        &self,
        project_name: &str,
        intents: &[String],
        deployed_url: Option<&str>,
        recording_path: Option<&std::path::Path>,
        iteration_count: u64,
        cancel: Arc<AtomicBool>,
    ) -> Result<String, InferenceError> {
        match self {
            Self::Claude(c) => c.run_social_thread(
                project_name,
                intents,
                deployed_url,
                recording_path,
                iteration_count,
                cancel,
            ),
            Self::Goose(g) => {
                let prompt = crate::social::build_social_thread_prompt(
                    project_name,
                    intents,
                    deployed_url,
                    recording_path,
                    iteration_count,
                );
                // Goose only exposes a polish entry point, so we route the
                // social prompt through it with an empty current_html — the
                // prompt is fully self-contained and doesn't depend on
                // current build state.
                g.run_polish(&prompt, "", cancel)
            }
        }
    }
}

fn which_path(bin: &str) -> Option<PathBuf> {
    if bin.contains('/') {
        let candidate = PathBuf::from(bin);
        return candidate.is_file().then_some(candidate);
    }
    let path_var = env::var_os("PATH")?;
    for entry in env::split_paths(&path_var) {
        let candidate = entry.join(bin);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_choice_parses_known_aliases() {
        assert_eq!(AgentChoice::parse("claude"), Some(AgentChoice::Claude));
        assert_eq!(AgentChoice::parse("Claude"), Some(AgentChoice::Claude));
        assert_eq!(AgentChoice::parse("claude-code"), Some(AgentChoice::Claude));
        assert_eq!(AgentChoice::parse("goose"), Some(AgentChoice::Goose));
        assert_eq!(AgentChoice::parse("Block"), Some(AgentChoice::Goose));
        assert_eq!(AgentChoice::parse("openai"), None);
        assert_eq!(AgentChoice::parse(""), None);
    }

    #[test]
    fn which_path_resolves_absolute_binary() {
        // `/bin/echo` exists on every UNIX host, so this is a reliable probe
        // that `which_path` honors the absolute-path shortcut without
        // touching $PATH.
        assert_eq!(
            which_path("/bin/echo"),
            Some(PathBuf::from("/bin/echo"))
        );
    }
}
