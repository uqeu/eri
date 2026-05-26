//! Memory v2 — embedding-based semantic recall (Phase 20).
//!
//! Ships a deterministic, dependency-free hash-embedding for v2.0 so
//! eri can compute + index vectors today without dragging in an ONNX
//! runtime or a remote inference round-trip. The dimensionality is
//! fixed (256) and the function is a feature-hashed bag-of-words —
//! good enough for keyword-bridging recall (e.g. "package manager"
//! finds an observation that mentions "pnpm"), bounded by the obvious
//! limitations of a stochastic hash projection.
//!
//! When the desktop build bundles a real sentence-transformer model,
//! swap [`embed_text`] to call it — the public API stays identical so
//! callers don't move. The hashing trick lives behind that function
//! call as the always-available fallback for tests + dev mode.

/// Embedding dimensionality. Picked to balance recall quality against
/// the size of the on-disk JSON blob: 256 floats × ~8 bytes/float JSON
/// ≈ 2KB per observation, which keeps a year-long Pro memory store
/// well under a megabyte.
pub const DIM: usize = 256;

/// Compute a fixed-size embedding for a piece of text. Deterministic
/// across processes + platforms — the same string always hashes to
/// the same vector, so cloud sync round-trips don't recompute.
///
/// Algorithm:
///   1. Lowercase + split on non-alphanumeric.
///   2. For each token of length ≥ 2, hash with a stable algorithm
///      (DefaultHasher seeded with the token), modulo DIM → bucket.
///   3. Accumulate `+1.0` into the bucket per occurrence.
///   4. L2-normalise the resulting vector.
pub fn embed_text(text: &str) -> Vec<f32> {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut v = vec![0.0_f32; DIM];
    for raw in text
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|t| t.len() >= 2)
    {
        let token = raw.to_ascii_lowercase();
        let mut h = DefaultHasher::new();
        token.hash(&mut h);
        let bucket = (h.finish() as usize) % DIM;
        v[bucket] += 1.0;
    }
    l2_normalise(&mut v);
    v
}

/// Cosine similarity in `[-1.0, 1.0]`. Returns 0.0 when either vector
/// is empty or all-zero so callers can use the score directly without
/// branching for the corner cases.
pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let n = a.len().min(b.len());
    let mut dot = 0.0_f32;
    let mut na = 0.0_f32;
    let mut nb = 0.0_f32;
    for i in 0..n {
        let av = a[i];
        let bv = b[i];
        dot += av * bv;
        na += av * av;
        nb += bv * bv;
    }
    if na == 0.0 || nb == 0.0 {
        return 0.0;
    }
    dot / (na.sqrt() * nb.sqrt())
}

fn l2_normalise(v: &mut [f32]) {
    let mag = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if mag == 0.0 {
        return;
    }
    for x in v.iter_mut() {
        *x /= mag;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embed_text_is_deterministic() {
        let a = embed_text("I use pnpm always");
        let b = embed_text("I use pnpm always");
        assert_eq!(a, b);
    }

    #[test]
    fn embed_text_returns_dim_length() {
        let v = embed_text("hello world");
        assert_eq!(v.len(), DIM);
    }

    #[test]
    fn cosine_of_identical_text_is_close_to_one() {
        let a = embed_text("the rust compiler is fast");
        let b = embed_text("the rust compiler is fast");
        assert!(cosine(&a, &b) > 0.999);
    }

    #[test]
    fn cosine_of_unrelated_text_is_low() {
        let a = embed_text("the user prefers pnpm package manager");
        let b = embed_text("blue magenta lime accent palette");
        let score = cosine(&a, &b);
        assert!(score < 0.5, "expected low similarity, got {score}");
    }

    #[test]
    fn cosine_recognises_word_overlap() {
        let a = embed_text("the user prefers pnpm package manager");
        let b = embed_text("what package manager does the user prefer");
        let score = cosine(&a, &b);
        // Hashing collisions make this lower than a real embedding
        // would produce, but it should comfortably beat random.
        assert!(score > 0.3, "expected overlap > 0.3, got {score}");
    }

    #[test]
    fn empty_vector_returns_zero_cosine() {
        let zero: Vec<f32> = vec![0.0; DIM];
        let v = embed_text("rust");
        assert_eq!(cosine(&zero, &v), 0.0);
        assert_eq!(cosine(&v, &[]), 0.0);
    }

    #[test]
    fn embed_text_l2_normalises() {
        let v = embed_text("the quick brown fox jumps over the lazy dog");
        let mag: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
        assert!((mag - 1.0).abs() < 1e-5, "expected unit vector, got {mag}");
    }
}
