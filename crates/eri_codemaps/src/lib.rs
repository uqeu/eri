//! Codemaps — shareable, visual codebase artifacts.
//!
//! A *codemap* captures a structural view of a workspace as a graph of
//! `CodemapNode`s connected by `CodemapEdge`s. Maps are generated from the
//! semantic index ([`eri_index::Index`]) and persisted under
//! `<workspace>/.eri/codemaps/<name>.json` (machine-readable) plus
//! `<name>.svg` (human-readable). The JSON is intended to be slurped by the
//! agent via an `@Codemap` mention; the SVG is what humans look at and share.
//!
//! v0 ships two of the four planned kinds:
//!   * `Module` — directory-level graph with edges where one directory's
//!     chunks reference symbols defined in another.
//!   * `Hotspot` — file-level heatmap of chunk density × bytes indexed.
//!
//! `Function` and `Data` are stubbed with a clear error so the rest of the
//! pipeline (sidecar, extension, picker, webview) can be wired now and the
//! generators added without churn.

mod render;

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result, anyhow, bail};
use serde::{Deserialize, Serialize};

use eri_index::Index;

pub use render::render_svg;

const STATE_DIR: &str = ".eri";
const CODEMAPS_DIR: &str = "codemaps";

/// The kind of codemap to generate.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CodemapKind {
    Module,
    Function { root: String, depth: u8 },
    Data,
    Hotspot,
}

impl CodemapKind {
    fn slug(&self) -> &'static str {
        match self {
            CodemapKind::Module => "module",
            CodemapKind::Function { .. } => "function",
            CodemapKind::Data => "data",
            CodemapKind::Hotspot => "hotspot",
        }
    }
}

/// One graph node. `id` is unique within a single codemap.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodemapNode {
    pub id: String,
    pub kind: NodeKind,
    pub label: String,
    pub path: Option<String>,
    pub size_hint: u32,
    pub metadata: serde_json::Value,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NodeKind {
    Module,
    Function,
    Type,
    File,
}

/// One directed edge between two nodes.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodemapEdge {
    pub from: String,
    pub to: String,
    pub kind: EdgeKind,
    pub weight: f32,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EdgeKind {
    Imports,
    Calls,
    Extends,
    Defines,
    Uses,
}

/// The persisted artifact.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Codemap {
    pub name: String,
    pub kind: CodemapKind,
    pub nodes: Vec<CodemapNode>,
    pub edges: Vec<CodemapEdge>,
    pub generated_at_ms: u64,
}

/// Summary used by `list()`.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodemapSummary {
    pub name: String,
    pub kind: String,
    pub generated_at_ms: u64,
}

/// A workspace-scoped store for codemaps. Holds no live handles — every
/// method re-reads/writes the on-disk JSON. The `index` is passed at
/// generation time rather than owned to keep this crate decoupled from the
/// `Services` registry in `eri_coreutils`.
pub struct CodemapStore {
    root: PathBuf,
}

impl CodemapStore {
    /// Open (or lazily create) the codemap directory for `workspace_root`.
    pub fn open(workspace_root: &Path) -> Result<Self> {
        let root = workspace_root.join(STATE_DIR).join(CODEMAPS_DIR);
        fs::create_dir_all(&root)
            .with_context(|| format!("failed to create codemap dir {}", root.display()))?;
        Ok(Self { root })
    }

    /// Generate a codemap of `kind` from `index`. Pure — does not persist.
    pub fn generate(&self, kind: CodemapKind, index: &Index) -> Result<Codemap> {
        let name = derive_name(&kind);
        let (nodes, edges) = match &kind {
            CodemapKind::Module => generate_module_map(index)?,
            CodemapKind::Hotspot => generate_hotspot_map(index)?,
            CodemapKind::Function { .. } => {
                bail!("not yet implemented; tracked under codemap-roadmap")
            }
            CodemapKind::Data => {
                bail!("not yet implemented; tracked under codemap-roadmap")
            }
        };
        Ok(Codemap {
            name,
            kind,
            nodes,
            edges,
            generated_at_ms: now_ms(),
        })
    }

    /// Persist a codemap as `<name>.json` + `<name>.svg`.
    pub fn save(&self, map: &Codemap) -> Result<()> {
        validate_name(&map.name)?;
        let json_path = self.root.join(format!("{}.json", map.name));
        let svg_path = self.root.join(format!("{}.svg", map.name));
        let json = serde_json::to_string_pretty(map)
            .with_context(|| format!("failed to serialise codemap {}", map.name))?;
        fs::write(&json_path, json)
            .with_context(|| format!("failed to write {}", json_path.display()))?;
        let svg = render_svg(map);
        fs::write(&svg_path, svg)
            .with_context(|| format!("failed to write {}", svg_path.display()))?;
        Ok(())
    }

