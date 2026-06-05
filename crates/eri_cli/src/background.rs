//! Background shell tasks -- run a long-lived command (dev server, watcher,
//! test runner) without blocking the agent loop, then poll its output or kill
//! it. Claude Code's `Bash(run_in_background)` + `BashOutput` + `KillShell`.
//!
//! Each task spawns the same secret-scrubbed, optionally-sandboxed shell as the
//! foreground `bash` tool, but its output streams into a shared buffer drained
//! by a detached reader task (so a chatty process never blocks on a full pipe).
//! The child has `kill_on_drop`, so aborting the reader task reliably kills the
//! process -- `kill()` does exactly that, then records the terminal state.
//!
//! The registry is depth-0 / per-loop. It holds `tokio` resources, so it is not
//! `Send`-bound across threads beyond the loop's own task.

use std::path::Path;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

use tokio::io::{AsyncBufReadExt, BufReader};

/// Cap a single task's retained output so an endless emitter can't grow the
/// buffer without bound. Oldest lines are dropped past this.
const MAX_OUTPUT_BYTES: usize = 64 * 1024;

/// Terminal or live state of a background task.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BgState {
    Running,
    Exited(i32),
    Killed,
}

impl BgState {
    fn label(&self) -> String {
        match self {
            BgState::Running => "running".into(),
            BgState::Exited(c) => format!("exited({c})"),
            BgState::Killed => "killed".into(),
        }
    }
}

struct Bg {
    id: String,
    label: String,
    output: std::sync::Arc<Mutex<String>>,
    state: std::sync::Arc<Mutex<BgState>>,
    handle: tokio::task::JoinHandle<()>,
}

/// A snapshot of one task for the model-facing tools.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BgSnapshot {
    pub id: String,
    pub label: String,
    pub state: String,
    pub output: String,
}

/// Per-loop registry of background shell tasks.
#[derive(Default)]
pub struct BackgroundRegistry {
    tasks: Vec<Bg>,
}

static SEQ: AtomicU64 = AtomicU64::new(0);

impl BackgroundRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Spawn `command` in the background. `sandbox` wraps it in the OS seatbelt
    /// (same as the foreground tool). Returns the task id or an error string.
    pub fn spawn(&mut self, root: &Path, command: &str, sandbox: bool) -> Result<String, String> {
        if command.trim().is_empty() {
            return Err("background: command is empty".into());
        }
        if sandbox && !crate::sandbox::is_available() {
            return Err(
                "background: --sandbox requested but OS sandboxing is unavailable; refusing".into(),
            );
        }
        let mut cmd = if sandbox {
            let (program, args) = crate::sandbox::wrap(root, command);
            let mut c = tokio::process::Command::new(program);
            c.args(args);
            c
        } else {
            let mut c = tokio::process::Command::new("sh");
            c.arg("-c").arg(command);
            c
        };
        cmd.current_dir(root)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);
        for (name, _) in std::env::vars() {
            if crate::build_agent::is_secret_env(&name) {
                cmd.env_remove(&name);
            }
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("background: spawn failed: {e}"))?;
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let output = std::sync::Arc::new(Mutex::new(String::new()));
        let state = std::sync::Arc::new(Mutex::new(BgState::Running));
        let out_for_task = output.clone();
        let state_for_task = state.clone();

        let handle = tokio::spawn(async move {
            // Drain stdout + stderr concurrently into the shared buffer so a
            // full pipe never blocks the child, then record the exit status.
            let drain_out = drain(stdout, out_for_task.clone());
            let drain_err = drain(stderr, out_for_task.clone());
            let wait = child.wait();
            let (_, _, status) = tokio::join!(drain_out, drain_err, wait);
            let code = status.ok().and_then(|s| s.code()).unwrap_or(-1);
            // Only record an exit if we weren't already killed.
            let mut s = state_for_task.lock().unwrap_or_else(|e| e.into_inner());
            if *s == BgState::Running {
                *s = BgState::Exited(code);
            }
        });

        let id = format!("bg_{}", SEQ.fetch_add(1, Ordering::Relaxed));
        self.tasks.push(Bg {
            id: id.clone(),
            label: command.chars().take(48).collect(),
            output,
            state,
            handle,
        });
        Ok(id)
    }

    /// Current state + accumulated output of a task.
    pub fn snapshot(&self, id: &str) -> Option<BgSnapshot> {
        let t = self.tasks.iter().find(|t| t.id == id)?;
        let state = t.state.lock().unwrap_or_else(|e| e.into_inner()).label();
        let output = t.output.lock().unwrap_or_else(|e| e.into_inner()).clone();
        Some(BgSnapshot {
            id: t.id.clone(),
            label: t.label.clone(),
            state,
            output,
        })
    }

    /// Kill a running task (abort the reader -> drop child -> kill_on_drop) and
    /// mark it Killed. Returns false for an unknown id.
    pub fn kill(&mut self, id: &str) -> bool {
        let Some(t) = self.tasks.iter().find(|t| t.id == id) else {
            return false;
        };
        {
            let mut s = t.state.lock().unwrap_or_else(|e| e.into_inner());
            if *s == BgState::Running {
                *s = BgState::Killed;
            }
        }
        t.handle.abort();
        true
    }

    /// `(id, label, running)` for every task, for a listing.
    pub fn list(&self) -> Vec<(String, String, bool)> {
        self.tasks
            .iter()
            .map(|t| {
                let running =
                    *t.state.lock().unwrap_or_else(|e| e.into_inner()) == BgState::Running;
                (t.id.clone(), t.label.clone(), running)
            })
            .collect()
    }
}

