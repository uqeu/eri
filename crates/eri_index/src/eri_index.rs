//! Codebase semantic indexer for eri.
//!
//! Walks a project directory, splits files into semantically meaningful
//! chunks (HTML sections, code blocks, prose paragraphs), and builds a
//! search index keyed on either embeddings (when an API key is set) or a
//! pure-Rust token-overlap scorer. Used by the voice loop so utterances
//! like "rewrite the contact form" can pull the right snippet of code into
//! the next Mercury prompt without the user typing a path.
//!
//! Design notes:
//! - Brute-force cosine over `Vec<IndexEntry>` is fine up to ~10k entries.
//!   That's plenty for a single-page build dir; we don't need an ANN library.
//! - The fallback path stays semantically equivalent — the same `search`
//!   surface returns the same shape, just scored via token overlap. The
//!   caller doesn't branch on which backend the index used.
//! - Embeddings are fetched in batches of 50 from OpenAI's
//!   `text-embedding-3-small` model (cheap, ~$0.02/1M tokens). A missing
//!   API key is *not* an error — `Index::build` silently downgrades to the
//!   fallback indexer and the panel surfaces a status line explaining how
//!   to enable cloud embeddings.

use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    time::Duration,
};

use serde::{Deserialize, Serialize};
use thiserror::Error;

const EMBEDDING_MODEL: &str = "text-embedding-3-small";
const EMBEDDING_ENDPOINT: &str = "https://api.openai.com/v1/embeddings";
const EMBEDDING_BATCH: usize = 50;
const SNIPPET_CHARS: usize = 400;
const CHUNK_CHARS: usize = 500;
const MAX_FILE_BYTES: u64 = 1_000_000;

/// One indexed chunk of a project file. Path + label + snippet are
/// human-readable; the embedding (if present) is the high-dimensional
/// vector used for cosine search. When the fallback indexer ran the
/// vector is empty and search falls back to token overlap.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct IndexEntry {
    pub path: PathBuf,
    pub kind: EntryKind,
    /// Short description shown to humans / fed to TTS. For HTML sections
    /// this is "<section id='contact'> in index.html"; for code chunks
    /// it's "lines 12-34 of script.js".
    pub label: String,
    /// ~400 chars of surrounding text. This is what gets prepended to the
    /// next Mercury prompt as `# Likely target`.
    pub snippet: String,
    /// Embedding vector when the embeddings backend produced one. Empty
    /// vec means the fallback (token-overlap) backend was used.
    #[serde(default)]
    pub embedding: Vec<f32>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum EntryKind {
    File,
    Symbol,
    Section,
}

/// The persisted form. We round-trip via JSON so the index file is
/// inspectable and easy to debug; binary formats save bytes but make
/// `cat .eri-index.json | jq` impossible.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Index {
    entries: Vec<IndexEntry>,
    /// Which backend produced this index. Surfaced through
    /// [`Index::backend`] so the panel can show "Embeddings" vs "Tokens"
    /// in the status row without re-inspecting individual entries.
    #[serde(default)]
    backend: IndexBackend,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum IndexBackend {
    /// OpenAI `text-embedding-3-small` cosine search.
    Embeddings,
    /// Pure-Rust token-overlap fallback. Used when no embeddings API key
    /// is set so the voice @-mention path still has a search backend.
    #[default]
    Tokens,
}

#[derive(Debug, Error)]
pub enum IndexError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("embedding api failed: {0}")]
    Embedding(String),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("OPENAI_API_KEY / ERI_EMBEDDING_API_KEY is not set")]
    MissingApiKey,
}

impl Index {
    /// Build an index for the given project directory. Tries the OpenAI
    /// embeddings path first; falls back to a token-overlap index if no
    /// API key is available so voice @-mentions still work without
    /// network access.
    pub fn build(project_dir: &Path) -> Result<Self, IndexError> {
        let entries = scan_entries(project_dir)?;
        if entries.is_empty() {
            return Ok(Self {
                entries,
                backend: IndexBackend::Tokens,
            });
        }
        match read_api_key() {
            Some(api_key) => match embed_entries(&api_key, entries.clone()) {
                Ok(embedded) => Ok(Self {
                    entries: embedded,
                    backend: IndexBackend::Embeddings,
                }),
                Err(error) => {
                    log::warn!(
                        "eri_index: embeddings backend failed ({error}); falling back to tokens"
                    );
                    Ok(Self {
                        entries,
                        backend: IndexBackend::Tokens,
                    })
                }
            },
            None => Ok(Self {
                entries,
                backend: IndexBackend::Tokens,
            }),
        }
    }

