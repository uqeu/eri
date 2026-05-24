//! eri_skills — agent-invocable Skills modeled after Claude Code's Skills.
//!
//! Skills live at `<workspace>/.eri/skills/<name>/SKILL.md`. Each skill has
//! a name, a description (what the model sees to decide whether to invoke
//! it), a list of activation keywords (`when`), and a markdown body that is
//! lazily attached to the prompt when the skill is invoked.
//!
//! This crate is intentionally tiny: it walks the skills directory, parses
//! a minimal YAML frontmatter subset, and exposes a relevance score for
//! prompt-time ranking. The agent decides whether to invoke a skill based
//! on its description; this crate just supplies the catalog and bodies.

mod frontmatter;
mod loader;
mod skill;

use std::path::Path;

use anyhow::Result;
use serde::Serialize;

pub use skill::Skill;

/// Workspace-scoped collection of loaded skills.
#[derive(Debug, Clone)]
pub struct Skills {
    skills: Vec<Skill>,
}

/// Lightweight summary suitable for prompt injection (no body).
#[derive(Debug, Clone, Serialize)]
pub struct SkillSummary {
    pub name: String,
    pub description: String,
}

impl Skills {
    /// Walk `<workspace>/.eri/skills/*/SKILL.md` (plus any legacy flat
    /// `<workspace>/.eri/skills/<name>.md` files) and return the parsed
    /// collection.
    pub fn load(workspace_root: &Path) -> Result<Self> {
        let skills = loader::load_workspace(workspace_root)?;
        Ok(Self { skills })
    }

    pub fn from_skills(skills: Vec<Skill>) -> Self {
        Self { skills }
    }

    pub fn list(&self) -> &[Skill] {
        &self.skills
    }

    pub fn get(&self, name: &str) -> Option<&Skill> {
        self.skills.iter().find(|s| s.name() == name)
    }

    /// Compact catalog suitable for injection into the model prompt. Bodies
    /// are intentionally omitted — the model picks a skill by name and the
    /// body is loaded lazily.
    pub fn catalog(&self) -> Vec<SkillSummary> {
        self.skills
            .iter()
            .map(|s| SkillSummary {
                name: s.name().to_string(),
                description: s.description().to_string(),
            })
            .collect()
    }

    /// Score each skill by lower-case keyword overlap with `ctx`. Returns
    /// `(skill, score)` pairs sorted descending; skills with score 0 are
    /// included so the caller can decide whether to threshold.
    pub fn relevance_score(&self, ctx: &str) -> Vec<(&Skill, f32)> {
        let haystack = ctx.to_lowercase();
        let mut scored: Vec<(usize, &Skill, f32)> = self
            .skills
            .iter()
            .enumerate()
            .map(|(idx, skill)| {
                let kw = skill.keywords();
                if kw.is_empty() {
                    return (idx, skill, 0.0);
                }
                let hits = kw.iter().filter(|k| haystack.contains(k.as_str())).count();
                let score = hits as f32 / kw.len() as f32;
                (idx, skill, score)
            })
            .collect();

        scored.sort_by(|a, b| {
            b.2.partial_cmp(&a.2)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.0.cmp(&b.0))
        });
        scored.into_iter().map(|(_, s, score)| (s, score)).collect()
    }
}

