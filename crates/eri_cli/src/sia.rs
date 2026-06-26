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

use std::collections::BTreeMap;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::control_envelope::DEFAULT_CONFIDENCE_FLOOR;
use crate::control_safety;

/// The provenance tag sia stamps on every change it makes — distinct from a user
/// (explicit) change, so a sia refinement is auditable and reversible.
pub const SIA_SOURCE: &str = "sia";

/// The minimum corroborating outcomes a proposal needs to earn its keep. A
/// one-off negative signal never justifies a policy change; a recurring one does.
/// Matches the existing undo→caution threshold.
pub const MIN_SUPPORT: usize = 2;

/// A refinement the sia loop proposes. Every variant refines the chain/confidence
/// axis or *narrows* (asks more). There is deliberately **no** variant that widens
/// a grant or edits the refusal list, so the safety line is enforced by the type.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Proposal {
    /// Raise the confidence floor for `pattern` — eri asks more readily for it.
    /// Produced by the undo signal (Slice 3a).
    RaiseFloor { pattern: String },
    // `DownweightChain` + `Caution` are part of the refine-able surface — their
    // `apply` routing and `LiveRefinablePolicy` ops are wired + tested — but their
    // *proposal-producers* (chain-misfire detection; folding the existing
    // P8 caution under the sia gate) are a later slice. The narrow allow marks
    // exactly that gap, not a dead op.
    /// Down-weight the learned chain transition `from` → `to` — it misfired.
    #[allow(dead_code)]
    DownweightChain { from: String, to: String },
    /// Caution `pattern` — ask before repeating it (a narrowing).
    #[allow(dead_code)]
    Caution { pattern: String },
}

impl Proposal {
    /// The action text(s) this proposal concerns — what the refusal re-check
    /// inspects, so a refused action can never be refined into policy.
    fn patterns(&self) -> Vec<&str> {
        match self {
            Proposal::RaiseFloor { pattern } | Proposal::Caution { pattern } => vec![pattern],
            Proposal::DownweightChain { from, to } => vec![from, to],
        }
    }
}

/// The audit stamp on an accepted sia change.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Provenance {
    /// Always [`SIA_SOURCE`] — marks the change as model-inferred self-improvement.
    pub source: &'static str,
    /// How many corroborating outcomes earned it (for the audit trail).
    pub support: usize,
}

/// The gate's decision on a proposal.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Verdict {
    /// Apply it, stamped with this provenance (reversible downstream).
    Accept(Provenance),
    /// Don't apply it; carries why (auditable).
    Reject(String),
}

/// The acceptance gate: should `proposal`, backed by `support` corroborating
/// outcomes, be applied? Pure + deterministic — fixture-testable, no IO.
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

// ── Slice 2a: the proactive-suggestion staleness producer ─────────────────────
//
// The first *behavioral* producer of a `DownweightChain` proposal. eri surfaces a
// proactive suggestion ("after X you usually Y" — the top established chain). When
// its OWN recent observations contradict it — the user kept doing X then something
// other than Y, never Y — the suggestion has gone stale and eri is nagging. This is
// the deferred chain-staleness/decay refinement: sia keeps its own predictions
// calibrated against observed behavior, on the chain axis only.
//
// Derived, never an explicit "no": the signal is read from the ordered behavior
// trail eri already keeps (the same source the suggestion itself is computed from),
// so no new capture surface is added. The *effect* is a SOFT, reversible suppression
// (Slice 2b's overlay) — suggest-less, never a hard kill — because a wrong
// suppression is otherwise invisible (you won't see the suggestion to re-engage it).

