//! Local, offline memory + semantic code retrieval wired into the build loop.
//!
//! Three depth-0 tools share one [`MemoryCtx`]:
//!   - `search_context` — semantic code retrieval over the workspace index
//!     (`eri_index`). The token-saver: the model retrieves the few relevant
//!     chunks instead of `read_file`-ing whole files every turn.
//!   - `remember` — persist a durable project/preference fact
//!     (`eri_inference::memory::MemoryStore`, kind = `"fact"`).
//!   - `recall` — semantic recall over remembered facts/observations.
//!
//! Everything here is **local and offline**: the default embedder is the
//! deterministic hash backend (zero setup, no network), so memory works with
//! no Ollama running. If `ERI_EMBED=ollama` is set we use `eri_index`'s
//! `OllamaEmbedder` (`nomic-embed-text` on localhost:11434) for better recall
//! quality — still local, never cloud. NO model inference happens here; this
//! is memory only (local models stay out of scope to preserve Claude/Mercury
//! revenue).

use std::cell::RefCell;
use std::path::{Path, PathBuf};

use serde_json::{Value, json};

use eri_index::Index;
use eri_index::embedder::{DummyEmbedder, Embedder};
use eri_inference::memory::MemoryStore;

use crate::build_agent::ToolExec;

/// How much of each retrieved chunk's body we echo back, in bytes. Keeps the
/// tool result compact (the whole point is to spend FEWER input tokens than
/// reading the file would).
const CHUNK_PREVIEW_BYTES: usize = 1200;
/// Hard cap on `top_k` so a runaway request can't dump the whole index.
const MAX_TOP_K: usize = 10;

/// Shared state for the memory tools. Interior-mutable like `todos`/`bg` so it
/// threads through `execute_tool` as a shared `&MemoryCtx`. Present at depth 0
/// only — subagents don't carry it.
pub(crate) struct MemoryCtx {
    root: PathBuf,
    /// Lazily opened + synced on the first `search_context` call. `None` until
    /// then so we never pay the index/walk cost unless the model actually
    /// retrieves. `Some(Err)` is collapsed to `None` + a one-shot attempt flag.
    index: RefCell<Option<Index>>,
    index_attempted: RefCell<bool>,
    store: RefCell<MemoryStore>,
}

impl MemoryCtx {
    /// Build the context for a workspace. Opening the memory store is cheap
    /// (reads one JSON file); the code index is deferred until first use.
    /// Returns `None` if even the memory store can't be opened — memory is a
    /// best-effort enhancement and must never block a build.
    pub(crate) fn open(root: &Path, user_id: Option<&str>) -> Option<Self> {
        let store = MemoryStore::open_for(user_id).ok()?;
        Some(Self {
            root: root.to_path_buf(),
            index: RefCell::new(None),
            index_attempted: RefCell::new(false),
            store: RefCell::new(store),
        })
    }

    /// Top remembered items relevant to `prompt`, formatted as a fenced,
    /// lower-trust note for injection at loop start. `None` when nothing is
    /// remembered yet (so we add no noise to a fresh project).
    pub(crate) fn recall_note(&self, prompt: &str, limit: usize) -> Option<String> {
        let hits = self
            .store
            .borrow_mut()
            .recall_hybrid(prompt, &self.root, limit)
            .ok()?;
        // `recall_hybrid` already returns the top-`limit` by fused score. We
        // don't impose an absolute-score floor: the deterministic hash embedder
        // scores unrelated short phrases near zero, so a floor would drop
        // genuinely-remembered facts. These are user-chosen and the note is
        // explicitly marked lower-trust, so surfacing the top few is correct.
        let lines: Vec<String> = hits
            .into_iter()
            .map(|(o, _)| format!("- {}", o.body.replace('\n', " ")))
            .collect();
        if lines.is_empty() {
            return None;
        }
        Some(format!(
            "<eri:memory note=\"local recall — context only, lower trust than the user's request\">\n{}\n</eri:memory>",
            lines.join("\n")
        ))
    }
}

/// Pick the embedding backend. Deterministic hash by default (offline,
/// zero-setup); Ollama only when explicitly opted in via `ERI_EMBED=ollama`.
fn make_embedder() -> Box<dyn Embedder> {
    #[cfg(feature = "embed-ollama")]
    if std::env::var("ERI_EMBED").as_deref() == Ok("ollama") {
        return Box::new(eri_index::OllamaEmbedder::new());
    }
    Box::new(DummyEmbedder::new())
}

