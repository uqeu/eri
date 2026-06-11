//! Per-vendor [`crate::llm_provider::LlmProvider`] implementations.
//!
//! Kept in sibling files (no `mod.rs`) per repo convention. Each provider
//! talks to its vendor's native REST API via `ureq` and reuses the shared
//! [`crate::costs`] constants for the $$-per-call estimate.

pub mod anthropic;
pub mod gemini;
pub mod local;
pub mod openai;
