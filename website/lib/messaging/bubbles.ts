/**
 * Multi-bubble dispatch — eri texting like a person, not a paragraph.
 *
 * A real texter sometimes fires 2–3 quick bubbles, sometimes one terse line. The
 * voice mirror (eri = relative to YOU) means matching that RHYTHM, not just the
 * register. The model is told (system prompt) to separate distinct bubbles with a
 * BLANK LINE when the user texts in bursts; this splits on those blank lines,
 * capped at `maxBubbles` (overflow merges into the last), then length-chunks each
 * bubble as a safety net. The transport already sends each returned string as its
 * own iMessage bubble, so this is the whole "send N" mechanism.
 *
 * `maxBubbles <= 1` reproduces the single-message behavior EXACTLY (strip markdown
 * + length-chunk), so a terse user — or a reply with no cadence facet yet — is
 * completely unaffected. Pure + unit-tested.
 */

import { chunkMessage, formatReply, stripMarkdown, MAX_CHUNK_CHARS } from "@/lib/imessage/format";

/** Hard ceiling on bubbles per reply — even a bursty user never gets a wall of texts. */
export const MAX_BUBBLES = 4;

/**
 * Split a model reply into ordered iMessage bubbles, honoring the cadence facet.
 * `maxBubbles` is the per-user cap (1 = terse single reply). Returns chunks the
 * transport sends in order, one bubble each.
 */
export function splitIntoBubbles(text: string, maxBubbles: number = 1): string[] {
  const cap = Math.max(1, Math.min(Math.floor(maxBubbles) || 1, MAX_BUBBLES));
  // Terse user / no facet → today's behavior, byte-for-byte (one logical message).
  if (cap <= 1) return formatReply(text);

  const plain = stripMarkdown(text);
  // The model marks intended bubble breaks with a blank line; honor only those, so
  // ordinary prose with single newlines is never chopped into stutter.
  const pieces = plain
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  // No explicit breaks → one message (don't invent bubbles the model didn't intend).
  if (pieces.length <= 1) return formatReply(text);

  // Cap: keep the first cap-1 bubbles, fold any overflow back into the last so we
  // never exceed the ceiling and never silently drop the tail of a reply.
  const bubbles =
    pieces.length <= cap
      ? pieces
      : [...pieces.slice(0, cap - 1), pieces.slice(cap - 1).join("\n\n")];

  // Length-safety within each bubble (a long one still splits); flatten + drop empties.
  return bubbles
    .flatMap((b) => chunkMessage(b, MAX_CHUNK_CHARS))
    .filter((s) => s.trim().length > 0);
}
