//! Interactive line editing for `eri chat` -- history, Ctrl-R reverse search,
//! emacs/vim keymaps, and a real Ctrl-C-cancels-the-line behavior, via
//! `rustyline`. Falls back to plain line reading when stdin isn't a terminal
//! (so `echo "hi" | eri chat` still works).
//!
//! The editor is sync/blocking; the chat loop is async, so reads run on
//! `spawn_blocking` and the editor is handed in and back each turn (it owns the
//! history). History persists at `~/.config/eri/history`.

use std::io::IsTerminal;
use std::path::PathBuf;

use rustyline::error::ReadlineError;

/// The outcome of one prompt read.
pub enum Line {
    /// A line of input (already owned).
    Text(String),
    /// Ctrl-C at the prompt -- cancel this line, keep the session (like a shell).
    Interrupted,
    /// Ctrl-D / EOF / closed pipe -- end the session.
    Eof,
}

/// History file: `~/.config/eri/history`. `None` if no home dir.
pub fn history_path() -> Option<PathBuf> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()?;
    Some(
        PathBuf::from(home)
            .join(".config")
            .join("eri")
            .join("history"),
    )
}

/// A line reader that uses rustyline on a TTY and a plain stdin reader otherwise.
pub struct LineEditor {
    /// `Some` on a TTY; `None` means use the plain fallback. Wrapped so it can be
    /// moved into `spawn_blocking` and returned (it carries the history).
    editor: Option<rustyline::DefaultEditor>,
    interactive: bool,
}

impl LineEditor {
    pub fn new() -> Self {
        let is_tty = std::io::stdin().is_terminal();
        let mut editor = if is_tty {
            rustyline::DefaultEditor::new().ok()
        } else {
            None
        };
        if let (Some(ed), Some(path)) = (editor.as_mut(), history_path()) {
            let _ = ed.load_history(&path);
        }
        let interactive = editor.is_some();
        Self {
            editor,
            interactive,
        }
    }

    /// Read one line for `prompt`. Async: the blocking read runs on a worker.
    pub async fn read_line(&mut self, prompt: &str) -> Line {
        if self.interactive {
            self.read_rustyline(prompt).await
        } else {
            read_plain(prompt).await
        }
    }

    async fn read_rustyline(&mut self, prompt: &str) -> Line {
        let Some(mut ed) = self.editor.take() else {
            return Line::Eof;
        };
        let p = prompt.to_string();
        let joined = tokio::task::spawn_blocking(move || {
            let r = ed.readline(&p);
            (ed, r)
        })
        .await;
        match joined {
            Ok((ed, result)) => {
                self.editor = Some(ed);
                match result {
                    Ok(line) => Line::Text(line),
                    Err(ReadlineError::Interrupted) => Line::Interrupted,
                    Err(ReadlineError::Eof) => Line::Eof,
                    // Any other read error ends the session cleanly.
                    Err(_) => Line::Eof,
                }
            }
            // The blocking task panicked/was cancelled -- editor is lost; end.
            Err(_) => Line::Eof,
        }
    }

    /// Record `line` in history (interactive only) and persist best-effort.
    pub fn remember(&mut self, line: &str) {
        if let Some(ed) = self.editor.as_mut() {
            let _ = ed.add_history_entry(line);
            if let Some(path) = history_path() {
                if let Some(parent) = path.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                let _ = ed.save_history(&path);
            }
        }
    }
}

impl Default for LineEditor {
    fn default() -> Self {
        Self::new()
    }
}

/// Plain blocking stdin read for the non-TTY path. Prints the prompt to stderr
/// (so piped stdout stays clean) and reads a line.
async fn read_plain(prompt: &str) -> Line {
    let p = prompt.to_string();
    let joined = tokio::task::spawn_blocking(move || {
        use std::io::Write as _;
        let _ = write!(std::io::stderr(), "{p}");
        let _ = std::io::stderr().flush();
        let mut buf = String::new();
        match std::io::stdin().read_line(&mut buf) {
            Ok(0) => None, // EOF
            Ok(_) => Some(buf),
            Err(_) => None,
        }
    })
    .await;
    match joined {
        Ok(Some(line)) => Line::Text(line),
        _ => Line::Eof,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn history_path_is_under_config_eri() {
        // With HOME set, the path is deterministic.
        let prev = std::env::var("HOME").ok();
        // Use the crate-wide env lock so we don't race other HOME-mutating tests.
        let _g = crate::config::ENV_TEST_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        unsafe {
            std::env::set_var("HOME", "/tmp/eri-home-test");
        }
        let p = history_path().unwrap();
        unsafe {
            match prev {
                Some(v) => std::env::set_var("HOME", v),
                None => std::env::remove_var("HOME"),
            }
        }
        assert!(p.ends_with(".config/eri/history"), "got {}", p.display());
    }

    #[test]
    fn editor_constructs_without_panicking() {
        // In CI stdin isn't a TTY, so this takes the fallback path -- it must
        // still build cleanly and report non-interactive.
        let ed = LineEditor::new();
        // remember() is a no-op without a rustyline editor; must not panic.
        let mut ed = ed;
        ed.remember("hello");
    }
}