/// Inspect the ordered behavior `trail` (oldest → newest executed actions) and
/// decide whether `suggested` — what eri surfaces after `context` — has gone stale.
/// It's stale when, across the occurrences of `context` in the trail, the user
/// followed it with `suggested` **zero** times and with something else at least
/// [`MIN_SUPPORT`] times: eri keeps suggesting Y, the user keeps doing otherwise.
///
/// Returns the [`Proposal::DownweightChain`] to soft-suppress `context → suggested`
/// plus the support (how many times it was passed over) for [`accept`], or `None`
/// when the suggestion is still followed or only passed over as a one-off. Pure +
/// deterministic — fixture-testable, no IO. The caller still routes the result
/// through [`accept`] (refusal boundary + earns-its-keep) before applying.
// Wired to the suppression overlay + surfacing in Slices 2b–2c; the scoped allow
// marks exactly that not-yet-wired gap (removed when the loop calls it), not a dead
// op — mirrors the `DownweightChain` producer-gap allow above.
#[allow(dead_code)]
pub fn stale_suggestion(
    context: &str,
    suggested: &str,
    trail: &[String],
) -> Option<(Proposal, usize)> {
    let mut followed = 0usize;
    let mut passed_over = 0usize;
    for pair in trail.windows(2) {
        if pair[0] != context {
            continue;
        }
        if pair[1] == suggested {
            followed += 1;
        } else {
            passed_over += 1;
        }
    }
    // Still followed at least once → not stale; keep suggesting (don't suppress a
    // suggestion the user sometimes takes). Passed over only once → a one-off, not
    // a pattern. Only a clean, recurring miss earns a (reversible) suppression.
    if followed > 0 || passed_over < MIN_SUPPORT {
        return None;
    }
    Some((
        Proposal::DownweightChain {
            from: context.to_string(),
            to: suggested.to_string(),
        },
        passed_over,
    ))
}

// ── Slice 2: the RefinablePolicy surface ──────────────────────────────────────

/// The most a confidence floor may be raised to — sia narrows (asks more) but
/// never pushes a pattern to "impossible to auto-run" in one go. Conservative.
pub const MAX_FLOOR: f32 = 0.95;

/// How much one accepted `RaiseFloor` bumps a pattern's floor — small, so a single
/// refinement is conservative and reversible.
pub const FLOOR_STEP: f32 = 0.05;

/// One sia-raised confidence floor + the inputs the post-hoc calibration (Slice
/// 3b) measures it against.
#[derive(Clone, Debug, Serialize, Deserialize)]
struct Floor {
    /// The raised auto-execute floor.
    value: f32,
    /// The undo count for this pattern WHEN the floor was raised — the baseline
    /// calibration compares against ("did undos keep coming after the raise?").
    support: usize,
    /// Superseded by calibration (it didn't earn its keep): kept for audit
    /// (bi-temporal — invalidate-not-delete), but no longer applied, so
    /// [`floor_for`](ConfidencePolicy::floor_for) reverts it to the default.
    superseded: bool,
}

/// Per-pattern confidence-floor overrides — the owned, refine-able confidence
/// state (review #3). A pattern with no *active* override uses
/// [`DEFAULT_CONFIDENCE_FLOOR`], so an **empty policy is byte-for-byte today's
/// behavior**. Persisted per-user (the caller resolves the user-scoped path).
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ConfidencePolicy {
    floors: BTreeMap<String, Floor>,
}

impl ConfidencePolicy {
    /// The auto-execute confidence floor for `pattern` — an *active* sia-raised
    /// override, or the default (when none, or the override was superseded by
    /// calibration).
    pub fn floor_for(&self, pattern: &str) -> f32 {
        self.floors
            .get(pattern)
            .filter(|f| !f.superseded)
            .map(|f| f.value)
            .unwrap_or(DEFAULT_CONFIDENCE_FLOOR)
    }

    /// Raise `pattern`'s floor one conservative, capped step (sia asks more readily
    /// for it), recording `support` (the undo count that earned it) as the
    /// calibration baseline. Idempotent at [`MAX_FLOOR`]. Re-raising a superseded
    /// floor starts fresh from the default. Returns the new floor.
    pub fn raise(&mut self, pattern: &str, support: usize) -> f32 {
        let value = (self.floor_for(pattern) + FLOOR_STEP).min(MAX_FLOOR);
        self.floors.insert(
            pattern.to_string(),
            Floor {
                value,
                support,
                superseded: false,
            },
        );
        value
    }

