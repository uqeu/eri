/**
 * Proactive iMessage loop — shared types (Phase: proactive outbound).
 *
 * eri's competitors all "text you first"; this is eri's version. A background
 * sweep detects signals (urgent email, imminent meeting, looming deadline),
 * turns each into a `ProactiveTrigger`, gates it (anti-annoyance), and — if it
 * clears — composes an eri-voice heads-up and sends it over iMessage. The brain
 * (gate/compose/detect/dispatch) is pure + injected so it's unit-tested without
 * a DB, the model, or Sendblue; the cron route is the only transport.
 */

export type ProactiveKind = "urgent_email" | "upcoming_meeting" | "deadline";

export interface ProactiveTrigger {
  kind: ProactiveKind;
  /** Short human summary of what eri noticed — feeds the compose prompt. */
  summary: string;
  /** 0..1 — the detector's confidence this is worth interrupting the user. */
  confidence: number;
  /** Stable key for one underlying signal, so it's never nudged twice. */
  dedupeKey: string;
}
