use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

use crate::frontmatter::{self, ParsedFile};
use crate::skill::Skill;

const SKILLS_DIR: &str = ".eri/skills";
const SKILL_FILE: &str = "SKILL.md";

pub(crate) fn load_workspace(workspace_root: &Path) -> Result<Vec<Skill>> {
    let mut skills = Vec::new();

    let skills_dir = workspace_root.join(SKILLS_DIR);
    if skills_dir.is_dir() {
        let mut entries: Vec<PathBuf> = fs::read_dir(&skills_dir)
            .with_context(|| format!("read_dir {}", skills_dir.display()))?
            .filter_map(|e| e.ok().map(|e| e.path()))
            .collect();
        entries.sort();

        for entry in entries {
            let file_type = match fs::metadata(&entry) {
                Ok(m) => m,
                Err(_) => continue,
            };
            if file_type.is_dir() {
                let skill_md = entry.join(SKILL_FILE);
                if !skill_md.is_file() {
                    // Directory without SKILL.md — ignored.
                    continue;
                }
                let skill = load_skill_dir(&entry, &skill_md)
                    .with_context(|| format!("failed to load skill {}", entry.display()))?;
                skills.push(skill);
            } else if file_type.is_file()
                && entry
                    .extension()
                    .and_then(|s| s.to_str())
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
            {
                // Legacy single-file skill: `.eri/skills/<name>.md`.
                let skill = load_legacy_file(&entry)
                    .with_context(|| format!("failed to load legacy skill {}", entry.display()))?;
                skills.push(skill);
            }
        }
    }

    Ok(skills)
}

fn load_skill_dir(root_dir: &Path, skill_md: &Path) -> Result<Skill> {
    let content = fs::read_to_string(skill_md)
        .with_context(|| format!("failed to read {}", skill_md.display()))?;
    let ParsedFile { frontmatter, body } = frontmatter::split(&content);

    let name = frontmatter
        .name
        .unwrap_or_else(|| derive_name_from_dir(root_dir));
    let description = frontmatter.description.unwrap_or_default();
    let when = frontmatter.when;

    Ok(Skill {
        name,
        description,
        when,
        body: body.trim_start_matches('\n').to_string(),
        root_dir: root_dir.to_path_buf(),
    })
}

fn load_legacy_file(path: &Path) -> Result<Skill> {
    let content =
        fs::read_to_string(path).with_context(|| format!("failed to read {}", path.display()))?;
    let ParsedFile { frontmatter, body } = frontmatter::split(&content);

    let name = frontmatter
        .name
        .unwrap_or_else(|| derive_name_from_file(path));
    let description = frontmatter.description.unwrap_or_default();
    let when = frontmatter.when;

    // Legacy single-file skills are scoped to their parent dir; helpers
    // resolve relative to that directory (the skills root).
    let root_dir = path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));

    Ok(Skill {
        name,
        description,
        when,
        body: body.trim_start_matches('\n').to_string(),
        root_dir,
    })
}

fn derive_name_from_dir(dir: &Path) -> String {
    dir.file_name()
        .and_then(|s| s.to_str())
        .map(str::to_string)
        .unwrap_or_else(|| dir.display().to_string())
}

fn derive_name_from_file(path: &Path) -> String {
    path.file_stem()
        .and_then(|s| s.to_str())
        .map(str::to_string)
        .unwrap_or_else(|| path.display().to_string())
}
