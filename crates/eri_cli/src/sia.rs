//! The sia acceptance gate (P3 Slice 1, ADR-0007 §5).
//!
//! Nothing the self-improve loop proposes is applied blind. Each refinement is a
//! [`Proposal`] that must clear [`accept`]:
//!
//! 1. **Refusal boundary — absolute, canonical.** If any pattern the proposal
//!    touches crosses the refusal list, it's rejected. The check is the SAME
//!    [`control_safety::classify_refusal`] the live gate uses at decision time —
//!    one source of truth, never a second copy (the exact drift hazard we killed
//!    when unifying the gate). sia never turns a refused action into learned
//!    policy.
//! 2. **Earns its keep.** A refinement is admitted only when it's backed by at
//!    least [`MIN_SUPPORT`] corroborating outcomes — the v1, MDL-flavored
//!    admission: a one-off negative signal never justifies a policy change; a
//!    recurring one does. (Calibration — "did the applied change actually reduce
//!    repeat undos?" — is the post-hoc check the loop adds at Slice 3a.)
//!
//! An accepted proposal carries [`Provenance`] (`source = "sia"`, the support it
//! earned) so every sia change is auditable and reversible — applied bi-temporally
//! (invalidate-not-delete) at Slice 2/3.
//!
//! **The hard line is structural.** sia refines the chain + confidence axis (or
//! *narrows* — asks more) ONLY. The [`Proposal`] type has **no variant that widens
//! a grant or touches the refusal list**, so "never widen a grant, never cross the
//! boundary" is enforced by the type, not by convention.

// NOTE: the per-item `#[allow(dead_code)]`s below are the SPINE seam — its caller
// (propose-from-outcomes → accept → apply) lands at Slice 3a, which REMOVES them
// (definition-of-done). Per-item, not module-wide, so unrelated dead code added to
// this file before 3a still warns.

use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::control_envelope::DEFAULT_CONFIDENCE_FLOOR;
use crate::control_safety;

/// The provenance tag sia stamps on every change it makes — distinct from a user
/// (explicit) change, so a sia refinement is auditable and reversible.
#[allow(dead_code)]
pub const SIA_SOURCE: &str = "sia";

/// The minimum corroborating outcomes a proposal needs to earn its keep. A
/// one-off negative signal never justifies a policy change; a recurring one does.
/// Matches the existing undo→caution threshold.
#[allow(dead_code)]
pub const MIN_SUPPORT: usize = 2;

/// A refinement the sia loop proposes. Every variant refines the chain/confidence
/// axis or *narrows* (asks more). There is deliberately **no** variant that widens
/// a grant or edits the refusal list, so the safety line is enforced by the type.
#[allow(dead_code)]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Proposal {
    /// Raise the confidence floor for `pattern` — eri asks more readily for it.
    RaiseFloor { pattern: String },
    /// Down-weight the learned chain transition `from` → `to` — it misfired.
    DownweightChain { from: String, to: String },
    /// Caution `pattern` — ask before repeating it (a narrowing).
    Caution { pattern: String },
}

impl Proposal {
    /// The action text(s) this proposal concerns — what the refusal re-check
    /// inspects, so a refused action can never be refined into policy.
    #[allow(dead_code)]
    fn patterns(&self) -> Vec<&str> {
        match self {
            Proposal::RaiseFloor { pattern } | Proposal::Caution { pattern } => vec![pattern],
            Proposal::DownweightChain { from, to } => vec![from, to],
        }
    }
}

/// The audit stamp on an accepted sia change.
#[allow(dead_code)]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Provenance {
    /// Always [`SIA_SOURCE`] — marks the change as model-inferred self-improvement.
    pub source: &'static str,
    /// How many corroborating outcomes earned it (for the audit trail).
    pub support: usize,
}

/// The gate's decision on a proposal.
#[allow(dead_code)]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Verdict {
    /// Apply it, stamped with this provenance (reversible downstream).
    Accept(Provenance),
    /// Don't apply it; carries why (auditable).
    Reject(String),
}

/// The acceptance gate: should `proposal`, backed by `support` corroborating
/// outcomes, be applied? Pure + deterministic — fixture-testable, no IO.
#[allow(dead_code)]
pub fn accept(proposal: &Proposal, support: usize) -> Verdict {
    // (1) Absolute boundary, via the canonical classifier (no copy). sia never
    // refines a refused action into learned policy.
    for pattern in proposal.patterns() {
        if control_safety::classify_refusal(pattern).is_some() {
            return Verdict::Reject(format!(
                "crosses the refusal boundary ({pattern:?}) — sia never refines a refused action"
            ));
        }
    }
    // (2) Earns its keep: a one-off doesn't justify a policy change.
    if support < MIN_SUPPORT {
        return Verdict::Reject(format!(
            "insufficient support ({support} < {MIN_SUPPORT}) — a one-off doesn't earn a policy change"
        ));
    }
    Verdict::Accept(Provenance {
        source: SIA_SOURCE,
        support,
    })
}

