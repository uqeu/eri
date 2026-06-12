//! `eri/review/*` JSON-RPC handlers.
//!
//! Three entry points: `local` (working-tree diffs), `pr` (forge PRs via the
//! relevant CLI), and `patch` (user-supplied unified diff). All three converge
//! on `eri_review::Reviewer` with a `LlmReviewBackend` that wraps the
//! inference layer's `LlmProvider`.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::Value;

use eri_inference::llm_provider::LlmProvider;
use eri_review::findings::FindingCategory;
use eri_review::{
    DiffSource, Effort, ReviewBackend, ReviewFinding, ReviewOptions, ReviewReport, Reviewer,
    loader_for,
};

use crate::DispatchError;
use crate::services::Services;

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalParams {
    workspace: PathBuf,
    /// `"unstaged"` (default) | `"staged"` | `"range"`.
    #[serde(default)]
    kind: Option<String>,
    base: Option<String>,
    head: Option<String>,
    #[serde(default)]
    options: ReviewOptionsWire,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrParams {
    workspace: PathBuf,
    /// `"github"` | `"gitlab"` | `"forgejo"`.
    forge: String,
    /// `https://...` URL fallback, parsed if owner/repo/pr aren't supplied.
    url: Option<String>,
    owner: Option<String>,
    repo: Option<String>,
    project: Option<String>,
    pr: Option<u32>,
    mr: Option<u32>,
    instance_url: Option<String>,
    #[serde(default)]
    options: ReviewOptionsWire,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PatchParams {
    workspace: PathBuf,
    patch: String,
    #[serde(default)]
    options: ReviewOptionsWire,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReviewOptionsWire {
    /// `"default"` | `"high"`.
    effort: Option<String>,
    /// Subset of categories to keep. Empty = keep all.
    #[serde(default)]
    focus: Vec<String>,
    /// `"chatgpt"`, `"claude"`, etc. — resolved by `provider_from_choice`.
    model: Option<String>,
}

impl ReviewOptionsWire {
    fn into_options(self, workspace: &Path) -> ReviewOptions {
        let effort = match self.effort.as_deref() {
            Some("high") => Effort::High,
            _ => Effort::Default,
        };
        let focus = self
            .focus
            .iter()
            .filter_map(|s| match s.as_str() {
                "security" => Some(FindingCategory::Security),
                "logic" => Some(FindingCategory::Logic),
                "performance" => Some(FindingCategory::Performance),
                "style" => Some(FindingCategory::Style),
                "test" => Some(FindingCategory::Test),
                "docs" => Some(FindingCategory::Docs),
                "other" => Some(FindingCategory::Other),
                _ => None,
            })
            .collect();
        let rules_dir = workspace.join(".eri").join("rules");
        let project_rules_dir = if rules_dir.is_dir() {
            Some(rules_dir)
        } else {
            None
        };
        ReviewOptions {
            effort,
            focus,
            project_rules_dir,
        }
    }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

pub async fn local(params: Value, services: &Services) -> Result<Value, DispatchError> {
    let p: LocalParams =
        serde_json::from_value(params).map_err(|e| DispatchError::BadParams(e.to_string()))?;
    let kind = p.kind.as_deref().unwrap_or("unstaged");
    let src = match kind {
        "unstaged" => DiffSource::LocalUnstaged,
        "staged" => DiffSource::LocalStaged,
        "range" => DiffSource::LocalRange {
            base: p.base.ok_or_else(|| {
                DispatchError::BadParams("range kind requires `base`".to_string())
            })?,
            head: p.head.ok_or_else(|| {
                DispatchError::BadParams("range kind requires `head`".to_string())
            })?,
        },
        other => {
            return Err(DispatchError::BadParams(format!(
                "unknown local review kind: {other}"
            )));
        }
    };
    let model_choice = p.options.model.clone();
    let opts = p.options.into_options(&p.workspace);
    run_review(src, &p.workspace, opts, model_choice, services).await
}

pub async fn pr(params: Value, services: &Services) -> Result<Value, DispatchError> {
    let p: PrParams =
        serde_json::from_value(params).map_err(|e| DispatchError::BadParams(e.to_string()))?;
    let src = resolve_pr_source(&p)?;
    let model_choice = p.options.model.clone();
    let opts = p.options.into_options(&p.workspace);
    run_review(src, &p.workspace, opts, model_choice, services).await
}

pub async fn patch(params: Value, services: &Services) -> Result<Value, DispatchError> {
    let p: PatchParams =
        serde_json::from_value(params).map_err(|e| DispatchError::BadParams(e.to_string()))?;
    if p.patch.trim().is_empty() {
        return Err(DispatchError::BadParams("empty patch".to_string()));
    }
    let src = DiffSource::Patch { raw: p.patch };
    let model_choice = p.options.model.clone();
    let opts = p.options.into_options(&p.workspace);
    run_review(src, &p.workspace, opts, model_choice, services).await
}

fn resolve_pr_source(p: &PrParams) -> Result<DiffSource, DispatchError> {
    match p.forge.as_str() {
        "github" => {
            let (owner, repo, pr) = if let Some(url) = &p.url {
                parse_github_url(url).ok_or_else(|| {
                    DispatchError::BadParams(format!("invalid GitHub PR URL: {url}"))
                })?
            } else {
                (
                    p.owner.clone().ok_or_else(|| {
                        DispatchError::BadParams("github review requires owner".to_string())
                    })?,
                    p.repo.clone().ok_or_else(|| {
                        DispatchError::BadParams("github review requires repo".to_string())
                    })?,
                    p.pr.ok_or_else(|| {
                        DispatchError::BadParams("github review requires pr".to_string())
                    })?,
                )
            };
            Ok(DiffSource::Github { owner, repo, pr })
        }
        "gitlab" => {
            let (project, mr) = if let Some(url) = &p.url {
                parse_gitlab_url(url).ok_or_else(|| {
                    DispatchError::BadParams(format!("invalid GitLab MR URL: {url}"))
                })?
            } else {
                (
                    p.project.clone().ok_or_else(|| {
                        DispatchError::BadParams("gitlab review requires project".to_string())
                    })?,
                    p.mr.ok_or_else(|| {
                        DispatchError::BadParams("gitlab review requires mr".to_string())
                    })?,
                )
            };
            Ok(DiffSource::Gitlab { project, mr })
        }
        "forgejo" => {
            let instance_url = p.instance_url.clone().ok_or_else(|| {
                DispatchError::BadParams("forgejo review requires instanceUrl".to_string())
            })?;
            let owner = p.owner.clone().ok_or_else(|| {
                DispatchError::BadParams("forgejo review requires owner".to_string())
            })?;
            let repo = p.repo.clone().ok_or_else(|| {
                DispatchError::BadParams("forgejo review requires repo".to_string())
            })?;
            let pr = p.pr.ok_or_else(|| {
                DispatchError::BadParams("forgejo review requires pr".to_string())
            })?;
            Ok(DiffSource::Forgejo {
                instance_url,
                owner,
                repo,
                pr,
            })
        }
        other => Err(DispatchError::BadParams(format!("unknown forge: {other}"))),
    }
}

fn parse_github_url(url: &str) -> Option<(String, String, u32)> {
    // https://github.com/owner/repo/pull/123
    let trimmed = url.trim().trim_end_matches('/');
    let after = trimmed.strip_prefix("https://github.com/")?;
    let mut parts = after.split('/');
    let owner = parts.next()?.to_string();
    let repo = parts.next()?.to_string();
    let kw = parts.next()?;
    if kw != "pull" && kw != "pulls" {
        return None;
    }
    let pr: u32 = parts.next()?.parse().ok()?;
    Some((owner, repo, pr))
}

fn parse_gitlab_url(url: &str) -> Option<(String, u32)> {
    // https://gitlab.com/group/sub/project/-/merge_requests/42
    let trimmed = url.trim().trim_end_matches('/');
    let after = trimmed.strip_prefix("https://gitlab.com/")?;
    let (project, rest) = after.split_once("/-/merge_requests/")?;
    let mr: u32 = rest.split('/').next()?.parse().ok()?;
    Some((project.to_string(), mr))
}

async fn run_review(
    src: DiffSource,
    workspace: &Path,
    opts: ReviewOptions,
    model_choice: Option<String>,
    services: &Services,
) -> Result<Value, DispatchError> {
    let loader = loader_for(&src, workspace);
    let bundle = loader.load(&src).map_err(DispatchError::Other)?;

    let provider = resolve_provider(model_choice.as_deref(), services).await?;
    let backend: Arc<dyn ReviewBackend> = Arc::new(LlmReviewBackend::new(provider));
    let reviewer = Reviewer::new(backend);

    let report = reviewer
        .review(&bundle, &opts)
        .await
        .map_err(DispatchError::Other)?;

    if let Err(err) = persist_report(workspace, &report) {
        tracing::warn!("failed to persist review report: {err}");
    }

    serde_json::to_value(&report).map_err(|e| DispatchError::Other(e.into()))
}

async fn resolve_provider(
    choice: Option<&str>,
    services: &Services,
) -> Result<Box<dyn LlmProvider>, DispatchError> {
    // Fall back to a sensible default if the IDE didn't pick one, then go
    // through the shared provider-acquisition seam (BYOK + proxy + env), so
    // signed-in / power-user keys are honored instead of an env-only guess.
    // `claude-sonnet-4-5` is the internal canonical alias, NOT a wire id — the
    // provider seam upgrades it to the valid `claude-sonnet-4-6` before any
    // Anthropic call (see llm_provider::wire_model_id_for_canonical + its
    // regression tests). Don't "fix" this to a dashed/dotted literal.
    let pick = choice.unwrap_or("claude-sonnet-4-5");
    super::iterate::resolve_provider(services, pick).await
}

fn persist_report(workspace: &Path, report: &ReviewReport) -> anyhow::Result<()> {
    let dir = workspace.join(".eri").join("reviews");
    fs::create_dir_all(&dir)?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path = dir.join(format!("{ts}.json"));
    let bytes = serde_json::to_vec_pretty(report)?;
    fs::write(&path, bytes)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// LLM backend
// ---------------------------------------------------------------------------

/// `ReviewBackend` impl that wraps an `LlmProvider` and parses model output
/// into `ReviewFinding`s.
struct LlmReviewBackend {
    provider: Box<dyn LlmProvider>,
}

impl LlmReviewBackend {
    fn new(provider: Box<dyn LlmProvider>) -> Self {
        Self { provider }
    }
}

#[async_trait]
impl ReviewBackend for LlmReviewBackend {
    async fn review_file(&self, system: &str, user: &str) -> anyhow::Result<Vec<ReviewFinding>> {
        let response = self
            .provider
            .complete(system, user, 4096)
            .map_err(|e| anyhow::anyhow!("inference failed: {e}"))?;
        parse_findings_json(&response.text)
    }

    fn model_id(&self) -> String {
        format!("{}/{}", self.provider.name(), self.provider.model())
    }
}

#[derive(Debug, Deserialize)]
struct WireFinding {
    severity: String,
    category: String,
    file: String,
    line_range: [u32; 2],
    title: String,
    description: String,
    #[serde(default)]
    suggested_fix: Option<String>,
    #[serde(default)]
    confidence: f32,
}

fn parse_findings_json(text: &str) -> anyhow::Result<Vec<ReviewFinding>> {
    let json = extract_json_array(text);
    let raw: Vec<WireFinding> = serde_json::from_str(&json)
        .map_err(|e| anyhow::anyhow!("model returned malformed JSON: {e}"))?;
    let mut out = Vec::with_capacity(raw.len());
    for w in raw {
        let severity = match w.severity.to_ascii_lowercase().as_str() {
            "critical" => eri_review::Severity::Critical,
            "high" => eri_review::Severity::High,
            "medium" => eri_review::Severity::Medium,
            "low" => eri_review::Severity::Low,
            _ => eri_review::Severity::Info,
        };
        let category = match w.category.to_ascii_lowercase().as_str() {
            "security" => FindingCategory::Security,
            "logic" => FindingCategory::Logic,
            "performance" => FindingCategory::Performance,
            "style" => FindingCategory::Style,
            "test" => FindingCategory::Test,
            "docs" => FindingCategory::Docs,
            _ => FindingCategory::Other,
        };
        let confidence = w.confidence.clamp(0.0, 1.0);
        out.push(ReviewFinding {
            severity,
            category,
            file: PathBuf::from(w.file),
            line_range: (w.line_range[0], w.line_range[1]),
            title: w.title,
            description: w.description,
            suggested_fix: w.suggested_fix,
            confidence,
        });
    }
    Ok(out)
}

/// Pull the first `[...]` JSON array out of the model's reply. Tolerates
/// markdown code fences (` ```json ... ``` `).
fn extract_json_array(text: &str) -> String {
    // Try fenced block first.
    if let Some(start) = text.find("```json") {
        let after = &text[start + "```json".len()..];
        if let Some(end) = after.find("```") {
            return after[..end].trim().to_string();
        }
    }
    if let Some(start) = text.find('[') {
        if let Some(end) = text.rfind(']') {
            if end > start {
                return text[start..=end].to_string();
            }
        }
    }
    "[]".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_github_pr_url() {
        let (o, r, n) = parse_github_url("https://github.com/foo/bar/pull/42").expect("parse");
        assert_eq!(o, "foo");
        assert_eq!(r, "bar");
        assert_eq!(n, 42);
    }

    #[test]
    fn parses_gitlab_mr_url_with_subgroup() {
        let (p, m) =
            parse_gitlab_url("https://gitlab.com/grp/sub/proj/-/merge_requests/7").expect("parse");
        assert_eq!(p, "grp/sub/proj");
        assert_eq!(m, 7);
    }

    #[test]
    fn extract_json_handles_fenced_block() {
        let raw = "Here are findings:\n```json\n[{\"x\":1}]\n```\n";
        assert_eq!(extract_json_array(raw), "[{\"x\":1}]");
    }

    #[test]
    fn extract_json_handles_naked_array() {
        let raw = "noise [1,2,3] noise";
        assert_eq!(extract_json_array(raw), "[1,2,3]");
    }

    #[test]
    fn parse_findings_accepts_minimal_payload() {
        let raw = r#"```json
[{"severity":"high","category":"security","file":"a.rs","line_range":[1,2],"title":"t","description":"d","confidence":0.7}]
```"#;
        let findings = parse_findings_json(raw).expect("parse");
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].title, "t");
        assert_eq!(findings[0].file, PathBuf::from("a.rs"));
    }
}
