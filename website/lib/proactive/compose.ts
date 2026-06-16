/**
 * Compose the user-turn prompt for a proactive nudge (pure).
 *
 * The system prompt already carries eri's persona + the user's Tier-A profile +
 * communication_style, so the model writes the heads-up in the user's own voice.
 * We deliberately give the model a SKIP escape hatch — a second, judgment-based
 * gate on top of the deterministic one: even if a trigger clears the gate, the
 * model can decide it isn't actually worth interrupting the user and reply SKIP.
 */

import type { ProactiveTrigger } from "./types";

/** Exact token the model returns when it judges the nudge not worth sending. */
export const SKIP_SENTINEL = "SKIP";

export function composeProactivePrompt(trigger: ProactiveTrigger): string {
  return [
    `[proactive heads-up] You just noticed: ${trigger.summary}`,
    "",
    "If this is genuinely worth a short text to them RIGHT NOW, write ONLY that text —",
    "in their voice, one or two lines, like a sharp friend would. No preamble, no sign-off,",
    "no 'just checking in'. Make it useful, not noise.",
    `If it is NOT worth interrupting them, reply with exactly: ${SKIP_SENTINEL}`,
  ].join("\n");
}

/** The model declined to send (its soft gate). */
export function isSkip(text: string): boolean {
  return text.trim().toUpperCase() === SKIP_SENTINEL;
}
