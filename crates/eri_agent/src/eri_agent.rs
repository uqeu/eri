//! `eri_agent` -- the transport-agnostic core of the eri agent loop, factored
//! out of the CLI so the IDE sidecar, the cloud runner, and third parties can
//! reuse the same building blocks (this is the seed of the eri-code Agent SDK).
//!
//! The modules:
//!
//!   - [`request`] -- build the streaming Messages request body.
//!   - [`transport`] -- the [`Transport`](transport::Transport) /
//!     [`ByteStream`](transport::ByteStream) seam + `run_turn`, the
//!     host-agnostic SSE reader. Swap the CLI's reqwest client for a mock or any
//!     other backend without touching the loop.
//!   - [`stream`] -- the [`TurnAccumulator`] protocol state machine (pure).
//!   - [`tool`] -- the [`Tool`] / [`ToolBox`] custom-tool interface.
//!   - [`compaction`] -- the layered context-shaping pipeline (budget-reduction
//!     -> snip -> microcompact).
//!   - [`permission`] -- the [`PermissionMode`] capability ladder.
//!   - [`style`] -- the [`SystemStyle`] output-style presets.
//!
//! Everything except `transport` is free of any network / auth / filesystem
//! dependency, so it unit-tests deterministically; `transport` is mockable.
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
pub mod driver;
pub mod permission;
pub mod request;
pub mod stream;
pub mod style;
pub mod tool;
pub mod transport;

pub use permission::PermissionMode;
pub use stream::{ToolUse, Turn, TurnAccumulator};
pub use style::SystemStyle;
pub use tool::{Tool, ToolBox, ToolOutcome};
