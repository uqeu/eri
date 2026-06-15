//! The unified engine-escalation ladder — ONE policy that drives engine
//! selection for a goal across BOTH the build loop and the control loop.
//!
//! ## Why this exists (architecture-review finding C5)
//!
//! The agentic loop runs an ORDERED engine list (cheapest eri-brain first →
//! local → … → Claude). Each turn picks an engine; if one can't continue, the
//! loop escalates to the next. Two surfaces used to hand-roll this policy
//! *differently*:
//!
//!   - the **build loop** retried from `engine[0]` every turn (max frugality,
//!     but it could thrash a flaky cheap engine forever), while
//!   - the **control loop** kept a sticky `engine_idx` — once escalated it
//!     stayed escalated for the whole goal (resilient, but it stopped trying
//!     the cheap engine even after a transient blip).
//!
//! Same concept, two policies → a silent behavioural fork AND an inconsistent
//! Claude-escalation-share metric (the moat's north-star). This module folds
//! them into one decided policy.
//!
//! ## The policy (one place, both loops)
//!
//! 1. **Cheap-first per turn.** Each turn starts at the cheapest engine that is
//!    not *tripped* (see 3); the first engine that produces a usable turn wins.
//! 2. **Per-turn escalation.** If an engine can't continue on a turn, advance to
//!    the next engine FOR THAT TURN, until one succeeds or the list is exhausted
//!    (exhausted ⇒ propagate the last error, as before).
//! 3. **Consecutive-failure circuit breaker.** Track consecutive turns where the
//!    cheapest (index-0) engine failed. After [`TRIP_THRESHOLD`] consecutive
//!    such turns, *trip* index-0: stop trying it and start subsequent turns from
//!    the next engine (sticky) for the rest of the goal — build's frugality plus
//!    control's thrash-guard. A turn where index-0 succeeds resets the counter
//!    (and can only reset it while still untripped; once tripped, it stays
//!    tripped for the goal — the resilience guarantee).
//!
//! Each escalation emits ONE [`LadderEvent`] so both loops report the
//! Claude-share metric with the same event shape.
//!
//! ## Shape
//!
//! [`EngineLadder`] is engine-type-agnostic: it holds only the per-goal trip
//! state and is driven by [`EngineLadder::run_turn`], a small generic over a
//! "try one engine" async closure returning a [`TurnAttempt`]. The build and
//! control loops each supply their own closure (mapping their own engine trait
//! and error type), so the *policy* lives here exactly once while the
//! transport, tool dispatch, usage accounting, and narration stay in each loop.

/// Consecutive turns the cheapest (index-0) engine must fail before the ladder
/// trips it and escalates stickily for the rest of the goal. Two gives one
/// transient blip a free retry on the next turn before we stop paying the cheap
/// engine's latency on every turn.
pub(crate) const TRIP_THRESHOLD: usize = 2;

/// What one engine attempt produced, from the loop's point of view. Generic
/// over the loop's own turn type `T` (a `Turn` for build, a `TurnOutput` for
/// control) and its own abort type `A` (build's graceful `Halt`; control has
/// none, so it uses [`std::convert::Infallible`]).
pub(crate) enum TurnAttempt<T, A> {
    /// A usable turn — done for this turn.
    Produced(T),
    /// This engine couldn't continue; advance to the next engine for this turn.
    Escalate,
    /// Stop the whole run immediately, NOT an escalation (build's recoverable
    /// quota/capacity `Halt`). The ladder returns it to the caller verbatim.
    Abort(A),
}

/// Emitted once per escalation so both loops report the Claude-share metric with
/// an identical event shape. `tripped` is true when this escalation also tripped
/// the cheap engine (the circuit breaker fired this turn), false for an ordinary
/// per-turn escalation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct LadderEvent {
    pub from_engine_name: String,
    pub to_engine_name: String,
    pub turn_index: usize,
    pub reason: String,
    pub tripped: bool,
}

/// The result of one ladder turn: the produced value, plus any escalation
/// events emitted while finding the engine that produced it.
pub(crate) struct LadderTurn<T> {
    pub value: T,
    pub events: Vec<LadderEvent>,
}

