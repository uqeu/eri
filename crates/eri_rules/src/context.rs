use std::collections::HashSet;
use std::path::PathBuf;

#[derive(Debug, Clone, Default)]
pub struct PromptContext {
    open_files: Vec<PathBuf>,
    mentioned: HashSet<String>,
    agent_requested: HashSet<String>,
}

impl PromptContext {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_open_files<I, P>(mut self, files: I) -> Self
    where
        I: IntoIterator<Item = P>,
        P: Into<PathBuf>,
    {
        self.open_files = files.into_iter().map(Into::into).collect();
        self
    }

    pub fn with_mentioned<I, S>(mut self, names: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.mentioned = names.into_iter().map(Into::into).collect();
        self
    }

    pub fn with_agent_requested<I, S>(mut self, names: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.agent_requested = names.into_iter().map(Into::into).collect();
        self
    }

    pub fn open_files(&self) -> &[PathBuf] {
        &self.open_files
    }

    pub fn is_mentioned(&self, name: &str) -> bool {
        self.mentioned.contains(name)
    }

    pub fn is_agent_requested(&self, name: &str) -> bool {
        self.agent_requested.contains(name)
    }
}
