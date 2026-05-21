use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

use crate::frontmatter::{self, ParsedFile};
use crate::rule::{Mode, Rule};

const RULES_DIR: &str = ".eri/rules";
const LEGACY_RULE_FILE: &str = ".eri/rules.md";

pub(crate) fn load_workspace(workspace_root: &Path) -> Result<Vec<Rule>> {
    let mut rules = Vec::new();

    let rules_dir = workspace_root.join(RULES_DIR);
    if rules_dir.is_dir() {
        for entry in walk_mdc(&rules_dir)? {
            let rule = load_rule_file(&entry)
                .with_context(|| format!("failed to load rule file {}", entry.display()))?;
            rules.push(rule);
        }
    }

    let legacy = workspace_root.join(LEGACY_RULE_FILE);
    if legacy.is_file() {
        let body = fs::read_to_string(&legacy)
            .with_context(|| format!("failed to read {}", legacy.display()))?;
        rules.push(Rule {
            name: "rules".to_string(),
            mode: Mode::Always,
            body,
            priority: 0,
            description: None,
        });
    }

    Ok(rules)
}

fn walk_mdc(dir: &Path) -> Result<Vec<PathBuf>> {
    let mut out = Vec::new();
    walk_inner(dir, &mut out)?;
    out.sort();
    Ok(out)
}

fn walk_inner(dir: &Path, out: &mut Vec<PathBuf>) -> Result<()> {
    for entry in fs::read_dir(dir).with_context(|| format!("read_dir {}", dir.display()))? {
        let entry = entry?;
        let path = entry.path();
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            walk_inner(&path, out)?;
        } else if file_type.is_file()
            && path
                .extension()
                .and_then(|s| s.to_str())
                .is_some_and(|ext| ext.eq_ignore_ascii_case("mdc"))
        {
            out.push(path);
        }
    }
    Ok(())
}

fn load_rule_file(path: &Path) -> Result<Rule> {
    let content = fs::read_to_string(path)
        .with_context(|| format!("failed to read {}", path.display()))?;
    let ParsedFile { frontmatter, body } = frontmatter::split(&content);

    let name = frontmatter
        .name
        .unwrap_or_else(|| derive_name_from_path(path));
    let mode = frontmatter.mode.unwrap_or(Mode::Manual);
    let priority = frontmatter.priority.unwrap_or(0);

    Ok(Rule {
        name,
        mode,
        body: body.trim_start_matches('\n').to_string(),
        priority,
        description: frontmatter.description,
    })
}

fn derive_name_from_path(path: &Path) -> String {
    path.file_stem()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| path.display().to_string())
}
