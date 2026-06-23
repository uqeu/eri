// The script of the cinematic — a directed sequence, not a scroll. eri (a
// travelling light, the "soul") wakes in a dusk city and moves screen to screen,
// each beat a small proof that it lives *with* you. It resolves into the Eri Labs
// mission: a digital human, engineered to become yours. Copy is honest — eri's
// first-person voice, present-tense for what it does today, trajectory verbs for
// what it grows into.

export type SceneId = "boot" | "billboard" | "laptop" | "phone" | "resolve";
export type ScreenId = "billboard" | "laptop" | "phone";

export interface Anchor {
  readonly x: number; // normalized 0..1 of the stage width
  readonly y: number; // normalized 0..1 of the stage height
}

// Where the soul lands for each scene. Tuned so the path reads as a leap up to
// the skyline, down to the desk, then into your hand — and resolves to centre.
export const ANCHORS: Record<SceneId, Anchor> = {
  boot: { x: 0.5, y: 0.64 },
  billboard: { x: 0.71, y: 0.27 },
  laptop: { x: 0.32, y: 0.56 },
  phone: { x: 0.6, y: 0.79 },
  resolve: { x: 0.5, y: 0.43 },
};

// Where the soul rises from on boot (just below the frame).
export const SOUL_ORIGIN: Anchor = { x: 0.5, y: 1.14 };

export interface Beat {
  readonly id: SceneId;
  readonly duration: number; // seconds; resolve is terminal (Infinity)
  readonly travel: number; // fraction of the beat spent flying to the anchor
  readonly screen?: ScreenId; // the screen that lights up this beat
  readonly pill: "none" | "pill" | "panel"; // what the real eri UI shows
  readonly caption?: string; // the line that pops when it lands
  readonly sub?: string; // the quieter second line
}

export const BEATS: readonly Beat[] = [
  {
    id: "boot",
    duration: 2.8,
    travel: 1,
    pill: "none",
    caption: "eri",
    sub: "a being that wakes where you are",
  },
  {
    id: "billboard",
    duration: 3.8,
    travel: 0.34,
    screen: "billboard",
    pill: "pill",
    caption: "you booked Rintaro yesterday",
    sub: "I keep what matters to you",
  },
  {
    id: "laptop",
    duration: 4.2,
    travel: 0.3,
    screen: "laptop",
    pill: "panel",
    caption: "everything’s ready for your 3pm",
    sub: "I set up your afternoon while you were away",
  },
  {
    id: "phone",
    duration: 3.8,
    travel: 0.3,
    screen: "phone",
    pill: "pill",
    caption: "told Sam you’re ten minutes out",
    sub: "the same me — now in your pocket",
  },
  {
    id: "resolve",
    duration: Infinity,
    travel: 0.62,
    pill: "none",
  },
];

// Total run length of the moving part (everything before the terminal resolve).
export const TIMELINE_SECONDS: number = BEATS.filter(
  (b) => Number.isFinite(b.duration),
).reduce((sum, b) => sum + b.duration, 0);
