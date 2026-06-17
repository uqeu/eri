/**
 * Learned communication style — eri adapting to how a person *actually* writes,
 * not parroting their last message.
 *
 * The shallow approach ("mirror the register of this message") fails: a user is
 * formal sometimes, casual other times, uses emoji on some texts and not others.
 * Reflecting a single message makes eri lurch. Instead we INGEST the user's
 * messages over time (from `conversation_turns`) and distill an *average* style —
 * typical casing, emoji rate, length, formality — which eri reflects with natural
 * variation. So if you emoji ~40% of the time, eri sometimes does and sometimes
 * doesn't; if you're usually lowercase but occasionally formal, eri trends
 * lowercase but isn't rigid.
 *
 * Pure + unit-tested. Mirrors the device-side Rust style writer so a phone-only
 * user gets the same adaptive voice without the desktop app.
 */

/** Below this many messages there isn't enough signal — return null and let eri
 *  write naturally until it's learned the person. */
export const MIN_MESSAGES_FOR_STYLE = 4;

const EMOJI =
  /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F02F}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{FE0F}\u{2700}-\u{27BF}]/u;

const SLANG = [
  "lol", "lmao", "lmfao", "ngl", "tbh", "idk", "fr", "bro", "bruh", "nah", "yeah",
  "ya", "u", "ur", "rn", "imo", "omg", "wtf", "ikr", "smh", "tysm", "pls", "pls",
];

/** Fraction of items satisfying `pred` (0 when empty). */
function frac<T>(items: T[], pred: (t: T) => boolean): number {
  if (items.length === 0) return 0;
  return items.filter(pred).length / items.length;
}

/** First alphabetic char, or undefined if none. */
function firstAlpha(s: string): string | undefined {
  const m = s.match(/[A-Za-z]/);
  return m?.[0];
}

/**
 * Distill a learned-style descriptor from the user's recent messages, or null if
 * there isn't enough to go on yet. The descriptor is factual (casing, length,
 * emoji rate, formality); the prompt frames how to use it (average + variation).
 */
export function analyzeCommunicationStyle(messages: string[]): string | null {
  const msgs = messages.map((m) => m.trim()).filter((m) => m.length > 0);
  if (msgs.length < MIN_MESSAGES_FOR_STYLE) return null;

  const lowerStart = frac(msgs, (m) => {
    const c = firstAlpha(m);
    return c !== undefined && c === c.toLowerCase();
  });
  const emojiRate = frac(msgs, (m) => EMOJI.test(m));
  const slangRate = frac(msgs, (m) => {
    const words = m.toLowerCase().split(/\s+/);
    return words.some((w) => SLANG.includes(w.replace(/[^a-z]/g, "")));
  });
  const properEnd = frac(msgs, (m) => /[.!?]$/.test(m));
  const avgWords =
    msgs.reduce((n, m) => n + m.split(/\s+/).filter(Boolean).length, 0) / msgs.length;

  const casing =
    lowerStart > 0.6 ? "usually writes in lowercase"
    : lowerStart < 0.2 ? "capitalizes properly"
    : "mixed casing";

  const length =
    avgWords < 6 ? "very short messages"
    : avgWords < 14 ? "fairly short messages"
    : "longer, fuller messages";

  const emoji =
    emojiRate > 0.5 ? `uses emoji often (~${Math.round(emojiRate * 100)}% of messages)`
    : emojiRate > 0.15 ? "uses emoji sometimes"
    : "rarely uses emoji";

  const formality =
    slangRate > 0.3 || lowerStart > 0.6 ? "casual, with slang/contractions"
    : properEnd > 0.7 && lowerStart < 0.2 ? "fairly formal and well-punctuated"
    : "a mix of casual and formal";

  return `${casing}, ${length}, ${emoji}, ${formality}`;
}
