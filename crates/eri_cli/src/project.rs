//! Project + global context (`AGENTS.md`) for the eri CLI.
//!
//! `AGENTS.md` is the cross-tool convention for telling an agent how a project
//! works (build commands, conventions, gotchas). eri reads it -- global first
//! (`~/.config/eri/AGENTS.md`), then the workspace's `./AGENTS.md` -- and folds
//! it into the build/chat system prompt so the agent follows project rules.
//! `eri init` (and `/init` in chat) scaffolds a starter file.

use std::io::Read;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

/// Cap how much context we inject, so a large AGENTS.md can't dominate the
/// token budget. Generous for real guidance; truncates pathological files.
const MAX_CONTEXT_BYTES: usize = 16 * 1024;

/// Workspace `AGENTS.md` path.
pub fn agents_md_path(root: &Path) -> PathBuf {
    root.join("AGENTS.md")
}

/// Global `~/.config/eri/AGENTS.md` path, if HOME resolves.
fn global_agents_md() -> Option<PathBuf> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()?;
    Some(
        Path::new(&home)
            .join(".config")
            .join("eri")
            .join("AGENTS.md"),
    )
}

/// Read a context file with hardening, returning its (capped) text. Returns
/// `None` if it is missing, empty, a symlink, a non-regular file, or unreadable.
///
/// Security: a workspace AGENTS.md is attacker-controllable (clone a hostile
/// repo). Without these checks a symlinked `AGENTS.md -> ~/.ssh/id_rsa` would be
/// read and folded into the prompt -- exfiltrating a secret to the inference
/// backend. We `lstat` and refuse symlinks + special files, and bound the read
/// so a huge file or a fifo cannot exhaust memory or block.
fn read_capped(path: &Path) -> Option<String> {
    let meta = std::fs::symlink_metadata(path).ok()?;
    // Reject symlinks and anything that is not a plain regular file.
    if meta.file_type().is_symlink() || !meta.file_type().is_file() {
        return None;
    }
    // Bounded read: never pull in more than the cap + 1 (the +1 detects overflow
    // so we can mark truncation), regardless of the stat'd size.
    let file = std::fs::File::open(path).ok()?;
    let mut buf = Vec::new();
    file.take(MAX_CONTEXT_BYTES as u64 + 1)
        .read_to_end(&mut buf)
        .ok()?;
    let mut s = String::from_utf8_lossy(&buf).into_owned();
    if s.trim().is_empty() {
        return None;
    }
    if s.len() > MAX_CONTEXT_BYTES {
        let mut end = MAX_CONTEXT_BYTES;
        while end > 0 && !s.is_char_boundary(end) {
            end -= 1;
        }
        s.truncate(end);
        s.push_str("\n…[truncated]");
    }
    Some(s)
}

/// Assemble project context for `root`: global then project `AGENTS.md`, each
/// read with symlink/size hardening. `None` when neither exists / both empty.
pub fn context(root: &Path) -> Option<String> {
    let mut parts: Vec<String> = Vec::new();
    if let Some(g) = global_agents_md()
        && let Some(s) = read_capped(&g)
    {
        parts.push(s);
    }
    if let Some(s) = read_capped(&agents_md_path(root)) {
        parts.push(s);
    }
    if parts.is_empty() {
        return None;
    }
    Some(parts.join("\n\n---\n\n"))
}

/// True when the workspace already has an `AGENTS.md`.
pub fn has_agents_md(root: &Path) -> bool {
    agents_md_path(root).exists()
}

/// Write a starter `AGENTS.md` into `root` if absent. Returns the path and
/// whether it was newly created (false = left an existing file untouched).
pub fn scaffold(root: &Path) -> Result<(PathBuf, bool)> {
    let path = agents_md_path(root);
    if path.exists() {
        return Ok((path, false));
    }
    let name = root
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "this project".to_string());
    let body = template(&name);
    std::fs::write(&path, body).with_context(|| format!("write {}", path.display()))?;
    Ok((path, true))
}

fn template(name: &str) -> String {
    format!(
        "# AGENTS.md\n\n\
Operating guide for eri (and other agents) working in {name}. Keep it short and \
current -- eri reads this on every build and chat turn.\n\n\
## Overview\n\
- What this project is and the problem it solves.\n\n\
## Stack & layout\n\
- Languages, frameworks, and where the important code lives.\n\n\
## Commands\n\
- build:   <how to build>\n\
- test:    <how to run tests>\n\
- run:     <how to run locally>\n\n\
## Conventions\n\
- Code style, naming, and patterns to follow.\n\
- Things to avoid.\n\n\
## Notes\n\
- Gotchas, external services, anything non-obvious.\n"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn scaffold_writes_then_is_idempotent() {
        let dir = TempDir::new().unwrap();
        let (path, created) = scaffold(dir.path()).unwrap();
        assert!(created);
        assert!(path.exists());
        // Second call must not overwrite.
        let (_, created2) = scaffold(dir.path()).unwrap();
        assert!(!created2);
    }

    #[test]
    fn context_reads_project_agents_md() {
        let dir = TempDir::new().unwrap();
        assert!(context(dir.path()).is_none());
        std::fs::write(agents_md_path(dir.path()), "build: cargo build\n").unwrap();
        let ctx = context(dir.path()).unwrap();
        assert!(ctx.contains("cargo build"));
    }

    #[test]
    fn context_truncates_oversize() {
        let dir = TempDir::new().unwrap();
        let big = "x".repeat(MAX_CONTEXT_BYTES + 5000);
        std::fs::write(agents_md_path(dir.path()), big).unwrap();
        let ctx = context(dir.path()).unwrap();
        assert!(ctx.len() <= MAX_CONTEXT_BYTES + 32);
        assert!(ctx.ends_with("[truncated]"));
    }

    #[cfg(unix)]
    #[test]
    fn context_refuses_symlinked_agents_md() {
        // A hostile workspace could symlink AGENTS.md to a secret; refuse it.
        let dir = TempDir::new().unwrap();
        let secret = dir.path().join("secret.txt");
        std::fs::write(&secret, "PRIVATE-KEY-DO-NOT-LEAK").unwrap();
        std::os::unix::fs::symlink(&secret, agents_md_path(dir.path())).unwrap();
        assert!(
            context(dir.path()).is_none(),
            "symlinked AGENTS.md must not be read"
        );
    }
}