    /// Load a previously saved codemap by name.
    pub fn load(&self, name: &str) -> Result<Codemap> {
        validate_name(name)?;
        let path = self.root.join(format!("{name}.json"));
        let raw = fs::read_to_string(&path)
            .with_context(|| format!("failed to read {}", path.display()))?;
        serde_json::from_str::<Codemap>(&raw)
            .with_context(|| format!("failed to parse codemap {}", path.display()))
    }

    /// Read the rendered SVG (if it exists) for `name`.
    pub fn svg(&self, name: &str) -> Result<String> {
        validate_name(name)?;
        let path = self.root.join(format!("{name}.svg"));
        fs::read_to_string(&path).with_context(|| format!("failed to read {}", path.display()))
    }

    /// List all saved codemaps, newest first.
    pub fn list(&self) -> Result<Vec<CodemapSummary>> {
        let mut out: Vec<CodemapSummary> = Vec::new();
        let entries = match fs::read_dir(&self.root) {
            Ok(e) => e,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(out),
            Err(err) => {
                return Err(anyhow!(err)).with_context(|| {
                    format!("failed to read codemap dir {}", self.root.display())
                });
            }
        };
        for entry in entries {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let raw = match fs::read_to_string(&path) {
                Ok(s) => s,
                Err(_) => continue,
            };
            let map: Codemap = match serde_json::from_str(&raw) {
                Ok(m) => m,
                Err(_) => continue,
            };
            out.push(CodemapSummary {
                name: map.name.clone(),
                kind: map.kind.slug().to_string(),
                generated_at_ms: map.generated_at_ms,
            });
        }
        out.sort_by_key(|b| std::cmp::Reverse(b.generated_at_ms));
        Ok(out)
    }

