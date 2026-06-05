//! Persistent agentic sessions for the `eri` CLI.
//!
//! A session captures a multi-turn conversation so work can resume across shell
//! invocations -- the "resume session" parity users expect from Claude Code /
//! Codex. Each session is one JSON file at `~/.config/eri/sessions/<id>.json`:
//!
//! ```json
//! {
//!   "id": "s_...",
//!   "createdAt": 1717459200,
//!   "updatedAt": 1717459260,
//!   "workspace": "/abs/path",
//!   "model": "claude-sonnet-4-6",
//!   "title": "a coffee shop landing page",
//!   "turns": 4,
//!   "tokensIn": 6616,
//!   "tokensOut": 1656,
//!   "messages": [ { "role": "user", "content": "..." }, ... ]
//! }
//! ```
//!
//! `messages` is the verbatim Anthropic Messages array, so a resumed session
//! seeds the model with the full prior context. No prompt content leaves the
//! machine except via the same metered inference proxy a fresh turn would use.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A persisted multi-turn session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub workspace: String,
    pub model: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default)]
    pub turns: usize,
    #[serde(default)]
    pub tokens_in: u64,
    #[serde(default)]
    pub tokens_out: u64,
    #[serde(default)]
    pub messages: Vec<Value>,
}

/// Lightweight listing row -- everything `eri sessions` / a resume picker needs
/// without loading the full message history.
#[derive(Debug, Clone)]
pub struct SessionMeta {
    pub id: String,
    pub updated_at: u64,
    pub title: Option<String>,
    pub workspace: String,
    pub turns: usize,
    pub tokens_in: u64,
    pub tokens_out: u64,
}

impl Session {
    /// Start a fresh session anchored to `workspace`, using `model`.
    pub fn create(workspace: &Path, model: &str) -> Self {
        let now = unix_secs();
        let workspace = workspace
            .canonicalize()
            .unwrap_or_else(|_| workspace.to_path_buf())
            .to_string_lossy()
            .to_string();
        Session {
            id: new_id(),
            created_at: now,
            updated_at: now,
            workspace,
            model: model.to_string(),
            title: None,
            turns: 0,
            tokens_in: 0,
            tokens_out: 0,
            messages: Vec::new(),
        }
    }

    /// Set the title from the first user prompt if not already set.
    pub fn ensure_title(&mut self, from_prompt: &str) {
        if self.title.is_none() {
            let t: String = from_prompt.trim().chars().take(72).collect();
            if !t.is_empty() {
                self.title = Some(t);
            }
        }
    }

    /// Stamp `updated_at` to now.
    pub fn touch(&mut self) {
        self.updated_at = unix_secs();
    }

    pub fn workspace_path(&self) -> PathBuf {
        PathBuf::from(&self.workspace)
    }

    /// Branch this session: a new session (new id) that starts from this one's
    /// full conversation state so it can diverge without disturbing the
    /// original. Messages + workspace + model carry over; per-session counters
    /// reset (the branch accrues its own usage); the title notes the lineage.
    /// Does not persist -- the caller saves the returned session.
    pub fn fork(&self) -> Session {
        let now = unix_secs();
        let base = self
            .title
            .clone()
            .unwrap_or_else(|| self.id.chars().take(8).collect());
        Session {
            id: new_id(),
            created_at: now,
            updated_at: now,
            workspace: self.workspace.clone(),
            model: self.model.clone(),
            title: Some(format!("fork of {base}")),
            turns: 0,
            tokens_in: 0,
            tokens_out: 0,
            messages: self.messages.clone(),
        }
    }

    /// A short human recap of where this session left off -- for when you return
    /// to it (`/recap`, resume picker). Pure + deterministic.
    pub fn recap(&self) -> String {
        let title = self.title.as_deref().unwrap_or("(untitled)");
        let mut out = format!(
            "{title}\n  id {}  ·  {} turns  ·  {} in / {} out tokens",
            self.id.chars().take(8).collect::<String>(),
            self.turns,
            self.tokens_in,
            self.tokens_out
        );
        if let Some(last) = last_text_snippet(&self.messages) {
            out.push_str(&format!("\n  last: {last}"));
        }
        out
    }

    /// Persist this session to disk (pretty JSON).
    pub fn save(&self) -> Result<()> {
        let dir = sessions_dir()?;
        fs::create_dir_all(&dir).with_context(|| format!("create {}", dir.display()))?;
        let path = dir.join(format!("{}.json", self.id));
        let body = serde_json::to_string_pretty(self).context("serialize session")?;
        fs::write(&path, format!("{body}\n"))
            .with_context(|| format!("write {}", path.display()))?;
        Ok(())
    }
}

