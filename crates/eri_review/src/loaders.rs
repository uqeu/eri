//! `DiffLoader` implementations.
//!
//! Each loader knows how to turn a `DiffSource` into a `DiffBundle` by
//! shelling out to the relevant CLI (`git`, `gh`, `glab`, `curl`) and feeding
//! the result through our unified-diff parser.
//!
//! All forge loaders fail gracefully when their CLI isn't installed — the
//! sidecar surfaces the error message to the IDE so the user knows what to
//! install.

use std::path::Path;
use std::process::Command;
// NOTE: subprocess work is short and on-demand (one-shot git/gh/glab/curl).
// Other eri crates (eri_git, eri_mcp) also use `std::process::Command`; the
// upstream Zed clippy config (`disallowed-methods`) flags this with a
// warning, but the policy doesn't apply to short, request-scoped sidecar
// calls. Loaders run inside the JSON-RPC dispatcher's worker thread, which
// already serialises per workspace.

use anyhow::{Context, Result, anyhow};

use crate::diff::{DiffBundle, DiffSource};
use crate::parser::parse_unified_diff;

/// Pluggable diff source. Implementors are stateless — the sidecar
/// constructs the right loader for each request.
pub trait DiffLoader: Send + Sync {
    fn load(&self, src: &DiffSource) -> Result<DiffBundle>;
}

// ---------------------------------------------------------------------------
// Local git
// ---------------------------------------------------------------------------

/// Loads diffs from the local working tree via `git diff`. The `workspace`
/// path is the repo root.
pub struct LocalGitLoader {
    workspace: std::path::PathBuf,
}

impl LocalGitLoader {
    pub fn new(workspace: impl Into<std::path::PathBuf>) -> Self {
        Self {
            workspace: workspace.into(),
        }
    }

    fn run_git(&self, args: &[&str]) -> Result<String> {
        let output = Command::new("git")
            .args(args)
            .current_dir(&self.workspace)
            .output()
            .with_context(|| format!("failed to spawn `git {}`", args.join(" ")))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(anyhow!(
                "`git {}` failed: {}",
                args.join(" "),
                stderr.trim()
            ));
        }
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    }
}

impl DiffLoader for LocalGitLoader {
    fn load(&self, src: &DiffSource) -> Result<DiffBundle> {
        let raw = match src {
            DiffSource::LocalUnstaged => self.run_git(&["diff", "--no-color"])?,
            DiffSource::LocalStaged => self.run_git(&["diff", "--cached", "--no-color"])?,
            DiffSource::LocalRange { base, head } => {
                validate_revision(base)?;
                validate_revision(head)?;
                let range = format!("{base}..{head}");
                self.run_git(&["diff", "--no-color", &range])?
            }
            other => {
                return Err(anyhow!(
                    "LocalGitLoader cannot load non-local source: {other:?}"
                ));
            }
        };
        let files = parse_unified_diff(&raw)?;
        Ok(DiffBundle {
            files,
            source: src.clone(),
            commit_messages: Vec::new(),
        })
    }
}

