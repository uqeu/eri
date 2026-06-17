/**
 * Natural confirmation detection for phone eri (review H1).
 *
 * When eri asks "just checking — want me to go ahead?", the user replies however
 * they naturally would ("go", "do it", "yeah", "confirm", "sounds good", 👍) —
 * not a robotic "YES". These match a message that is, on its own, an affirmation
 * or a refusal (anchored, so a normal sentence containing "no" isn't a refusal).
 * Pure + unit-tested.
 */

const AFFIRM =
  /^\s*(y|ya|yea|yeah|yep|yup|yes|y's|sure|ok|okay|k|kk|go|go ahead|go for it|do it|do that|confirm|confirmed|please|please do|yes please|sounds good|sgtm|looks good|perfect|great|absolutely|definitely|for sure|let'?s go|send it|👍|👍🏻|👍🏼|👍🏽|👍🏾|👍🏿|🙏|✅)\s*[.!\s]*$/i;

const NEGATE =
  /^\s*(n|no|no thanks|nope|nah|naw|don'?t|do not|stop|cancel|cancelled|nevermind|never mind|abort|forget it|skip it|not now|no don'?t|👎|❌|🛑)\s*[.!\s]*$/i;

/** True when the whole message is a natural "yes, go ahead". */
export function isAffirmation(text: string): boolean {
  return AFFIRM.test(text.trim());
}

/** True when the whole message is a natural "no / cancel". */
export function isNegation(text: string): boolean {
  return NEGATE.test(text.trim());
}

// Cues that the user is CORRECTING eri's previous reply (a negative behavioral
// signal for KTO). Distinct from a bare "no" to a pending confirmation.
const CORRECTION =
  /\b(that'?s (wrong|not right|incorrect|not it)|not what i (meant|said|asked)|i meant|i didn'?t (mean|ask)|you'?re wrong|that'?s not what|actually,? (no|that'?s)|wrong answer|incorrect)\b/i;

/**
 * True when the message reads as a correction of eri's previous answer (a
 * negative signal — eri got it wrong). Includes a plain negation OR an explicit
 * correction cue. Used to label the prior reply for the KTO training signal.
 */
export function isCorrection(text: string): boolean {
  const t = text.trim();
  return isNegation(t) || CORRECTION.test(t);
}