/// Outcome of [`EngineLadder::run_turn`]: a produced turn, an exhausted list
/// (propagate the last escalation error), or a caller-defined abort.
pub(crate) enum LadderOutcome<T, A, E> {
    /// An engine produced a turn (carrying any escalation events emitted).
    Turn(LadderTurn<T>),
    /// Every non-tripped engine escalated; carries the last engine's error so
    /// the caller can propagate it exactly as before.
    Exhausted(E),
    /// A caller-defined abort surfaced (build's graceful `Halt`).
    Aborted(A),
}

/// Per-goal engine-selection state. Holds the ordered engine *names* (for event
/// reporting + start-index selection) and the circuit-breaker state. The engines
/// themselves stay with the caller; the ladder only decides *which index to try
/// next* and *when to trip the cheap one*.
pub(crate) struct EngineLadder {
    /// Engine labels in escalation order (index 0 = cheapest).
    names: Vec<String>,
    /// Once true, index-0 is skipped for the rest of the goal (sticky).
    tripped: bool,
    /// Consecutive turns index-0 has failed while still untripped.
    consecutive_cheap_failures: usize,
}

impl EngineLadder {
    /// Build a ladder over engines named `names` (escalation order). A single
    /// engine (Claude-only) is valid and behaves exactly as a no-escalation
    /// loop: index-0 is the only engine, it's never "the cheap engine we trip
    /// away from" in any observable way, and no events are ever emitted.
    pub(crate) fn new(names: Vec<String>) -> Self {
        Self {
            names,
            tripped: false,
            consecutive_cheap_failures: 0,
        }
    }

    /// The index this turn starts from: the cheapest engine not tripped away.
    /// While untripped that's 0; once tripped it's 1 (sticky escalation past the
    /// cheap engine). Capped to the last index so a single-engine ladder always
    /// starts at 0.
    fn start_index(&self) -> usize {
        let start = if self.tripped { 1 } else { 0 };
        start.min(self.names.len().saturating_sub(1))
    }

    /// True once index-0 has been tripped for the rest of the goal. Exposed for
    /// tests + callers that want to surface it.
    #[cfg(test)]
    pub(crate) fn is_tripped(&self) -> bool {
        self.tripped
    }

    /// Drive one turn through the policy. `attempt(index)` runs the engine at
    /// `index` and reports whether it produced a turn, wants escalation, or
    /// aborts the run. `run_turn` walks engines from [`start_index`] forward,
    /// emitting one [`LadderEvent`] per escalation, updates the circuit-breaker
    /// state, and returns the outcome.
    ///
    /// `turn_index` is the loop's own 0-based step counter, recorded in events.
    /// `last_error(index)` renders the escalation reason / propagated error for
    /// the engine at `index` (the loops format these differently, so it's a
    /// closure) — called only on an escalation/exhaustion path.
    pub(crate) async fn run_turn<T, A, E, F, Fut, R>(
        &mut self,
        turn_index: usize,
        mut attempt: F,
        mut reason_for: R,
    ) -> LadderOutcome<T, A, E>
    where
        F: FnMut(usize) -> Fut,
        Fut: std::future::Future<Output = TurnAttempt<T, A>>,
        R: FnMut(usize) -> E,
        E: ToString,
    {
        let start = self.start_index();
        let last = self.names.len().saturating_sub(1);
        let mut events: Vec<LadderEvent> = Vec::new();

        let mut idx = start;
        loop {
            match attempt(idx).await {
                TurnAttempt::Produced(value) => {
                    // A turn produced at index-0 (while untripped) clears the
                    // consecutive-failure streak; a turn produced anywhere else
                    // (or after escalating within this turn) does not "rescue"
                    // the cheap engine — but note index-0 can only be the start
                    // index while untripped, so this is the only reset path.
                    if idx == 0 && !self.tripped {
                        self.consecutive_cheap_failures = 0;
                    }
                    return LadderOutcome::Turn(LadderTurn { value, events });
                }
                TurnAttempt::Abort(a) => return LadderOutcome::Aborted(a),
                TurnAttempt::Escalate => {
                    // Circuit breaker: a failure of index-0 (only reachable while
                    // untripped, since a tripped ladder never starts there) counts
                    // toward the trip threshold. Trip on the threshold-th
                    // consecutive cheap failure; the trip is reported on THIS
                    // escalation's event.
                    let mut tripped_now = false;
                    if idx == 0 && !self.tripped {
                        self.consecutive_cheap_failures += 1;
                        if self.consecutive_cheap_failures >= TRIP_THRESHOLD {
                            self.tripped = true;
                            tripped_now = true;
                        }
                    }
                    if idx >= last {
                        // List exhausted for this turn — propagate the last error.
                        return LadderOutcome::Exhausted(reason_for(idx));
                    }
                    events.push(LadderEvent {
                        from_engine_name: self.names[idx].clone(),
                        to_engine_name: self.names[idx + 1].clone(),
                        turn_index,
                        reason: render_reason(&reason_for(idx)),
                        tripped: tripped_now,
                    });
                    idx += 1;
                }
            }
        }
    }
}