    /// Construct from a pre-computed entry list. Used by tests and by
    /// future remote-index loaders.
    pub fn from_entries(entries: Vec<IndexEntry>, backend: IndexBackend) -> Self {
        Self { entries, backend }
    }

    pub fn entries(&self) -> &[IndexEntry] {
        &self.entries
    }

    pub fn backend(&self) -> IndexBackend {
        self.backend
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn save(&self, path: &Path) -> Result<(), IndexError> {
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                fs::create_dir_all(parent)?;
            }
        }
        let json = serde_json::to_string_pretty(self)?;
        fs::write(path, json)?;
        Ok(())
    }

    pub fn load(path: &Path) -> Result<Self, IndexError> {
        let raw = fs::read_to_string(path)?;
        let parsed: Self = serde_json::from_str(&raw)?;
        Ok(parsed)
    }

    /// Return the top-k entries that best match `query`. Uses cosine
    /// similarity when the index has embeddings; otherwise scores by
    /// shared-token overlap. Entries are returned in descending score
    /// order; the caller can apply a confidence cutoff (we suggest
    /// `> 0.55` for embeddings, `> 0.20` for token overlap).
    pub fn search(&self, query: &str, top_k: usize) -> Result<Vec<&IndexEntry>, IndexError> {
        if self.entries.is_empty() || top_k == 0 {
            return Ok(Vec::new());
        }
        let scored = match self.backend {
            IndexBackend::Embeddings => match read_api_key() {
                Some(api_key) => {
                    let vector = embed_one(&api_key, query)?;
                    self.score_by_cosine(&vector)
                }
                // The index was built with embeddings but the key is now
                // gone — fall back to token overlap so the user still gets
                // a useful result rather than an error.
                None => self.score_by_tokens(query),
            },
            IndexBackend::Tokens => self.score_by_tokens(query),
        };
        let top = scored.into_iter().take(top_k).map(|(_, e)| e).collect();
        Ok(top)
    }

    fn score_by_cosine(&self, query: &[f32]) -> Vec<(f32, &IndexEntry)> {
        let mut scored: Vec<(f32, &IndexEntry)> = self
            .entries
            .iter()
            .filter(|e| !e.embedding.is_empty())
            .map(|e| (cosine_similarity(query, &e.embedding), e))
            .collect();
        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        scored
    }

    fn score_by_tokens(&self, query: &str) -> Vec<(f32, &IndexEntry)> {
        let query_tokens = tokenize(query);
        if query_tokens.is_empty() {
            return Vec::new();
        }
        let mut scored: Vec<(f32, &IndexEntry)> = self
            .entries
            .iter()
            .map(|e| (token_overlap_score(&query_tokens, e), e))
            .filter(|(score, _)| *score > 0.0)
            .collect();
        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        scored
    }
}

/// Read the embedding API key from either `OPENAI_API_KEY` or
/// `ERI_EMBEDDING_API_KEY` (the latter wins, so users who already have an
/// OpenAI key for other tools can give the indexer its own).
fn read_api_key() -> Option<String> {
    std::env::var("ERI_EMBEDDING_API_KEY")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| {
            std::env::var("OPENAI_API_KEY")
                .ok()
                .filter(|s| !s.trim().is_empty())
        })
}

