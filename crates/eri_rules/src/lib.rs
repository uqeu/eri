// eri_rules — project rules engine modeled after `.cursor/rules/*.mdc`.
// Walks `<workspace>/.eri/rules/**/*.mdc`, parses YAML frontmatter + Markdown
// body, and resolves which rules apply to a given prompt context.

mod context;
mod frontmatter;
mod loader;
mod rule;

use std::path::Path;

use anyhow::Result;

pub use context::PromptContext;
pub use rule::{Mode, Rule};

#[derive(Debug, Clone)]
pub struct Rules {
    rules: Vec<Rule>,
}

impl Rules {
    pub fn load(workspace_root: &Path) -> Result<Self> {
        let rules = loader::load_workspace(workspace_root)?;
        Ok(Self { rules })
    }

    pub fn from_rules(rules: Vec<Rule>) -> Self {
        Self { rules }
    }

    pub fn all(&self) -> &[Rule] {
        &self.rules
    }

    pub fn get(&self, name: &str) -> Option<&Rule> {
        self.rules.iter().find(|r| r.name() == name)
    }

    // Returns the active rules for the given prompt context, sorted with the
    // highest-priority rule first (ties broken by insertion order).
    pub fn active_for(&self, ctx: &PromptContext) -> Vec<&Rule> {
        let mut selected: Vec<(usize, &Rule)> = Vec::new();

        for (idx, rule) in self.rules.iter().enumerate() {
            let active = match rule.mode() {
                Mode::Always => true,
                Mode::Manual => ctx.is_mentioned(rule.name()),
                Mode::AgentRequested => ctx.is_agent_requested(rule.name()),
                Mode::AutoAttached { .. } => match rule.glob_set() {
                    Some(set) => ctx.open_files().iter().any(|p| set.is_match(p)),
                    None => false,
                },
            };
            if active {
                selected.push((idx, rule));
            }
        }

        selected.sort_by(|a, b| {
            b.1.priority()
                .cmp(&a.1.priority())
                .then_with(|| a.0.cmp(&b.0))
        });
        selected.into_iter().map(|(_, r)| r).collect()
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use tempfile::TempDir;

    use super::*;

    fn write(path: &std::path::Path, content: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    fn rules_dir(ws: &std::path::Path) -> PathBuf {
        ws.join(".eri/rules")
    }

    #[test]
    fn parses_frontmatter_and_body() {
        let tmp = TempDir::new().unwrap();
        let ws = tmp.path();
        write(
            &rules_dir(ws).join("style.mdc"),
            "---\nname: style\nmode: always\npriority: 5\ndescription: \"House style\"\n---\nBe terse.\n",
        );

        let rules = Rules::load(ws).unwrap();
        let rule = rules.get("style").expect("rule loaded");
        assert_eq!(rule.name(), "style");
        assert!(matches!(rule.mode(), Mode::Always));
        assert_eq!(rule.priority(), 5);
        assert_eq!(rule.description(), Some("House style"));
        assert!(rule.body().contains("Be terse."));
    }

    #[test]
    fn auto_attached_matches_globs() {
        let tmp = TempDir::new().unwrap();
        let ws = tmp.path();
        write(
            &rules_dir(ws).join("ts.mdc"),
            "---\nname: ts\nmode: auto_attached\nglobs:\n  - \"src/**/*.ts\"\n  - \"src/**/*.tsx\"\n---\nTS guidance.\n",
        );

        let rules = Rules::load(ws).unwrap();

        let active = rules.active_for(
            &PromptContext::new().with_open_files(["src/app/main.ts"]),
        );
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].name(), "ts");

        let inactive = rules.active_for(
            &PromptContext::new().with_open_files(["docs/readme.md"]),
        );
        assert!(inactive.is_empty());
    }

    #[test]
    fn priority_orders_active_rules() {
        let tmp = TempDir::new().unwrap();
        let ws = tmp.path();
        write(
            &rules_dir(ws).join("low.mdc"),
            "---\nname: low\nmode: always\npriority: 1\n---\nlow\n",
        );
        write(
            &rules_dir(ws).join("high.mdc"),
            "---\nname: high\nmode: always\npriority: 10\n---\nhigh\n",
        );
        write(
            &rules_dir(ws).join("mid.mdc"),
            "---\nname: mid\nmode: always\npriority: 5\n---\nmid\n",
        );

        let rules = Rules::load(ws).unwrap();
        let active = rules.active_for(&PromptContext::new());
        let names: Vec<_> = active.iter().map(|r| r.name()).collect();
        assert_eq!(names, vec!["high", "mid", "low"]);
    }

    #[test]
    fn manual_rule_requires_mention() {
        let tmp = TempDir::new().unwrap();
        let ws = tmp.path();
        write(
            &rules_dir(ws).join("security.mdc"),
            "---\nname: security\nmode: manual\n---\nCheck inputs.\n",
        );

        let rules = Rules::load(ws).unwrap();

        let none = rules.active_for(&PromptContext::new());
        assert!(none.is_empty());

        let mentioned = rules
            .active_for(&PromptContext::new().with_mentioned(["security"]));
        assert_eq!(mentioned.len(), 1);
        assert_eq!(mentioned[0].name(), "security");
    }

    #[test]
    fn legacy_single_file_loads_as_always() {
        let tmp = TempDir::new().unwrap();
        let ws = tmp.path();
        write(&ws.join(".eri/rules.md"), "Be careful.\n");

        let rules = Rules::load(ws).unwrap();
        let active = rules.active_for(&PromptContext::new());
        assert_eq!(active.len(), 1);
        assert!(matches!(active[0].mode(), Mode::Always));
        assert!(active[0].body().contains("Be careful."));
    }

    #[test]
    fn agent_requested_only_when_requested() {
        let tmp = TempDir::new().unwrap();
        let ws = tmp.path();
        write(
            &rules_dir(ws).join("review.mdc"),
            "---\nname: review\nmode: agent_requested\ndescription: \"Apply during PR review\"\n---\nReview deeply.\n",
        );

        let rules = Rules::load(ws).unwrap();
        assert!(rules.active_for(&PromptContext::new()).is_empty());

        let active = rules.active_for(
            &PromptContext::new().with_agent_requested(["review"]),
        );
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].description(), Some("Apply during PR review"));
    }
}
