//! TOON (Token-Object-Oriented Notation) serializer.
//!
//! Format (one node per line, indented by containment depth):
//!
//! ```text
//! doc#1 index.html
//!   section#2 hero | bytes=1240-2380 | line=12
//!     component#3 cta_button "Get started"
//!     component#4 hero_image asset=hero.jpg
//!   section#5 features | bytes=2380-4100
//! ```
//!
//! Non-containment edges (References, StyledBy) are emitted as a
//! `[ref=<id>,...]` suffix on the source node's line. Lines are produced in
//! ascending node-id order for determinism.

use std::collections::{BTreeMap, HashSet};

use crate::{EdgeKind, Graph, Node, NodeKind};

const INDENT: &str = "  ";

pub fn serialize<F: Fn(&Node) -> bool>(graph: &Graph, include: F) -> String {
    let mut included: HashSet<u32> = HashSet::new();
    let mut by_parent: BTreeMap<Option<u32>, Vec<u32>> = BTreeMap::new();
    for node in &graph.nodes {
        if !include(node) {
            continue;
        }
        included.insert(node.id);
    }
    // Build parent map respecting the filter — ancestors not in the filter are
    // collapsed (i.e. we walk up until we find an included ancestor).
    for node in &graph.nodes {
        if !included.contains(&node.id) {
            continue;
        }
        let parent = walk_to_included(graph, node.id, &included);
        by_parent.entry(parent).or_default().push(node.id);
    }
    for ids in by_parent.values_mut() {
        ids.sort();
    }
    // Compute non-containment edges grouped by source node.
    let mut refs: BTreeMap<u32, Vec<u32>> = BTreeMap::new();
    for edge in &graph.edges {
        if matches!(edge.kind, EdgeKind::Contains) {
            continue;
        }
        if !included.contains(&edge.from) || !included.contains(&edge.to) {
            continue;
        }
        refs.entry(edge.from).or_default().push(edge.to);
    }
    for ids in refs.values_mut() {
        ids.sort();
        ids.dedup();
    }

    let mut out = String::new();
    let roots: Vec<u32> = by_parent.get(&None).cloned().unwrap_or_default();
    for root in roots {
        emit(graph, root, 0, &by_parent, &refs, &mut out);
    }
    out
}

fn walk_to_included(graph: &Graph, id: u32, included: &HashSet<u32>) -> Option<u32> {
    let mut cursor = parent_of(graph, id);
    let mut guard = 0;
    while let Some(parent) = cursor {
        if guard > graph.nodes.len() {
            return None;
        }
        if included.contains(&parent) {
            return Some(parent);
        }
        cursor = parent_of(graph, parent);
        guard += 1;
    }
    None
}

fn parent_of(graph: &Graph, id: u32) -> Option<u32> {
    graph
        .edges
        .iter()
        .find(|e| e.to == id && matches!(e.kind, EdgeKind::Contains))
        .map(|e| e.from)
}

fn emit(
    graph: &Graph,
    id: u32,
    depth: usize,
    by_parent: &BTreeMap<Option<u32>, Vec<u32>>,
    refs: &BTreeMap<u32, Vec<u32>>,
    out: &mut String,
) {
    let node = match graph.nodes.iter().find(|n| n.id == id) {
        Some(n) => n,
        None => return,
    };
    for _ in 0..depth {
        out.push_str(INDENT);
    }
    out.push_str(kind_tag(node.kind));
    out.push('#');
    out.push_str(&node.id.to_string());
    out.push(' ');
    out.push_str(&sanitize(&node.name));

    let (start, end) = node.byte_range;
    if !(start == 0 && end == 0) {
        out.push(' ');
        out.push_str(&start.to_string());
        out.push('-');
        out.push_str(&end.to_string());
    }
    if !node.summary.is_empty() && node.summary.len() <= 40 {
        out.push(' ');
        out.push('"');
        out.push_str(&sanitize(&node.summary));
        out.push('"');
    }
    if let Some(targets) = refs.get(&id) {
        out.push_str(" [ref=");
        for (i, t) in targets.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            out.push_str(&t.to_string());
        }
        out.push(']');
    }
    out.push('\n');

    if let Some(children) = by_parent.get(&Some(id)) {
        for child in children {
            emit(graph, *child, depth + 1, by_parent, refs, out);
        }
    }
}

fn kind_tag(kind: NodeKind) -> &'static str {
    match kind {
        NodeKind::Document => "doc",
        NodeKind::Section => "section",
        NodeKind::Component => "component",
        NodeKind::Script => "script",
        NodeKind::Style => "style",
        NodeKind::Asset => "asset",
    }
}

fn sanitize(text: &str) -> String {
    // Collapse newlines / extra whitespace; TOON is line-oriented.
    let mut buf = String::with_capacity(text.len());
    let mut last_space = false;
    for ch in text.chars() {
        if ch == '\n' || ch == '\r' || ch == '\t' {
            if !last_space {
                buf.push(' ');
                last_space = true;
            }
            continue;
        }
        if ch == '"' {
            buf.push('\'');
            last_space = false;
            continue;
        }
        if ch == '|' {
            buf.push('/');
            last_space = false;
            continue;
        }
        buf.push(ch);
        last_space = ch == ' ';
    }
    buf.trim().to_string()
}