    /// Mark `pattern`'s floor superseded — calibration found it didn't earn its
    /// keep. Bi-temporal: the record stays (auditable), but it stops applying.
    pub fn supersede(&mut self, pattern: &str) {
        if let Some(f) = self.floors.get_mut(pattern) {
            f.superseded = true;
        }
    }

    /// The patterns with an ACTIVE raised floor — the set calibration revisits.
    pub fn active_patterns(&self) -> Vec<String> {
        self.floors
            .iter()
            .filter(|(_, f)| !f.superseded)
            .map(|(p, _)| p.clone())
            .collect()
    }

    /// The recorded support baseline for `pattern`'s active floor, if any.
    fn support_of(&self, pattern: &str) -> Option<usize> {
        self.floors
            .get(pattern)
            .filter(|f| !f.superseded)
            .map(|f| f.support)
    }

    /// Persist to `path` (pretty JSON). The caller resolves a user-scoped path.
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
    pub fn load(path: &Path) -> Self {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }
}

/// The post-hoc verdict on one applied floor refinement (Slice 3b — the closed
/// measurement loop, what makes it *learn* rather than apply heuristics).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Calibration {
    /// The floor reduced repeat undos (none since the raise) — it earned its keep.
    Kept,
    /// Undos for the pattern kept coming after the raise — it didn't help; the
    /// floor is superseded (reverted, bi-temporally).
    Reverted,
    /// Another mechanism (e.g. the always-ask caution) is ALSO responding to this
    /// pattern, so the floor's effect is confounded — we can't credit OR blame it.
    /// Left as-is (it only ever tightens, so it's harmless).
    Confounded,
}

/// Measure one pattern's active floor against the named metric — *did raising it
/// reduce repeat undos?* — and keep, revert, or leave-confounded. Pure: the IO
/// (current undo count, whether the pattern is also cautioned) is supplied by the
/// caller, so calibration is deterministic + fixture-testable.
///
/// `confounded` MUST be true when the floor isn't the *sole* responder for the
/// pattern (e.g. it's also cautioned) — then we never credit the floor for work
/// another mechanism did (the design caveat).
pub fn calibrate(
    policy: &mut ConfidencePolicy,
    pattern: &str,
    undone_now: usize,
    confounded: bool,
) -> Calibration {
    let Some(support) = policy.support_of(pattern) else {
        // No active floor for this pattern — nothing to calibrate.
        return Calibration::Confounded;
    };
    if confounded {
        return Calibration::Confounded;
    }
    if undone_now > support {
        // Undos continued after the raise → it didn't reduce them → revert.
        policy.supersede(pattern);
        Calibration::Reverted
    } else {
        Calibration::Kept
    }
}

/// Run the closed measurement loop over the signed-in user's ACTIVE floors (Slice
/// 3b): for each, [`calibrate`] keeps / reverts / leaves-confounded, persisting
/// any reversions. The current undo count and the confound check (is the pattern
/// also cautioned, so the floor isn't the sole responder) are **injected**, so the
/// IO stays at the edge and the decision stays pure. Best-effort; returns how many
/// floors were reverted.
pub fn calibrate_floors(
    user_id: Option<&str>,
    undone_count: impl Fn(&str) -> usize,
    is_cautioned: impl Fn(&str) -> bool,
) -> usize {
    let Ok(path) = confidence_path(user_id) else {
        return 0;
    };
    let mut policy = ConfidencePolicy::load(&path);
    let mut reverted = 0;
    for pattern in policy.active_patterns() {
        if calibrate(
            &mut policy,
            &pattern,
            undone_count(&pattern),
            is_cautioned(&pattern),
        ) == Calibration::Reverted
        {
            reverted += 1;
        }
    }
    if reverted > 0 {
        let _ = policy.save(&path);
    }
    reverted
}