    /// Absolute path to the on-disk codemap directory. Exposed mainly for
    /// tests and tooling.
    pub fn root_dir(&self) -> &Path {
        &self.root
    }
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/// Pull every chunk out of the index via a top-k search with an empty query.
/// `DummyEmbedder` (and any sane real embedder) will score everything ≈ 0 for
/// an empty input, so we get a deterministic enumeration capped at
/// `MAX_CHUNKS_FOR_MAP`. Good enough for v0 codemaps.
const MAX_CHUNKS_FOR_MAP: usize = 8_192;

fn enumerate_chunks(index: &Index) -> Result<Vec<eri_index::Chunk>> {
    let stats = index.stats();
    let want = stats.chunks.clamp(1, MAX_CHUNKS_FOR_MAP);
    let raw = index
        .search("", want)
        .map_err(|e| anyhow!("failed to enumerate index chunks: {e}"))?;
    Ok(raw.into_iter().map(|r| r.chunk).collect())
}

fn top_dir(path: &str) -> String {
    // Use the first path segment as the "module". Files at the root collapse
    // into a single synthetic "(root)" bucket so they remain visible.
    let cleaned = path.trim_start_matches("./").trim_start_matches('/');
    match cleaned.split_once('/') {
        Some((head, _)) if !head.is_empty() => head.to_string(),
        _ => "(root)".to_string(),
    }
}

fn generate_module_map(index: &Index) -> Result<(Vec<CodemapNode>, Vec<CodemapEdge>)> {
    let chunks = enumerate_chunks(index)?;

    // Bucket chunks by top-level directory.
    let mut by_module: BTreeMap<String, Vec<eri_index::Chunk>> = BTreeMap::new();
    for chunk in chunks {
        by_module
            .entry(top_dir(&chunk.path))
            .or_default()
            .push(chunk);
    }

    // Define a node per module.
    let nodes: Vec<CodemapNode> = by_module
        .iter()
        .map(|(module, chunks)| {
            let bytes: u64 = chunks
                .iter()
                .map(|c| (c.byte_end.saturating_sub(c.byte_start)) as u64)
                .sum();
            CodemapNode {
                id: format!("module:{module}"),
                kind: NodeKind::Module,
                label: module.clone(),
                path: Some(module.clone()),
                size_hint: chunks.len().min(u32::MAX as usize) as u32,
                metadata: serde_json::json!({
                    "chunks": chunks.len(),
                    "bytes": bytes,
                }),
            }
        })
        .collect();

    // Collect the set of likely-symbol identifiers each module defines —
    // identifiers that appear early enough in a function/class chunk to
    // resemble a declaration. This is intentionally coarse; we are not
    // trying to be a compiler.
    let mut defined_by: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for (module, chunks) in &by_module {
        let entry = defined_by.entry(module.clone()).or_default();
        for chunk in chunks {
            for ident in extract_definition_idents(chunk) {
                entry.insert(ident);
            }
        }
    }

    // For every other module, count how many of its chunks textually
    // reference an identifier defined elsewhere. The aggregate count
    // becomes the edge weight.
    let modules: Vec<String> = by_module.keys().cloned().collect();
    let mut edges: Vec<CodemapEdge> = Vec::new();
    for source in &modules {
        let source_chunks = match by_module.get(source) {
            Some(c) => c,
            None => continue,
        };
        for target in &modules {
            if source == target {
                continue;
            }
            let target_idents = match defined_by.get(target) {
                Some(s) if !s.is_empty() => s,
                _ => continue,
            };
            let mut weight = 0u32;
            for chunk in source_chunks {
                for ident in target_idents {
                    if chunk.content.contains(ident.as_str()) {
                        weight = weight.saturating_add(1);
                        break;
                    }
                }
            }
            if weight > 0 {
                edges.push(CodemapEdge {
                    from: format!("module:{source}"),
                    to: format!("module:{target}"),
                    kind: EdgeKind::Imports,
                    weight: weight as f32,
                });
            }
        }
    }

    Ok((nodes, edges))
}

fn generate_hotspot_map(index: &Index) -> Result<(Vec<CodemapNode>, Vec<CodemapEdge>)> {
    let chunks = enumerate_chunks(index)?;

    // Per-file aggregates.
    #[derive(Default)]
    struct FileAgg {
        chunk_count: u32,
        bytes: u64,
    }
    let mut by_file: BTreeMap<String, FileAgg> = BTreeMap::new();
    for chunk in &chunks {
        let agg = by_file.entry(chunk.path.clone()).or_default();
        agg.chunk_count = agg.chunk_count.saturating_add(1);
        agg.bytes = agg
            .bytes
            .saturating_add((chunk.byte_end.saturating_sub(chunk.byte_start)) as u64);
    }

    // Only files with > N chunks make the map; for tiny workspaces we relax
    // the threshold to 0 so the map isn't empty.
    let min_chunks: u32 = if by_file.len() < 8 { 0 } else { 2 };

    let nodes: Vec<CodemapNode> = by_file
        .into_iter()
        .filter(|(_, agg)| agg.chunk_count > min_chunks)
        .map(|(path, agg)| CodemapNode {
            id: format!("file:{path}"),
            kind: NodeKind::File,
            label: short_label(&path),
            path: Some(path.clone()),
            size_hint: agg.chunk_count.saturating_mul(2).max(8),
            metadata: serde_json::json!({
                "chunks": agg.chunk_count,
                "bytes": agg.bytes,
            }),
        })
        .collect();

    Ok((nodes, Vec::new()))
}

/// Pull out plausible top-level identifier names from a chunk body. We look
/// for the first identifier after common declaration keywords. Cheap and
/// works across languages without a tree-sitter dependency in this crate.
fn extract_definition_idents(chunk: &eri_index::Chunk) -> Vec<String> {
    const KEYWORDS: &[&str] = &[
        "fn ",
        "function ",
        "def ",
        "class ",
        "struct ",
        "enum ",
        "trait ",
        "interface ",
        "type ",
        "pub fn ",
        "pub struct ",
        "pub enum ",
        "pub trait ",
        "pub type ",
        "export function ",
        "export class ",
    ];
    let mut out: Vec<String> = Vec::new();
    let body = &chunk.content;
    for kw in KEYWORDS {
        for (idx, _) in body.match_indices(kw) {
            let tail = &body[idx + kw.len()..];
            let ident: String = tail
                .chars()
                .take_while(|c| c.is_alphanumeric() || *c == '_')
                .collect();
            if ident.len() >= 3 {
                out.push(ident);
            }
        }
    }
    out.sort();
    out.dedup();
    out
}

fn derive_name(kind: &CodemapKind) -> String {
    match kind {
        CodemapKind::Module => "module".to_string(),
        CodemapKind::Hotspot => "hotspot".to_string(),
        CodemapKind::Function { root, depth } => {
            let safe: String = root
                .chars()
                .map(|c| if c.is_alphanumeric() { c } else { '_' })
                .collect();
            format!("function_{safe}_d{depth}")
        }
        CodemapKind::Data => "data".to_string(),
    }
}

fn short_label(path: &str) -> String {
    path.rsplit('/').next().unwrap_or(path).to_string()
}

fn validate_name(name: &str) -> Result<()> {
    if name.is_empty() {
        bail!("codemap name must not be empty");
    }
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        bail!("codemap name {name:?} contains forbidden characters");
    }
    Ok(())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn build_tiny_index(root: &Path) -> Index {
        fs::create_dir_all(root.join("alpha")).unwrap();
        fs::create_dir_all(root.join("beta")).unwrap();
        fs::write(
            root.join("alpha/lib.rs"),
            b"pub fn alpha_one() {}\npub fn alpha_two() { alpha_one(); }\n",
        )
        .unwrap();
        fs::write(
            root.join("beta/lib.rs"),
            b"pub fn beta_one() { /* references alpha_one for the heuristic */ alpha_one(); }\n",
        )
        .unwrap();
        let mut index = Index::open(root).unwrap();
        index.sync().unwrap();
        index
    }