/// Render the loop's escalation error into the event's `reason` string. Kept
/// generic via `ToString` so both loops' error types work without the ladder
/// knowing about `anyhow::Error` vs a `String`.
fn render_reason<E: ToString>(e: &E) -> String {
    e.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A scripted engine table: `plan[i]` is the outcome the engine at that
    /// index returns. The test closure consults this by index, so the ladder's
    /// *selection* policy is what's under test — not any real transport.
    ///
    /// `Ok(text)` = produced a turn with that text; `Err(msg)` = escalate with
    /// that error message.
    fn attempt_from<'a>(
        plan: &'a [Result<&'static str, &'static str>],
    ) -> impl Fn(usize) -> std::future::Ready<TurnAttempt<&'static str, std::convert::Infallible>> + 'a
    {
        move |idx: usize| {
            let out = match plan.get(idx) {
                Some(Ok(t)) => TurnAttempt::Produced(*t),
                _ => TurnAttempt::Escalate,
            };
            std::future::ready(out)
        }
    }

    fn reason_from<'a>(
        plan: &'a [Result<&'static str, &'static str>],
    ) -> impl Fn(usize) -> String + 'a {
        move |idx: usize| match plan.get(idx) {
            Some(Err(e)) => (*e).to_string(),
            _ => "exhausted".to_string(),
        }
    }

    fn names() -> Vec<String> {
        vec!["cheap".into(), "mid".into(), "claude".into()]
    }

    // (a) The cheap engine is retried each turn while not tripped.
    #[tokio::test]
    async fn cheap_engine_is_retried_each_turn_while_untripped() {
        let mut ladder = EngineLadder::new(names());
        // Cheap succeeds turn after turn — never escalates, never trips.
        let plan = [Ok("cheap-ok"), Ok("mid"), Ok("claude")];
        for turn in 0..5 {
            let outcome = ladder
                .run_turn(turn, attempt_from(&plan), reason_from(&plan))
                .await;
            match outcome {
                LadderOutcome::Turn(t) => {
                    assert_eq!(
                        t.value, "cheap-ok",
                        "turn {turn} should run the cheap engine"
                    );
                    assert!(t.events.is_empty(), "no escalation, no events");
                }
                _ => panic!("expected a produced turn"),
            }
        }
        assert!(!ladder.is_tripped());
    }

    // (a') A cheap failure that recovers next turn still retries cheap (per-turn
    // escalation, no premature stickiness below the trip threshold).
    #[tokio::test]
    async fn single_cheap_failure_still_retries_cheap_next_turn() {
        let mut ladder = EngineLadder::new(names());
        // Turn 0: cheap fails, escalate to mid (succeeds). One failure < threshold.
        let plan0 = [Err("blip"), Ok("mid"), Ok("claude")];
        let out0 = ladder
            .run_turn(0, attempt_from(&plan0), reason_from(&plan0))
            .await;
        match out0 {
            LadderOutcome::Turn(t) => {
                assert_eq!(t.value, "mid");
                assert_eq!(t.events.len(), 1);
                assert!(!t.events[0].tripped, "one failure must not trip");
            }
            _ => panic!("expected a produced turn"),
        }
        assert!(!ladder.is_tripped(), "below threshold → still untripped");
        // Turn 1: cheap recovers — and because it wasn't tripped, we tried it.
        let plan1 = [Ok("cheap-back"), Ok("mid"), Ok("claude")];
        let out1 = ladder
            .run_turn(1, attempt_from(&plan1), reason_from(&plan1))
            .await;
        match out1 {
            LadderOutcome::Turn(t) => assert_eq!(t.value, "cheap-back"),
            _ => panic!("expected a produced turn"),
        }
    }

    // (b) Trips after TRIP_THRESHOLD consecutive cheap failures, then sticks.
    #[tokio::test]
    async fn trips_after_two_consecutive_cheap_failures_then_sticks() {
        let mut ladder = EngineLadder::new(names());
        let plan = [Err("down"), Ok("mid"), Ok("claude")];
        // Turn 0: cheap fails (1st). Not yet tripped.
        let _ = ladder
            .run_turn(0, attempt_from(&plan), reason_from(&plan))
            .await;
        assert!(!ladder.is_tripped());
        // Turn 1: cheap fails (2nd consecutive) → trips on THIS escalation event.
        let out1 = ladder
            .run_turn(1, attempt_from(&plan), reason_from(&plan))
            .await;
        match out1 {
            LadderOutcome::Turn(t) => {
                assert_eq!(t.value, "mid");
                assert_eq!(t.events.len(), 1);
                assert!(t.events[0].tripped, "the 2nd consecutive failure trips it");
            }
            _ => panic!("expected a produced turn"),
        }
        assert!(ladder.is_tripped());
        // Turn 2: tripped → starts at index 1 (mid), never even tries cheap, so
        // a now-recovered cheap engine is ignored (sticky resilience guarantee).
        let plan2 = [Ok("cheap-recovered"), Ok("mid-2"), Ok("claude")];
        let out2 = ladder
            .run_turn(2, attempt_from(&plan2), reason_from(&plan2))
            .await;
        match out2 {
            LadderOutcome::Turn(t) => {
                assert_eq!(t.value, "mid-2", "stays on mid, ignores recovered cheap");
                assert!(t.events.is_empty(), "starting at mid is not an escalation");
            }
            _ => panic!("expected a produced turn"),
        }
        assert!(
            ladder.is_tripped(),
            "once tripped, stays tripped for the goal"
        );
    }

    // (c) A cheap success resets the pre-trip counter (so two NON-consecutive
    // failures never trip).
    #[tokio::test]
    async fn cheap_success_resets_the_consecutive_failure_counter() {
        let mut ladder = EngineLadder::new(names());
        // Turn 0: cheap fails (1st).
        let fail = [Err("down"), Ok("mid"), Ok("claude")];
        let _ = ladder
            .run_turn(0, attempt_from(&fail), reason_from(&fail))
            .await;
        assert!(!ladder.is_tripped());
        // Turn 1: cheap SUCCEEDS → resets the streak to 0.
        let ok = [Ok("cheap-ok"), Ok("mid"), Ok("claude")];
        let _ = ladder
            .run_turn(1, attempt_from(&ok), reason_from(&ok))
            .await;
        assert!(!ladder.is_tripped());
        // Turn 2: cheap fails again (counts as 1st of a fresh streak, not 2nd).
        let out2 = ladder
            .run_turn(2, attempt_from(&fail), reason_from(&fail))
            .await;
        match out2 {
            LadderOutcome::Turn(t) => {
                assert!(
                    !t.events[0].tripped,
                    "a non-consecutive second failure must NOT trip"
                );
            }
            _ => panic!("expected a produced turn"),
        }
        assert!(!ladder.is_tripped(), "reset means no trip");
    }

    // (d) An exhausted list propagates the last error.
    #[tokio::test]
    async fn exhausted_list_propagates_the_last_error() {
        let mut ladder = EngineLadder::new(vec!["cheap".into(), "claude".into()]);
        // Both engines escalate.
        let plan = [Err("cheap-down"), Err("claude-down")];
        let outcome = ladder
            .run_turn(0, attempt_from(&plan), reason_from(&plan))
            .await;
        match outcome {
            LadderOutcome::Exhausted(e) => assert_eq!(e, "claude-down"),
            _ => panic!("expected exhaustion to propagate the last error"),
        }
    }

    // (e) An escalation event carries the right fields.
    #[tokio::test]
    async fn escalation_event_has_the_right_fields() {
        let mut ladder = EngineLadder::new(names());
        let plan = [Err("cheap blew up"), Ok("mid"), Ok("claude")];
        let outcome = ladder
            .run_turn(3, attempt_from(&plan), reason_from(&plan))
            .await;
        match outcome {
            LadderOutcome::Turn(t) => {
                assert_eq!(t.events.len(), 1);
                let ev = &t.events[0];
                assert_eq!(ev.from_engine_name, "cheap");
                assert_eq!(ev.to_engine_name, "mid");
                assert_eq!(ev.turn_index, 3);
                assert_eq!(ev.reason, "cheap blew up");
                assert!(!ev.tripped);
            }
            _ => panic!("expected a produced turn with one event"),
        }
    }

    // (e') Two escalations in one turn emit two events (cheap → mid → claude).
    #[tokio::test]
    async fn two_escalations_in_one_turn_emit_two_events() {
        let mut ladder = EngineLadder::new(names());
        let plan = [Err("cheap-down"), Err("mid-down"), Ok("claude")];
        let outcome = ladder
            .run_turn(0, attempt_from(&plan), reason_from(&plan))
            .await;
        match outcome {
            LadderOutcome::Turn(t) => {
                assert_eq!(t.value, "claude");
                assert_eq!(t.events.len(), 2);
                assert_eq!(t.events[0].from_engine_name, "cheap");
                assert_eq!(t.events[0].to_engine_name, "mid");
                assert_eq!(t.events[1].from_engine_name, "mid");
                assert_eq!(t.events[1].to_engine_name, "claude");
            }
            _ => panic!("expected a produced turn with two events"),
        }
    }

    // PRESERVE: a single-engine (Claude-only) ladder behaves exactly as today —
    // always index 0, never trips, never emits events, and an error exhausts
    // immediately (propagated, as the old loop did).
    #[tokio::test]
    async fn single_engine_claude_only_is_unchanged() {
        let mut ladder = EngineLadder::new(vec!["claude".into()]);
        // Success path: runs the sole engine, no events.
        let ok = [Ok("claude-only")];
        match ladder
            .run_turn(0, attempt_from(&ok), reason_from(&ok))
            .await
        {
            LadderOutcome::Turn(t) => {
                assert_eq!(t.value, "claude-only");
                assert!(t.events.is_empty());
            }
            _ => panic!("expected the sole engine to produce a turn"),
        }
        assert!(!ladder.is_tripped(), "a single engine is never tripped");
        // Failure path: exhausts immediately with the sole engine's error.
        let bad = [Err("claude-down")];
        match ladder
            .run_turn(1, attempt_from(&bad), reason_from(&bad))
            .await
        {
            LadderOutcome::Exhausted(e) => assert_eq!(e, "claude-down"),
            _ => panic!("expected exhaustion"),
        }
        // Even after a failure, a single-engine ladder never trips (no index to
        // trip away to) — index 0 stays the start.
        assert!(!ladder.is_tripped());
        assert_eq!(ladder.start_index(), 0);
    }

    // Abort short-circuits the run without escalating (build's graceful Halt).
    #[tokio::test]
    async fn abort_short_circuits_without_escalating() {
        let mut ladder = EngineLadder::new(names());
        let attempt = |idx: usize| {
            let out = if idx == 0 {
                TurnAttempt::<&'static str, &'static str>::Abort("halt: quota")
            } else {
                TurnAttempt::Produced("should not reach")
            };
            std::future::ready(out)
        };
        let reason = |_: usize| "unused".to_string();
        match ladder.run_turn(0, attempt, reason).await {
            LadderOutcome::Aborted(a) => assert_eq!(a, "halt: quota"),
            _ => panic!("expected the abort to short-circuit"),
        }
        // An abort is not a cheap failure — it must not advance the trip counter.
        assert!(!ladder.is_tripped());
    }
}