// ── Slice 2a · the reversible suppression overlay ─────────────────────────────
//
// A stale proactive suggestion (the [`stale_suggestion`] producer) is SOFT-
// suppressed here: eri suggests it LESS, **never deletes it**. The overlay is kept
// SEPARATE from the world graph's observed `NEXT` counts — those stay ground truth
// (what the user actually did), so a resumed behaviour always resurfaces and a wrong
// suppression is reversible. Mirrors [`ConfidencePolicy`]: an empty overlay is
// byte-for-byte today's behaviour, every record is provenance-stamped (sia, via the
// applying [`Provenance`]) and bi-temporally supersede-able — calibration (a later
// slice) reverts a suppression the user's behaviour contradicts.

// The overlay is read by the surfacing layer (Slice 3) and written by
// `LiveRefinablePolicy::downweight_chain` + revisited by calibration (Slice 4); the
// scoped allows below mark exactly that not-yet-wired gap (removed when wired), not
// dead code — same treatment as the `stale_suggestion` producer above.

/// One sia-applied soft suppression of a chain edge `from → to`.
#[allow(dead_code)]
#[derive(Clone, Debug, Serialize, Deserialize)]
struct Suppression {
    /// The edge, stored so [`SuppressionPolicy::active_edges`] reconstructs it
    /// without parsing the map key.
    from: String,
    to: String,
    /// The pass-over count WHEN the edge was suppressed — the baseline calibration
    /// compares against ("did the user resume the suggestion after eri backed off?").
    support: usize,
    /// Superseded by calibration (it didn't earn its keep): kept for audit
    /// (bi-temporal — invalidate-not-delete), but no longer applied, so
    /// [`is_suppressed`](SuppressionPolicy::is_suppressed) reads `false` again.
    superseded: bool,
}

/// Per-edge soft-suppression overlay — sia's reversible opinion about which
/// proactive suggestions have gone stale, kept SEPARATE from the world graph's
/// observed counts (ground truth). An edge with no *active* suppression surfaces
/// normally, so an **empty overlay is exactly today's behavior**. Persisted per-user
/// beside the world graph + confidence policy.
#[allow(dead_code)]
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct SuppressionPolicy {
    /// Keyed by the edge (unit-separator joined, so labels with arbitrary
    /// punctuation can't collide); the value also carries `from`/`to`.
    edges: BTreeMap<String, Suppression>,
}

/// Join an edge's endpoints into a collision-proof map key (the unit separator
/// can't appear in an action label).
#[allow(dead_code)]
fn edge_key(from: &str, to: &str) -> String {
    format!("{from}\u{1f}{to}")
}

#[allow(dead_code)]
impl SuppressionPolicy {
    /// Is the proactive suggestion `from → to` *actively* suppressed (so the
    /// surfacing layer should suggest it less)? A superseded record reads `false`.
    pub fn is_suppressed(&self, from: &str, to: &str) -> bool {
        self.edges
            .get(&edge_key(from, to))
            .is_some_and(|s| !s.superseded)
    }

    /// Soft-suppress `from → to`, recording `support` (the pass-over count that
    /// earned it) as the calibration baseline. Idempotent; re-suppressing a
    /// superseded edge starts a fresh ACTIVE suppression.
    pub fn suppress(&mut self, from: &str, to: &str, support: usize) {
        self.edges.insert(
            edge_key(from, to),
            Suppression {
                from: from.to_string(),
                to: to.to_string(),
                support,
                superseded: false,
            },
        );
    }

    /// Mark `from → to` superseded — calibration found the suppression didn't earn
    /// its keep (the user resumed it). Bi-temporal: the record stays (auditable),
    /// but it stops applying, so the suggestion resurfaces.
    pub fn supersede(&mut self, from: &str, to: &str) {
        if let Some(s) = self.edges.get_mut(&edge_key(from, to)) {
            s.superseded = true;
        }
    }

    /// The edges with an ACTIVE suppression — the set calibration revisits.
    pub fn active_edges(&self) -> Vec<(String, String)> {
        self.edges
            .values()
            .filter(|s| !s.superseded)
            .map(|s| (s.from.clone(), s.to.clone()))
            .collect()
    }

