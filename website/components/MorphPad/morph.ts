// Pure morph model for the homepage pad. No React, no DOM — just the data and
// the tiny state functions, so the behaviour is unit-tested independently of
// rendering. One brain, two modes: Control (use eri to run your computer) and
// Build (use eri to build software). Research / eyes / voice / memory are
// facets the brain shows *inside* Control, not separate rows.

export type Mode = "control" | "build";

export const MODES = ["control", "build"] as const;

export interface ModeDims {
  /** Max pad width in px at desktop — Build is the massive IDE. */
  readonly maxWidth: number;
  /** Floor height the body morphs to in px. */
  readonly minHeight: number;
}

// The morph has to be *dramatic*: Build roughly doubles the pad in both axes.
const DIMS: Record<Mode, ModeDims> = {
  control: { maxWidth: 560, minHeight: 300 },
  build: { maxWidth: 1080, minHeight: 600 },
};

export function dimensionsFor(mode: Mode): ModeDims {
  return DIMS[mode];
}

export function nextMode(mode: Mode): Mode {
  return mode === "control" ? "build" : "control";
}

// One-line caption that morphs with the pad, reinforcing the two-mode story.
export const CAPTION: Record<Mode, string> = {
  control: "Control — it runs your real apps, hands-free.",
  build: "Build — it expands into a full editor that ships.",
};

// The autoplay reel: a few Control beats, then the Build IDE, looping. Build
// recurs so the showpiece is never more than a couple of beats away.
export type Slide = { readonly mode: "control"; readonly facet: number } | { readonly mode: "build" };

export const TIMELINE: readonly Slide[] = [
  { mode: "control", facet: 0 },
  { mode: "control", facet: 1 },
  { mode: "build" },
  { mode: "control", facet: 2 },
  { mode: "control", facet: 3 },
  { mode: "build" },
];

export const HOLD_MS: Record<Mode, number> = { control: 3800, build: 5600 };

/** Index of the first slide for a mode — where the segmented control jumps to. */
export function firstSlideOf(mode: Mode): number {
  return TIMELINE.findIndex((s) => s.mode === mode);
}

// ── Control: the brain operating your computer. Each facet folds in one of the
// "supporting" capabilities (act / ask=research+eyes / voice) so they read as
// one surface doing many things, not six pads. ──

export type ControlKind = "act" | "ask" | "voice";

export interface ControlFacet {
  readonly kind: ControlKind;
  /** What you say / type to eri. */
  readonly request: string;
  /** Tiny actuation chips — the literal steps eri took on your machine. */
  readonly actions: readonly string[];
  /** eri's spoken-style result. */
  readonly answer: string;
  /** Optional ambient note — what it saw on screen or remembered about you. */
  readonly note?: string;
}

export const CONTROL_FACETS: readonly ControlFacet[] = [
  {
    kind: "act",
    request: "open Spotify and play my Deep Focus playlist",
    actions: ["opened Spotify", "found Deep Focus", "▶ playing"],
    answer: "Playing Deep Focus — 46 tracks, shuffled.",
    note: "It drove the real app, not a plugin.",
  },
  {
    kind: "ask",
    request: "what's this error on my screen?",
    actions: ["read your screen", "traced it", "recalled March"],
    answer:
      "Null deref at Header.tsx:42 — theme is undefined on first paint. You hit this exact one in March.",
    note: "It saw the stack trace you were looking at and remembered the fix.",
  },
  {
    kind: "voice",
    request: "reply to priya, umm, i'll send the deck friday",
    actions: ["heard you", "cleaned on-device", "drafted"],
    answer: "“I'll send the deck Friday.” — drafted in Mail, waiting on you to send.",
    note: "Fillers removed, punctuation added, all on your machine.",
  },
  {
    kind: "act",
    request: "force-quit the app that's hogging my fans",
    actions: ["checked Activity", "found the culprit", "quit it"],
    answer: "Quit Chrome Helper (GPU) — it was pinning a core. Fans already easing off.",
    note: "Anything risky, it asks first. One hotkey stops it cold.",
  },
];

export function advanceFacet(i: number): number {
  return (i + 1) % CONTROL_FACETS.length;
}

// ── Build: the showpiece. The pad expands into a real IDE. ──

export interface BuildScene {
  readonly request: string;
  readonly files: readonly { readonly name: string; readonly active?: boolean; readonly edited?: boolean }[];
  readonly activeFile: string;
  /** Real-looking code, line by line. Lines flagged `add` render as eri's edit. */
  readonly code: readonly { readonly text: string; readonly add?: boolean }[];
  readonly preview: string;
  readonly tests: string;
  readonly plan: readonly string[];
}

export const BUILD: BuildScene = {
  request: "add a dark-mode toggle and persist the choice",
  files: [
    { name: "app/", },
    { name: "  layout.tsx" },
    { name: "components/" },
    { name: "  Header.tsx", active: true, edited: true },
    { name: "  ThemeToggle.tsx", edited: true },
    { name: "lib/" },
    { name: "  theme.ts", edited: true },
  ],
  activeFile: "components/Header.tsx",
  code: [
    { text: "import { ThemeToggle } from \"./ThemeToggle\";", add: true },
    { text: "" },
    { text: "export function Header() {" },
    { text: "  return (" },
    { text: "    <header className=\"flex items-center justify-between\">" },
    { text: "      <Logo />" },
    { text: "      <nav className=\"flex items-center gap-4\">" },
    { text: "        <NavLinks />" },
    { text: "        <ThemeToggle />", add: true },
    { text: "      </nav>" },
    { text: "    </header>" },
    { text: "  );" },
    { text: "}" },
  ],
  preview: "Toggle wired — switching the whole app, choice saved to localStorage.",
  tests: "12 passed in 0.4s",
  plan: [
    "Read Header.tsx and theme.ts",
    "Add <ThemeToggle/> + a persisted preference",
    "Run the suite — 12 passed",
  ],
};
