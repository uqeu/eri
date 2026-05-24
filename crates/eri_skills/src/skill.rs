use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

/// A single skill loaded from a `SKILL.md` file (or legacy flat `<name>.md`).
///
/// The skill's `root_dir` is the directory that contains `SKILL.md`. Helper
/// files (templates, examples, sub-checklists) referenced from the body are
/// resolved relative to this directory via [`Skill::load_helper`].
#[derive(Debug, Clone)]
pub struct Skill {
    pub(crate) name: String,
    pub(crate) description: String,
    pub(crate) when: Vec<String>,
    pub(crate) body: String,
    pub(crate) root_dir: PathBuf,
}

impl Skill {
    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn description(&self) -> &str {
        &self.description
    }

    pub fn keywords(&self) -> &[String] {
        &self.when
    }

    pub fn body(&self) -> &str {
        &self.body
    }

    pub fn root_dir(&self) -> &Path {
        &self.root_dir
    }

    /// Read a sibling file inside this skill's `root_dir`.
    ///
    /// `relative` must not escape the skill directory; absolute paths and
    /// `..` traversal are rejected to keep helper loads scoped to the skill.
    pub fn load_helper(&self, relative: &str) -> Result<String> {
        if relative.is_empty() {
            anyhow::bail!("helper path is empty");
        }
        let rel = Path::new(relative);
        if rel.is_absolute() {
            anyhow::bail!("helper path must be relative: {relative}");
        }
        for comp in rel.components() {
            if matches!(comp, std::path::Component::ParentDir) {
                anyhow::bail!("helper path may not contain '..': {relative}");
            }
        }
        let full = self.root_dir.join(rel);
        fs::read_to_string(&full)
            .with_context(|| format!("failed to read helper {}", full.display()))
    }
}