    #[test]
    fn open_creates_codemap_dir() {
        let tmp = tempdir().unwrap();
        let store = CodemapStore::open(tmp.path()).unwrap();
        assert!(store.root_dir().is_dir());
        assert!(store.root_dir().ends_with(".eri/codemaps"));
    }

    #[test]
    fn generate_module_map_emits_nodes_and_edges() {
        let tmp = tempdir().unwrap();
        let index = build_tiny_index(tmp.path());
        let store = CodemapStore::open(tmp.path()).unwrap();

        let map = store.generate(CodemapKind::Module, &index).unwrap();
        assert!(map.nodes.iter().any(|n| n.label == "alpha"));
        assert!(map.nodes.iter().any(|n| n.label == "beta"));
        // beta references alpha_one (defined in alpha/lib.rs) → edge beta→alpha
        assert!(
            map.edges
                .iter()
                .any(|e| e.from == "module:beta" && e.to == "module:alpha"),
            "expected beta→alpha edge, got {:?}",
            map.edges
        );
    }

    #[test]
    fn save_and_load_round_trip() {
        let tmp = tempdir().unwrap();
        let index = build_tiny_index(tmp.path());
        let store = CodemapStore::open(tmp.path()).unwrap();

        let map = store.generate(CodemapKind::Module, &index).unwrap();
        store.save(&map).unwrap();

        let loaded = store.load(&map.name).unwrap();
        assert_eq!(loaded.name, map.name);
        assert_eq!(loaded.nodes.len(), map.nodes.len());
        assert_eq!(loaded.edges.len(), map.edges.len());

        // SVG was written next to the JSON.
        let svg_path = store.root_dir().join(format!("{}.svg", map.name));
        assert!(svg_path.is_file());
        let svg = store.svg(&map.name).unwrap();
        assert!(svg.contains("<svg"));
    }

    #[test]
    fn list_returns_saved_maps_newest_first() {
        let tmp = tempdir().unwrap();
        let index = build_tiny_index(tmp.path());
        let store = CodemapStore::open(tmp.path()).unwrap();

        let mut module_map = store.generate(CodemapKind::Module, &index).unwrap();
        let mut hotspot_map = store.generate(CodemapKind::Hotspot, &index).unwrap();
        // Force a deterministic ordering rather than relying on wall clock
        // resolution.
        module_map.generated_at_ms = 1_000;
        hotspot_map.generated_at_ms = 2_000;
        store.save(&module_map).unwrap();
        store.save(&hotspot_map).unwrap();

        let list = store.list().unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].name, "hotspot");
        assert_eq!(list[1].name, "module");
    }

    #[test]
    fn function_and_data_maps_are_not_yet_implemented() {
        let tmp = tempdir().unwrap();
        let index = build_tiny_index(tmp.path());
        let store = CodemapStore::open(tmp.path()).unwrap();

        let err = store
            .generate(
                CodemapKind::Function {
                    root: "main".into(),
                    depth: 2,
                },
                &index,
            )
            .unwrap_err();
        assert!(err.to_string().contains("not yet implemented"));

        let err = store.generate(CodemapKind::Data, &index).unwrap_err();
        assert!(err.to_string().contains("not yet implemented"));
    }

    #[test]
    fn validate_name_rejects_traversal() {
        let tmp = tempdir().unwrap();
        let store = CodemapStore::open(tmp.path()).unwrap();
        assert!(store.load("../escape").is_err());
        assert!(store.load("foo/bar").is_err());
        assert!(store.load("").is_err());
    }
}
