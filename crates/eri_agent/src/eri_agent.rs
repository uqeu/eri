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

pub mod compaction;
pub mod permission;
pub mod style;

pub use permission::PermissionMode;
pub use style::SystemStyle;
