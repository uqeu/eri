//! `eri worktree` -- isolated git worktrees for parallel sessions.
//!
//! Running two eri sessions in the same directory fights over the working tree.
//! A worktree gives each session its own checkout on its own branch, sharing the
//! one object store, so parallel builds/edits never collide. Thin wrapper over
//! `eri_git`'s worktree helpers.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

/// Resolve the repository root (the cwd; git itself walks up to the real root).
fn repo() -> Result<PathBuf> {
    std::env::current_dir().context("read current directory")
}

/// Default worktree path when the user doesn't pass one: a sibling of the repo
/// named `<repo>-<branch>`, so it sits next to the project, not inside it.
fn default_path(repo: &Path, branch: &str) -> PathBuf {
    let repo_name = repo.file_name().and_then(|n| n.to_str()).unwrap_or("repo");
    let safe_branch = branch.replace('/', "-");
    let parent = repo.parent().unwrap_or(repo);
    parent.join(format!("{repo_name}-{safe_branch}"))
}

/// `eri worktree add <branch> [--path P]`.
pub fn add(branch: &str, path: Option<PathBuf>) -> Result<()> {
    let repo = repo()?;
    let target = path.unwrap_or_else(|| default_path(&repo, branch));
    eri_git::add_worktree(&repo, &target, branch)
        .with_context(|| format!("create worktree for branch '{branch}'"))?;
    println!(
        "[eri] created worktree at {} on branch '{branch}'.\n      cd {} && eri chat",
        target.display(),
        target.display()
    );
    Ok(())
}

/// `eri worktree list`.
pub fn list() -> Result<()> {
    let repo = repo()?;
    let worktrees = eri_git::list_worktrees(&repo).context("list worktrees")?;
    if worktrees.len() <= 1 {
        println!(
            "[eri] no linked worktrees (only the main checkout). Add one with `eri worktree add <branch>`."
        );
        return Ok(());
    }
    println!("worktrees:");
    for w in &worktrees {
        let tag = if w.is_main { " (main)" } else { "" };
        let branch = w.branch.as_deref().unwrap_or("(detached)");
        let short = w.head.get(..8).unwrap_or(&w.head);
        println!("  {}  [{branch}] {short}{tag}", w.path.display());
    }
    Ok(())
}

/// `eri worktree remove <path> [--force]`.
pub fn remove(path: &Path, force: bool) -> Result<()> {
    let repo = repo()?;
    eri_git::remove_worktree(&repo, path, force)
        .with_context(|| format!("remove worktree {}", path.display()))?;
    println!("[eri] removed worktree {}.", path.display());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_path_is_a_named_sibling() {
        let p = default_path(Path::new("/work/myrepo"), "feature/login");
        assert_eq!(p, Path::new("/work/myrepo-feature-login"));
    }

    #[test]
    fn default_path_handles_rootless_repo() {
        // No parent -> falls back to the repo dir itself as the base.
        let p = default_path(Path::new("repo"), "x");
        assert_eq!(p, Path::new("repo-x"));
    }
}