/// Directory holding session files: `~/.config/eri/sessions`.
pub fn sessions_dir() -> Result<PathBuf> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .context("no HOME / USERPROFILE -- cannot resolve sessions dir")?;
    Ok(PathBuf::from(home)
        .join(".config")
        .join("eri")
        .join("sessions"))
}

/// Load a session by exact id.
pub fn load(id: &str) -> Result<Session> {
    let path = sessions_dir()?.join(format!("{id}.json"));
    let raw = fs::read_to_string(&path)
        .with_context(|| format!("no session {id} (looked at {})", path.display()))?;
    serde_json::from_str(&raw).with_context(|| format!("parse {}", path.display()))
}

/// Resolve a session by exact id or unambiguous id-prefix.
pub fn resolve(id_or_prefix: &str) -> Result<Session> {
    if load(id_or_prefix).is_ok() {
        return load(id_or_prefix);
    }
    let matches: Vec<SessionMeta> = list()?
        .into_iter()
        .filter(|m| m.id.starts_with(id_or_prefix))
        .collect();
    match matches.as_slice() {
        [] => anyhow::bail!("no session matching '{id_or_prefix}' -- try `eri sessions`"),
        [one] => load(&one.id),
        many => anyhow::bail!(
            "'{id_or_prefix}' is ambiguous ({} sessions match) -- use a longer id",
            many.len()
        ),
    }
}

/// List sessions, most-recently-updated first.
pub fn list() -> Result<Vec<SessionMeta>> {
    let dir = sessions_dir()?;
    let rd = match fs::read_dir(&dir) {
        Ok(rd) => rd,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e).with_context(|| format!("read {}", dir.display())),
    };
    let mut out: Vec<SessionMeta> = Vec::new();
    for entry in rd.filter_map(std::result::Result::ok) {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Ok(raw) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(s) = serde_json::from_str::<Session>(&raw) else {
            continue;
        };
        out.push(SessionMeta {
            id: s.id,
            updated_at: s.updated_at,
            title: s.title,
            workspace: s.workspace,
            turns: s.turns,
            tokens_in: s.tokens_in,
            tokens_out: s.tokens_out,
        });
    }
    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(out)
}

/// Most-recently-updated session, for `--continue`.
pub fn latest() -> Result<Option<Session>> {
    match list()?.first() {
        Some(meta) => Ok(Some(load(&meta.id)?)),
        None => Ok(None),
    }
}

fn unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// The last readable text from the conversation (newest user or assistant
/// text), trimmed to a one-line snippet. `None` for an empty/contentless
/// history. Used by `recap`.
fn last_text_snippet(messages: &[Value]) -> Option<String> {
    for msg in messages.iter().rev() {
        let text = match msg.get("content") {
            // Plain-string user turn.
            Some(Value::String(s)) => Some(s.clone()),
            // Content-array turn: take its text blocks (assistant) or any
            // string-valued content.
            Some(Value::Array(blocks)) => {
                let joined: String = blocks
                    .iter()
                    .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
                    .filter_map(|b| b.get("text").and_then(Value::as_str))
                    .collect::<Vec<_>>()
                    .join(" ");
                if joined.trim().is_empty() {
                    None
                } else {
                    Some(joined)
                }
            }
            _ => None,
        };
        if let Some(t) = text {
            let one_line = t.split_whitespace().collect::<Vec<_>>().join(" ");
            if one_line.is_empty() {
                continue;
            }
            let snippet: String = one_line.chars().take(100).collect();
            return Some(snippet);
        }
    }
    None
}

/// Generate a sortable, collision-resistant session id: `s_<millis36>_<seq36>`.
/// Millis give human-sortable ordering; a process-local monotonic counter
/// guarantees uniqueness even for rapid same-millisecond creates (the nanos
/// clock can otherwise repeat within one millisecond).
fn new_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let millis = now.as_millis() as u64;
    let seq = SEQ.fetch_add(1, Ordering::Relaxed);
    format!("s_{}_{}", base36(millis), base36(seq))
}