/// Walk the project tree and split every supported file into entries.
/// Embeddings are *not* attached here — the embedding step runs in a
/// separate batched call so we don't fire one POST per chunk.
fn scan_entries(project_dir: &Path) -> Result<Vec<IndexEntry>, IndexError> {
    let mut entries: Vec<IndexEntry> = Vec::new();
    let mut stack: Vec<PathBuf> = vec![project_dir.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let read = match fs::read_dir(&dir) {
            Ok(r) => r,
            Err(_) => continue,
        };
        for entry in read.flatten() {
            let path = entry.path();
            let file_type = match entry.file_type() {
                Ok(ft) => ft,
                Err(_) => continue,
            };
            if file_type.is_dir() {
                if is_skippable_dir(&path) {
                    continue;
                }
                stack.push(path);
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            if !is_indexable_path(&path) {
                continue;
            }
            let metadata = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            if metadata.len() > MAX_FILE_BYTES {
                continue;
            }
            let text = match fs::read_to_string(&path) {
                Ok(t) => t,
                Err(_) => continue,
            };
            split_file_into_entries(&path, &text, &mut entries);
        }
    }
    Ok(entries)
}

fn is_skippable_dir(path: &Path) -> bool {
    let name = match path.file_name().and_then(|n| n.to_str()) {
        Some(n) => n,
        None => return false,
    };
    matches!(
        name,
        ".git"
            | "node_modules"
            | "target"
            | "dist"
            | "build"
            | ".next"
            | ".cache"
            | ".eri"
            | "iterations"
    ) || name.starts_with('.') && name.len() > 1 && name != ".env"
}

fn is_indexable_path(path: &Path) -> bool {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if name == ".eri-index.json" {
        return false;
    }
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase());
    matches!(
        ext.as_deref(),
        Some("html") | Some("htm") | Some("css") | Some("js") | Some("json") | Some("md")
    )
}

/// Split a single file into chunks. HTML files are split by major
/// semantic blocks (so "the contact form" maps to its own entry); other
/// supported files are split into ~CHUNK_CHARS-sized slices to keep
/// embedding cost predictable while preserving enough surrounding text
/// to be useful as Mercury context.
fn split_file_into_entries(path: &Path, text: &str, out: &mut Vec<IndexEntry>) {
    let display_path = path.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase());

    if matches!(ext.as_deref(), Some("html") | Some("htm")) {
        let sections = split_html_sections(text);
        for section in sections {
            out.push(IndexEntry {
                path: path.to_path_buf(),
                kind: EntryKind::Section,
                label: format!("{} in {}", section.label, display_path),
                snippet: truncate_for_snippet(&section.body),
                embedding: Vec::new(),
            });
        }
        // Also push a whole-file entry so "the index page" matches.
        out.push(IndexEntry {
            path: path.to_path_buf(),
            kind: EntryKind::File,
            label: format!("whole file: {display_path}"),
            snippet: truncate_for_snippet(text),
            embedding: Vec::new(),
        });
        return;
    }

    // Non-HTML: chunk by character window. Char-based slicing on a
    // utf-8 boundary is non-trivial; we walk char_indices to find a
    // safe split.
    for (chunk_index, chunk) in chunk_text(text, CHUNK_CHARS).into_iter().enumerate() {
        if chunk.trim().is_empty() {
            continue;
        }
        let label = format!("chunk {} of {}", chunk_index + 1, display_path);
        out.push(IndexEntry {
            path: path.to_path_buf(),
            kind: EntryKind::File,
            label,
            snippet: truncate_for_snippet(&chunk),
            embedding: Vec::new(),
        });
    }
}

#[derive(Debug)]
struct HtmlSection {
    label: String,
    body: String,
}

/// Lightweight HTML splitter: walks the text looking for opening tags
/// of major semantic elements and pairs each with the next matching
/// closing tag at the same depth. Intentionally NOT a full HTML parser —
/// we just need "the contact form" to land in its own entry.
fn split_html_sections(text: &str) -> Vec<HtmlSection> {
    const TAGS: &[&str] = &["section", "header", "footer", "nav", "main", "form"];
    let mut sections: Vec<HtmlSection> = Vec::new();
    let lower = text.to_ascii_lowercase();
    for tag in TAGS {
        let open_marker = format!("<{tag}");
        let close_marker = format!("</{tag}>");
        let mut cursor = 0;
        while let Some(rel) = lower[cursor..].find(&open_marker) {
            let start = cursor + rel;
            // Find end of opening tag (>). If the source uses self-closing
            // or malformed HTML this loop just skips the section.
            let after_open = match text[start..].find('>') {
                Some(p) => start + p + 1,
                None => break,
            };
            let close_rel = match lower[after_open..].find(&close_marker) {
                Some(p) => p,
                None => {
                    cursor = after_open;
                    continue;
                }
            };
            let close_end = after_open + close_rel + close_marker.len();
            let body = text[start..close_end].to_string();
            let descriptor = descriptor_from_opening_tag(&text[start..after_open], tag);
            sections.push(HtmlSection {
                label: descriptor,
                body,
            });
            cursor = close_end;
        }
    }
    sections
}