impl Drop for BackgroundRegistry {
    /// When the loop ends, abort every reader task -- each drops its child,
    /// which has `kill_on_drop`, so no background process outlives the run.
    fn drop(&mut self) {
        for t in &self.tasks {
            t.handle.abort();
        }
    }
}

/// Read everything from `reader` line by line into `buf`, capping total size.
async fn drain(
    reader: Option<impl tokio::io::AsyncRead + Unpin>,
    buf: std::sync::Arc<Mutex<String>>,
) {
    let Some(reader) = reader else {
        return;
    };
    let mut lines = BufReader::new(reader).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let mut b = buf.lock().unwrap_or_else(|e| e.into_inner());
        b.push_str(&line);
        b.push('\n');
        if b.len() > MAX_OUTPUT_BYTES {
            // Drop the oldest half to stay bounded, rounding up to a char
            // boundary so we never slice through a multi-byte sequence.
            let mut cut = b.len() - MAX_OUTPUT_BYTES / 2;
            while cut < b.len() && !b.is_char_boundary(cut) {
                cut += 1;
            }
            *b = b[cut..].to_string();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    async fn wait_until_done(reg: &BackgroundRegistry, id: &str) -> BgSnapshot {
        for _ in 0..50 {
            let snap = reg.snapshot(id).unwrap();
            if snap.state != "running" {
                return snap;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
        panic!("task {id} did not finish in time");
    }

    #[tokio::test]
    async fn spawn_captures_output_and_exit() {
        let dir = TempDir::new().unwrap();
        let mut reg = BackgroundRegistry::new();
        let id = reg
            .spawn(dir.path(), "echo hello-bg && exit 0", false)
            .unwrap();
        let snap = wait_until_done(&reg, &id).await;
        assert_eq!(snap.state, "exited(0)");
        assert!(snap.output.contains("hello-bg"));
    }

    #[tokio::test]
    async fn nonzero_exit_recorded() {
        let dir = TempDir::new().unwrap();
        let mut reg = BackgroundRegistry::new();
        let id = reg.spawn(dir.path(), "exit 7", false).unwrap();
        let snap = wait_until_done(&reg, &id).await;
        assert_eq!(snap.state, "exited(7)");
    }

    #[tokio::test]
    async fn kill_stops_a_long_task() {
        let dir = TempDir::new().unwrap();
        let mut reg = BackgroundRegistry::new();
        let id = reg.spawn(dir.path(), "sleep 30", false).unwrap();
        // It's running...
        assert_eq!(reg.snapshot(&id).unwrap().state, "running");
        assert!(reg.kill(&id));
        let snap = reg.snapshot(&id).unwrap();
        assert_eq!(snap.state, "killed");
        // Killing an unknown id is a graceful false.
        assert!(!reg.kill("bg_nope"));
    }

    #[tokio::test]
    async fn list_reflects_tasks() {
        let dir = TempDir::new().unwrap();
        let mut reg = BackgroundRegistry::new();
        let a = reg.spawn(dir.path(), "echo a", false).unwrap();
        let _b = reg.spawn(dir.path(), "sleep 30", false).unwrap();
        let _ = wait_until_done(&reg, &a).await;
        let list = reg.list();
        assert_eq!(list.len(), 2);
        // Distinct ids.
        assert_ne!(list[0].0, list[1].0);
    }

    #[tokio::test]
    async fn empty_command_errors() {
        let dir = TempDir::new().unwrap();
        let mut reg = BackgroundRegistry::new();
        assert!(reg.spawn(dir.path(), "   ", false).is_err());
    }
}
