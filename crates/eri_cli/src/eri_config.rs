//! Project + global `.eri/config.toml` defaults.
//!
//! A small key=value file sets defaults so you don't repeat flags:
//!
//! ```toml
//! mode = "fast"       # fast | thinking | auto  (default for build/chat)
//! max_turns = 16      # headless turn cap
//! ```
//!
//! Precedence: explicit CLI flag > project `.eri/config.toml` > global
//! `~/.config/eri/config.toml` > built-in default. Parsed by hand (only a few
//! scalar keys) to avoid a TOML dependency.

use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct EriConfig {
    /// "fast" | "thinking" | "auto".
    pub mode: Option<String>,
    /// Headless turn cap.
    pub max_turns: Option<usize>,
}

impl EriConfig {
    /// Overlay `other` onto `self` (other wins for set fields).
    fn merge(mut self, other: EriConfig) -> EriConfig {
        if other.mode.is_some() {
            self.mode = other.mode;
        }
        if other.max_turns.is_some() {
            self.max_turns = other.max_turns;
        }
        self
    }
}

fn strip_quotes(s: &str) -> &str {
    let s = s.trim();
    s.strip_prefix('"')
        .and_then(|r| r.strip_suffix('"'))
        .or_else(|| s.strip_prefix('\'').and_then(|r| r.strip_suffix('\'')))
        .unwrap_or(s)
}

/// Parse the supported scalar keys from a config file's text. Unknown keys and
/// `[sections]` are ignored, so a richer TOML file still parses what we use.
fn parse(text: &str) -> EriConfig {
    let mut cfg = EriConfig::default();
    for raw in text.lines() {
        let line = raw.split('#').next().unwrap_or("").trim();
        if line.is_empty() || line.starts_with('[') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        let value = strip_quotes(value);
        match key {
            "mode" => {
                let v = value.to_lowercase();
                if matches!(v.as_str(), "fast" | "thinking" | "auto") {
                    cfg.mode = Some(v);
                }
            }
            "max_turns" => {
                if let Ok(n) = value.parse::<usize>() {
                    cfg.max_turns = Some(n);
                }
            }
            _ => {}
        }
    }
    cfg
}

fn read(path: &Path) -> EriConfig {
    std::fs::read_to_string(path)
        .ok()
        .map(|t| parse(&t))
        .unwrap_or_default()
}

fn global_path() -> Option<PathBuf> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()?;
    Some(
        PathBuf::from(home)
            .join(".config")
            .join("eri")
            .join("config.toml"),
    )
}

fn project_path(workspace: &Path) -> PathBuf {
    workspace.join(".eri").join("config.toml")
}

/// Load the merged config for `workspace`: global, then project on top.
pub fn load(workspace: &Path) -> EriConfig {
    let global = global_path().map(|p| read(&p)).unwrap_or_default();
    let project = read(&project_path(workspace));
    global.merge(project)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn parses_known_keys_ignores_rest() {
        let cfg = parse("mode = \"fast\"\nmax_turns = 12\n# comment\nfoo = \"bar\"\n[section]\n");
        assert_eq!(cfg.mode.as_deref(), Some("fast"));
        assert_eq!(cfg.max_turns, Some(12));
    }

    #[test]
    fn rejects_invalid_mode() {
        let cfg = parse("mode = banana");
        assert!(cfg.mode.is_none());
    }

    #[test]
    fn project_overrides_global() {
        let ws = TempDir::new().unwrap();
        let dir = ws.path().join(".eri");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("config.toml"), "mode = \"thinking\"\n").unwrap();
        // Point HOME at a temp dir with a different global value.
        let home = TempDir::new().unwrap();
        let gdir = home.path().join(".config").join("eri");
        std::fs::create_dir_all(&gdir).unwrap();
        std::fs::write(gdir.join("config.toml"), "mode = \"fast\"\nmax_turns = 9\n").unwrap();

        let prev = std::env::var("HOME").ok();
        // Reuse the shared env lock so we don't race other HOME-mutating tests.
        let _g = crate::config::ENV_TEST_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        unsafe {
            std::env::set_var("HOME", home.path());
        }
        let cfg = load(ws.path());
        unsafe {
            match prev.as_deref() {
                Some(v) => std::env::set_var("HOME", v),
                None => std::env::remove_var("HOME"),
            }
        }
        // project mode wins; global max_turns still applies.
        assert_eq!(cfg.mode.as_deref(), Some("thinking"));
        assert_eq!(cfg.max_turns, Some(9));
    }
}
