use std::{
    fs,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result, anyhow};
use eri_core::{CandidatePatch, IdeAction};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ActionDisposition {
    Executed,
    PendingConfirmation,
}

#[derive(Debug, Default)]
pub struct ActionGateway {
    pending_confirmation: Option<IdeAction>,
    executed_actions: Vec<IdeAction>,
}

impl ActionGateway {
    pub fn submit(&mut self, action: IdeAction) -> ActionDisposition {
        if action.requires_confirmation() {
            self.pending_confirmation = Some(action);
            ActionDisposition::PendingConfirmation
        } else {
            self.executed_actions.push(action);
            ActionDisposition::Executed
        }
    }

    pub fn pending_confirmation(&self) -> Option<&IdeAction> {
        self.pending_confirmation.as_ref()
    }

    pub fn executed_actions(&self) -> &[IdeAction] {
        &self.executed_actions
    }

    pub fn confirm_pending(&mut self) -> Option<IdeAction> {
        let action = self.pending_confirmation.take()?;
        self.executed_actions.push(action.clone());
        Some(action)
    }

    pub fn reject_pending(&mut self) -> Option<IdeAction> {
        self.pending_confirmation.take()
    }
}

#[derive(Debug, Clone)]
pub struct AppliedPatchOnDisk {
    pub path: PathBuf,
    pub original_text: String,
}

/// Apply a [`CandidatePatch`] to the filesystem, anchored at `root` when the
/// patch path is relative. Returns the original file contents so the caller
/// can stage an undo. The patch is rejected if the file does not currently
/// contain the patch's `old_text`, so a stale candidate cannot clobber edits.
pub fn apply_patch_to_disk(
    patch: &CandidatePatch,
    root: Option<&Path>,
) -> Result<AppliedPatchOnDisk> {
    let path = resolve_patch_path(&patch.path, root);
    let current = fs::read_to_string(&path)
        .with_context(|| format!("reading {} before applying patch", path.display()))?;
    if !current.contains(&patch.old_text) {
        return Err(anyhow!(
            "file {} no longer contains the candidate's old_text",
            path.display()
        ));
    }
    let updated = current.replacen(&patch.old_text, &patch.new_text, 1);
    fs::write(&path, &updated).with_context(|| format!("writing patched {}", path.display()))?;
    Ok(AppliedPatchOnDisk {
        path,
        original_text: current,
    })
}

/// Revert a previously applied patch by rewriting the file with the captured
/// original text.
pub fn undo_patch_on_disk(applied: &AppliedPatchOnDisk) -> Result<()> {
    fs::write(&applied.path, &applied.original_text)
        .with_context(|| format!("reverting {}", applied.path.display()))?;
    Ok(())
}

/// Write a batch of new files to `root` (creating parent directories as
/// needed). Returns the absolute path of `root` plus the absolute path of
/// every file written. Existing files are overwritten — callers should pick
/// a fresh directory if that matters.
pub fn write_build_files(files: &[(PathBuf, String)], root: &Path) -> Result<Vec<PathBuf>> {
    fs::create_dir_all(root).with_context(|| format!("creating build root {}", root.display()))?;
    let mut written = Vec::with_capacity(files.len());
    for (relative_path, content) in files {
        let resolved = if relative_path.is_absolute() {
            relative_path.clone()
        } else {
            root.join(relative_path)
        };
        if let Some(parent) = resolved.parent() {
            fs::create_dir_all(parent).with_context(|| format!("creating {}", parent.display()))?;
        }
        fs::write(&resolved, content).with_context(|| format!("writing {}", resolved.display()))?;
        written.push(resolved);
    }
    Ok(written)
}

/// Launch macOS `open` on the given path. Used for revealing a build folder
/// in Finder or opening an HTML file in the default browser.
pub fn open_with_finder(path: &Path) -> Result<()> {
    std::process::Command::new("open")
        .arg(path)
        .spawn()
        .with_context(|| format!("opening {}", path.display()))?;
    Ok(())
}

/// Describes a detected backend file that eri can auto-spawn so the fullstack
/// preview runs locally without the user opening a terminal.
#[derive(Debug, Clone)]
pub struct DetectedServer {
    pub path: PathBuf,
    pub command: String,
    pub args: Vec<String>,
    pub label: String,
}

/// Scan a build directory for a self-contained server file (one of
/// `server.js`, `server.py`, `app.py`, `index.js`) and return how to launch
/// it. Returns `None` if no recognized server file exists.
pub fn detect_server_in_dir(root: &Path) -> Option<DetectedServer> {
    let candidates: [(&str, &str, &[&str], &str); 4] = [
        ("server.js", "node", &[], "Node server"),
        ("index.js", "node", &[], "Node server"),
        ("server.py", "python3", &[], "Python server"),
        ("app.py", "python3", &[], "Python server"),
    ];
    for (filename, cmd, args, label) in candidates {
        let candidate = root.join(filename);
        if candidate.is_file() {
            return Some(DetectedServer {
                path: candidate,
                command: cmd.to_string(),
                args: args.iter().map(|s| s.to_string()).collect(),
                label: format!("{label} ({filename})"),
            });
        }
    }
    None
}

/// Spawn a detected server with stdout/stderr piped. The caller must keep the
/// returned `Child` alive (drop = kill via SIGKILL on Drop).
pub fn spawn_server(server: &DetectedServer) -> Result<std::process::Child> {
    let parent = server
        .path
        .parent()
        .ok_or_else(|| anyhow!("server path has no parent"))?;
    let child = std::process::Command::new(&server.command)
        .arg(
            server
                .path
                .file_name()
                .ok_or_else(|| anyhow!("server path has no filename"))?,
        )
        .args(&server.args)
        .current_dir(parent)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .with_context(|| format!("spawning {} {}", server.command, server.path.display()))?;
    Ok(child)
}

fn resolve_patch_path(path: &Path, root: Option<&Path>) -> PathBuf {
    if path.is_absolute() {
        return path.to_path_buf();
    }
    match root {
        Some(root) => root.join(path),
        None => path.to_path_buf(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use tempfile::tempdir;

    #[test]
    fn apply_patch_replaces_file_contents() -> Result<()> {
        let dir = tempdir()?;
        let target = dir.path().join("App.tsx");
        fs::write(&target, "button { background: blue; }\n")?;
        let patch = CandidatePatch::replace_text(
            1,
            PathBuf::from("App.tsx"),
            "button { background: blue; }",
            "button { background: red; }",
        );
        let applied = apply_patch_to_disk(&patch, Some(dir.path()))?;
        let updated = fs::read_to_string(&target)?;
        assert_eq!(updated, "button { background: red; }\n");
        assert_eq!(applied.path, target);
        assert_eq!(applied.original_text, "button { background: blue; }\n");
        undo_patch_on_disk(&applied)?;
        let reverted = fs::read_to_string(&target)?;
        assert_eq!(reverted, "button { background: blue; }\n");
        Ok(())
    }

    #[test]
    fn apply_patch_refuses_when_old_text_missing() -> Result<()> {
        let dir = tempdir()?;
        let target = dir.path().join("App.tsx");
        fs::write(&target, "button { background: green; }\n")?;
        let patch = CandidatePatch::replace_text(
            1,
            PathBuf::from("App.tsx"),
            "button { background: blue; }",
            "button { background: red; }",
        );
        let error = apply_patch_to_disk(&patch, Some(dir.path())).unwrap_err();
        assert!(error.to_string().contains("no longer contains"));
        Ok(())
    }
}