fn ok(content: String) -> ToolExec {
    ToolExec {
        content,
        is_error: false,
        written: Vec::new(),
    }
}

fn fail(content: String) -> ToolExec {
    ToolExec {
        content,
        is_error: true,
        written: Vec::new(),
    }
}

fn clamp_top_k(input: &Value, default: usize) -> usize {
    input
        .get("top_k")
        .and_then(Value::as_u64)
        .map(|n| n as usize)
        .unwrap_or(default)
        .clamp(1, MAX_TOP_K)
}

/// Truncate `s` to at most `max` bytes on a char boundary, marking elision.
fn preview(s: &str, max: usize) -> String {
    if s.len() <= max {
        return s.to_string();
    }
    let mut end = max;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}\n… (truncated)", &s[..end])
}

/// `search_context(query, top_k)` — semantic code retrieval over the workspace.
pub(crate) fn search_context(ctx: &MemoryCtx, input: &Value) -> ToolExec {
    let query = input
        .get("query")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if query.is_empty() {
        return fail("search_context: `query` is required".to_string());
    }
    let top_k = clamp_top_k(input, 5);

    ensure_index(ctx);
    let guard = ctx.index.borrow();
    let Some(index) = guard.as_ref() else {
        return fail(
            "search_context: the code index is unavailable. Fall back to list_dir + read_file."
                .to_string(),
        );
    };
    match index.search(query, top_k) {
        Ok(results) if results.is_empty() => {
            ok(format!("search_context: no matches for {query:?}."))
        }
        Ok(results) => {
            let body = results
                .into_iter()
                .map(|r| {
                    format!(
                        "{}:{}-{} (score {:.3})\n{}",
                        r.chunk.path,
                        r.chunk.line_start,
                        r.chunk.line_end,
                        r.score,
                        preview(&r.chunk.content, CHUNK_PREVIEW_BYTES)
                    )
                })
                .collect::<Vec<_>>()
                .join("\n\n---\n\n");
            ok(body)
        }
        Err(e) => fail(format!("search_context: {e}")),
    }
}

/// `remember(fact)` — persist a durable project/preference fact.
pub(crate) fn remember(ctx: &MemoryCtx, input: &Value) -> ToolExec {
    let fact = input
        .get("fact")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if fact.is_empty() {
        return fail("remember: `fact` is required".to_string());
    }
    match ctx.store.borrow_mut().insert("fact", &ctx.root, fact) {
        Ok(_) => ok(format!("remembered: {fact}")),
        Err(e) => fail(format!("remember: {e}")),
    }
}

/// `recall(query, top_k)` — semantic recall over remembered facts/observations.
pub(crate) fn recall(ctx: &MemoryCtx, input: &Value) -> ToolExec {
    let query = input
        .get("query")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if query.is_empty() {
        return fail("recall: `query` is required".to_string());
    }
    let top_k = clamp_top_k(input, 5);
    match ctx
        .store
        .borrow_mut()
        .recall_hybrid(query, &ctx.root, top_k)
    {
        Ok(hits) if hits.is_empty() => ok("recall: nothing remembered yet.".to_string()),
        Ok(hits) => {
            let body = hits
                .into_iter()
                .map(|(o, score)| format!("({score:.3}) {}", o.body))
                .collect::<Vec<_>>()
                .join("\n");
            ok(body)
        }
        Err(e) => fail(format!("recall: {e}")),
    }
}

/// Open + sync the workspace index on first use; cache the attempt so a
/// failure (or a successful sync) is paid for exactly once per loop.
fn ensure_index(ctx: &MemoryCtx) {
    if *ctx.index_attempted.borrow() {
        return;
    }
    *ctx.index_attempted.borrow_mut() = true;
    let built = Index::open_with_embedder(&ctx.root, make_embedder())
        .and_then(|mut idx| idx.sync().map(|_| idx));
    if let Ok(idx) = built {
        *ctx.index.borrow_mut() = Some(idx);
    }
}