// ── Slice 2: the RefinablePolicy surface ──────────────────────────────────────

/// The most a confidence floor may be raised to — sia narrows (asks more) but
/// never pushes a pattern to "impossible to auto-run" in one go. Conservative.
#[allow(dead_code)]
pub const MAX_FLOOR: f32 = 0.95;

/// How much one accepted `RaiseFloor` bumps a pattern's floor — small, so a single
/// refinement is conservative and reversible.
#[allow(dead_code)]
pub const FLOOR_STEP: f32 = 0.05;

/// Per-pattern confidence-floor overrides — the owned, refine-able confidence
/// state (review #3). A pattern with no override uses [`DEFAULT_CONFIDENCE_FLOOR`],
/// so an **empty policy is byte-for-byte today's behavior** (zero behavior change
/// until sia raises a floor, and until the gate reads it at Slice 3a). Persisted
/// per-user (the caller resolves the user-scoped path — fixing the cautions-global
/// inconsistency).
#[allow(dead_code)]
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ConfidencePolicy {
    floors: BTreeMap<String, f32>,
}

impl ConfidencePolicy {
    /// The auto-execute confidence floor for `pattern` — a sia-raised override, or
    /// the default when none.
    #[allow(dead_code)]
    pub fn floor_for(&self, pattern: &str) -> f32 {
        self.floors
            .get(pattern)
            .copied()
            .unwrap_or(DEFAULT_CONFIDENCE_FLOOR)
    }

    /// Raise `pattern`'s floor one conservative, capped step (sia asks more readily
    /// for it). Idempotent at [`MAX_FLOOR`]. Returns the new floor.
    #[allow(dead_code)]
    pub fn raise(&mut self, pattern: &str) -> f32 {
        let next = (self.floor_for(pattern) + FLOOR_STEP).min(MAX_FLOOR);
        self.floors.insert(pattern.to_string(), next);
        next
    }

    /// Persist to `path` (pretty JSON). The caller resolves a user-scoped path.
    #[allow(dead_code)]
    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_string_pretty(self)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        std::fs::write(path, json)
    }

    /// Load, or an empty (= default-everywhere) policy if the file is absent or
    /// unreadable — so a fresh user is exactly today's behavior.
    #[allow(dead_code)]
    pub fn load(path: &Path) -> Self {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }
}

/// The narrow surface sia may write — the three refine-able / *narrowing*
/// operations. It **cannot name the refusal list or widen a grant** (the hard
/// line, structural — there is no such method). The concrete adapter (over the
/// [`ConfidencePolicy`] + the world-graph chain weights + cautions, all
/// user-scoped) is wired at Slice 3a; [`apply`] is the one place a [`Verdict::Accept`]
/// becomes a change.
#[allow(dead_code)]
pub trait RefinablePolicy {
    /// Ask more readily for `pattern` (raise its confidence floor).
    fn raise_floor(&mut self, pattern: &str, provenance: &Provenance);
    /// Weaken the learned chain `from` → `to` (it misfired).
    fn downweight_chain(&mut self, from: &str, to: &str, provenance: &Provenance);
    /// Ask before repeating `pattern` (a caution — a narrowing).
    fn caution(&mut self, pattern: &str, provenance: &Provenance);
}