fn base36(mut n: u64) -> String {
    const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if n == 0 {
        return "0".to_string();
    }
    let mut buf = Vec::new();
    while n > 0 {
        buf.push(DIGITS[(n % 36) as usize]);
        n /= 36;
    }
    buf.reverse();
    String::from_utf8(buf).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::TempDir;

    fn with_temp_home<F: FnOnce()>(f: F) {
        let _g = crate::config::ENV_TEST_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let dir = TempDir::new().unwrap();
        let prev = std::env::var("HOME").ok();
        unsafe {
            std::env::set_var("HOME", dir.path());
        }
        f();
        unsafe {
            match prev.as_deref() {
                Some(v) => std::env::set_var("HOME", v),
                None => std::env::remove_var("HOME"),
            }
        }
    }

    #[test]
    fn create_save_load_roundtrips() {
        with_temp_home(|| {
            let mut s = Session::create(Path::new("."), "claude-sonnet-4-6");
            s.ensure_title("build a coffee shop site");
            s.messages.push(json!({ "role": "user", "content": "hi" }));
            s.turns = 2;
            s.tokens_in = 100;
            s.tokens_out = 40;
            s.save().unwrap();

            let loaded = load(&s.id).unwrap();
            assert_eq!(loaded.id, s.id);
            assert_eq!(loaded.title.as_deref(), Some("build a coffee shop site"));
            assert_eq!(loaded.turns, 2);
            assert_eq!(loaded.tokens_out, 40);
            assert_eq!(loaded.messages.len(), 1);
        });
    }

    #[test]
    fn fork_copies_history_with_new_id_and_reset_counters() {
        let mut parent = Session::create(Path::new("."), "claude-sonnet-4-6");
        parent.ensure_title("add auth");
        parent
            .messages
            .push(json!({ "role": "user", "content": "first" }));
        parent.turns = 3;
        parent.tokens_in = 500;
        parent.tokens_out = 200;

        let child = parent.fork();
        assert_ne!(child.id, parent.id, "fork gets a fresh id");
        assert_eq!(child.messages, parent.messages, "history carries over");
        assert_eq!(child.model, parent.model);
        assert_eq!(child.workspace, parent.workspace);
        assert_eq!(child.title.as_deref(), Some("fork of add auth"));
        // The branch accrues its own usage.
        assert_eq!(child.turns, 0);
        assert_eq!(child.tokens_in, 0);
        assert_eq!(child.tokens_out, 0);
        // The parent is untouched.
        assert_eq!(parent.turns, 3);
    }

    #[test]
    fn recap_summarizes_and_includes_last_text() {
        let mut s = Session::create(Path::new("."), "m");
        s.ensure_title("build a parser");
        s.turns = 2;
        s.messages
            .push(json!({ "role": "user", "content": "write the lexer" }));
        s.messages.push(json!({
            "role": "assistant",
            "content": [
                { "type": "text", "text": "Done -- the lexer handles all tokens now." },
                { "type": "tool_use", "id": "x", "name": "done", "input": {} }
            ]
        }));
        let r = s.recap();
        assert!(r.contains("build a parser"));
        assert!(r.contains("2 turns"));
        // Newest text wins (assistant's), not the tool_use block.
        assert!(r.contains("the lexer handles all tokens"));
    }

    #[test]
    fn recap_handles_empty_history() {
        let s = Session::create(Path::new("."), "m");
        let r = s.recap();
        assert!(r.contains("(untitled)"));
        assert!(!r.contains("last:"));
    }

    #[test]
    fn list_is_newest_first_and_latest_matches() {
        with_temp_home(|| {
            let mut a = Session::create(Path::new("."), "m");
            a.updated_at = 1000;
            a.save().unwrap();
            let mut b = Session::create(Path::new("."), "m");
            b.updated_at = 2000;
            b.save().unwrap();

            let listed = list().unwrap();
            assert_eq!(listed.len(), 2);
            assert_eq!(listed[0].updated_at, 2000);
            assert_eq!(latest().unwrap().unwrap().id, b.id);
        });
    }

    #[test]
    fn resolve_by_prefix() {
        with_temp_home(|| {
            let s = Session::create(Path::new("."), "m");
            s.save().unwrap();
            let prefix = &s.id[..s.id.len() - 2];
            assert_eq!(resolve(prefix).unwrap().id, s.id);
        });
    }

    #[test]
    fn missing_session_errors() {
        with_temp_home(|| {
            assert!(load("s_nope").is_err());
            assert!(resolve("s_nope").is_err());
            assert!(list().unwrap().is_empty());
            assert!(latest().unwrap().is_none());
        });
    }

    #[test]
    fn base36_encodes() {
        assert_eq!(base36(0), "0");
        assert_eq!(base36(35), "z");
        assert_eq!(base36(36), "10");
    }
}