/// Build a human-readable label for an HTML section by extracting the
/// `id` or `class` attribute from the opening tag. Falls back to just
/// the tag name when neither is present.
fn descriptor_from_opening_tag(opening: &str, tag: &str) -> String {
    let lower = opening.to_ascii_lowercase();
    if let Some(value) = extract_attr(&lower, opening, "id") {
        return format!("<{tag} id=\"{value}\">");
    }
    if let Some(value) = extract_attr(&lower, opening, "class") {
        return format!("<{tag} class=\"{value}\">");
    }
    if let Some(value) = extract_attr(&lower, opening, "name") {
        return format!("<{tag} name=\"{value}\">");
    }
    format!("<{tag}>")
}

fn extract_attr(lower: &str, original: &str, attr: &str) -> Option<String> {
    let needle = format!("{attr}=\"");
    let attr_start = lower.find(&needle)?;
    let value_start = attr_start + needle.len();
    let value_end = original[value_start..].find('"')?;
    Some(original[value_start..value_start + value_end].to_string())
}

fn chunk_text(text: &str, max_chars: usize) -> Vec<String> {
    if text.is_empty() || max_chars == 0 {
        return Vec::new();
    }
    let mut chunks: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut char_count = 0;
    for ch in text.chars() {
        current.push(ch);
        char_count += 1;
        if char_count >= max_chars {
            chunks.push(std::mem::take(&mut current));
            char_count = 0;
        }
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

fn truncate_for_snippet(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= SNIPPET_CHARS {
        return trimmed.to_string();
    }
    let mut out = String::with_capacity(SNIPPET_CHARS + 1);
    for (n, ch) in trimmed.chars().enumerate() {
        if n >= SNIPPET_CHARS {
            break;
        }
        out.push(ch);
    }
    out
}

/// Cosine similarity in `[-1.0, 1.0]`. Returns 0.0 for either-vector-zero
/// or mismatched-length inputs so a malformed cache file can't NaN the
/// search.
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.is_empty() || b.is_empty() || a.len() != b.len() {
        return 0.0;
    }
    let mut dot: f32 = 0.0;
    let mut a_norm: f32 = 0.0;
    let mut b_norm: f32 = 0.0;
    for (x, y) in a.iter().zip(b.iter()) {
        dot += x * y;
        a_norm += x * x;
        b_norm += y * y;
    }
    let denom = a_norm.sqrt() * b_norm.sqrt();
    if denom == 0.0 {
        return 0.0;
    }
    dot / denom
}

/// Pure-Rust fallback scorer. Computes Jaccard-style overlap between
/// query tokens and the union of `label + snippet` tokens. Bounded to
/// `[0.0, 1.0]` so callers can use the same confidence cutoff style as
/// the embedding path (just with a smaller threshold).
fn token_overlap_score(query_tokens: &HashSet<String>, entry: &IndexEntry) -> f32 {
    let mut entry_tokens = tokenize(&entry.label);
    entry_tokens.extend(tokenize(&entry.snippet));
    if entry_tokens.is_empty() {
        return 0.0;
    }
    let shared = query_tokens.intersection(&entry_tokens).count() as f32;
    let union = query_tokens.union(&entry_tokens).count() as f32;
    if union == 0.0 {
        0.0
    } else {
        shared / union
    }
}

fn tokenize(text: &str) -> HashSet<String> {
    text.to_ascii_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| t.len() >= 3)
        .filter(|t| !STOPWORDS.contains(t))
        .map(|t| t.to_string())
        .collect()
}

const STOPWORDS: &[&str] = &[
    "the", "and", "for", "with", "this", "that", "from", "into", "have", "has", "are", "was",
    "you", "your", "but", "not", "all", "any", "can", "use", "via", "let", "src", "alt", "href",
];