/// Apply an accepted [`Proposal`] to a refine-able policy — the ONE place a
/// verdict becomes a change. Routes to one of the three narrowing ops; it
/// structurally cannot do anything else (no refusal edit, no grant-widening).
#[allow(dead_code)]
pub fn apply(policy: &mut impl RefinablePolicy, proposal: &Proposal, provenance: &Provenance) {
    match proposal {
        Proposal::RaiseFloor { pattern } => policy.raise_floor(pattern, provenance),
        Proposal::DownweightChain { from, to } => policy.downweight_chain(from, to, provenance),
        Proposal::Caution { pattern } => policy.caution(pattern, provenance),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_well_supported_benign_refinement_is_accepted_with_sia_provenance() {
        let p = Proposal::RaiseFloor {
            pattern: "click the Deploy button".into(),
        };
        match accept(&p, 3) {
            Verdict::Accept(prov) => {
                assert_eq!(prov.source, SIA_SOURCE);
                assert_eq!(prov.support, 3);
            }
            other => panic!("expected Accept, got {other:?}"),
        }
    }

    #[test]
    fn a_one_off_does_not_earn_a_policy_change() {
        // support 1 < MIN_SUPPORT(2): the metric rejects it.
        let p = Proposal::Caution {
            pattern: "quit Slack".into(),
        };
        assert!(matches!(accept(&p, 1), Verdict::Reject(_)));
        // ...but the same proposal recurring is admitted.
        assert!(matches!(accept(&p, MIN_SUPPORT), Verdict::Accept(_)));
    }

    #[test]
    fn a_proposal_touching_the_refusal_boundary_is_rejected_via_the_canonical_check() {
        // The pattern crosses the absolute boundary (the SAME classify_refusal the
        // live gate uses) — sia must never refine a refused action into policy,
        // even when it's well supported.
        let p = Proposal::Caution {
            pattern: "type my password into the field".into(),
        };
        assert!(
            control_safety::classify_refusal("type my password into the field").is_some(),
            "precondition: this pattern is refused at the live gate"
        );
        assert!(matches!(accept(&p, 99), Verdict::Reject(_)));
    }

    #[test]
    fn a_chain_proposal_is_rejected_if_either_endpoint_crosses_the_boundary() {
        let p = Proposal::DownweightChain {
            from: "open the bank app".into(),
            to: "wire transfer $500 to account 12345".into(),
        };
        assert!(matches!(accept(&p, 5), Verdict::Reject(_)));
    }

    #[test]
    fn an_empty_confidence_policy_is_todays_default_behavior() {
        let pol = ConfidencePolicy::default();
        assert_eq!(pol.floor_for("click Save"), DEFAULT_CONFIDENCE_FLOOR);
    }

    #[test]
    fn raising_a_floor_is_a_capped_conservative_step() {
        let mut pol = ConfidencePolicy::default();
        let after = pol.raise("quit Slack");
        assert!((after - (DEFAULT_CONFIDENCE_FLOOR + FLOOR_STEP)).abs() < 1e-6);
        // Repeated raises converge to the cap, never past it.
        for _ in 0..50 {
            pol.raise("quit Slack");
        }
        assert_eq!(pol.floor_for("quit Slack"), MAX_FLOOR);
        // Other patterns are untouched — still the default.
        assert_eq!(pol.floor_for("click Save"), DEFAULT_CONFIDENCE_FLOOR);
    }

    #[test]
    fn confidence_policy_round_trips_and_a_missing_file_is_the_default() {
        let dir = std::env::temp_dir().join(format!("eri-sia-{}", std::process::id()));
        let path = dir.join("confidence.json");
        let mut pol = ConfidencePolicy::default();
        pol.raise("quit Slack");
        pol.save(&path).expect("save");
        assert_eq!(
            ConfidencePolicy::load(&path).floor_for("quit Slack"),
            pol.floor_for("quit Slack")
        );
        // A fresh user (no file) is exactly today's behavior, not an error.
        assert_eq!(
            ConfidencePolicy::load(Path::new("/nonexistent/eri/confidence.json")).floor_for("x"),
            DEFAULT_CONFIDENCE_FLOOR
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[derive(Default)]
    struct RecordingPolicy {
        ops: Vec<String>,
    }
    impl RefinablePolicy for RecordingPolicy {
        fn raise_floor(&mut self, pattern: &str, _p: &Provenance) {
            self.ops.push(format!("raise_floor:{pattern}"));
        }
        fn downweight_chain(&mut self, from: &str, to: &str, _p: &Provenance) {
            self.ops.push(format!("downweight:{from}->{to}"));
        }
        fn caution(&mut self, pattern: &str, _p: &Provenance) {
            self.ops.push(format!("caution:{pattern}"));
        }
    }

    #[test]
    fn apply_routes_each_proposal_to_its_narrowing_op() {
        let prov = Provenance {
            source: SIA_SOURCE,
            support: 3,
        };
        let mut pol = RecordingPolicy::default();
        apply(
            &mut pol,
            &Proposal::RaiseFloor {
                pattern: "click Deploy".into(),
            },
            &prov,
        );
        apply(
            &mut pol,
            &Proposal::DownweightChain {
                from: "A".into(),
                to: "B".into(),
            },
            &prov,
        );
        apply(
            &mut pol,
            &Proposal::Caution {
                pattern: "quit Slack".into(),
            },
            &prov,
        );
        assert_eq!(
            pol.ops,
            vec![
                "raise_floor:click Deploy",
                "downweight:A->B",
                "caution:quit Slack",
            ]
        );
    }
}
