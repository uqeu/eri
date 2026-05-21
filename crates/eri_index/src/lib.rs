//! Semantic codebase index for eri.
//!
//! A library that walks a workspace, splits files into semantically
//! meaningful chunks via tree-sitter, embeds them with a swappable backend,
//! and persists everything to SQLite for incremental re-sync.
//!
//! # Architecture
//!
//! - [`walker`] respects `.gitignore` and `.eriignore`, skips files above
//!   a size cap, and yields candidate paths.
//! - [`chunker`] uses tree-sitter to chunk at function/class/method
//!   boundaries for supported languages, with a recursive splitter
//!   fallback for everything else.
//! - [`embedder`] defines the [`Embedder`] trait. Concrete implementations:
//!   - [`embedder::DummyEmbedder`] — deterministic hash-based vectors,
//!     used by tests and as a fallback when no real backend is wired up.
//!   - [`embedder::OllamaEmbedder`] — POSTs to a local Ollama server
//!     (`http://localhost:11434/api/embeddings`) using the
//!     `nomic-embed-text` model. The recommended production backend
//!     until candle is finished.
//!   - [`embedder::NomicCandleEmbedder`] — stub for an in-process candle
//!     backend. Compiles but its body is `todo!()`. Wire it up when the
//!     candle yak shave is acceptable.
//! - [`store`] persists chunks + embeddings + per-file content hashes in
//!   `<workspace>/.eri/index.sqlite`.
//! - [`Index`] ties them together and exposes `sync`, `search`, `stats`.
//!
//! Incremental sync compares blake3 hashes against the previous run and
//! only re-chunks + re-embeds files whose hash changed (Merkle-tree spirit
//! without an explicit tree — file-granularity is enough for now).

pub mod chunker;
pub mod embedder;
pub mod store;
pub mod walker;

mod index;

pub use chunker::{Chunk, ChunkKind};
pub use embedder::{DummyEmbedder, Embedder, EmbedderError};
#[cfg(feature = "ollama")]
pub use embedder::OllamaEmbedder;
#[cfg(feature = "candle")]
pub use embedder::NomicCandleEmbedder;
pub use index::{Index, IndexError, IndexStats, SearchResult, SyncReport};
