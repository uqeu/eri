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

use serde_json::Value;

/// Consecutive turns the cheapest (index-0) engine must fail before the ladder
/// trips it and escalates stickily for the rest of the goal. Two gives one
/// transient blip a free retry on the next turn before we stop paying the cheap
/// engine's latency on every turn.
pub(crate) const TRIP_THRESHOLD: usize = 2;

/// True if any message in `messages` carries an IMAGE content block.
///
/// ## Why (vision → Claude routing)
///
/// eri's hosted eri-brain is a **text** dense model, NOT a VLM — it would choke
/// on / silently ignore an image. The architecture's core principle is "vision
/// reasons on Claude" (`docs/architecture/vision-perception.md`): any turn whose
/// input contains image content (a screenshot, camera frame, pasted image) must
/// be handled by a vision-capable engine (Claude), never eri-brain. This pure
/// predicate is how the ladder detects such a turn.
///
/// Messages are Anthropic-shaped: each message's `content` is either a string
/// (text only — no image) or an array of content blocks, where an image is a
/// block with `"type":"image"` (`{"type":"image","source":{...}}`). For safety
/// against OpenAI-shaped inputs that may transit the same path, `"image_url"` is
/// also treated as an image block. A turn is "vision-required" if ANY block in
/// ANY message is an image block.
pub(crate) fn messages_have_image(messages: &[Value]) -> bool {
    messages.iter().any(message_has_image)
}

/// True if a single message's `content` array contains an image block. A
/// string `content` (text-only) is never an image; only an array of blocks can
/// hold one.
fn message_has_image(message: &Value) -> bool {
    message
        .get("content")
        .and_then(Value::as_array)
        .is_some_and(|blocks| blocks.iter().any(block_is_image))
}

/// True if a content block is an image. Accepts the Anthropic shape
/// (`"type":"image"`) and, defensively, the OpenAI shape (`"type":"image_url"`).
fn block_is_image(block: &Value) -> bool {
    matches!(
        block.get("type").and_then(Value::as_str),
        Some("image") | Some("image_url")
    )
}

