//! Thin wrapper around `llama-cpp-2`. Keeps the unsafe-ish FFI surface
//! confined to this module so the public engine can stay simple.
//!
//! ## STATUS — feature reserved but dependency not declared
//!
//! `llama-cpp-sys-2` requires `cc ^1.2.61`. The workspace currently pins
//! `cc ~1.0.90` via `tree-sitter-javascript = "0.21"` in `eri_index`, so
//! `cargo` can't resolve both at once. The dep declaration in
//! `Cargo.toml` has been left out for now; when the workspace pin is
//! lifted, add:
//!
//! ```toml
//! [dependencies]
//! llama-cpp-2 = { version = "0.1.146", optional = true }
//!
//! [features]
//! llama = ["dep:llama-cpp-2"]
//! ```
//!
//! and uncomment the body below. The surrounding engine, model_store,
//! and dispatch are all already wired up.
//!
//! TODO(llama): swap the placeholder body for the real FFI calls.

#![cfg(feature = "llama")]

use std::path::Path;

use parking_lot::Mutex;

use crate::TabError;

/// Owns the llama backend, model, and a serialised context. The mutex
/// guards the entire generation call because the llama.cpp context is
/// not safe to share across threads concurrently.
pub(crate) struct Engine {
    // Serialises access to the underlying decoder.
    #[allow(dead_code)]
    lock: Mutex<()>,
}

impl Engine {
    pub(crate) fn load(_model_path: &Path, _n_ctx: u32) -> Result<Self, TabError> {
        Err(TabError::FeatureDisabled)
    }

    pub(crate) fn generate<F>(
        &self,
        _prompt: &str,
        _max_tokens: usize,
        _stop: &[String],
        _on_token: F,
    ) -> Result<String, TabError>
    where
        F: FnMut(&str),
    {
        Err(TabError::FeatureDisabled)
    }
}

// === Reference implementation (commented out until cc pin is lifted) ===
//
// use std::num::NonZeroU32;
// use llama_cpp_2::context::params::LlamaContextParams;
// use llama_cpp_2::llama_backend::LlamaBackend;
// use llama_cpp_2::llama_batch::LlamaBatch;
// use llama_cpp_2::model::params::LlamaModelParams;
// use llama_cpp_2::model::{AddBos, LlamaModel, Special};
// use llama_cpp_2::sampling::LlamaSampler;
// use llama_cpp_2::token::LlamaToken;
//
// pub(crate) struct Engine {
//     backend: LlamaBackend,
//     model: LlamaModel,
//     ctx_params: LlamaContextParams,
//     lock: Mutex<()>,
// }
//
// impl Engine {
//     pub(crate) fn load(model_path: &Path, n_ctx: u32) -> Result<Self, TabError> {
//         let backend = LlamaBackend::init()
//             .map_err(|e| TabError::Llama(format!("backend init: {e}")))?;
//         let model = LlamaModel::load_from_file(
//             &backend,
//             model_path,
//             &LlamaModelParams::default(),
//         ).map_err(|e| TabError::Llama(format!("model load: {e}")))?;
//         let ctx_params = LlamaContextParams::default()
//             .with_n_ctx(NonZeroU32::new(n_ctx.max(512)));
//         Ok(Self { backend, model, ctx_params, lock: Mutex::new(()) })
//     }
//
//     pub(crate) fn generate<F: FnMut(&str)>(
//         &self,
//         prompt: &str,
//         max_tokens: usize,
//         stop: &[String],
//         mut on_token: F,
//     ) -> Result<String, TabError> {
//         let _guard = self.lock.lock();
//         let mut ctx = self.model
//             .new_context(&self.backend, self.ctx_params.clone())
//             .map_err(|e| TabError::Llama(format!("ctx new: {e}")))?;
//         let tokens: Vec<LlamaToken> = self.model
//             .str_to_token(prompt, AddBos::Always)
//             .map_err(|e| TabError::Llama(format!("tokenize: {e}")))?;
//         let n_ctx = ctx.n_ctx() as usize;
//         if tokens.len() >= n_ctx {
//             return Err(TabError::Llama(format!(
//                 "prompt {} tokens exceeds context {}",
//                 tokens.len(), n_ctx
//             )));
//         }
//         let mut batch = LlamaBatch::new(n_ctx, 1);
//         let last_idx = (tokens.len() - 1) as i32;
//         for (i, tok) in tokens.iter().enumerate() {
//             let pos = i as i32;
//             batch.add(*tok, pos, &[0], pos == last_idx)
//                 .map_err(|e| TabError::Llama(format!("batch add: {e}")))?;
//         }
//         ctx.decode(&mut batch)
//             .map_err(|e| TabError::Llama(format!("decode prompt: {e}")))?;
//         let mut sampler = LlamaSampler::chain_simple([
//             LlamaSampler::temp(0.1),
//             LlamaSampler::top_k(40),
//             LlamaSampler::top_p(0.95, 1),
//             LlamaSampler::greedy(),
//         ]);
//         let mut out = String::new();
//         let mut n_cur = tokens.len() as i32;
//         for _ in 0..max_tokens.max(1) {
//             let new_token = sampler.sample(&ctx, batch.n_tokens() - 1);
//             sampler.accept(new_token);
//             if self.model.is_eog_token(new_token) { break; }
//             let piece = self.model.token_to_str(new_token, Special::Tokenize)
//                 .map_err(|e| TabError::Llama(format!("detokenize: {e}")))?;
//             on_token(&piece);
//             out.push_str(&piece);
//             if stop.iter().any(|s| !s.is_empty() && out.contains(s)) { break; }
//             batch.clear();
//             batch.add(new_token, n_cur, &[0], true)
//                 .map_err(|e| TabError::Llama(format!("batch add new: {e}")))?;
//             n_cur += 1;
//             ctx.decode(&mut batch)
//                 .map_err(|e| TabError::Llama(format!("decode step: {e}")))?;
//         }
//         Ok(out)
//     }
// }
