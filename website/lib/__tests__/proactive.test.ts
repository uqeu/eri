import { strict as assert } from "node:assert";
import {
  decideGate,
  isQuietHour,
  MAX_PER_DAY,
  MIN_GAP_MS,
  proactiveEnabled,
  type GateState,
} from "../proactive/gate";
import { composeProactivePrompt, isSkip, SKIP_SENTINEL } from "../proactive/compose";
import { detectTriggers, detectUpcomingMeetings, detectUrgentEmails } from "../proactive/detect";
import { dispatchProactive, type ProactiveDeps } from "../proactive/dispatch";
import type { ProactiveTrigger } from "../proactive/types";

const NOON = Date.UTC(2026, 5, 15, 16, 0, 0); // arbitrary "now"

function trigger(over: Partial<ProactiveTrigger> = {}): ProactiveTrigger {
  return { kind: "urgent_email", summary: "an urgent email", confidence: 0.8, dedupeKey: "email:1", ...over };
}

function gateState(over: Partial<GateState> = {}): GateState {
  return { nowMs: NOON, lastSentMs: null, sentTodayCount: 0, alreadySent: false, localHour: 14, ...over };
}

// ---- gate -----------------------------------------------------------------
{
  assert.equal(decideGate(trigger(), gateState()).send, true, "clean trigger sends");
  assert.equal(decideGate(trigger(), gateState({ alreadySent: true })).reason, "duplicate");
  assert.equal(decideGate(trigger({ confidence: 0.4 }), gateState()).reason, "low_confidence");
  assert.equal(decideGate(trigger(), gateState({ localHour: 23 })).reason, "quiet_hours");
  assert.equal(decideGate(trigger(), gateState({ localHour: 3 })).reason, "quiet_hours");
  assert.equal(decideGate(trigger(), gateState({ sentTodayCount: MAX_PER_DAY })).reason, "daily_cap");
  assert.equal(
    decideGate(trigger(), gateState({ lastSentMs: NOON - MIN_GAP_MS + 1000 })).reason,
    "too_soon",
    "a recent send blocks the next",
  );
  assert.equal(
    decideGate(trigger(), gateState({ lastSentMs: NOON - MIN_GAP_MS - 1000 })).send,
    true,
    "past the gap, it sends again",
  );
  // quiet-hours wrap
  assert.ok(isQuietHour(22) && isQuietHour(7) && !isQuietHour(8) && !isQuietHour(21));
}

// ---- compose --------------------------------------------------------------
{
  const p = composeProactivePrompt(trigger({ summary: "a meeting in 10 min" }));
  assert.ok(p.includes("a meeting in 10 min"), "prompt carries the summary");
  assert.ok(p.includes(SKIP_SENTINEL), "prompt offers the SKIP escape hatch");
  assert.ok(isSkip("  skip ") && isSkip("SKIP") && !isSkip("on it"));
}

// ---- detectors ------------------------------------------------------------
{
  const urgent = detectUrgentEmails([
    { id: "a", from: "Boss", subject: "URGENT: sign by today", receivedMs: NOON },
    { id: "b", from: "News", subject: "weekly digest", receivedMs: NOON },
  ]);
  assert.equal(urgent.length, 1, "only the time-sensitive email triggers");
  assert.equal(urgent[0].dedupeKey, "email:a");
  assert.ok(urgent[0].confidence >= 0.6);

  const meetings = detectUpcomingMeetings(
    [
      { id: "m1", title: "Standup", startMs: NOON + 10 * 60_000 }, // in 10 min → trigger
      { id: "m2", title: "Later", startMs: NOON + 5 * 60_000 * 60 }, // hours away → no
      { id: "m3", title: "Past", startMs: NOON - 60_000 }, // already started → no
    ],
    NOON,
  );
  assert.equal(meetings.length, 1);
  assert.equal(meetings[0].dedupeKey, "event:m1");

  const all = detectTriggers(
    { emails: [{ id: "a", from: "B", subject: "deadline ASAP", receivedMs: NOON }], events: [] },
    NOON,
  );
  assert.ok(all.length === 1 && all[0].confidence >= all.at(-1)!.confidence, "sorted by confidence");

  // equal-confidence triggers get a deterministic order (stable secondary sort
  // on dedupeKey) — two meetings are both confidence 0.8, so order can't be left
  // to the engine's sort.
  const tie = detectTriggers(
    {
      emails: [],
      events: [
        { id: "z", title: "Z meeting", startMs: NOON + 10 * 60_000 },
        { id: "a", title: "A meeting", startMs: NOON + 10 * 60_000 },
      ],
    },
    NOON,
  );
  assert.equal(tie.length, 2);
  assert.equal(tie[0].confidence, tie[1].confidence, "both triggers tie on confidence");
  assert.deepEqual(
    tie.map((t) => t.dedupeKey),
    ["event:a", "event:z"],
    "equal-confidence triggers are ordered deterministically by dedupeKey",
  );
}