    /// Persist to `path` (pretty JSON). The caller resolves a user-scoped path.
    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_string_pretty(self)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        std::fs::write(path, json)
    }

    /// Load, or an empty (= today's behavior) overlay if the file is absent or
    /// unreadable — so a fresh user is exactly today's suggestions.
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
pub fn apply(policy: &mut impl RefinablePolicy, proposal: &Proposal, provenance: &Provenance) {
    match proposal {
        Proposal::RaiseFloor { pattern } => policy.raise_floor(pattern, provenance),
        Proposal::DownweightChain { from, to } => policy.downweight_chain(from, to, provenance),
        Proposal::Caution { pattern } => policy.caution(pattern, provenance),
    }
}

/// The user-scoped path for the confidence-floor policy — beside the world graph
/// (`~/.eri/[users/<p>/]confidence.json`), so floors are per-user like the world
/// model (fixing the cautions-global inconsistency for the new axis).
pub fn confidence_path(user_id: Option<&str>) -> io::Result<PathBuf> {
    Ok(
        eri_inference::memory::world_recall::world_graph_path_for(user_id)?
            .with_file_name("confidence.json"),
    )
}

/// The production [`RefinablePolicy`] — applies an accepted refinement to the
/// signed-in user's stores: confidence floors ([`ConfidencePolicy`], beside the
/// world graph), chain weights (the world graph, via the `eri_inference` seam),
/// and cautions (the permission store). User-scoped and **best-effort** — a
/// failed write never breaks the surrounding command. Every op NARROWS; the type
/// has no way to widen a grant or touch the refusal list.
pub struct LiveRefinablePolicy {
    user_id: Option<String>,
}

impl LiveRefinablePolicy {
    pub fn new(user_id: Option<String>) -> Self {
        Self { user_id }
    }
}

impl RefinablePolicy for LiveRefinablePolicy {
    fn raise_floor(&mut self, pattern: &str, provenance: &Provenance) {
        if let Ok(path) = confidence_path(self.user_id.as_deref()) {
            let mut floors = ConfidencePolicy::load(&path);
            floors.raise(pattern, provenance.support);
            let _ = floors.save(&path);
        }
    }

    fn downweight_chain(&mut self, from: &str, to: &str, _provenance: &Provenance) {
        let _ = eri_inference::memory::world_recall::downweight_transition(
            self.user_id.as_deref(),
            from,
            to,
        );
    }

