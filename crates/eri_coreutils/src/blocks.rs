//! Terminal command "blocks" — a Warp-style model where each command + its
//! output + exit code is one atomic, queryable unit (not a scrollback blob).
//!
//! Why: the agent (and the UI) can then ask "what happened in the last few
//! blocks?" or "what was the last failure?" cheaply and precisely, instead of
//! scraping raw terminal text. The IDE/sidecar records a [`CommandBlock`] per
//! command into a bounded [`BlockLog`]; this module is the pure, serializable
//! model + queries (no terminal/PTY here — that lives in the IDE).

use serde::{Deserialize, Serialize};

/// One executed command and its result.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CommandBlock {
    /// Monotonic id within a session (assigned by [`BlockLog::record`]).
    pub id: u64,
    pub command: String,
    pub output: String,
    /// Process exit code (`None` if still running / unknown).
    pub exit_code: Option<i32>,
    /// Start time, epoch millis (caller-supplied so this stays pure/testable).
    pub started_ms: u64,
    /// Wall-clock duration in millis.
    pub duration_ms: u64,
    /// Working directory the command ran in.
    pub cwd: String,
}

impl CommandBlock {
    /// A block "failed" when it finished with a non-zero exit code.
    pub fn failed(&self) -> bool {
        matches!(self.exit_code, Some(c) if c != 0)
    }

    /// Compact one-line summary for agent context (token-frugal): the command,
    /// status, and a bounded tail of output.
    pub fn summary(&self, max_output: usize) -> String {
        let status = match self.exit_code {
            Some(0) => "ok".to_string(),
            Some(c) => format!("exit {c}"),
            None => "running".to_string(),
        };
        let out = self.output.trim();
        let tail = if out.len() > max_output {
            // keep the END (errors are usually at the bottom), on a char boundary
            let mut start = out.len() - max_output;
            while start < out.len() && !out.is_char_boundary(start) {
                start += 1;
            }
            format!("…{}", &out[start..])
        } else {
            out.to_string()
        };
        format!("[{}] $ {} ({status})\n{tail}", self.id, self.command)
    }
}

/// A bounded, newest-last ring of command blocks for one session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockLog {
    cap: usize,
    next_id: u64,
    blocks: Vec<CommandBlock>,
}

impl BlockLog {
    pub fn new(cap: usize) -> Self {
        Self {
            cap: cap.max(1),
            next_id: 1,
            blocks: Vec::new(),
        }
    }

    /// Append a command result; assigns + returns its id. Evicts the oldest
    /// block when over capacity.
    pub fn record(
        &mut self,
        command: impl Into<String>,
        output: impl Into<String>,
        exit_code: Option<i32>,
        started_ms: u64,
        duration_ms: u64,
        cwd: impl Into<String>,
    ) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        self.blocks.push(CommandBlock {
            id,
            command: command.into(),
            output: output.into(),
            exit_code,
            started_ms,
            duration_ms,
            cwd: cwd.into(),
        });
        while self.blocks.len() > self.cap {
            self.blocks.remove(0);
        }
        id
    }

    pub fn len(&self) -> usize {
        self.blocks.len()
    }
    pub fn is_empty(&self) -> bool {
        self.blocks.is_empty()
    }

    /// The most recent block.
    pub fn last(&self) -> Option<&CommandBlock> {
        self.blocks.last()
    }

    /// The most recent FAILED block (non-zero exit) — "what just broke?".
    pub fn last_failed(&self) -> Option<&CommandBlock> {
        self.blocks.iter().rev().find(|b| b.failed())
    }

    /// Look a block up by id.
    pub fn get(&self, id: u64) -> Option<&CommandBlock> {
        self.blocks.iter().find(|b| b.id == id)
    }

    /// The newest `n` blocks (oldest→newest).
    pub fn recent(&self, n: usize) -> &[CommandBlock] {
        let start = self.blocks.len().saturating_sub(n);
        &self.blocks[start..]
    }

    /// Token-frugal context for the agent: summaries of the newest `n` blocks.
    pub fn context(&self, n: usize, max_output_each: usize) -> String {
        self.recent(n)
            .iter()
            .map(|b| b.summary(max_output_each))
            .collect::<Vec<_>>()
            .join("\n\n")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn log() -> BlockLog {
        let mut l = BlockLog::new(3);
        l.record("ls", "a\nb", Some(0), 0, 5, "/repo");
        l.record(
            "cargo build",
            "error[E0001]: boom",
            Some(101),
            10,
            900,
            "/repo",
        );
        l.record("echo hi", "hi", Some(0), 1000, 1, "/repo");
        l
    }

    #[test]
    fn ids_increment_and_lookup_works() {
        let l = log();
        assert_eq!(l.len(), 3);
        assert_eq!(l.get(2).unwrap().command, "cargo build");
        assert_eq!(l.last().unwrap().command, "echo hi");
    }

    #[test]
    fn failed_detection_and_last_failed() {
        let l = log();
        assert!(l.get(2).unwrap().failed());
        assert!(!l.get(1).unwrap().failed());
        assert_eq!(l.last_failed().unwrap().id, 2); // the cargo build
    }

    #[test]
    fn capacity_evicts_oldest_keeps_ids() {
        let mut l = log();
        l.record("pwd", "/repo", Some(0), 2000, 1, "/repo"); // 4th -> evicts id 1
        assert_eq!(l.len(), 3);
        assert!(l.get(1).is_none(), "oldest evicted");
        assert_eq!(l.last().unwrap().command, "pwd");
        assert_eq!(l.last().unwrap().id, 4, "ids keep counting");
    }

    #[test]
    fn summary_is_bounded_and_keeps_error_tail() {
        let b = CommandBlock {
            id: 9,
            command: "cargo test".into(),
            output: "x".repeat(500) + "FATAL_AT_END",
            exit_code: Some(1),
            started_ms: 0,
            duration_ms: 1,
            cwd: "/r".into(),
        };
        let s = b.summary(40);
        assert!(s.contains("exit 1"));
        assert!(
            s.contains("FATAL_AT_END"),
            "keeps the end where errors live"
        );
        assert!(s.contains('…'), "marks truncation");
    }

    #[test]
    fn context_joins_recent_summaries() {
        let l = log();
        let ctx = l.context(2, 80);
        assert!(ctx.contains("cargo build"));
        assert!(ctx.contains("echo hi"));
        assert!(!ctx.contains("$ ls "), "older block beyond n is excluded");
    }

    #[test]
    fn empty_log_is_safe() {
        let l = BlockLog::new(5);
        assert!(l.is_empty());
        assert!(l.last().is_none());
        assert!(l.last_failed().is_none());
        assert_eq!(l.context(3, 50), "");
    }
}