// ---- dispatch branches ----------------------------------------------------
function deps(over: Partial<ProactiveDeps> = {}): ProactiveDeps {
  return {
    gateState: async () => gateState(),
    loadProfile: async () => ({ profile: null, dynamicContext: "" }),
    resolvePhone: async () => "+15551234567",
    runTurn: async () => ({ text: "heads up — that email needs you today", tokensIn: 10, tokensOut: 8, model: "claude" }),
    send: async () => true,
    recordSent: async () => {},
    ...over,
  };
}

(async () => {
  // happy path → sent, and recordSent fires exactly once
  let recorded = 0;
  const sent = await dispatchProactive("u1", trigger(), deps({ recordSent: async () => { recorded++; } }));
  assert.equal(sent.branch, "sent");
  assert.ok(sent.text && sent.meter, "sent carries text + meter");
  assert.equal(recorded, 1, "records the send for dedupe/rate-limit");

  // gated → never runs the model, never records
  let ran = false;
  const gated = await dispatchProactive(
    "u1",
    trigger(),
    deps({ gateState: async () => gateState({ alreadySent: true }), runTurn: async () => { ran = true; throw new Error("should not run"); } }),
  );
  assert.equal(gated.branch, "gated");
  assert.equal(gated.reason, "duplicate");
  assert.equal(ran, false, "gated triggers never touch the model");

  // model SKIP → skipped, no send
  let sends = 0;
  const skipped = await dispatchProactive(
    "u1",
    trigger(),
    deps({ runTurn: async () => ({ text: "SKIP", tokensIn: 5, tokensOut: 1, model: "claude" }), send: async () => { sends++; return true; } }),
  );
  assert.equal(skipped.branch, "skipped");
  assert.equal(sends, 0, "a SKIP is never sent");
  assert.ok(skipped.meter, "but the model tokens are still metered");

  // no verified phone → no_phone, and the (paid) model never runs, so no meter
  let modelRan = false;
  const noPhone = await dispatchProactive(
    "u1",
    trigger(),
    deps({
      resolvePhone: async () => null,
      runTurn: async () => { modelRan = true; throw new Error("should not run"); },
    }),
  );
  assert.equal(noPhone.branch, "no_phone");
  assert.equal(modelRan, false, "no phone → never bill the model");
  assert.equal(noPhone.meter, undefined, "no phone → nothing to meter");

  // send failure → errored, NOT recorded (so it can retry next sweep)
  let rec2 = 0;
  const failed = await dispatchProactive(
    "u1",
    trigger(),
    deps({ send: async () => false, recordSent: async () => { rec2++; } }),
  );
  assert.equal(failed.branch, "errored");
  assert.equal(rec2, 0, "a dropped send is not recorded");

  // a thrown dep → errored, never crashes the sweep
  const threw = await dispatchProactive("u1", trigger(), deps({ loadProfile: async () => { throw new Error("db down"); } }));
  assert.equal(threw.branch, "errored");

  // Kill-switch: enabled by default (unset/blank/true), OFF only for an explicit
  // falsey value — so setting PROACTIVE_ENABLED=false stops the sweep with no deploy.
  assert.equal(proactiveEnabled(undefined), true, "unset → enabled (no behavior change)");
  assert.equal(proactiveEnabled(""), true, "blank → enabled");
  assert.equal(proactiveEnabled("true"), true);
  assert.equal(proactiveEnabled("1"), true);
  for (const off of ["false", "FALSE", "0", "off", "no", " false "]) {
    assert.equal(proactiveEnabled(off), false, `"${off}" stops the sweep`);
  }

  console.log("proactive.test.ts: all assertions passed");
})();