/// True if the engine named `name` can reason over images (a VLM). Claude is
/// vision-capable; eri-brain (text-only hosted model) and on-device `local`
/// models are NOT. Matched case-insensitively on a `claude` prefix so the
/// concrete model label (e.g. `claude-sonnet-4-6`) still counts.
pub(crate) fn is_vision_capable(name: &str) -> bool {
    name.to_ascii_lowercase().starts_with("claude")
}

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

    /// The index this turn starts from, given whether the turn requires vision.
    ///
    /// Base start: the cheapest engine not tripped away — 0 while untripped, 1
    /// once tripped (sticky escalation past the cheap engine).
    ///
    /// Vision override: when `vision_required` is true, the cheap engine
    /// (eri-brain) is text-only and cannot see the image, so we jump straight to
    /// the FIRST vision-capable engine in the list (Claude) and never try the
    /// cheap engine for this turn. The index is *derived* from the engine list,
    /// not hard-coded, so a Claude-only or differently-ordered list still works.
    /// If no engine is vision-capable, we fall back to the base start (don't
    /// deadlock) — the caller's narration notes this under `ERI_DEBUG`.
    ///
    /// Always capped to the last index so a single-engine ladder starts at 0.
    fn start_index(&self, vision_required: bool) -> usize {
        let base = if self.tripped { 1 } else { 0 };
        let start = if vision_required {
            match self.first_vision_capable() {
                // Honour the trip state too: never restart below the tripped
                // floor, even toward a vision engine that sits before it.
                Some(vision_idx) => vision_idx.max(base),
                // No vision engine at all — fall back to base (graceful, no
                // deadlock). Vision will be sent to a text engine, but that's
                // strictly better than refusing to run the turn.
                None => base,
            }
        } else {
            base
        };
        start.min(self.names.len().saturating_sub(1))
    }

    /// Index of the first vision-capable engine in the list, if any. Used to
    /// pick the per-turn start for image turns without hard-coding index 1.
    fn first_vision_capable(&self) -> Option<usize> {
        self.names.iter().position(|n| is_vision_capable(n))
    }

    /// Whether this ladder has any vision-capable engine at all. Exposed so the
    /// loops can note (under `ERI_DEBUG`) when an image turn cannot be routed to
    /// a VLM and falls back to the cheap engine.
    pub(crate) fn has_vision_capable_engine(&self) -> bool {
        self.first_vision_capable().is_some()
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
    ///
    /// `vision_required` forces the turn to START at the first vision-capable
    /// engine (Claude), skipping the text-only cheap engine — see
    /// [`messages_have_image`] for WHY. Pass `false` for text-only turns to keep
    /// the unchanged cheap-first behaviour.
    pub(crate) async fn run_turn<T, A, E, F, Fut, R>(
        &mut self,
        turn_index: usize,
        vision_required: bool,
        mut attempt: F,
        mut reason_for: R,
    ) -> LadderOutcome<T, A, E>
    where
        F: FnMut(usize) -> Fut,
        Fut: std::future::Future<Output = TurnAttempt<T, A>>,
        R: FnMut(usize) -> E,
        E: ToString,
    {
        let start = self.start_index(vision_required);
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
                .run_turn(turn, false, attempt_from(&plan), reason_from(&plan))
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
            .run_turn(0, false, attempt_from(&plan0), reason_from(&plan0))
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
            .run_turn(1, false, attempt_from(&plan1), reason_from(&plan1))
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
            .run_turn(0, false, attempt_from(&plan), reason_from(&plan))
            .await;
        assert!(!ladder.is_tripped());
        // Turn 1: cheap fails (2nd consecutive) → trips on THIS escalation event.
        let out1 = ladder
            .run_turn(1, false, attempt_from(&plan), reason_from(&plan))
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
            .run_turn(2, false, attempt_from(&plan2), reason_from(&plan2))
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
            .run_turn(0, false, attempt_from(&fail), reason_from(&fail))
            .await;
        assert!(!ladder.is_tripped());
        // Turn 1: cheap SUCCEEDS → resets the streak to 0.
        let ok = [Ok("cheap-ok"), Ok("mid"), Ok("claude")];
        let _ = ladder
            .run_turn(1, false, attempt_from(&ok), reason_from(&ok))
            .await;
        assert!(!ladder.is_tripped());
        // Turn 2: cheap fails again (counts as 1st of a fresh streak, not 2nd).
        let out2 = ladder
            .run_turn(2, false, attempt_from(&fail), reason_from(&fail))
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
            .run_turn(0, false, attempt_from(&plan), reason_from(&plan))
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
            .run_turn(3, false, attempt_from(&plan), reason_from(&plan))
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
            .run_turn(0, false, attempt_from(&plan), reason_from(&plan))
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
            .run_turn(0, false, attempt_from(&ok), reason_from(&ok))
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
            .run_turn(1, false, attempt_from(&bad), reason_from(&bad))
            .await
        {
            LadderOutcome::Exhausted(e) => assert_eq!(e, "claude-down"),
            _ => panic!("expected exhaustion"),
        }
        // Even after a failure, a single-engine ladder never trips (no index to
        // trip away to) — index 0 stays the start.
        assert!(!ladder.is_tripped());
        assert_eq!(ladder.start_index(false), 0);
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
        match ladder.run_turn(0, false, attempt, reason).await {
            LadderOutcome::Aborted(a) => assert_eq!(a, "halt: quota"),
            _ => panic!("expected the abort to short-circuit"),
        }
        // An abort is not a cheap failure — it must not advance the trip counter.
        assert!(!ladder.is_tripped());
    }

    // ---- vision → Claude routing -------------------------------------------

    use serde_json::json;

    // Predicate: an image block inside a user message's content array → true.
    #[test]
    fn messages_have_image_detects_anthropic_image_block() {
        let messages = vec![json!({
            "role": "user",
            "content": [
                { "type": "text", "text": "what is on my screen?" },
                { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "..." } },
            ],
        })];
        assert!(messages_have_image(&messages));
    }

    // Predicate: text-only messages (string content and a text block) → false.
    #[test]
    fn messages_have_image_is_false_for_text_only() {
        let string_content = json!({ "role": "user", "content": "hello there" });
        let block_content = json!({
            "role": "assistant",
            "content": [ { "type": "text", "text": "hi" } ],
        });
        assert!(!messages_have_image(&[string_content, block_content]));
    }

    // Predicate: OpenAI-shaped "image_url" block is also treated as an image
    // (defensive — anything image-bearing must bypass the text-only engine).
    #[test]
    fn messages_have_image_accepts_openai_image_url_block() {
        let messages = vec![json!({
            "role": "user",
            "content": [ { "type": "image_url", "image_url": { "url": "data:..." } } ],
        })];
        assert!(messages_have_image(&messages));
    }

    // Predicate edge cases: empty list, missing/odd content shapes → false (no
    // panic, no false positive).
    #[test]
    fn messages_have_image_handles_edge_shapes() {
        assert!(!messages_have_image(&[]));
        // No content key.
        assert!(!messages_have_image(&[json!({ "role": "user" })]));
        // content is an object, not an array.
        assert!(!messages_have_image(&[
            json!({ "role": "user", "content": { "type": "image" } })
        ]));
        // A block whose type is not a string.
        assert!(!messages_have_image(&[json!({
            "role": "user",
            "content": [ { "type": 7 } ],
        })]));
        // An image block somewhere in the middle of a longer conversation.
        let convo = vec![
            json!({ "role": "user", "content": "first" }),
            json!({ "role": "assistant", "content": [ { "type": "text", "text": "ok" } ] }),
            json!({ "role": "user", "content": [ { "type": "image", "source": {} } ] }),
        ];
        assert!(messages_have_image(&convo));
    }

    // Capability helper: Claude (incl. concrete model labels) is vision-capable;
    // eri-brain / local are not.
    #[test]
    fn is_vision_capable_only_for_claude() {
        assert!(is_vision_capable("claude"));
        assert!(is_vision_capable("claude-sonnet-4-6"));
        assert!(is_vision_capable("Claude"));
        assert!(!is_vision_capable("eri-brain"));
        assert!(!is_vision_capable("local"));
        assert!(!is_vision_capable("mid"));
    }

    // Vision turn starts at the first vision-capable engine even though eri-brain
    // is index 0 — the cheap engine is never tried, and reaching the vision
    // engine without per-turn escalation emits no escalation events.
    #[tokio::test]
    async fn vision_turn_starts_at_claude_even_with_cheap_engine_first() {
        let mut ladder =
            EngineLadder::new(vec!["eri-brain".into(), "local".into(), "claude".into()]);
        // If the ladder wrongly started at index 0, it would PRODUCE "brain";
        // routing to Claude (index 2) must yield "claude" with no events.
        let plan = [Ok("brain"), Ok("local"), Ok("claude")];
        match ladder
            .run_turn(0, true, attempt_from(&plan), reason_from(&plan))
            .await
        {
            LadderOutcome::Turn(t) => {
                assert_eq!(t.value, "claude", "vision turn must run the vision engine");
                assert!(
                    t.events.is_empty(),
                    "starting on the vision engine is not an escalation"
                );
            }
            _ => panic!("expected the vision engine to produce the turn"),
        }
        // Skipping the cheap engine is not a cheap failure — it must not trip it.
        assert!(!ladder.is_tripped());
    }

    // Index is DERIVED from the list, not hard-coded to 1: with the vision engine
    // at index 1, a vision turn starts there; with it at the end, it starts there.
    #[test]
    fn vision_start_index_is_derived_from_the_engine_list() {
        let mid = EngineLadder::new(vec!["eri-brain".into(), "claude".into(), "local".into()]);
        assert_eq!(mid.start_index(true), 1);
        let end = EngineLadder::new(vec!["eri-brain".into(), "local".into(), "claude".into()]);
        assert_eq!(end.start_index(true), 2);
        // Non-vision turn is unchanged: cheapest engine first.
        assert_eq!(end.start_index(false), 0);
    }

    // A non-vision (text) turn is unchanged: cheap-first, succeeds at index 0.
    #[tokio::test]
    async fn text_turn_is_unchanged_cheap_first() {
        let mut ladder =
            EngineLadder::new(vec!["eri-brain".into(), "local".into(), "claude".into()]);
        let plan = [Ok("brain"), Ok("local"), Ok("claude")];
        match ladder
            .run_turn(0, false, attempt_from(&plan), reason_from(&plan))
            .await
        {
            LadderOutcome::Turn(t) => {
                assert_eq!(t.value, "brain", "text turn runs the cheap engine");
                assert!(t.events.is_empty());
            }
            _ => panic!("expected the cheap engine to produce the turn"),
        }
    }

    // A Claude-only list is unaffected by vision: index 0 is already the vision
    // engine, so a vision turn behaves identically to a text turn.
    #[tokio::test]
    async fn claude_only_list_is_unaffected_by_vision() {
        let mut ladder = EngineLadder::new(vec!["claude".into()]);
        assert!(ladder.has_vision_capable_engine());
        assert_eq!(ladder.start_index(true), 0);
        let plan = [Ok("claude-only")];
        match ladder
            .run_turn(0, true, attempt_from(&plan), reason_from(&plan))
            .await
        {
            LadderOutcome::Turn(t) => {
                assert_eq!(t.value, "claude-only");
                assert!(t.events.is_empty());
            }
            _ => panic!("expected the sole engine to produce the turn"),
        }
    }

    // No vision-capable engine at all: a vision turn falls back to the base
    // (cheap-first) start rather than deadlocking, and never trips.
    #[tokio::test]
    async fn no_vision_engine_falls_back_gracefully() {
        let mut ladder = EngineLadder::new(vec!["eri-brain".into(), "local".into()]);
        assert!(!ladder.has_vision_capable_engine());
        // Falls back to the base start (index 0) for a vision turn.
        assert_eq!(ladder.start_index(true), 0);
        let plan = [Ok("brain"), Ok("local")];
        match ladder
            .run_turn(0, true, attempt_from(&plan), reason_from(&plan))
            .await
        {
            LadderOutcome::Turn(t) => {
                assert_eq!(
                    t.value, "brain",
                    "no vision engine → fall back to cheap-first"
                );
            }
            _ => panic!("expected a produced turn (graceful fallback, no deadlock)"),
        }
        assert!(!ladder.is_tripped());
    }

    // Vision routing respects the trip floor: once the cheap engine is tripped,
    // a vision turn never restarts below the tripped index.
    #[test]
    fn vision_start_index_never_below_trip_floor() {
        // claude at index 0, tripped → base floor is 1; vision must not pull back
        // to 0 below the floor.
        let mut ladder = EngineLadder::new(vec!["claude".into(), "local".into()]);
        // Force the trip state directly to test start_index in isolation.
        ladder.tripped = true;
        assert_eq!(
            ladder.start_index(true),
            1,
            "must not restart below trip floor"
        );
    }
}