    fn caution(&mut self, pattern: &str, _provenance: &Provenance) {
        // Route to the existing caution mechanism (ask-first — a narrowing).
        if let Some(path) = control_safety::PermissionStore::default_path() {
            let mut store = control_safety::PermissionStore::load(&path);
            if store.absorb_cautions(vec![pattern.to_string()]) > 0 {
                let _ = store.save(&path);
            }
        }
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

    fn trail(actions: &[&str]) -> Vec<String> {
        actions.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn a_suggestion_the_user_still_follows_is_not_stale() {
        // After "open editor" eri suggests "run tests" — and the user keeps doing
        // it. Nothing to suppress; eri should keep suggesting.
        let t = trail(&["open editor", "run tests", "open editor", "run tests"]);
        assert!(stale_suggestion("open editor", "run tests", &t).is_none());
    }

    #[test]
    fn passing_a_suggestion_over_once_is_a_one_off_not_a_pattern() {
        // Passed over a single time (< MIN_SUPPORT) — a one-off never justifies a
        // policy change, exactly as the acceptance gate would also reject.
        let t = trail(&["open editor", "check email"]);
        assert!(stale_suggestion("open editor", "run tests", &t).is_none());
    }

    #[test]
    fn repeatedly_passing_a_suggestion_over_proposes_a_soft_downweight() {
        // eri keeps suggesting "run tests" after "open editor"; the user keeps doing
        // "check email" instead and NEVER runs tests → the suggestion is stale.
        let t = trail(&[
            "open editor",
            "check email",
            "open editor",
            "check email",
            "open editor",
            "reply on slack",
        ]);
        let (proposal, support) =
            stale_suggestion("open editor", "run tests", &t).expect("stale suggestion");
        assert_eq!(
            proposal,
            Proposal::DownweightChain {
                from: "open editor".into(),
                to: "run tests".into(),
            }
        );
        assert_eq!(support, 3, "passed over three times");
        // And the producer's result clears the acceptance gate as a well-supported,
        // benign refinement — stamped sia, reversible downstream.
        match accept(&proposal, support) {
            Verdict::Accept(prov) => assert_eq!(prov.source, SIA_SOURCE),
            other => panic!("expected Accept, got {other:?}"),
        }
    }

    #[test]
    fn a_mixed_history_where_the_user_sometimes_follows_is_not_stale() {
        // Passed over twice but ALSO followed once — the suggestion still earns its
        // place; suppressing it would be wrong (and invisible). Keep suggesting.
        let t = trail(&[
            "open editor",
            "check email",
            "open editor",
            "run tests",
            "open editor",
            "check email",
        ]);
        assert!(stale_suggestion("open editor", "run tests", &t).is_none());
    }

    #[test]
    fn a_stale_suggestion_that_crosses_the_refusal_boundary_is_still_never_applied() {
        // Even a cleanly-passed-over suggestion is re-checked at the gate: if it
        // names a refused action, sia must never fold it into policy.
        let t = trail(&[
            "unlock the vault",
            "open notes",
            "unlock the vault",
            "open notes",
        ]);
        let (proposal, support) =
            stale_suggestion("unlock the vault", "type my password into the field", &t)
                .expect("passed over twice");
        assert!(
            control_safety::classify_refusal("type my password into the field").is_some(),
            "precondition: the suggested action is refused at the live gate"
        );
        assert!(matches!(accept(&proposal, support), Verdict::Reject(_)));
    }

    #[test]
    fn an_empty_confidence_policy_is_todays_default_behavior() {
        let pol = ConfidencePolicy::default();
        assert_eq!(pol.floor_for("click Save"), DEFAULT_CONFIDENCE_FLOOR);
    }

    #[test]
    fn raising_a_floor_is_a_capped_conservative_step() {
        let mut pol = ConfidencePolicy::default();
        let after = pol.raise("quit Slack", 2);
        assert!((after - (DEFAULT_CONFIDENCE_FLOOR + FLOOR_STEP)).abs() < 1e-6);
        // Repeated raises converge to the cap, never past it.
        for _ in 0..50 {
            pol.raise("quit Slack", 2);
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
        pol.raise("quit Slack", 2);
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

    #[test]
    fn an_empty_suppression_overlay_is_todays_behavior() {
        // Nothing suppressed → every suggestion surfaces exactly as today.
        let pol = SuppressionPolicy::default();
        assert!(!pol.is_suppressed("open editor", "run tests"));
        assert!(pol.active_edges().is_empty());
    }

    #[test]
    fn suppressing_an_edge_demotes_only_that_suggestion() {
        let mut pol = SuppressionPolicy::default();
        pol.suppress("open editor", "run tests", 3);
        assert!(pol.is_suppressed("open editor", "run tests"));
        // A different edge — even sharing an endpoint — is untouched.
        assert!(!pol.is_suppressed("open editor", "check email"));
        assert!(!pol.is_suppressed("run tests", "open editor"));
        assert_eq!(
            pol.active_edges(),
            vec![("open editor".to_string(), "run tests".to_string())]
        );
    }

    #[test]
    fn supersede_reverts_a_suppression_so_the_suggestion_resurfaces() {
        // THE reversibility guard: a wrong suppression is invisible (you won't see
        // the suggestion to re-engage it), so calibration MUST be able to revert it.
        let mut pol = SuppressionPolicy::default();
        pol.suppress("open editor", "run tests", 2);
        pol.supersede("open editor", "run tests");
        assert!(
            !pol.is_suppressed("open editor", "run tests"),
            "a superseded suppression no longer applies — the suggestion is back"
        );
        // Bi-temporal: the record is kept (auditable), it just stops applying.
        assert!(pol.active_edges().is_empty());
        // And re-suppressing a superseded edge starts a fresh ACTIVE suppression.
        pol.suppress("open editor", "run tests", 4);
        assert!(pol.is_suppressed("open editor", "run tests"));
    }

    #[test]
    fn suppression_overlay_round_trips_and_a_missing_file_is_the_default() {
        let dir = std::env::temp_dir().join(format!("eri-sia-supp-{}", std::process::id()));
        let path = dir.join("suppression.json");
        let mut pol = SuppressionPolicy::default();
        pol.suppress("open editor", "run tests", 3);
        pol.suppress("open Slack", "open Calendar", 2);
        pol.supersede("open Slack", "open Calendar"); // superseded survives the round-trip
        pol.save(&path).expect("save");

        let loaded = SuppressionPolicy::load(&path);
        assert!(loaded.is_suppressed("open editor", "run tests"));
        assert!(
            !loaded.is_suppressed("open Slack", "open Calendar"),
            "a superseded suppression round-trips as inactive"
        );
        // A fresh user (no file) is exactly today's behavior, not an error.
        assert!(
            !SuppressionPolicy::load(Path::new("/nonexistent/eri/suppression.json"))
                .is_suppressed("x", "y")
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
    fn sia_only_tightens_a_floor_never_below_the_default() {
        // THE safety property of the whole loop: floors only RISE. After any
        // sequence of raises, every floor is >= the default — there is no mutator
        // that lowers one — so sia can only ever make eri ask MORE, never
        // auto-execute something it wouldn't have pre-learning.
        let mut pol = ConfidencePolicy::default();
        for _ in 0..3 {
            pol.raise("open Safari", 2);
        }
        pol.raise("quit Mail", 2);
        assert!(pol.floor_for("open Safari") >= DEFAULT_CONFIDENCE_FLOOR);
        assert!(pol.floor_for("quit Mail") >= DEFAULT_CONFIDENCE_FLOOR);
        // A pattern sia never touched is exactly the default — unchanged.
        assert_eq!(pol.floor_for("anything else"), DEFAULT_CONFIDENCE_FLOOR);
    }

    #[test]
    fn calibration_keeps_a_floor_with_no_new_undos() {
        // The user stopped undoing the pattern after the raise → it earned its keep.
        let mut pol = ConfidencePolicy::default();
        pol.raise("open Safari", 2); // raised at undo count 2
        assert_eq!(
            calibrate(&mut pol, "open Safari", 2, false),
            Calibration::Kept
        );
        assert!(pol.floor_for("open Safari") > DEFAULT_CONFIDENCE_FLOOR);
    }

    #[test]
    fn calibration_reverts_a_floor_that_did_not_reduce_undos() {
        // Undos kept coming after the raise → it didn't help → revert (superseded,
        // bi-temporal), back to the default floor.
        let mut pol = ConfidencePolicy::default();
        pol.raise("open Safari", 2);
        assert_eq!(
            calibrate(&mut pol, "open Safari", 4, false),
            Calibration::Reverted
        );
        assert_eq!(
            pol.floor_for("open Safari"),
            DEFAULT_CONFIDENCE_FLOOR,
            "a reverted floor is back to the default"
        );
        // Superseded, not deleted (audit) — and no longer an active floor.
        assert!(pol.active_patterns().is_empty());
    }

    #[test]
    fn calibration_never_credits_or_blames_a_confounded_floor() {
        // The pattern is ALSO cautioned → the floor isn't the sole responder, so a
        // reduction (or not) in undos isn't the floor's doing (the design caveat).
        // Left exactly as-is — harmless, since the floor only ever tightens.
        let mut pol = ConfidencePolicy::default();
        pol.raise("open Safari", 2);
        assert_eq!(
            calibrate(&mut pol, "open Safari", 9, true),
            Calibration::Confounded
        );
        assert!(
            pol.floor_for("open Safari") > DEFAULT_CONFIDENCE_FLOOR,
            "a confounded floor is neither reverted nor credited — left active"
        );
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