// Helper used in tests below.
#[cfg(test)]
fn skills_dir(workspace: &Path) -> std::path::PathBuf {
    workspace.join(".eri/skills")
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    fn write(path: &Path, content: &str) -> Result<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(path, content)?;
        Ok(())
    }

    #[test]
    fn parses_complete_skill_md() -> Result<()> {
        let tmp = TempDir::new()?;
        let ws = tmp.path();
        let dir = skills_dir(ws).join("secure-review");
        write(
            &dir.join("SKILL.md"),
            "---\nname: secure-review\ndescription: \"Review code for OWASP issues\"\nwhen: security, review, audit\n---\nBody content goes here.\n",
        )?;

        let skills = Skills::load(ws)?;
        let skill = skills.get("secure-review").expect("loaded");
        assert_eq!(skill.name(), "secure-review");
        assert_eq!(skill.description(), "Review code for OWASP issues");
        assert_eq!(
            skill.keywords(),
            &["security".to_string(), "review".to_string(), "audit".to_string()]
        );
        assert!(skill.body().contains("Body content goes here."));
        assert_eq!(skill.root_dir(), dir.as_path());
        Ok(())
    }

    #[test]
    fn ignores_subdirs_without_skill_md() -> Result<()> {
        let tmp = TempDir::new()?;
        let ws = tmp.path();
        fs::create_dir_all(skills_dir(ws).join("not-a-skill"))?;
        write(
            &skills_dir(ws).join("good/SKILL.md"),
            "---\nname: good\ndescription: ok\n---\nbody\n",
        )?;

        let skills = Skills::load(ws)?;
        assert_eq!(skills.list().len(), 1);
        assert_eq!(skills.list()[0].name(), "good");
        Ok(())
    }

    #[test]
    fn relevance_score_ranks_by_keyword_overlap() -> Result<()> {
        let tmp = TempDir::new()?;
        let ws = tmp.path();
        write(
            &skills_dir(ws).join("sec/SKILL.md"),
            "---\nname: sec\ndescription: sec\nwhen: security, auth\n---\nbody\n",
        )?;
        write(
            &skills_dir(ws).join("perf/SKILL.md"),
            "---\nname: perf\ndescription: perf\nwhen: performance, latency\n---\nbody\n",
        )?;
        write(
            &skills_dir(ws).join("style/SKILL.md"),
            "---\nname: style\ndescription: style\nwhen: formatting\n---\nbody\n",
        )?;

        let skills = Skills::load(ws)?;
        let ranked = skills.relevance_score("please run a security and auth review");
        assert_eq!(ranked[0].0.name(), "sec");
        assert!(ranked[0].1 > ranked[1].1);
        Ok(())
    }

    #[test]
    fn get_returns_none_for_unknown_name() -> Result<()> {
        let tmp = TempDir::new()?;
        let ws = tmp.path();
        write(
            &skills_dir(ws).join("foo/SKILL.md"),
            "---\nname: foo\ndescription: foo\n---\nbody\n",
        )?;

        let skills = Skills::load(ws)?;
        assert!(skills.get("missing").is_none());
        assert!(skills.get("foo").is_some());
        Ok(())
    }

    #[test]
    fn load_helper_reads_sibling_file() -> Result<()> {
        let tmp = TempDir::new()?;
        let ws = tmp.path();
        let dir = skills_dir(ws).join("with-helper");
        write(
            &dir.join("SKILL.md"),
            "---\nname: with-helper\ndescription: uses helper\n---\nSee checklist.md\n",
        )?;
        write(&dir.join("checklist.md"), "1. lock the doors\n2. check inputs\n")?;

        let skills = Skills::load(ws)?;
        let skill = skills.get("with-helper").expect("loaded");
        let helper = skill.load_helper("checklist.md")?;
        assert!(helper.contains("lock the doors"));

        // Path traversal must be rejected.
        assert!(skill.load_helper("../../../etc/passwd").is_err());
        assert!(skill.load_helper("/etc/passwd").is_err());
        Ok(())
    }

    #[test]
    fn legacy_flat_md_loads_as_skill() -> Result<()> {
        let tmp = TempDir::new()?;
        let ws = tmp.path();
        write(
            &skills_dir(ws).join("inline.md"),
            "---\nname: inline\ndescription: legacy\nwhen: legacy\n---\nflat body\n",
        )?;

        let skills = Skills::load(ws)?;
        let skill = skills.get("inline").expect("loaded");
        assert_eq!(skill.name(), "inline");
        assert!(skill.body().contains("flat body"));
        // No helper directory — load_helper for a nonexistent file errors cleanly.
        assert!(skill.load_helper("nothing.md").is_err());
        Ok(())
    }
}
