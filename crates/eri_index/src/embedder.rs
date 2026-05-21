//! Embedding backends.
//!
//! [`Embedder`] is the swappable interface. Three implementations ship:
//!
//! - [`DummyEmbedder`] — deterministic hash-based vectors, for tests.
//! - [`OllamaEmbedder`] (feature `ollama`, default) — POSTs to a local
//!   Ollama server. Requires `ollama serve` running locally and
//!   `ollama pull nomic-embed-text` once.
//! - [`NomicCandleEmbedder`] (feature `candle`) — stub for an in-process
//!   candle backend. The full pipeline (hf-hub download, tokenizer,
//!   forward pass, mean-pool, L2 normalize) is documented in code but
//!   not implemented yet. Calling `embed` returns `Unimplemented`.

#[cfg(feature = "ollama")]
use std::time::Duration;

use thiserror::Error;

/// Embedding dimensionality the rest of the crate assumes. `nomic-embed-
/// text-v1.5` outputs 768; the dummy backend uses the same dim so tests
/// exercise the same code paths as production.
pub const EMBEDDING_DIM: usize = 768;

/// Soft token cap. nomic-embed-text-v1.5 accepts 8192 tokens; we truncate
/// at this many characters as a coarse approximation so we never blow up
/// the backend with massive chunks.
pub const MAX_INPUT_CHARS: usize = 8192 * 4;

#[derive(Debug, Error)]
pub enum EmbedderError {
    #[error("backend transport error: {0}")]
    Transport(String),
    #[error("backend returned unexpected payload: {0}")]
    Payload(String),
    #[error("backend dimension mismatch: expected {expected}, got {actual}")]
    Dimension { expected: usize, actual: usize },
    #[error("backend is not implemented yet: {0}")]
    Unimplemented(&'static str),
}

/// Embedding backend. Implementations must be `Send + Sync` so callers
/// can move them across threads.
pub trait Embedder: Send + Sync {
    /// Embed a batch of text inputs. Returns one f32 vector per input,
    /// each of length [`EMBEDDING_DIM`]. Implementations are expected to
    /// truncate inputs longer than [`MAX_INPUT_CHARS`] themselves.
    fn embed_batch(&self, inputs: &[String]) -> Result<Vec<Vec<f32>>, EmbedderError>;

    /// Convenience wrapper for one-off query embeddings.
    fn embed_one(&self, input: &str) -> Result<Vec<f32>, EmbedderError> {
        let mut out = self.embed_batch(&[input.to_string()])?;
        out.pop().ok_or_else(|| {
            EmbedderError::Payload("backend returned empty batch result".to_string())
        })
    }

    /// Output dimensionality. Default returns [`EMBEDDING_DIM`].
    fn dimension(&self) -> usize {
        EMBEDDING_DIM
    }
}

/// Deterministic hash-based embedder. Not semantically meaningful — used
/// purely for tests so the search/sync pipeline can run without network.
///
/// Identical inputs always produce identical vectors, and lexically
/// similar inputs (overlapping words) produce vectors with non-zero
/// cosine similarity, which is enough for the smoke tests.
#[derive(Clone, Debug, Default)]
pub struct DummyEmbedder;

impl DummyEmbedder {
    pub fn new() -> Self {
        Self
    }
}

impl Embedder for DummyEmbedder {
    fn embed_batch(&self, inputs: &[String]) -> Result<Vec<Vec<f32>>, EmbedderError> {
        Ok(inputs.iter().map(|s| hash_embed(s)).collect())
    }
}

fn hash_embed(input: &str) -> Vec<f32> {
    let mut vec = vec![0.0f32; EMBEDDING_DIM];
    let lower = input.to_ascii_lowercase();
    for token in lower.split(|c: char| !c.is_alphanumeric()) {
        if token.len() < 2 {
            continue;
        }
        let hash = blake3::hash(token.as_bytes());
        let bytes = hash.as_bytes();
        // Use 4 different positions per token to spread the signal.
        for window in 0..4 {
            let idx = u16::from_le_bytes([bytes[window * 2], bytes[window * 2 + 1]]) as usize
                % EMBEDDING_DIM;
            let sign = if bytes[window * 2 + 2] & 1 == 0 { 1.0 } else { -1.0 };
            vec[idx] += sign;
        }
    }
    l2_normalize(&mut vec);
    vec
}

fn l2_normalize(v: &mut [f32]) {
    let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 0.0 {
        for x in v.iter_mut() {
            *x /= norm;
        }
    }
}

#[cfg(feature = "ollama")]
fn truncate_input(input: &str) -> String {
    if input.chars().count() <= MAX_INPUT_CHARS {
        return input.to_string();
    }
    input.chars().take(MAX_INPUT_CHARS).collect()
}

// ---------------------------------------------------------------------
// Ollama backend
// ---------------------------------------------------------------------

#[cfg(feature = "ollama")]
#[derive(Clone, Debug)]
pub struct OllamaEmbedder {
    endpoint: String,
    model: String,
    timeout: Duration,
}

#[cfg(feature = "ollama")]
impl Default for OllamaEmbedder {
    fn default() -> Self {
        Self {
            endpoint: "http://localhost:11434/api/embeddings".to_string(),
            model: "nomic-embed-text".to_string(),
            timeout: Duration::from_secs(30),
        }
    }
}

#[cfg(feature = "ollama")]
impl OllamaEmbedder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_endpoint(mut self, endpoint: impl Into<String>) -> Self {
        self.endpoint = endpoint.into();
        self
    }

