// Pure helper for voice "view-control" intents — zoom / scroll / navigate.
// Stays free of vscode imports so we can table-test the classifier
// without an extension host. Terminal-control intents continue to live
// in intentMatcher.ts; this file only handles the new ordering on
// transcripts like "show me the hero headline" that would otherwise be
// swallowed by the FOCUS_VERBS list.

export type ViewIntentKind = "zoom" | "scroll" | "navigate";
export type ScrollDirection = "up" | "down" | "left" | "right";
export type Magnitude = "small" | "big";

export interface ZoomIntent {
  readonly kind: "zoom";
  readonly direction: "in" | "out";
  readonly magnitude: Magnitude;
}

export interface ScrollIntent {
  readonly kind: "scroll";
  readonly direction: ScrollDirection;
  readonly magnitude: Magnitude;
}

export interface NavigateIntent {
  readonly kind: "navigate";
  /** Free-form target string — caller resolves to file/symbol/DOM/Quick Pick. */
  readonly target: string;
}

export type ViewIntent = ZoomIntent | ScrollIntent | NavigateIntent;

const ZOOM_TRIGGERS = ["zoom", "magnify", "shrink"];
const SCROLL_TRIGGERS = ["scroll", "pan"];
// Navigate verbs (show / reveal / go / jump / find / open) intersect with
// FOCUS_VERBS in intentMatcher.ts; the dispatcher must check view intents
// FIRST so "show me the hero headline" doesn't get treated as terminal
// focus when the user is pointing at the preview. Matching is done via
// NAVIGATE_LEAD_PATTERNS below rather than a flat list.

const BIG_CUES = ["a lot", "lots", "way", "really", "much", "loads", "all the way", "to the bottom", "to the top"];
const SMALL_CUES = ["a little", "a bit", "slightly", "small", "just a bit"];

const NAVIGATE_OBJECTS = ["headline", "section", "function", "symbol", "file", "component"];

const NAVIGATE_LEAD_PATTERNS = [
  /\b(?:show|reveal|go to|jump to|find|open|navigate to)\s+(?:me\s+)?(?:the\s+)?(.+?)\s*$/i,
  /\b(?:take me to|bring me to)\s+(?:the\s+)?(.+?)\s*$/i,
];

/**
 * Classify a transcript as a view intent. Returns null if the transcript
 * doesn't unambiguously look like a view-control instruction.
 *
 * IMPORTANT — callers must check the result of this function BEFORE
 * `matchTerminalIntent`, because "show me the hero headline" would
 * otherwise be classified as a terminal focus intent via FOCUS_VERBS.
 */
export function matchViewIntent(rawTranscript: string): ViewIntent | null {
  const raw = (rawTranscript ?? "").trim();
  if (raw.length === 0) return null;
  const transcript = raw.toLowerCase();

  const magnitude = detectMagnitude(transcript);

  if (matchesAny(transcript, ZOOM_TRIGGERS) || transcript.startsWith("make it bigger") || transcript.startsWith("make it smaller")) {
    const direction = detectZoomDirection(transcript);
    if (!direction) return null;
    return { kind: "zoom", direction, magnitude };
  }

  if (matchesAny(transcript, SCROLL_TRIGGERS) || transcript.startsWith("go to the bottom") || transcript.startsWith("go to the top")) {
    const direction = detectScrollDirection(transcript);
    if (!direction) return null;
    return { kind: "scroll", direction, magnitude };
  }

  const nav = tryParseNavigate(raw, transcript);
  if (nav) return nav;

  return null;
}

function detectZoomDirection(transcript: string): "in" | "out" | null {
  if (/\bzoom\s+in\b|\bmagnify\b|\bbigger\b|\bcloser\b/.test(transcript)) {
    return "in";
  }
  if (/\bzoom\s+out\b|\bshrink\b|\bsmaller\b|\bback\s+out\b/.test(transcript)) {
    return "out";
  }
  return null;
}

function detectScrollDirection(transcript: string): ScrollDirection | null {
  if (/\b(?:scroll\s+)?down\b|\bbottom\b/.test(transcript)) return "down";
  if (/\b(?:scroll\s+)?up\b|\btop\b/.test(transcript)) return "up";
  if (/\b(?:scroll\s+)?left\b/.test(transcript)) return "left";
  if (/\b(?:scroll\s+)?right\b/.test(transcript)) return "right";
  return null;
}

function detectMagnitude(transcript: string): Magnitude {
  if (matchesAny(transcript, BIG_CUES)) return "big";
  if (matchesAny(transcript, SMALL_CUES)) return "small";
  // Default to small — most "scroll down" / "zoom in" requests are subtle.
  return "small";
}

function matchesAny(text: string, needles: ReadonlyArray<string>): boolean {
  return needles.some((needle) => text.includes(needle));
}

function tryParseNavigate(rawTranscript: string, lowerTranscript: string): NavigateIntent | null {
  // Reject transcripts that look like terminal-focus commands
  // ("show me the dev terminal"). Heuristic: if the target tail mentions
  // "terminal" / "shell" / "console" we treat it as terminal focus.
  for (const pattern of NAVIGATE_LEAD_PATTERNS) {
    const lowerMatch = pattern.exec(lowerTranscript);
    if (!lowerMatch) continue;
    const rawMatch = pattern.exec(rawTranscript);
    const lowerTail = lowerMatch[1]?.trim();
    const rawTail = (rawMatch?.[1] ?? lowerMatch[1])?.trim();
    if (!lowerTail || !rawTail) continue;
    if (/\b(terminal|shell|console|repl)\b/.test(lowerTail)) {
      return null;
    }
    // Require the target to look like a navigation candidate: either a
    // file name (extension or path-like), a code symbol, a navigate
    // object noun, or a quoted phrase. Otherwise we'd swallow generic
    // chat like "show me what you did".
    if (
      /\.[a-z0-9]{1,6}\b/i.test(lowerTail) ||      // looks like a file
      /[a-z][A-Z]/.test(rawTail) ||                 // camelCase symbol
      matchesAny(lowerTail, NAVIGATE_OBJECTS) ||
      /["']/.test(rawTail)
    ) {
      return { kind: "navigate", target: stripTrailingPunctuation(rawTail) };
    }
    return null;
  }
  return null;
}

function stripTrailingPunctuation(s: string): string {
  return s.replace(/[.?!,;]+$/, "").trim();
}

/**
 * Helper for terminals/voice.ts: did this transcript look like a view
 * intent? Lets the caller short-circuit terminal classification when so.
 */
export function looksLikeViewIntent(rawTranscript: string): boolean {
  return matchViewIntent(rawTranscript) !== null;
}
