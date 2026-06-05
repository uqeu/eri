//! `eri_agent` -- the transport-agnostic core of the eri agent loop, factored
//! out of the CLI so the IDE sidecar, the cloud runner, and third parties can
//! reuse the same building blocks (this is the seed of the eri-code Agent SDK).
//!
//! These pieces are deliberately free of any network / auth / filesystem
//! dependency, so they unit-test deterministically and compose anywhere:
//!
//!   - [`compaction`] -- the layered context-shaping pipeline run before each
//!     model call (budget-reduction -> snip -> microcompact).
//!   - [`permission`] -- the [`PermissionMode`] capability ladder.
//!   - [`style`] -- the [`SystemStyle`] output-style presets.
//!
//! The agent's transport (which model, how billed) stays in the host (the CLI's
//! `build_agent`); the host wires these blocks into its own `messages` loop.
//!
//! # Example
//!
//! ```
//! use eri_agent::{PermissionMode, SystemStyle};
//! use eri_agent::compaction::shape_context;
//! use serde_json::json;
//!
//! // Capability posture: plan mode is read-only.
//! let mode = PermissionMode::from_legacy_flags(/* plan */ true, /* shell */ false);
//! assert!(!mode.allows_writes() && !mode.allows_shell());
//!
//! // A non-default style contributes a directive the host prepends to its persona.
//! assert!(SystemStyle::parse("reviewer").directive().is_some());
//!
//! // Shape a growing message history under a token target before a model call.
//! let mut messages = vec![
//!     json!({ "role": "user", "content": "x".repeat(80_000) }),
//!     json!({ "role": "user", "content": "recent" }),
//! ];
//! let report = shape_context(&mut messages, 1_000);
//! assert!(report.tokens_after <= report.tokens_before);
//! ```

pub mod compaction;
pub mod permission;
pub mod stream;
pub mod style;

pub use permission::PermissionMode;
pub use stream::{ToolUse, Turn, TurnAccumulator};
pub use style::SystemStyle;