#[derive(Serialize)]
struct EmbeddingRequest<'a> {
    model: &'a str,
    input: Vec<&'a str>,
}

#[derive(Deserialize)]
struct EmbeddingResponse {
    data: Vec<EmbeddingDatum>,
}

#[derive(Deserialize)]
struct EmbeddingDatum {
    embedding: Vec<f32>,
}

/// Batch-embed every entry in groups of [`EMBEDDING_BATCH`]. Mutates
/// `entries[i].embedding` in place so we don't double-allocate.
fn embed_entries(api_key: &str, mut entries: Vec<IndexEntry>) -> Result<Vec<IndexEntry>, IndexError> {
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(10))
        .timeout(Duration::from_secs(60))
        .build();

    for chunk_start in (0..entries.len()).step_by(EMBEDDING_BATCH) {
        let chunk_end = (chunk_start + EMBEDDING_BATCH).min(entries.len());
        let inputs: Vec<&str> = entries[chunk_start..chunk_end]
            .iter()
            .map(|e| e.snippet.as_str())
            .collect();
        let request = EmbeddingRequest {
            model: EMBEDDING_MODEL,
            input: inputs,
        };
        let body = serde_json::to_string(&request)?;
        let response = match agent
            .post(EMBEDDING_ENDPOINT)
            .set("authorization", &format!("Bearer {api_key}"))
            .set("content-type", "application/json")
            .send_string(&body)
        {
            Ok(r) => r,
            Err(ureq::Error::Status(status, response)) => {
                let body = response.into_string().unwrap_or_default();
                return Err(IndexError::Embedding(format!(
                    "{EMBEDDING_ENDPOINT} returned {status}: {body}"
                )));
            }
            Err(other) => return Err(IndexError::Embedding(other.to_string())),
        };
        let response_body = response
            .into_string()
            .map_err(|e| IndexError::Embedding(e.to_string()))?;
        let parsed: EmbeddingResponse = serde_json::from_str(&response_body)?;
        if parsed.data.len() != chunk_end - chunk_start {
            return Err(IndexError::Embedding(format!(
                "expected {} embeddings, got {}",
                chunk_end - chunk_start,
                parsed.data.len()
            )));
        }
        for (offset, datum) in parsed.data.into_iter().enumerate() {
            entries[chunk_start + offset].embedding = datum.embedding;
        }
    }
    Ok(entries)
}