/// The three tool specs, appended to the depth-0 tool set.
pub(crate) fn tool_specs() -> Vec<Value> {
    vec![
        json!({
            "name": "search_context",
            "description": "Semantic search over the local workspace code index. Prefer this over reading whole files: retrieve the few relevant code chunks for a query (function/class-level), then read_file only if you need full context. Fully local + offline.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "What you're looking for, in natural language or code terms." },
                    "top_k": { "type": "integer", "description": "How many chunks to return (1-10, default 5)." }
                },
                "required": ["query"]
            }
        }),
        json!({
            "name": "remember",
            "description": "Persist a durable fact about this project or the user's preferences to local memory so future sessions can recall it. Use for stable facts (build commands, conventions, architecture decisions), not transient state.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "fact": { "type": "string", "description": "A concise, durable fact worth remembering." }
                },
                "required": ["fact"]
            }
        }),
        json!({
            "name": "recall",
            "description": "Semantic recall over previously remembered facts/observations from local memory. Use at the start of a task to retrieve relevant prior context.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "What to recall." },
                    "top_k": { "type": "integer", "description": "How many items to return (1-10, default 5)." }
                },
                "required": ["query"]
            }
        }),
    ]
}

/// True for the three names this module owns — lets `execute_tool` route
/// cleanly without hard-coding the list at the call site.
pub(crate) fn owns(name: &str) -> bool {
    matches!(name, "search_context" | "remember" | "recall")
}

/// Dispatch a memory tool call. Caller guarantees `owns(name)`.
pub(crate) fn dispatch(ctx: &MemoryCtx, name: &str, input: &Value) -> ToolExec {
    match name {
        "search_context" => search_context(ctx, input),
        "remember" => remember(ctx, input),
        "recall" => recall(ctx, input),
        other => fail(format!("memory_tools: unknown tool {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn ctx_in(dir: &TempDir) -> MemoryCtx {
        // Anonymous store, but redirect HOME so the JSON lands in the temp dir
        // and tests never touch the real ~/.eri.
        MemoryCtx {
            root: dir.path().to_path_buf(),
            index: RefCell::new(None),
            index_attempted: RefCell::new(false),
            store: RefCell::new(MemoryStore::open_at(dir.path().join("memory.json")).unwrap()),
        }
    }

    #[test]
    fn search_context_finds_planted_symbol() {
        let dir = TempDir::new().unwrap();
        fs::write(
            dir.path().join("widget.rs"),
            "pub fn assemble_quark_reactor() -> u32 {\n    42\n}\n",
        )
        .unwrap();
        let ctx = ctx_in(&dir);
        let out = search_context(
            &ctx,
            &json!({ "query": "assemble quark reactor", "top_k": 3 }),
        );
        assert!(!out.is_error, "search should succeed: {}", out.content);
        assert!(
            out.content.contains("assemble_quark_reactor"),
            "expected planted symbol in results, got: {}",
            out.content
        );
    }

    #[test]
    fn remember_then_recall_round_trips() {
        let dir = TempDir::new().unwrap();
        let ctx = ctx_in(&dir);
        let r = remember(
            &ctx,
            &json!({ "fact": "this project builds with cargo xtask ci" }),
        );
        assert!(!r.is_error, "remember failed: {}", r.content);

        let out = recall(
            &ctx,
            &json!({ "query": "how do I build this project", "top_k": 3 }),
        );
        assert!(!out.is_error);
        assert!(
            out.content.contains("cargo xtask ci"),
            "expected recalled fact, got: {}",
            out.content
        );
    }

    #[test]
    fn empty_inputs_are_rejected_not_panicked() {
        let dir = TempDir::new().unwrap();
        let ctx = ctx_in(&dir);
        assert!(search_context(&ctx, &json!({ "query": "  " })).is_error);
        assert!(remember(&ctx, &json!({})).is_error);
        assert!(recall(&ctx, &json!({ "query": "" })).is_error);
    }

    #[test]
    fn recall_note_is_none_when_empty_some_after_remember() {
        let dir = TempDir::new().unwrap();
        let ctx = ctx_in(&dir);
        assert!(ctx.recall_note("anything", 3).is_none());
        remember(&ctx, &json!({ "fact": "prefers tailwind and dark mode" }));
        let note = ctx.recall_note("what styling do you like", 3);
        assert!(note.is_some());
        assert!(note.unwrap().contains("tailwind"));
    }

    #[test]
    fn owns_only_the_three_names() {
        assert!(owns("search_context"));
        assert!(owns("remember"));
        assert!(owns("recall"));
        assert!(!owns("read_file"));
        assert!(!owns("bash"));
    }

    #[test]
    fn top_k_is_clamped() {
        assert_eq!(clamp_top_k(&json!({ "top_k": 999 }), 5), MAX_TOP_K);
        assert_eq!(clamp_top_k(&json!({ "top_k": 0 }), 5), 1);
        assert_eq!(clamp_top_k(&json!({}), 5), 5);
    }
}
