//! `eri_graph` builds an incremental, file-scoped graph of an eri project
//! (index.html plus sibling CSS/JS) and serializes a relevant subgraph as TOON
//! (Token-Object-Oriented Notation), a hierarchical line-oriented format that
//! compresses several times smaller than the raw HTML when fed to Mercury or
//! other LLMs. The graph is intended to be cheap to maintain in-process and to
//! support surgical edits via `byte_range` on each node.

use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use thiserror::Error;

mod html_scan;
mod toon;

pub use html_scan::HtmlBlock;

/// Approximate characters per token used by `fit_to_token_budget`. This is a
/// rough heuristic (LLM tokenizers vary), but TOON's compact format gives
/// roughly 3-5 chars per token in practice, so 4 is the working estimate.
pub const CHARS_PER_TOKEN: u32 = 4;

#[derive(Debug, Error)]
pub enum GraphError {
    #[error("io error: {0}")]
    Io(#[from] io::Error),
    #[error("parse error: {0}")]
    Parse(String),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NodeKind {
    Document,
    Section,
    Component,
    Script,
    Style,
    Asset,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EdgeKind {
    Contains,
    References,
    StyledBy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Node {
    pub id: u32,
    pub kind: NodeKind,
    pub name: String,
    pub path: PathBuf,
    pub line: Option<u32>,
    pub byte_range: (usize, usize),
    pub summary: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Edge {
    pub from: u32,
    pub to: u32,
    pub kind: EdgeKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Graph {
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
    pub last_built_at: i64,
}

impl Graph {
    /// Build a graph for `project_dir` by scanning `index.html` and sibling
    /// `.css` / `.js` files. Missing files are silently skipped; an empty
    /// directory yields an empty graph.
    pub fn build(project_dir: &Path) -> Result<Self, GraphError> {
        let mut graph = Graph {
            nodes: Vec::new(),
            edges: Vec::new(),
            last_built_at: now_seconds(),
        };
        let index = project_dir.join("index.html");
        if index.is_file() {
            graph.scan_file(project_dir, &index)?;
        }
        if project_dir.is_dir() {
            let mut sibling_paths: Vec<PathBuf> = Vec::new();
            for entry in fs::read_dir(project_dir)? {
                let entry = entry?;
                let path = entry.path();
                if !path.is_file() {
                    continue;
                }
                if path == index {
                    continue;
                }
                let ext = path
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("")
                    .to_ascii_lowercase();
                if ext == "css" || ext == "js" {
                    sibling_paths.push(path);
                }
            }
            sibling_paths.sort();
            for path in sibling_paths {
                graph.scan_file(project_dir, &path)?;
            }
        }
        Ok(graph)
    }

    /// Incrementally re-scan a single file. All nodes/edges previously
    /// associated with `file` are removed and replaced with a fresh scan.
    pub fn update_file(&mut self, project_dir: &Path, file: &Path) -> Result<(), GraphError> {
        let abs = if file.is_absolute() {
            file.to_path_buf()
        } else {
            project_dir.join(file)
        };
        self.remove_file(&abs);
        if abs.is_file() {
            self.scan_file(project_dir, &abs)?;
        }
        self.last_built_at = now_seconds();
        Ok(())
    }

    /// Serialize the entire graph as TOON.
    pub fn to_toon(&self) -> String {
        toon::serialize(self, |_| true)
    }

    /// Serialize the subgraph matching `f` as TOON. Containers of matching
    /// nodes are always included so the indentation hierarchy remains valid.
    pub fn to_toon_filtered<F: Fn(&Node) -> bool>(&self, f: F) -> String {
        let mut included: HashSet<u32> = HashSet::new();
        for node in &self.nodes {
            if f(node) {
                included.insert(node.id);
                for ancestor in self.ancestors(node.id) {
                    included.insert(ancestor);
                }
            }
        }
        toon::serialize(self, |node| included.contains(&node.id))
    }

    /// Pick the most relevant subgraph for `query` that fits in approximately
    /// `target_tokens`. Relevance is a case-insensitive substring match against
    /// each node's name and summary. Matching nodes are seeded, their
    /// ancestors are pulled in to keep the tree valid, and additional sibling
    /// detail is added in document order until the byte budget would be
    /// exceeded. Returns TOON.
    pub fn fit_to_token_budget(&self, query: &str, target_tokens: u32) -> String {
        let budget_chars = target_tokens.saturating_mul(CHARS_PER_TOKEN) as usize;
        let q = query.trim().to_ascii_lowercase();

        let mut included: HashSet<u32> = HashSet::new();
        if !q.is_empty() {
            for node in &self.nodes {
                if node.name.to_ascii_lowercase().contains(&q)
                    || node.summary.to_ascii_lowercase().contains(&q)
                {
                    included.insert(node.id);
                    for ancestor in self.ancestors(node.id) {
                        included.insert(ancestor);
                    }
                }
            }
        }
        // Always seed the document roots so partial results still parse.
        for node in &self.nodes {
            if matches!(node.kind, NodeKind::Document) {
                included.insert(node.id);
            }
        }

        let mut rendered = toon::serialize(self, |node| included.contains(&node.id));
        if rendered.len() <= budget_chars {
            // We have room — top up with extra nodes in document order until
            // we'd bust the budget.
            for node in &self.nodes {
                if included.contains(&node.id) {
                    continue;
                }
                let mut trial = included.clone();
                trial.insert(node.id);
                for ancestor in self.ancestors(node.id) {
                    trial.insert(ancestor);
                }
                let next = toon::serialize(self, |n| trial.contains(&n.id));
                if next.len() > budget_chars {
                    break;
                }
                included = trial;
                rendered = next;
            }
            return rendered;
        }

        // Over budget — drop leaves furthest from matches until we fit.
        let mut ordered: Vec<u32> = included.iter().copied().collect();
        ordered.sort_by_key(|id| self.depth(*id));
        while rendered.len() > budget_chars {
            // Pop the deepest non-document node.
            let mut dropped = false;
            while let Some(id) = ordered.pop() {
                let node = match self.node(id) {
                    Some(n) => n,
                    None => continue,
                };
                if matches!(node.kind, NodeKind::Document) {
                    continue;
                }
                included.remove(&id);
                rendered = toon::serialize(self, |n| included.contains(&n.id));
                dropped = true;
                break;
            }
            if !dropped {
                break;
            }
        }
        rendered
    }

    /// Persist the graph to disk as JSON.
    pub fn save(&self, path: &Path) -> Result<(), GraphError> {
        let bytes = serde_json::to_vec_pretty(self)?;
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                fs::create_dir_all(parent)?;
            }
        }
        fs::write(path, bytes)?;
        Ok(())
    }

    /// Load a graph from a JSON file written by [`Graph::save`].
    pub fn load(path: &Path) -> Result<Self, GraphError> {
        let bytes = fs::read(path)?;
        let graph: Graph = serde_json::from_slice(&bytes)?;
        Ok(graph)
    }

    fn next_id(&self) -> u32 {
        self.nodes.iter().map(|n| n.id).max().unwrap_or(0) + 1
    }

    fn node(&self, id: u32) -> Option<&Node> {
        self.nodes.iter().find(|n| n.id == id)
    }

    fn parent_of(&self, id: u32) -> Option<u32> {
        self.edges
            .iter()
            .find(|e| e.to == id && matches!(e.kind, EdgeKind::Contains))
            .map(|e| e.from)
    }

    fn ancestors(&self, id: u32) -> Vec<u32> {
        let mut out = Vec::new();
        let mut cursor = self.parent_of(id);
        let mut guard = 0;
        while let Some(parent) = cursor {
            if guard > self.nodes.len() {
                break;
            }
            out.push(parent);
            cursor = self.parent_of(parent);
            guard += 1;
        }
        out
    }

    fn depth(&self, id: u32) -> u32 {
        self.ancestors(id).len() as u32
    }

    fn remove_file(&mut self, file: &Path) {
        let to_drop: HashSet<u32> = self
            .nodes
            .iter()
            .filter(|n| n.path == file)
            .map(|n| n.id)
            .collect();
        if to_drop.is_empty() {
            return;
        }
        self.nodes.retain(|n| !to_drop.contains(&n.id));
        self.edges
            .retain(|e| !to_drop.contains(&e.from) && !to_drop.contains(&e.to));
    }

    fn scan_file(&mut self, project_dir: &Path, file: &Path) -> Result<(), GraphError> {
        let source = fs::read_to_string(file)?;
        let ext = file
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        match ext.as_str() {
            "html" | "htm" => self.scan_html(project_dir, file, &source),
            "css" => {
                self.add_opaque_document(file, &source, NodeKind::Style);
                Ok(())
            }
            "js" | "mjs" => {
                self.add_opaque_document(file, &source, NodeKind::Script);
                Ok(())
            }
            _ => Ok(()),
        }
    }

    fn add_opaque_document(&mut self, file: &Path, source: &str, kind: NodeKind) {
        let name = file
            .file_name()
            .and_then(|f| f.to_str())
            .unwrap_or("file")
            .to_string();
        let summary = summary_from_text(source);
        let id = self.next_id();
        self.nodes.push(Node {
            id,
            kind,
            name,
            path: file.to_path_buf(),
            line: Some(1),
            byte_range: (0, source.len()),
            summary,
        });
    }

    fn scan_html(
        &mut self,
        _project_dir: &Path,
        file: &Path,
        source: &str,
    ) -> Result<(), GraphError> {
        let doc_id = self.next_id();
        let doc_name = file
            .file_name()
            .and_then(|f| f.to_str())
            .unwrap_or("index.html")
            .to_string();
        self.nodes.push(Node {
            id: doc_id,
            kind: NodeKind::Document,
            name: doc_name,
            path: file.to_path_buf(),
            line: Some(1),
            byte_range: (0, source.len()),
            summary: String::new(),
        });

        let blocks = html_scan::scan(source);
        for block in &blocks {
            self.emit_block(file, source, doc_id, block);
        }
        Ok(())
    }

    fn emit_block(&mut self, file: &Path, source: &str, parent_id: u32, block: &html_scan::HtmlBlock) {
        let line = Some(line_of(source, block.start));
        let summary = if matches!(block.kind, NodeKind::Section | NodeKind::Document) {
            // Sections keep an empty summary — their content shows via children.
            // Surface a tiny title only for components/assets.
            String::new()
        } else if block.summary.is_empty() {
            summary_from_text(&source[block.start..block.end.min(source.len())])
        } else {
            block.summary.clone()
        };
        let id = self.next_id();
        self.nodes.push(Node {
            id,
            kind: block.kind,
            name: block.name.clone(),
            path: file.to_path_buf(),
            line,
            byte_range: (block.start, block.end),
            summary,
        });
        self.edges.push(Edge {
            from: parent_id,
            to: id,
            kind: EdgeKind::Contains,
        });
        for child in &block.children {
            self.emit_block(file, source, id, child);
        }
    }
}

fn now_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn line_of(source: &str, byte: usize) -> u32 {
    let upto = byte.min(source.len());
    let mut count = 1u32;
    for b in source.as_bytes()[..upto].iter() {
        if *b == b'\n' {
            count = count.saturating_add(1);
        }
    }
    count
}

fn summary_from_text(text: &str) -> String {
    let mut buf = String::new();
    let mut in_tag = false;
    let mut last_was_space = true;
    for ch in text.chars() {
        if ch == '<' {
            in_tag = true;
            continue;
        }
        if ch == '>' {
            in_tag = false;
            continue;
        }
        if in_tag {
            continue;
        }
        if ch.is_whitespace() {
            if !last_was_space && !buf.is_empty() {
                buf.push(' ');
                last_was_space = true;
            }
        } else {
            buf.push(ch);
            last_was_space = false;
        }
        if buf.len() >= 80 {
            break;
        }
    }
    let trimmed = buf.trim();
    let trimmed = if trimmed.len() > 80 {
        &trimmed[..80]
    } else {
        trimmed
    };
    trimmed.to_string()
}
