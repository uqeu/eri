/**
 * Reply formatting for phone eri (ADR-0002).
 *
 * iMessage renders plain text — markdown syntax shows up as literal `**` / `` ` ``
 * noise — and a single message can't be arbitrarily long. So a model reply is
 * (1) stripped of the markdown eri normally emits, then (2) chunked into ordered
 * pieces small enough to send. Pure + unit-tested; the provider just sends the
 * chunks in order.
 */

/** Sendblue/iMessage send well under a couple thousand chars; keep a safe margin. */
export const MAX_CHUNK_CHARS = 1500;

/** Strip the markdown eri emits down to plain text for iMessage. */
export function stripMarkdown(text: string): string {
  return (
    text
      // fenced code blocks → keep the inner code, drop the fences
      .replace(/```[a-zA-Z0-9]*\n?([\s\S]*?)```/g, (_m, code) => String(code).trim())
      // inline code `x` → x
      .replace(/`([^`]+)`/g, "$1")
      // bold/italic **x** *x* __x__ _x_ → x
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/(^|[^a-zA-Z0-9])_([^_]+)_/g, "$1$2")
      // links [text](url) → text (url)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
      // headings / blockquotes at line start → drop the marker
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s{0,3}>\s?/gm, "")
      // collapse 3+ newlines to a paragraph break
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * Split `text` into ordered chunks no longer than `max`, breaking on the
 * friendliest available boundary (paragraph → newline → sentence → word), and
 * hard-splitting only a single token that itself exceeds `max`.
 */
export function chunkMessage(text: string, max: number = MAX_CHUNK_CHARS): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed.length ? [trimmed] : [];

  const chunks: string[] = [];
  let rest = trimmed;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    // Prefer the latest boundary inside the window, in descending niceness.
    const boundary =
      lastIndexOfAny(window, ["\n\n", "\n", ". ", "! ", "? ", " "]) ?? -1;
    const cut = boundary > 0 ? boundary + 1 : max; // +1 keeps the delimiter with the chunk
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest.length) chunks.push(rest);
  return chunks;
}

/** Highest index at which any of `needles` occurs in `s`, or null if none. */
function lastIndexOfAny(s: string, needles: string[]): number | null {
  let best = -1;
  for (const n of needles) {
    const i = s.lastIndexOf(n);
    if (i > best) best = i;
  }
  return best >= 0 ? best : null;
}

/** Strip markdown then chunk — the full reply pipeline. */
export function formatReply(text: string, max: number = MAX_CHUNK_CHARS): string[] {
  return chunkMessage(stripMarkdown(text), max);
}
