/**
 * Anti-annoyance gate for proactive nudges (pure).
 *
 * The single most important thing about texting someone first is NOT doing it
 * too much. This is the deterministic floor: confidence threshold, hard daily
 * cap, minimum gap between nudges, quiet hours, and never re-sending the same
 * signal. A second, softer gate is the model's own SKIP judgment (see compose).
 * Mirrors the spirit of the Rust `proactive::MIN_CONFIDENCE` floor.
 */

import type { ProactiveTrigger } from "./types";

/** Below this, a detector isn't sure enough to interrupt the user. */
export const MIN_CONFIDENCE = 0.6;
/** At least this long between two proactive texts, so eri never spams. */
export const MIN_GAP_MS = 60 * 60 * 1000; // 1 hour
/** Hard ceiling on proactive texts per rolling day. */
export const MAX_PER_DAY = 4;
/** Quiet window (local hour, wraps midnight): [22:00, 24:00) ∪ [00:00, 08:00). */
export const QUIET_START_HOUR = 22;
export const QUIET_END_HOUR = 8;

export interface GateState {
  /** Now, epoch ms (injected so the gate is deterministic + testable). */
  nowMs: number;
  /** When eri last sent this user ANY proactive text; null if never. */
  lastSentMs: number | null;
  /** How many proactive texts eri has sent this user in the last rolling day. */
  sentTodayCount: number;
  /** True if this exact signal (dedupeKey) was already nudged. */
  alreadySent: boolean;
  /** The user's LOCAL hour 0..23 (caller resolves timezone). */
  localHour: number;
}

export interface GateDecision {
  send: boolean;
  /** Stable reason code — logged + asserted in tests. */
  reason:
    | "ok"
    | "duplicate"
    | "low_confidence"
    | "quiet_hours"
    | "daily_cap"
    | "too_soon";
}

/** True inside the quiet window (handles the midnight wrap). */
export function isQuietHour(hour: number): boolean {
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
}

/**
 * Emergency kill-switch for the whole proactive sweep. Enabled by DEFAULT (env
 * unset/blank) so behavior is unchanged; setting `PROACTIVE_ENABLED` to a falsey
 * value ("false"/"0"/"off"/"no") STOPS the cron instantly with no code deploy —
 * the route short-circuits to a 200 no-op, so no Gmail/Composio fetch runs at all.
 */
export function proactiveEnabled(value: string | undefined): boolean {
  if (value == null) return true;
  const v = value.trim().toLowerCase();
  return !(v === "false" || v === "0" || v === "off" || v === "no");
}

/** Decide whether a single trigger may be sent right now. Pure. */
export function decideGate(trigger: ProactiveTrigger, state: GateState): GateDecision {
  if (state.alreadySent) return { send: false, reason: "duplicate" };
  if (trigger.confidence < MIN_CONFIDENCE) return { send: false, reason: "low_confidence" };
  if (isQuietHour(state.localHour)) return { send: false, reason: "quiet_hours" };
  if (state.sentTodayCount >= MAX_PER_DAY) return { send: false, reason: "daily_cap" };
  if (state.lastSentMs !== null && state.nowMs - state.lastSentMs < MIN_GAP_MS) {
    return { send: false, reason: "too_soon" };
  }
  return { send: true, reason: "ok" };
}