fn embed_one(api_key: &str, query: &str) -> Result<Vec<f32>, IndexError> {
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(5))
        .timeout(Duration::from_secs(20))
        .build();
    let request = EmbeddingRequest {
        model: EMBEDDING_MODEL,
        input: vec![query],
    };
    let body = serde_json::to_string(&request)?;
    let response = match agent
        .post(EMBEDDING_ENDPOINT)
        .set("authorization", &format!("Bearer {api_key}"))
        .set("content-type", "application/json")
        .send_string(&body)
    {
        Ok(r) => r,
        Err(ureq::Error::Status(status, response)) => {
            let body = response.into_string().unwrap_or_default();
            return Err(IndexError::Embedding(format!(
                "{EMBEDDING_ENDPOINT} returned {status}: {body}"
            )));
        }
        Err(other) => return Err(IndexError::Embedding(other.to_string())),
    };
    let response_body = response
        .into_string()
        .map_err(|e| IndexError::Embedding(e.to_string()))?;
    let parsed: EmbeddingResponse = serde_json::from_str(&response_body)?;
    parsed
        .data
        .into_iter()
        .next()
        .map(|d| d.embedding)
        .ok_or_else(|| IndexError::Embedding("empty embedding response".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cosine_similarity_returns_1_for_identical_vectors() {
        let a = vec![0.5, 0.5, 0.5, 0.5];
        let b = vec![0.5, 0.5, 0.5, 0.5];
        let score = cosine_similarity(&a, &b);
        assert!((score - 1.0).abs() < 1e-6, "expected ~1.0, got {score}");
    }

    #[test]
    fn cosine_similarity_returns_0_for_orthogonal_vectors() {
        let a = vec![1.0, 0.0];
        let b = vec![0.0, 1.0];
        assert!(cosine_similarity(&a, &b).abs() < 1e-6);
    }

    #[test]
    fn cosine_similarity_handles_mismatched_lengths() {
        let a = vec![1.0, 0.0];
        let b = vec![0.0, 1.0, 0.0];
        assert_eq!(cosine_similarity(&a, &b), 0.0);
    }

    #[test]
    fn fallback_indexer_finds_token_overlap_section() {
        let entries = vec![
            IndexEntry {
                path: PathBuf::from("index.html"),
                kind: EntryKind::Section,
                label: "<section id=\"contact\"> in index.html".to_string(),
                snippet: "<section id=\"contact\"><form>email message submit</form></section>"
                    .to_string(),
                embedding: Vec::new(),
            },
            IndexEntry {
                path: PathBuf::from("index.html"),
                kind: EntryKind::Section,
                label: "<header> in index.html".to_string(),
                snippet: "<header><nav>home about pricing</nav></header>".to_string(),
                embedding: Vec::new(),
            },
        ];
        let index = Index::from_entries(entries, IndexBackend::Tokens);
        let results = index
            .search("rewrite the contact form", 1)
            .expect("search ok");
        assert_eq!(results.len(), 1);
        assert!(
            results[0].label.contains("contact"),
            "expected contact section, got {:?}",
            results[0].label
        );
    }

    #[test]
    fn index_save_and_load_roundtrip() {
        let entries = vec![IndexEntry {
            path: PathBuf::from("script.js"),
            kind: EntryKind::File,
            label: "chunk 1 of script.js".to_string(),
            snippet: "function init() { return 42; }".to_string(),
            embedding: vec![0.1, 0.2, 0.3],
        }];
        let original = Index::from_entries(entries, IndexBackend::Embeddings);

        let tmp = tempfile::tempdir().expect("tempdir");
        let path = tmp.path().join(".eri-index.json");
        original.save(&path).expect("save");
        let loaded = Index::load(&path).expect("load");
        assert_eq!(loaded, original);
        assert_eq!(loaded.backend(), IndexBackend::Embeddings);
        assert_eq!(loaded.len(), 1);
    }

    #[test]
    fn split_html_finds_form_section() {
        let html = r#"<!DOCTYPE html>
            <html><body>
            <header><h1>Welcome</h1></header>
            <section id="contact">
                <form name="contact-form">
                    <input type="email" />
                    <button>Send</button>
                </form>
            </section>
            </body></html>"#;
        let sections = split_html_sections(html);
        let labels: Vec<&str> = sections.iter().map(|s| s.label.as_str()).collect();
        assert!(
            labels.iter().any(|l| l.contains("contact")),
            "expected section labeled with contact id, got {labels:?}"
        );
        assert!(
            labels.iter().any(|l| l.contains("contact-form")),
            "expected form named contact-form, got {labels:?}"
        );
    }

    #[test]
    fn build_scans_html_files_into_section_entries() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let path = tmp.path().join("index.html");
        fs::write(
            &path,
            r#"<html><body>
                <section id="hero"><h1>Hi</h1></section>
                <section id="pricing"><h2>Pricing</h2></section>
            </body></html>"#,
        )
        .expect("write fixture");
        // Force fallback path so we don't hit the network.
        let saved = std::env::var("OPENAI_API_KEY").ok();
        let saved_eri = std::env::var("ERI_EMBEDDING_API_KEY").ok();
        // SAFETY: tests run single-threaded per-binary by default in
        // cargo, and we restore both vars below.
        unsafe {
            std::env::remove_var("OPENAI_API_KEY");
            std::env::remove_var("ERI_EMBEDDING_API_KEY");
        }
        let index = Index::build(tmp.path()).expect("build");
        if let Some(v) = saved {
            unsafe { std::env::set_var("OPENAI_API_KEY", v) }
        }
        if let Some(v) = saved_eri {
            unsafe { std::env::set_var("ERI_EMBEDDING_API_KEY", v) }
        }
        assert_eq!(index.backend(), IndexBackend::Tokens);
        assert!(index.len() >= 2, "expected hero + pricing sections");
        let results = index.search("pricing section", 1).expect("search");
        assert_eq!(results.len(), 1);
        assert!(results[0].label.contains("pricing"));
    }
}