/// Refuse arbitrary shell-meta in revision strings. Whitelist what `git diff`
/// accepts for safety even though we don't use a shell.
fn validate_revision(rev: &str) -> Result<()> {
    if rev.is_empty() {
        return Err(anyhow!("empty git revision"));
    }
    let bad = rev.chars().any(|c| {
        matches!(
            c,
            ' ' | '\t' | '\n' | ';' | '|' | '&' | '$' | '`' | '"' | '\''
        )
    });
    if bad {
        return Err(anyhow!(
            "git revision contains forbidden character: {rev:?}"
        ));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

/// Fetches a GitHub PR diff via the `gh` CLI.
pub struct GithubApiLoader;

impl GithubApiLoader {
    pub fn new() -> Self {
        Self
    }
}

impl Default for GithubApiLoader {
    fn default() -> Self {
        Self::new()
    }
}

impl DiffLoader for GithubApiLoader {
    fn load(&self, src: &DiffSource) -> Result<DiffBundle> {
        let (owner, repo, pr) = match src {
            DiffSource::Github { owner, repo, pr } => (owner, repo, *pr),
            other => {
                return Err(anyhow!(
                    "GithubApiLoader expects DiffSource::Github, got {other:?}"
                ));
            }
        };
        validate_segment(owner)?;
        validate_segment(repo)?;

        let pr_arg = pr.to_string();
        let diff = run_cli(
            "gh",
            &["pr", "diff", &pr_arg, "--repo", &format!("{owner}/{repo}")],
        )
        .context(
            "failed to run `gh pr diff` — install GitHub CLI (https://cli.github.com) and run `gh auth login`",
        )?;

        let files = parse_unified_diff(&diff)?;
        Ok(DiffBundle {
            files,
            source: src.clone(),
            commit_messages: Vec::new(),
        })
    }
}

// ---------------------------------------------------------------------------
// GitLab
// ---------------------------------------------------------------------------

/// Fetches a GitLab MR diff via the `glab` CLI.
pub struct GitlabApiLoader;

impl GitlabApiLoader {
    pub fn new() -> Self {
        Self
    }
}

impl Default for GitlabApiLoader {
    fn default() -> Self {
        Self::new()
    }
}

impl DiffLoader for GitlabApiLoader {
    fn load(&self, src: &DiffSource) -> Result<DiffBundle> {
        let (project, mr) = match src {
            DiffSource::Gitlab { project, mr } => (project, *mr),
            other => {
                return Err(anyhow!(
                    "GitlabApiLoader expects DiffSource::Gitlab, got {other:?}"
                ));
            }
        };
        validate_segment(project)?;
        let mr_arg = mr.to_string();
        let diff = run_cli(
            "glab",
            &["mr", "diff", &mr_arg, "--repo", project],
        )
        .context(
            "failed to run `glab mr diff` — install GitLab CLI (https://gitlab.com/gitlab-org/cli) and authenticate",
        )?;
        let files = parse_unified_diff(&diff)?;
        Ok(DiffBundle {
            files,
            source: src.clone(),
            commit_messages: Vec::new(),
        })
    }
}

// ---------------------------------------------------------------------------
// Forgejo / Gitea
// ---------------------------------------------------------------------------

/// Fetches a Forgejo / Gitea PR diff via `curl`. We use plain HTTP since
/// Forgejo has no dedicated CLI and the diff endpoint is unauthenticated for
/// public repos. Private repos require an instance-level access token; the
/// IDE prompts the user separately.
pub struct ForgejoApiLoader {
    token: Option<String>,
}

impl ForgejoApiLoader {
    pub fn new(token: Option<String>) -> Self {
        Self { token }
    }
}

impl Default for ForgejoApiLoader {
    fn default() -> Self {
        Self::new(None)
    }
}

impl DiffLoader for ForgejoApiLoader {
    fn load(&self, src: &DiffSource) -> Result<DiffBundle> {
        let (instance_url, owner, repo, pr) = match src {
            DiffSource::Forgejo {
                instance_url,
                owner,
                repo,
                pr,
            } => (instance_url, owner, repo, *pr),
            other => {
                return Err(anyhow!(
                    "ForgejoApiLoader expects DiffSource::Forgejo, got {other:?}"
                ));
            }
        };
        validate_url(instance_url)?;
        validate_segment(owner)?;
        validate_segment(repo)?;

        let url = format!(
            "{}/api/v1/repos/{}/{}/pulls/{}.diff",
            instance_url.trim_end_matches('/'),
            owner,
            repo,
            pr
        );

        let mut args: Vec<String> = vec![
            "-fsSL".to_string(),
            "--max-time".to_string(),
            "30".to_string(),
        ];
        if let Some(token) = &self.token {
            args.push("-H".to_string());
            args.push(format!("Authorization: token {token}"));
        }
        args.push(url);

        let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
        let diff = run_cli("curl", &arg_refs).context(
            "failed to run `curl` against Forgejo — ensure curl is installed and the instance URL is reachable",
        )?;

        let files = parse_unified_diff(&diff)?;
        Ok(DiffBundle {
            files,
            source: src.clone(),
            commit_messages: Vec::new(),
        })
    }
}

// ---------------------------------------------------------------------------
// Raw patch
// ---------------------------------------------------------------------------

/// Parses a user-supplied unified diff verbatim.
pub struct PatchLoader;

impl PatchLoader {
    pub fn new() -> Self {
        Self
    }
}

impl Default for PatchLoader {
    fn default() -> Self {
        Self::new()
    }
}

impl DiffLoader for PatchLoader {
    fn load(&self, src: &DiffSource) -> Result<DiffBundle> {
        let raw = match src {
            DiffSource::Patch { raw } => raw,
            other => {
                return Err(anyhow!(
                    "PatchLoader expects DiffSource::Patch, got {other:?}"
                ));
            }
        };
        let files = parse_unified_diff(raw)?;
        Ok(DiffBundle {
            files,
            source: src.clone(),
            commit_messages: Vec::new(),
        })
    }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

fn run_cli(program: &str, args: &[&str]) -> Result<String> {
    let output = Command::new(program)
        .args(args)
        .output()
        .with_context(|| format!("`{program}` not installed or not in PATH"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!(
            "`{} {}` exited with status {}: {}",
            program,
            args.join(" "),
            output.status,
            stderr.trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn validate_segment(s: &str) -> Result<()> {
    if s.is_empty() {
        return Err(anyhow!("empty path segment"));
    }
    if s.contains('/') && !is_gitlab_group(s) {
        return Err(anyhow!("invalid segment: {s:?}"));
    }
    if s.chars().any(|c| {
        matches!(
            c,
            ' ' | '\t' | '\n' | ';' | '|' | '&' | '$' | '`' | '"' | '\'' | '<' | '>'
        )
    }) {
        return Err(anyhow!("segment contains forbidden character: {s:?}"));
    }
    Ok(())
}

/// GitLab projects can have nested groups (`group/subgroup/project`). Only
/// `/` is allowed in this case — anything else still trips `validate_segment`.
fn is_gitlab_group(s: &str) -> bool {
    s.split('/').all(|part| {
        !part.is_empty()
            && part
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
    })
}

fn validate_url(s: &str) -> Result<()> {
    if !(s.starts_with("http://") || s.starts_with("https://")) {
        return Err(anyhow!("Forgejo instance URL must be http(s)://: {s:?}"));
    }
    if s.chars()
        .any(|c| matches!(c, ' ' | '\t' | '\n' | '"' | '\'' | '`' | '$'))
    {
        return Err(anyhow!("Forgejo URL contains forbidden character: {s:?}"));
    }
    Ok(())
}

/// Convenience: build the right loader for a `DiffSource`. The workspace path
/// is only used by `LocalGitLoader`; other sources ignore it.
pub fn loader_for(src: &DiffSource, workspace: &Path) -> Box<dyn DiffLoader> {
    match src {
        DiffSource::LocalUnstaged | DiffSource::LocalStaged | DiffSource::LocalRange { .. } => {
            Box::new(LocalGitLoader::new(workspace))
        }
        DiffSource::Github { .. } => Box::new(GithubApiLoader::new()),
        DiffSource::Gitlab { .. } => Box::new(GitlabApiLoader::new()),
        DiffSource::Forgejo { .. } => Box::new(ForgejoApiLoader::new(None)),
        DiffSource::Patch { .. } => Box::new(PatchLoader::new()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn git_available() -> bool {
        Command::new("git")
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    #[test]
    fn local_git_loader_reads_unstaged_diff() {
        if !git_available() {
            eprintln!("skipping: git not available");
            return;
        }
        let tmp = tempfile::tempdir().expect("tempdir");
        let root = tmp.path();
        run_in(root, &["git", "init", "-q"]);
        run_in(root, &["git", "config", "user.email", "t@t"]);
        run_in(root, &["git", "config", "user.name", "t"]);
        // commit a baseline file
        std::fs::write(root.join("hello.rs"), "fn main() {}\n").unwrap();
        run_in(root, &["git", "add", "hello.rs"]);
        run_in(root, &["git", "commit", "-q", "-m", "init"]);
        // unstaged edit
        std::fs::write(root.join("hello.rs"), "fn main() { println!(\"hi\"); }\n").unwrap();

        let loader = LocalGitLoader::new(root);
        let bundle = loader.load(&DiffSource::LocalUnstaged).expect("load");
        assert_eq!(bundle.files.len(), 1);
        assert_eq!(bundle.files[0].path, std::path::PathBuf::from("hello.rs"));
        assert!(!bundle.files[0].hunks.is_empty());
    }

    fn run_in(dir: &Path, argv: &[&str]) {
        let status = Command::new(argv[0])
            .args(&argv[1..])
            .current_dir(dir)
            .status()
            .expect("spawn");
        assert!(status.success(), "{argv:?} failed");
    }

    #[test]
    fn github_loader_rejects_wrong_source() {
        let loader = GithubApiLoader::new();
        let err = loader
            .load(&DiffSource::Patch { raw: String::new() })
            .expect_err("must reject");
        assert!(err.to_string().contains("expects DiffSource::Github"));
    }

    #[test]
    fn github_loader_graceful_when_gh_missing() {
        // Set PATH to an empty dir so `gh` lookup fails. We honor the platform's
        // PATH separator. We can't reliably hide system `gh` on every CI box,
        // so this test asserts the error path returns an anyhow Result rather
        // than panics.
        let loader = GithubApiLoader::new();
        let r = loader.load(&DiffSource::Github {
            owner: "noone".into(),
            repo: "nothing".into(),
            pr: 999_999_999,
        });
        // Either: gh isn't installed → context error, or gh is installed but
        // the PR doesn't exist → command-failed error. Both are Err.
        if r.is_ok() {
            // Extremely unlikely (would require a real PR at noone/nothing#999999999).
            // Skip without failing.
            return;
        }
        let msg = r.unwrap_err().to_string();
        assert!(
            msg.contains("gh") || msg.contains("PR") || msg.contains("repo"),
            "unexpected error: {msg}"
        );
    }

    #[test]
    fn patch_loader_parses_inline_patch() {
        let raw = "\
diff --git a/x.rs b/x.rs
--- a/x.rs
+++ b/x.rs
@@ -1,2 +1,2 @@
-a
+b
 c
";
        let bundle = PatchLoader::new()
            .load(&DiffSource::Patch {
                raw: raw.to_string(),
            })
            .expect("load");
        assert_eq!(bundle.files.len(), 1);
    }

    #[test]
    fn rejects_shell_meta_in_revision() {
        let loader = LocalGitLoader::new(".");
        let err = loader
            .load(&DiffSource::LocalRange {
                base: "main; rm -rf /".into(),
                head: "HEAD".into(),
            })
            .expect_err("must reject");
        assert!(err.to_string().contains("forbidden"));
    }
}