    pub fn with_model(mut self, model: impl Into<String>) -> Self {
        self.model = model.into();
        self
    }
}

#[cfg(feature = "ollama")]
#[derive(serde::Serialize)]
struct OllamaRequest<'a> {
    model: &'a str,
    prompt: &'a str,
}

#[cfg(feature = "ollama")]
#[derive(serde::Deserialize)]
struct OllamaResponse {
    embedding: Vec<f32>,
}

#[cfg(feature = "ollama")]
impl Embedder for OllamaEmbedder {
    fn embed_batch(&self, inputs: &[String]) -> Result<Vec<Vec<f32>>, EmbedderError> {
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(5))
            .timeout(self.timeout)
            .build();
        let mut out: Vec<Vec<f32>> = Vec::with_capacity(inputs.len());
        for input in inputs {
            let trimmed = truncate_input(input);
            let body = serde_json::to_string(&OllamaRequest {
                model: &self.model,
                prompt: &trimmed,
            })
            .map_err(|e| EmbedderError::Payload(e.to_string()))?;
            let response = agent
                .post(&self.endpoint)
                .set("content-type", "application/json")
                .send_string(&body)
                .map_err(|e| EmbedderError::Transport(e.to_string()))?;
            let response_body = response
                .into_string()
                .map_err(|e| EmbedderError::Transport(e.to_string()))?;
            let parsed: OllamaResponse = serde_json::from_str(&response_body)
                .map_err(|e| EmbedderError::Payload(e.to_string()))?;
            if parsed.embedding.len() != EMBEDDING_DIM {
                return Err(EmbedderError::Dimension {
                    expected: EMBEDDING_DIM,
                    actual: parsed.embedding.len(),
                });
            }
            out.push(parsed.embedding);
        }
        Ok(out)
    }
}

// ---------------------------------------------------------------------
// Candle backend (stub)
// ---------------------------------------------------------------------

/// In-process nomic-embed-text-v1.5 via candle.
///
/// Not implemented yet. The intended pipeline:
///   1. Use `hf-hub` to download `nomic-ai/nomic-embed-text-v1.5`
///      weights + tokenizer to `~/.cache/eri/models/...`.
///   2. Load the BERT-style model with `candle-transformers::models::bert`.
///   3. For each input: tokenize → truncate to 8192 → forward pass →
///      mean-pool over the last hidden state → L2 normalize.
///   4. Auto-detect CUDA / Metal / CPU via candle-core device probes.
///
/// Switching this on requires adding `candle-core`, `candle-nn`,
/// `candle-transformers`, `hf-hub`, and `tokenizers` to Cargo.toml under
/// the `candle` feature.
#[cfg(feature = "candle")]
#[derive(Clone, Debug, Default)]
pub struct NomicCandleEmbedder;

#[cfg(feature = "candle")]
impl NomicCandleEmbedder {
    pub fn new() -> Self {
        Self
    }
}

#[cfg(feature = "candle")]
impl Embedder for NomicCandleEmbedder {
    fn embed_batch(&self, _inputs: &[String]) -> Result<Vec<Vec<f32>>, EmbedderError> {
        Err(EmbedderError::Unimplemented(
            "NomicCandleEmbedder: see module docs for the pipeline that needs wiring",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dummy_embedder_is_deterministic() {
        let e = DummyEmbedder::new();
        let a = e.embed_one("hello world").unwrap();
        let b = e.embed_one("hello world").unwrap();
        assert_eq!(a, b);
        assert_eq!(a.len(), EMBEDDING_DIM);
    }

    #[test]
    fn dummy_embedder_overlapping_inputs_have_positive_cosine() {
        let e = DummyEmbedder::new();
        let a = e.embed_one("alpha bravo charlie").unwrap();
        let b = e.embed_one("alpha bravo delta").unwrap();
        let c = e.embed_one("xylophone yacht zebra").unwrap();
        let ab: f32 = a.iter().zip(&b).map(|(x, y)| x * y).sum();
        let ac: f32 = a.iter().zip(&c).map(|(x, y)| x * y).sum();
        assert!(ab > ac, "expected ab={ab} > ac={ac}");
    }

    #[test]
    fn dummy_embedder_batches_in_order() {
        let e = DummyEmbedder::new();
        let inputs = vec!["alpha".to_string(), "bravo".to_string(), "alpha".to_string()];
        let out = e.embed_batch(&inputs).unwrap();
        assert_eq!(out.len(), 3);
        assert_eq!(out[0], out[2]);
        assert_ne!(out[0], out[1]);
    }
}
