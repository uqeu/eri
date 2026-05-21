use globset::{Glob, GlobSet, GlobSetBuilder};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Mode {
    Always,
    AutoAttached { globs: Vec<String> },
    AgentRequested,
    Manual,
}

#[derive(Debug, Clone)]
pub struct Rule {
    pub name: String,
    pub mode: Mode,
    pub body: String,
    pub priority: i64,
    pub description: Option<String>,
}

impl Rule {
    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn body(&self) -> &str {
        &self.body
    }

    pub fn priority(&self) -> i64 {
        self.priority
    }

    pub fn description(&self) -> Option<&str> {
        self.description.as_deref()
    }

    pub fn mode(&self) -> &Mode {
        &self.mode
    }

    pub(crate) fn glob_set(&self) -> Option<GlobSet> {
        match &self.mode {
            Mode::AutoAttached { globs } => build_glob_set(globs).ok(),
            _ => None,
        }
    }
}

fn build_glob_set(patterns: &[String]) -> anyhow::Result<GlobSet> {
    let mut builder = GlobSetBuilder::new();
    for p in patterns {
        builder.add(Glob::new(p)?);
    }
    Ok(builder.build()?)
}
