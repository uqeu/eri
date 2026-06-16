/**
 * Signal → trigger detectors (pure).
 *
 * Given raw signals (recent emails, upcoming calendar events) these decide what,
 * if anything, is worth a proactive nudge and with what confidence. Kept pure +
 * provider-agnostic: the cron fetches signals (Gmail/Calendar via the connectors)
 * and hands them here, so the *judgment* is unit-tested without any live API.
 */

import type { ProactiveTrigger } from "./types";

export interface EmailSignal {
  id: string;
  from: string;
  subject: string;
  snippet?: string;
  /** epoch ms received */
  receivedMs: number;
}

export interface CalendarSignal {
  id: string;
  title: string;
  /** epoch ms the event starts */
  startMs: number;
}

/** Phrases that mark an email as time-sensitive. Lowercased match. */
const URGENT_PHRASES = [
  "urgent",
  "asap",
  "as soon as possible",
  "time-sensitive",
  "time sensitive",
  "deadline",
  "due today",
  "due tomorrow",
  "action required",
  "final notice",
  "expires today",
  "responde",
];

/** Detect time-sensitive emails. Confidence rises with the number of cues. */
export function detectUrgentEmails(emails: EmailSignal[]): ProactiveTrigger[] {
  const triggers: ProactiveTrigger[] = [];
  for (const email of emails) {
    const hay = `${email.subject} ${email.snippet ?? ""}`.toLowerCase();
    const hits = URGENT_PHRASES.filter((phrase) => hay.includes(phrase));
    if (hits.length === 0) continue;
    triggers.push({
      kind: "urgent_email",
      summary: `an email from ${email.from} — "${email.subject}" — looks time-sensitive`,
      confidence: Math.min(0.6 + 0.15 * hits.length, 0.95),
      dedupeKey: `email:${email.id}`,
    });
  }
  return triggers;
}

/** Lead time (minutes) before a meeting that we'd nudge about. */
export const MEETING_LEAD_MIN = 30;

/** Detect meetings starting within the lead window. */
export function detectUpcomingMeetings(
  events: CalendarSignal[],
  nowMs: number,
): ProactiveTrigger[] {
  const triggers: ProactiveTrigger[] = [];
  for (const event of events) {
    const minutesUntil = (event.startMs - nowMs) / 60_000;
    if (minutesUntil <= 0 || minutesUntil > MEETING_LEAD_MIN) continue;
    triggers.push({
      kind: "upcoming_meeting",
      summary: `"${event.title}" starts in about ${Math.round(minutesUntil)} min`,
      confidence: 0.8,
      dedupeKey: `event:${event.id}`,
    });
  }
  return triggers;
}

/** All detectors over one user's fetched signals, highest-confidence first. */
export function detectTriggers(
  signals: { emails: EmailSignal[]; events: CalendarSignal[] },
  nowMs: number,
): ProactiveTrigger[] {
  return [
    ...detectUrgentEmails(signals.emails),
    ...detectUpcomingMeetings(signals.events, nowMs),
  ].sort(
    // Highest confidence first; break ties on dedupeKey so equal-confidence
    // triggers have a deterministic order (Array.sort isn't guaranteed stable
    // across engines, and the cron picks the top trigger).
    (a, b) => b.confidence - a.confidence || a.dedupeKey.localeCompare(b.dedupeKey),
  );
}
