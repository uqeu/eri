"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

// EriWorkbench — an interactive workbench demo of the eri loop.
//
// Three files, three scene decks: a pricing card (interactive toggle), an
// analytics dashboard (KPIs + sparkline + bar chart), and a forecast chart
// (confidence band + draggable prediction point). Each file's auto-loop walks
// through ~4 voice-driven edits. Click any preview to pause; 5s of idle and
// the loop resumes.

const STEP_MS = 4200;
const TICK_MS = 90;
const STEP_COUNT = 4;
const IDLE_RESUME_MS = 5000;
const ANNUAL_OSCILLATE_MS = 1700;

const PHASE_GAZE_END = 900;
const PHASE_VOICE_START = 900;
const PHASE_VOICE_END = 2300;
const PHASE_ROUTE_START = 1800;
const PHASE_ROUTE_END = 2600;
const PHASE_DENOISE_START = 2200;
const PHASE_DENOISE_END = 3400;
const PHASE_RESOLVE_END = 4000;

type FileId = "page.tsx" | "Dashboard.tsx" | "Forecast.tsx";

interface CodeToken {
  readonly kind: "plain" | "tag" | "attr" | "string" | "punct" | "comment";
  readonly text: string;
}

interface LoopStep {
  readonly target: string;
  readonly targetLabel: string;
  readonly voicePhrase: string;
  readonly compiledPrompt: string;
  readonly routedTo: string;
  readonly codeLineIndex: number;
  readonly newCode: ReadonlyArray<CodeToken>;
}

// ---------- page.tsx (pricing) ----------

const PAGE_CODE: ReadonlyArray<ReadonlyArray<CodeToken>> = [
  [{ kind: "comment", text: "// app/pricing/page.tsx" }],
  [
    { kind: "punct", text: "export default function " },
    { kind: "tag", text: "Pricing" },
    { kind: "punct", text: "() {" },
  ],
  [{ kind: "plain", text: "  return (" }],
  [
    { kind: "plain", text: "    " },
    { kind: "punct", text: "<" },
    { kind: "tag", text: "section" },
    { kind: "plain", text: " " },
    { kind: "attr", text: "className" },
    { kind: "punct", text: "=" },
    { kind: "string", text: '"pricing"' },
    { kind: "punct", text: ">" },
  ],
  [
    { kind: "plain", text: "      " },
    { kind: "punct", text: "<" },
    { kind: "tag", text: "h1" },
    { kind: "plain", text: " " },
    { kind: "attr", text: "className" },
    { kind: "punct", text: "=" },
    { kind: "string", text: '"text-4xl"' },
    { kind: "punct", text: ">" },
    { kind: "plain", text: "Pricing that scales" },
    { kind: "punct", text: "</" },
    { kind: "tag", text: "h1" },
    { kind: "punct", text: ">" },
  ],
  [
    { kind: "plain", text: "      " },
    { kind: "punct", text: "<" },
    { kind: "tag", text: "Toggle" },
    { kind: "plain", text: " " },
    { kind: "attr", text: "value" },
    { kind: "punct", text: "={" },
    { kind: "plain", text: "annual" },
    { kind: "punct", text: "} />" },
  ],
  [
    { kind: "plain", text: "      " },
    { kind: "punct", text: "<" },
    { kind: "tag", text: "Price" },
    { kind: "plain", text: " " },
    { kind: "attr", text: "value" },
    { kind: "punct", text: "={" },
    { kind: "plain", text: "annual ? 240 : 25" },
    { kind: "punct", text: "} />" },
  ],
  [
    { kind: "plain", text: "      " },
    { kind: "punct", text: "<" },
    { kind: "tag", text: "Button" },
    { kind: "punct", text: ">" },
    { kind: "plain", text: "Start free trial" },
    { kind: "punct", text: "</" },
    { kind: "tag", text: "Button" },
    { kind: "punct", text: ">" },
  ],
  [
    { kind: "plain", text: "    " },
    { kind: "punct", text: "</" },
    { kind: "tag", text: "section" },
    { kind: "punct", text: ">" },
  ],
  [{ kind: "plain", text: "  );" }],
  [{ kind: "punct", text: "}" }],
];

const PAGE_STEPS: ReadonlyArray<LoopStep> = [
  {
    target: "headline",
    targetLabel: "h1.hero-headline",
    voicePhrase: "tighten this up",
    compiledPrompt: "tighten letter-spacing on h1 in pricing.tsx",
    routedTo: "eri engine · diffusion",
    codeLineIndex: 4,
    newCode: [
      { kind: "plain", text: "      " },
      { kind: "punct", text: "<" },
      { kind: "tag", text: "h1" },
      { kind: "plain", text: " " },
      { kind: "attr", text: "className" },
      { kind: "punct", text: "=" },
      { kind: "string", text: '"text-4xl tracking-tight"' },
      { kind: "punct", text: ">" },
      { kind: "plain", text: "Pricing that scales" },
      { kind: "punct", text: "</" },
      { kind: "tag", text: "h1" },
      { kind: "punct", text: ">" },
    ],
  },
  {
    target: "toggle",
    targetLabel: "Toggle.billing",
    voicePhrase: "make the toggle glow on annual",
    compiledPrompt:
      "add accent box-shadow + scale on Toggle when value === 'annual'",
    routedTo: "eri engine · diffusion",
    codeLineIndex: 5,
    newCode: [
      { kind: "plain", text: "      " },
      { kind: "punct", text: "<" },
      { kind: "tag", text: "Toggle" },
      { kind: "plain", text: " " },
      { kind: "attr", text: "value" },
      { kind: "punct", text: "={" },
      { kind: "plain", text: "annual" },
      { kind: "punct", text: "}" },
      { kind: "plain", text: " " },
      { kind: "attr", text: "glow" },
      { kind: "punct", text: "={" },
      { kind: "plain", text: "annual" },
      { kind: "punct", text: "} />" },
    ],
  },
  {
    target: "price",
    targetLabel: "Price.chip",
    voicePhrase: "fade the price when it changes",
    compiledPrompt:
      "wrap Price.value transition with 200ms opacity fade on change",
    routedTo: "Eri Coder · careful diffs",
    codeLineIndex: 6,
    newCode: [
      { kind: "plain", text: "      " },
      { kind: "punct", text: "<" },
      { kind: "tag", text: "Price" },
      { kind: "plain", text: " " },
      { kind: "attr", text: "value" },
      { kind: "punct", text: "={" },
      { kind: "plain", text: "annual ? 240 : 25" },
      { kind: "punct", text: "}" },
      { kind: "plain", text: " " },
      { kind: "attr", text: "fade" },
      { kind: "punct", text: " />" },
    ],
  },
  {
    target: "cta",
    targetLabel: "Button.cta-primary",
    voicePhrase: "halo on the cta",
    compiledPrompt: "add accent radial halo behind Button, animate on hover",
    routedTo: "eri engine · diffusion",
    codeLineIndex: 7,
    newCode: [
      { kind: "plain", text: "      " },
      { kind: "punct", text: "<" },
      { kind: "tag", text: "Button" },
      { kind: "plain", text: " " },
      { kind: "attr", text: "halo" },
      { kind: "punct", text: ">" },
      { kind: "plain", text: "Start free trial" },
      { kind: "punct", text: "</" },
      { kind: "tag", text: "Button" },
      { kind: "punct", text: ">" },
    ],
  },
];

// ---------- Dashboard.tsx ----------

const DASHBOARD_CODE: ReadonlyArray<ReadonlyArray<CodeToken>> = [
  [{ kind: "comment", text: "// components/Dashboard.tsx" }],
  [
    { kind: "punct", text: "import { " },
    { kind: "tag", text: "Sparkline" },
    { kind: "punct", text: ", " },
    { kind: "tag", text: "BarChart" },
    { kind: "punct", text: ", " },
    { kind: "tag", text: "KPICard" },
    { kind: "punct", text: " } from " },
    { kind: "string", text: '"@/charts"' },
    { kind: "punct", text: ";" },
  ],
  [{ kind: "plain", text: "" }],
  [
    { kind: "punct", text: "export function " },
    { kind: "tag", text: "Dashboard" },
    { kind: "punct", text: "() {" },
  ],
  [{ kind: "plain", text: "  return (" }],
  [
    { kind: "plain", text: "    " },
    { kind: "punct", text: "<" },
    { kind: "tag", text: "div" },
    { kind: "plain", text: " " },
    { kind: "attr", text: "className" },
    { kind: "punct", text: "=" },
    { kind: "string", text: '"grid gap-4"' },
    { kind: "punct", text: ">" },
  ],
  [
    { kind: "plain", text: "      " },
    { kind: "punct", text: "<" },
    { kind: "tag", text: "KPICard" },
    { kind: "plain", text: " " },
    { kind: "attr", text: "label" },
    { kind: "punct", text: "=" },
    { kind: "string", text: '"MRR"' },
    { kind: "plain", text: " " },
    { kind: "attr", text: "value" },
    { kind: "punct", text: "={" },
    { kind: "plain", text: "24840" },
    { kind: "punct", text: "} />" },
  ],
  [
    { kind: "plain", text: "      " },
    { kind: "punct", text: "<" },
    { kind: "tag", text: "Sparkline" },
    { kind: "plain", text: " " },
    { kind: "attr", text: "data" },
    { kind: "punct", text: "={" },
    { kind: "plain", text: "revenue7d" },
    { kind: "punct", text: "} />" },
  ],
  [
    { kind: "plain", text: "      " },
    { kind: "punct", text: "<" },
    { kind: "tag", text: "BarChart" },
    { kind: "plain", text: " " },
    { kind: "attr", text: "data" },
    { kind: "punct", text: "={" },
    { kind: "plain", text: "signupsByWeek" },
    { kind: "punct", text: "} />" },
  ],
  [
    { kind: "plain", text: "    " },
    { kind: "punct", text: "</" },
    { kind: "tag", text: "div" },
    { kind: "punct", text: ">" },
  ],
  [{ kind: "plain", text: "  );" }],
  [{ kind: "punct", text: "}" }],
];

const DASHBOARD_STEPS: ReadonlyArray<LoopStep> = [
  {
    target: "kpi",
    targetLabel: "KPICard.delta",
    voicePhrase: "add deltas to the kpis",
    compiledPrompt:
      "add prev-period delta prop to KPICard with up/down arrow and color",
    routedTo: "eri engine · diffusion",
    codeLineIndex: 6,
    newCode: [
      { kind: "plain", text: "      " },
      { kind: "punct", text: "<" },
      { kind: "tag", text: "KPICard" },
      { kind: "plain", text: " " },
      { kind: "attr", text: "label" },
      { kind: "punct", text: "=" },
      { kind: "string", text: '"MRR"' },
      { kind: "plain", text: " " },
      { kind: "attr", text: "value" },
      { kind: "punct", text: "={" },
      { kind: "plain", text: "24840" },
      { kind: "punct", text: "}" },
      { kind: "plain", text: " " },
      { kind: "attr", text: "delta" },
      { kind: "punct", text: "={" },
      { kind: "plain", text: "0.124" },
      { kind: "punct", text: "} />" },
    ],
  },
  {
    target: "sparkline",
    targetLabel: "Sparkline.tint",
    voicePhrase: "tint the sparkline by trend",
    compiledPrompt:
      "color sparkline accent based on first vs last value (rising = accent, falling = warm)",
    routedTo: "Eri Coder · careful diffs",
    codeLineIndex: 7,
    newCode: [
      { kind: "plain", text: "      " },
      { kind: "punct", text: "<" },
      { kind: "tag", text: "Sparkline" },
      { kind: "plain", text: " " },
      { kind: "attr", text: "data" },
      { kind: "punct", text: "={" },
      { kind: "plain", text: "revenue7d" },
      { kind: "punct", text: "}" },
      { kind: "plain", text: " " },
      { kind: "attr", text: "tint" },
      { kind: "punct", text: "=" },
      { kind: "string", text: '"trend"' },
      { kind: "punct", text: " />" },
    ],
  },
  {
    target: "bars",
    targetLabel: "BarChart.highlight",
    voicePhrase: "highlight the latest bar",
    compiledPrompt:
      "highlight latest bar in BarChart with accent fill and inner glow",
    routedTo: "eri engine · diffusion",
    codeLineIndex: 8,
    newCode: [
      { kind: "plain", text: "      " },
      { kind: "punct", text: "<" },
      { kind: "tag", text: "BarChart" },
      { kind: "plain", text: " " },
      { kind: "attr", text: "data" },
      { kind: "punct", text: "={" },
      { kind: "plain", text: "signupsByWeek" },
      { kind: "punct", text: "}" },
      { kind: "plain", text: " " },
      { kind: "attr", text: "highlight" },
      { kind: "punct", text: "=" },
      { kind: "string", text: '"latest"' },
      { kind: "punct", text: " />" },
    ],
  },
  {
    target: "tooltip",
    targetLabel: "BarChart.tooltip",
    voicePhrase: "show a tooltip on hover",
    compiledPrompt:
      "add hover tooltip with value + week label to BarChart bars",
    routedTo: "Eri Reviewer · long horizon",
    codeLineIndex: 8,
    newCode: [
      { kind: "plain", text: "      " },
      { kind: "punct", text: "<" },
      { kind: "tag", text: "BarChart" },
      { kind: "plain", text: " " },
      { kind: "attr", text: "data" },
      { kind: "punct", text: "={" },
      { kind: "plain", text: "signupsByWeek" },
      { kind: "punct", text: "}" },
      { kind: "plain", text: " " },
      { kind: "attr", text: "highlight" },
      { kind: "punct", text: "=" },
      { kind: "string", text: '"latest"' },
      { kind: "punct", text: " " },
      { kind: "attr", text: "tooltips" },
      { kind: "punct", text: " />" },
    ],
  },
];

// ---------- Forecast.tsx ----------

const FORECAST_CODE: ReadonlyArray<ReadonlyArray<CodeToken>> = [
  [{ kind: "comment", text: "// components/Forecast.tsx" }],
  [
    { kind: "punct", text: "import { " },
    { kind: "tag", text: "LineChart" },
    { kind: "punct", text: ", " },
    { kind: "tag", text: "Band" },
    { kind: "punct", text: ", " },
    { kind: "tag", text: "Anomaly" },
    { kind: "punct", text: " } from " },
    { kind: "string", text: '"@/charts"' },
    { kind: "punct", text: ";" },
  ],
  [{ kind: "plain", text: "" }],
  [
    { kind: "punct", text: "export function " },
    { kind: "tag", text: "Forecast" },
    { kind: "punct", text: "() {" },
  ],
  [
    { kind: "plain", text: "  const points = " },
    { kind: "tag", text: "useForecast" },
    { kind: "punct", text: "({ horizon: " },
    { kind: "plain", text: "14" },
    { kind: "punct", text: " });" },
  ],
  [{ kind: "plain", text: "  return (" }],
  [
    { kind: "plain", text: "    " },
    { kind: "punct", text: "<" },
    { kind: "tag", text: "LineChart" },
    { kind: "plain", text: " " },
    { kind: "attr", text: "data" },
    { kind: "punct", text: "={" },
    { kind: "plain", text: "points" },
    { kind: "punct", text: "} />" },
  ],
  [{ kind: "plain", text: "  );" }],
  [{ kind: "punct", text: "}" }],
];

const FORECAST_STEPS: ReadonlyArray<LoopStep> = [
  {
    target: "horizon",
    targetLabel: "useForecast.horizon",
    voicePhrase: "stretch the horizon to 30 days",
    compiledPrompt:
      "extend forecast horizon from 14 to 30 days, keep historical fixed",
    routedTo: "eri engine · diffusion",
    codeLineIndex: 4,
    newCode: [
      { kind: "plain", text: "  const points = " },
      { kind: "tag", text: "useForecast" },
      { kind: "punct", text: "({ horizon: " },
      { kind: "plain", text: "30" },
      { kind: "punct", text: " });" },
    ],
  },
  {
    target: "band",
    targetLabel: "Band.confidence",
    voicePhrase: "show the confidence band",
    compiledPrompt:
      "render p10/p90 confidence band beneath forecast segment with accent tint",
    routedTo: "Eri Coder · careful diffs",
    codeLineIndex: 6,
    newCode: [
      { kind: "plain", text: "    " },
      { kind: "punct", text: "<" },
      { kind: "tag", text: "LineChart" },
      { kind: "plain", text: " " },
      { kind: "attr", text: "data" },
      { kind: "punct", text: "={" },
      { kind: "plain", text: "points" },
      { kind: "punct", text: "}>" },
      { kind: "plain", text: " " },
      { kind: "punct", text: "<" },
      { kind: "tag", text: "Band" },
      { kind: "plain", text: " " },
      { kind: "attr", text: "lower" },
      { kind: "punct", text: "={" },
      { kind: "plain", text: "p10" },
      { kind: "punct", text: "} " },
      { kind: "attr", text: "upper" },
      { kind: "punct", text: "={" },
      { kind: "plain", text: "p90" },
      { kind: "punct", text: "} />" },
      { kind: "punct", text: "</" },
      { kind: "tag", text: "LineChart" },
      { kind: "punct", text: ">" },
    ],
  },
  {
    target: "anomaly",
    targetLabel: "Anomaly.dots",
    voicePhrase: "mark the anomalies",
    compiledPrompt:
      "render outlier points as accent dots with z-score > 2 threshold",
    routedTo: "Eri Reviewer · long horizon",
    codeLineIndex: 6,
    newCode: [
      { kind: "plain", text: "    " },
      { kind: "punct", text: "<" },
      { kind: "tag", text: "LineChart" },
      { kind: "plain", text: " " },
      { kind: "attr", text: "data" },
      { kind: "punct", text: "={" },
      { kind: "plain", text: "points" },
      { kind: "punct", text: "}>" },
      { kind: "punct", text: "<" },
      { kind: "tag", text: "Band" },
      { kind: "plain", text: " ..." },
      { kind: "punct", text: " /><" },
      { kind: "tag", text: "Anomaly" },
      { kind: "plain", text: " " },
      { kind: "attr", text: "points" },
      { kind: "punct", text: "={" },
      { kind: "plain", text: "outliers" },
      { kind: "punct", text: "} />" },
      { kind: "punct", text: "</" },
      { kind: "tag", text: "LineChart" },
      { kind: "punct", text: ">" },
    ],
  },
  {
    target: "drag",
    targetLabel: "LineChart.onDrag",
    voicePhrase: "let me drag the next prediction",
    compiledPrompt:
      "wire onPointDrag handler on the t+1 forecast point, update model state",
    routedTo: "eri engine · diffusion",
    codeLineIndex: 6,
    newCode: [
      { kind: "plain", text: "    " },
      { kind: "punct", text: "<" },
      { kind: "tag", text: "LineChart" },
      { kind: "plain", text: " " },
      { kind: "attr", text: "data" },
      { kind: "punct", text: "={" },
      { kind: "plain", text: "points" },
      { kind: "punct", text: "}" },
      { kind: "plain", text: " " },
      { kind: "attr", text: "onPointDrag" },
      { kind: "punct", text: "={" },
      { kind: "plain", text: "rebase" },
      { kind: "punct", text: "}>..." },
      { kind: "punct", text: "</" },
      { kind: "tag", text: "LineChart" },
      { kind: "punct", text: ">" },
    ],
  },
];

const FILES: Record<
  FileId,
  { readonly codeBase: ReadonlyArray<ReadonlyArray<CodeToken>>; readonly steps: ReadonlyArray<LoopStep> }
> = {
  "page.tsx": { codeBase: PAGE_CODE, steps: PAGE_STEPS },
  "Dashboard.tsx": { codeBase: DASHBOARD_CODE, steps: DASHBOARD_STEPS },
  "Forecast.tsx": { codeBase: FORECAST_CODE, steps: FORECAST_STEPS },
};

// ---------- shared helpers ----------

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function diffBadgeLabel(activeFile: FileId, stepIndex: number): string {
  const stepDescriptors: Record<FileId, ReadonlyArray<string>> = {
    "page.tsx": [
      "tracking-tight applied",
      "glow prop added",
      "fade prop added",
      "halo prop added",
    ],
    "Dashboard.tsx": [
      "delta prop added",
      "sparkline tinted",
      "latest bar highlighted",
      "tooltips wired",
    ],
    "Forecast.tsx": [
      "horizon extended",
      "confidence band added",
      "anomalies marked",
      "drag-to-rebase enabled",
    ],
  };
  return stepDescriptors[activeFile][stepIndex] ?? "diff applied";
}

// ---------- shared types ----------

interface SceneFlags {
  readonly a: boolean;
  readonly b: boolean;
  readonly c: boolean;
  readonly d: boolean;
}

// ============================================================
//   Main component
// ============================================================

export function EriWorkbench(): React.ReactElement {
  const [tick, setTick] = useState<number>(0);
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const [activeFile, setActiveFile] = useState<FileId>("page.tsx");
  // Page-specific interactive state.
  const [annual, setAnnual] = useState<boolean>(false);
  // Forecast-specific interactive state — user-drag of t+1 prediction.
  const [forecastNudge, setForecastNudge] = useState<number>(0);
  const lastInteractRef = useRef<number>(0);

  // Active deck.
  const active = FILES[activeFile];
  const activeSteps = active.steps;
  const activeCodeBase = active.codeBase;

  // Tick advances unless user is "paused" (clicked an interactive thing).
  useEffect(() => {
    const id = window.setInterval(() => {
      if (
        pausedAt !== null &&
        Date.now() - lastInteractRef.current >= IDLE_RESUME_MS
      ) {
        setPausedAt(null);
      }
      if (pausedAt === null) {
        setTick((prev) => prev + 1);
      }
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [pausedAt]);

  const handleFileSelect = (file: FileId): void => {
    if (file === activeFile) return;
    setActiveFile(file);
    setTick(0); // restart cycle for new file
  };

  const handlePreviewInteract = (): void => {
    lastInteractRef.current = Date.now();
    setPausedAt((prev) => prev ?? Date.now());
  };

  const elapsedMs = tick * TICK_MS;
  const totalMs = STEP_MS * STEP_COUNT;
  const cycleMs = elapsedMs % totalMs;
  const stepIndex = Math.floor(cycleMs / STEP_MS);
  const inStepMs = cycleMs % STEP_MS;
  const step = activeSteps[stepIndex] ?? activeSteps[0]!;

  const appliedSteps: ReadonlyArray<number> = [...Array(stepIndex).keys()];
  const denoiseFraction = clamp01(
    (inStepMs - PHASE_DENOISE_START) /
      (PHASE_DENOISE_END - PHASE_DENOISE_START),
  );
  const resolveFraction = clamp01(
    (inStepMs - PHASE_DENOISE_END) / (PHASE_RESOLVE_END - PHASE_DENOISE_END),
  );
  const showNewLine = inStepMs >= PHASE_DENOISE_END;
  const denoising =
    inStepMs >= PHASE_DENOISE_START && inStepMs < PHASE_DENOISE_END;

  const codeLines = activeCodeBase.map((line, idx) => {
    const overrideStepIdx = [...appliedSteps]
      .reverse()
      .find((sIdx) => activeSteps[sIdx]?.codeLineIndex === idx);
    if (overrideStepIdx !== undefined) {
      return activeSteps[overrideStepIdx]!.newCode;
    }
    return line;
  });

  const voiceFraction = clamp01(
    (inStepMs - PHASE_VOICE_START) / (PHASE_VOICE_END - PHASE_VOICE_START),
  );
  const phraseShownChars = Math.floor(step.voicePhrase.length * voiceFraction);
  const voicePhraseShown = step.voicePhrase.slice(0, phraseShownChars);
  const voiceActive =
    inStepMs >= PHASE_VOICE_START && inStepMs <= PHASE_RESOLVE_END;
  const compiledVisible = inStepMs >= PHASE_DENOISE_START;
  const routingActive =
    inStepMs >= PHASE_ROUTE_START && inStepMs < PHASE_ROUTE_END;
  const routingShown = inStepMs >= PHASE_ROUTE_START;

  const sceneFlags: SceneFlags = {
    a: stepIndex > 0 || (stepIndex === 0 && showNewLine),
    b: stepIndex > 1 || (stepIndex === 1 && showNewLine),
    c: stepIndex > 2 || (stepIndex === 2 && showNewLine),
    d: stepIndex > 3 || (stepIndex === 3 && showNewLine),
  };

  // Page: drive annual toggle by scene state (unless user is paused).
  useEffect(() => {
    if (pausedAt !== null) return;
    if (activeFile !== "page.tsx") return;
    let next: boolean;
    if (stepIndex >= 2) {
      const subPhase = Math.floor(inStepMs / ANNUAL_OSCILLATE_MS) % 2;
      next = subPhase === 1;
    } else if (stepIndex === 1 && showNewLine) {
      next = true;
    } else {
      next = false;
    }
    if (next !== annual) setAnnual(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pausedAt, activeFile, stepIndex, inStepMs, showNewLine]);

  // Forecast: reset nudge when leaving the file.
  useEffect(() => {
    if (activeFile !== "Forecast.tsx") setForecastNudge(0);
  }, [activeFile]);

  const handleToggleClick = (): void => {
    handlePreviewInteract();
    setAnnual((prev) => !prev);
  };

  const gazeProgress = clamp01(inStepMs / PHASE_GAZE_END);

  const modifiedLineIndices = appliedSteps
    .map((s) => activeSteps[s]?.codeLineIndex)
    .filter((n): n is number => typeof n === "number");

  return (
    <div className="relative rounded-xl border border-white/[0.08] bg-[#0b0b0b] overflow-hidden shadow-[0_20px_60px_-20px_rgba(0,0,0,0.6)]">
      {/* Title bar */}
      <div className="relative flex items-center justify-between px-4 py-2 border-b border-white/[0.06] bg-[#0a0a0a]">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-[#ff5f57]" aria-hidden />
          <span className="h-3 w-3 rounded-full bg-[#febc2e]" aria-hidden />
          <span className="h-3 w-3 rounded-full bg-[#28c840]" aria-hidden />
        </div>
        <p className="font-mono text-[11px] text-paper/45 absolute left-1/2 -translate-x-1/2">
          eri workbench · pricing-app
        </p>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-paper/35">
            review → ship
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[200px_1.15fr_1fr] min-h-[560px]">
        <Sidebar activeFile={activeFile} onSelect={handleFileSelect} />

        <div className="flex flex-col border-l border-r border-white/[0.06] bg-[#0c0c0c] min-w-0">
          <TabBar activeFile={activeFile} onSelect={handleFileSelect} />
          <CodePane
            codeLines={codeLines}
            activeLineIndex={step.codeLineIndex}
            denoising={denoising}
            denoiseFraction={denoiseFraction}
            resolveFraction={resolveFraction}
            showNewLine={showNewLine}
            currentStepNewCode={step.newCode}
            modifiedLineIndices={modifiedLineIndices}
            showAppliedBadge={showNewLine && resolveFraction < 1}
            appliedBadgeLabel={diffBadgeLabel(activeFile, stepIndex)}
          />
          <VoiceInputBar
            voicePhraseShown={voicePhraseShown}
            voiceActive={voiceActive}
            compiledVisible={compiledVisible}
            compiledPrompt={step.compiledPrompt}
            routedTo={step.routedTo}
            routingActive={routingActive}
            routingShown={routingShown}
          />
        </div>

        {activeFile === "page.tsx" ? (
          <PagePreview
            target={step.target}
            gazeProgress={gazeProgress}
            flags={sceneFlags}
            annual={annual}
            onToggleClick={handleToggleClick}
            paused={pausedAt !== null}
            targetLabel={step.targetLabel}
          />
        ) : activeFile === "Dashboard.tsx" ? (
          <DashboardPreview
            flags={sceneFlags}
            targetLabel={step.targetLabel}
            onInteract={handlePreviewInteract}
          />
        ) : (
          <ForecastPreview
            flags={sceneFlags}
            targetLabel={step.targetLabel}
            forecastNudge={forecastNudge}
            onForecastNudge={(v) => {
              handlePreviewInteract();
              setForecastNudge(v);
            }}
          />
        )}
      </div>

      <StatusBar
        stepIndex={stepIndex}
        routedTo={step.routedTo}
        paused={pausedAt !== null}
        activeFile={activeFile}
      />
    </div>
  );
}

// ============================================================
//   Sidebar
// ============================================================

interface SidebarProps {
  readonly activeFile: FileId;
  readonly onSelect: (file: FileId) => void;
}

function Sidebar({
  activeFile,
  onSelect,
}: SidebarProps): React.ReactElement {
  return (
    <aside className="hidden lg:flex flex-col bg-[#080808] py-4 px-3 text-[12px] font-mono">
      <p className="text-paper/35 text-[10px] uppercase tracking-wider mb-3 px-2">
        Workspace
      </p>
      <FileTreeNode label="pricing-app" expanded depth={0} />
      <FileTreeNode label="src" expanded depth={1} />
      <FileTreeNode label="app" expanded depth={2} />
      <FileTreeNode label="pricing" expanded depth={3} />
      <FileTreeNode
        label="page.tsx"
        depth={4}
        active={activeFile === "page.tsx"}
        onSelect={() => onSelect("page.tsx")}
      />
      <FileTreeNode label="components" expanded depth={2} />
      <FileTreeNode
        label="Dashboard.tsx"
        depth={3}
        active={activeFile === "Dashboard.tsx"}
        onSelect={() => onSelect("Dashboard.tsx")}
      />
      <FileTreeNode
        label="Forecast.tsx"
        depth={3}
        active={activeFile === "Forecast.tsx"}
        onSelect={() => onSelect("Forecast.tsx")}
      />
      <FileTreeNode label="lib" depth={2} />
      <div className="mt-auto border-t border-white/[0.04] pt-3 px-2">
        <p className="text-paper/40 text-[10px] flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
          agent memory
        </p>
        <p className="text-paper/30 text-[10px] mt-1.5">
          412 turns · last edit 2m ago
        </p>
      </div>
    </aside>
  );
}

interface FileTreeNodeProps {
  readonly label: string;
  readonly depth: number;
  readonly expanded?: boolean;
  readonly active?: boolean;
  readonly onSelect?: () => void;
}

function FileTreeNode({
  label,
  depth,
  expanded,
  active,
  onSelect,
}: FileTreeNodeProps): React.ReactElement {
  const isFile = label.includes(".");
  const baseClass = `flex items-center gap-1.5 py-0.5 rounded-sm transition-colors w-full text-left ${
    active
      ? "bg-accent/[0.06] text-paper"
      : "text-paper/60 hover:text-paper/85"
  }`;
  const inner = (
    <>
      {!isFile && (
        <span className="text-paper/35 text-[9px]" aria-hidden>
          {expanded ? "▾" : "▸"}
        </span>
      )}
      {isFile ? (
        <span className="text-paper/30 text-[10px]" aria-hidden>
          ◇
        </span>
      ) : null}
      <span className={active ? "text-accent" : ""}>{label}</span>
    </>
  );
  if (isFile && onSelect) {
    return (
      <button
        type="button"
        onClick={onSelect}
        className={`${baseClass} cursor-pointer`}
        style={{ paddingLeft: `${depth * 10 + 6}px` }}
      >
        {inner}
      </button>
    );
  }
  return (
    <div className={baseClass} style={{ paddingLeft: `${depth * 10 + 6}px` }}>
      {inner}
    </div>
  );
}

// ============================================================
//   TabBar
// ============================================================

interface TabBarProps {
  readonly activeFile: FileId;
  readonly onSelect: (file: FileId) => void;
}

const TAB_FILES: ReadonlyArray<FileId> = [
  "page.tsx",
  "Dashboard.tsx",
  "Forecast.tsx",
];

function TabBar({
  activeFile,
  onSelect,
}: TabBarProps): React.ReactElement {
  return (
    <div className="flex items-center border-b border-white/[0.06] bg-[#0a0a0a] text-[12px] font-mono overflow-x-auto">
      {TAB_FILES.map((file) => {
        const isActive = file === activeFile;
        return (
          <button
            key={file}
            type="button"
            onClick={() => onSelect(file)}
            className={`flex items-center gap-2 px-4 py-2 border-r border-white/[0.06] transition-colors cursor-pointer ${
              isActive
                ? "bg-[#0c0c0c] text-paper/85"
                : "text-paper/40 hover:text-paper/65 hover:bg-white/[0.02]"
            }`}
          >
            <span
              className={`text-[10px] ${
                isActive ? "text-paper/40" : "text-paper/25"
              }`}
              aria-hidden
            >
              ◇
            </span>
            {file}
            {isActive ? (
              <span className="text-paper/30 text-[9px] ml-1">●</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

// ============================================================
//   CodePane + CodeLineRow
// ============================================================

interface CodePaneProps {
  readonly codeLines: ReadonlyArray<ReadonlyArray<CodeToken>>;
  readonly activeLineIndex: number;
  readonly denoising: boolean;
  readonly denoiseFraction: number;
  readonly resolveFraction: number;
  readonly showNewLine: boolean;
  readonly currentStepNewCode: ReadonlyArray<CodeToken>;
  readonly modifiedLineIndices: ReadonlyArray<number>;
  readonly showAppliedBadge: boolean;
  readonly appliedBadgeLabel: string;
}

function CodePane({
  codeLines,
  activeLineIndex,
  denoising,
  denoiseFraction,
  resolveFraction,
  showNewLine,
  currentStepNewCode,
  modifiedLineIndices,
  showAppliedBadge,
  appliedBadgeLabel,
}: CodePaneProps): React.ReactElement {
  return (
    <div className="relative flex-1 px-4 py-3 font-mono text-[12px] leading-[1.65] overflow-hidden">
      {codeLines.map((line, idx) => {
        const isActive = idx === activeLineIndex;
        const showDenoise = isActive && denoising;
        const showResolved = isActive && showNewLine;
        const displayLine = showResolved ? currentStepNewCode : line;
        const gutter: "+" | "~" | null = showDenoise
          ? "~"
          : showResolved || modifiedLineIndices.includes(idx)
            ? "+"
            : null;
        return (
          <CodeLineRow
            key={`line-${idx}`}
            lineNo={idx + 1}
            tokens={displayLine}
            denoising={showDenoise}
            denoiseFraction={denoiseFraction}
            resolveFraction={showResolved ? resolveFraction : 1}
            resolvedHighlight={showResolved}
            gutter={gutter}
          />
        );
      })}
      {showAppliedBadge ? (
        <div
          className="absolute top-3 right-4 flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/[0.12] px-2.5 py-0.5 font-mono text-[10px] text-accent"
          style={{ animation: "diffResolve 0.6s ease-out" }}
        >
          <span aria-hidden>✦</span>
          {appliedBadgeLabel}
        </div>
      ) : null}
    </div>
  );
}

interface CodeLineRowProps {
  readonly lineNo: number;
  readonly tokens: ReadonlyArray<CodeToken>;
  readonly denoising: boolean;
  readonly denoiseFraction: number;
  readonly resolveFraction: number;
  readonly resolvedHighlight: boolean;
  readonly gutter?: "+" | "~" | null;
}

function CodeLineRow({
  lineNo,
  tokens,
  denoising,
  denoiseFraction,
  resolveFraction,
  resolvedHighlight,
  gutter,
}: CodeLineRowProps): React.ReactElement {
  const bg = resolvedHighlight
    ? `rgba(224,255,79,${0.10 * (1 - resolveFraction)})`
    : "transparent";
  const gutterColor =
    gutter === "+"
      ? "text-accent"
      : gutter === "~"
        ? "text-[#a8d1ff]"
        : "text-transparent";
  return (
    <div
      className="flex gap-3 transition-colors duration-300"
      style={{ background: bg }}
    >
      <span
        className={`${gutterColor} text-[11px] w-3 text-center shrink-0 select-none font-mono`}
        aria-hidden
      >
        {gutter ?? "·"}
      </span>
      <span className="text-paper/25 text-[11px] w-6 text-right shrink-0 select-none">
        {lineNo}
      </span>
      <span className="min-w-0 truncate">
        {tokens.map((tok, ti) => {
          if (denoising && Math.random() < (1 - denoiseFraction) * 0.4) {
            return (
              <span
                key={`tok-${ti}`}
                style={{
                  color: "rgba(224,255,79,0.7)",
                  opacity: 0.5 + denoiseFraction * 0.5,
                }}
              >
                {"░".repeat(tok.text.length)}
              </span>
            );
          }
          return (
            <span key={`tok-${ti}`} className={tokenClass(tok.kind)}>
              {tok.text}
            </span>
          );
        })}
      </span>
    </div>
  );
}

function tokenClass(kind: CodeToken["kind"]): string {
  switch (kind) {
    case "tag":
      return "text-[#d4a5ff]";
    case "attr":
      return "text-[#a8d1ff]";
    case "string":
      return "text-[#c2f29b]";
    case "punct":
      return "text-paper/55";
    case "comment":
      return "text-paper/35 italic";
    case "plain":
    default:
      return "text-paper/85";
  }
}

// ============================================================
//   VoiceInputBar
// ============================================================

interface VoiceInputBarProps {
  readonly voicePhraseShown: string;
  readonly voiceActive: boolean;
  readonly compiledVisible: boolean;
  readonly compiledPrompt: string;
  readonly routedTo: string;
  readonly routingActive: boolean;
  readonly routingShown: boolean;
}

function VoiceInputBar({
  voicePhraseShown,
  voiceActive,
  compiledVisible,
  compiledPrompt,
  routedTo,
  routingActive,
  routingShown,
}: VoiceInputBarProps): React.ReactElement {
  return (
    <div className="border-t border-white/[0.06] bg-[#080808] px-4 py-3 flex flex-col gap-2">
      <div className="flex items-start gap-3">
        <span
          className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-accent/40 mt-px shrink-0"
          aria-hidden
          style={{
            background: voiceActive ? "rgba(224,255,79,0.12)" : "transparent",
          }}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-3 w-3 text-accent"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <rect x="9" y="3" width="6" height="12" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0" strokeLinecap="round" />
          </svg>
        </span>
        <p className="font-mono text-[12px] text-paper/85 truncate flex-1">
          <span className="text-paper/40">"</span>
          {voicePhraseShown}
          <span
            className="inline-block w-[1px] h-[12px] align-middle ml-0.5"
            style={{
              background: "var(--accent)",
              animation: "caretBlink 1s steps(2) infinite",
            }}
            aria-hidden
          />
          <span className="text-paper/40">"</span>
        </p>
      </div>
      <p
        className="font-mono text-[11px] text-paper/55 pl-8 truncate"
        style={{
          opacity: compiledVisible ? 1 : 0,
          transition: "opacity 240ms ease-out",
        }}
        aria-hidden={!compiledVisible}
      >
        <span className="text-accent/70">✦ compiled ·</span> {compiledPrompt}
      </p>
      <p
        className="font-mono text-[11px] pl-8 truncate flex items-center gap-2"
        style={{
          opacity: routingShown ? 1 : 0,
          transition: "opacity 240ms ease-out",
        }}
        aria-hidden={!routingShown}
      >
        <span className="text-paper/45">→ routed ·</span>
        <span
          className="text-accent/85"
          style={{
            animation: routingActive
              ? "annualGlow 1.2s ease-in-out infinite"
              : "none",
          }}
        >
          {routedTo}
        </span>
      </p>
    </div>
  );
}

// ============================================================
//   PagePreview (existing pricing card)
// ============================================================

interface Point {
  readonly x: number;
  readonly y: number;
}

type PageTargetId = "headline" | "toggle" | "price" | "cta";

const PAGE_TARGET_ORDER: ReadonlyArray<PageTargetId> = [
  "headline",
  "toggle",
  "price",
  "cta",
];

const PAGE_FALLBACK_POSITIONS: Record<PageTargetId, Point> = {
  headline: { x: 160, y: 80 },
  toggle: { x: 200, y: 160 },
  price: { x: 160, y: 230 },
  cta: { x: 140, y: 320 },
};

interface PagePreviewProps {
  readonly target: string;
  readonly gazeProgress: number;
  readonly flags: SceneFlags;
  readonly annual: boolean;
  readonly onToggleClick: () => void;
  readonly paused: boolean;
  readonly targetLabel: string;
}

function PagePreview({
  target,
  gazeProgress,
  flags,
  annual,
  onToggleClick,
  paused,
  targetLabel,
}: PagePreviewProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const headlineRef = useRef<HTMLHeadingElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const priceRef = useRef<HTMLDivElement | null>(null);
  const ctaRef = useRef<HTMLButtonElement | null>(null);
  const [positions, setPositions] = useState<Record<PageTargetId, Point>>(
    PAGE_FALLBACK_POSITIONS,
  );

  useLayoutEffect(() => {
    function measure(): void {
      const container = containerRef.current;
      if (!container) return;
      const c = container.getBoundingClientRect();
      const m = (el: Element | null): Point | null => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          x: r.left - c.left + r.width / 2,
          y: r.top - c.top + r.height / 2,
        };
      };
      const next: Partial<Record<PageTargetId, Point>> = {};
      const h = m(headlineRef.current);
      const t = m(toggleRef.current);
      const p = m(priceRef.current);
      const cta = m(ctaRef.current);
      if (h) next.headline = h;
      if (t) next.toggle = t;
      if (p) next.price = p;
      if (cta) next.cta = cta;
      setPositions((prev) => ({ ...prev, ...next }));
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const pageTarget = (PAGE_TARGET_ORDER.includes(target as PageTargetId)
    ? (target as PageTargetId)
    : "headline") as PageTargetId;
  const idx = PAGE_TARGET_ORDER.indexOf(pageTarget);
  const prevTarget =
    PAGE_TARGET_ORDER[(idx + PAGE_TARGET_ORDER.length - 1) %
      PAGE_TARGET_ORDER.length]!;
  const from = positions[prevTarget];
  const to = positions[pageTarget];
  const gazeX = from.x + (to.x - from.x) * easeOut(gazeProgress);
  const gazeY = from.y + (to.y - from.y) * easeOut(gazeProgress);

  const headlineTight = flags.a;
  const toggleGlowEnabled = flags.b;
  const priceFadeEnabled = flags.c;
  const ctaHalo = flags.d;
  const priceText = annual ? "$240/yr" : "$25/mo";
  const toggleHasGlow = toggleGlowEnabled && annual;

  return (
    <div className="relative bg-[#0a0a0a]">
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.06]">
        <p className="font-mono text-[11px] text-paper/45 uppercase tracking-wider">
          Preview · live
        </p>
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-accent pulse-dot" aria-hidden />
          <span className="font-mono text-[10px] text-paper/45">
            looking · {targetLabel}
          </span>
        </div>
      </div>
      <div
        ref={containerRef}
        className="relative px-6 py-8"
        style={{ minHeight: "440px" }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute h-10 w-10 rounded-full"
          style={{
            left: gazeX - 20,
            top: gazeY - 20,
            border: "1.5px solid rgba(224,255,79,0.65)",
            background: "rgba(224,255,79,0.06)",
            boxShadow: "0 0 18px rgba(224,255,79,0.35)",
            transition: "left 280ms ease-out, top 280ms ease-out",
          }}
        />

        <h3
          ref={headlineRef}
          className="font-display text-paper transition-all duration-500"
          style={{
            fontWeight: 500,
            fontSize: "26px",
            letterSpacing: headlineTight ? "-0.04em" : "-0.005em",
          }}
        >
          Pricing that scales with you
        </h3>
        <p className="mt-1.5 text-[13px] text-paper/45">
          One plan. Predictable cost. Cancel any time.
        </p>

        <div className="mt-6 flex items-center gap-3">
          <span
            className={`font-mono text-[12px] transition-colors ${
              annual ? "text-paper/55" : "text-paper/85"
            }`}
          >
            Monthly
          </span>
          <button
            ref={toggleRef}
            type="button"
            role="switch"
            aria-checked={annual}
            aria-label="Toggle billing cycle"
            onClick={onToggleClick}
            className="relative h-7 w-14 rounded-full border transition-all duration-500 cursor-pointer"
            style={{
              borderColor:
                pageTarget === "toggle"
                  ? "rgba(224,255,79,0.45)"
                  : "rgba(255,255,255,0.10)",
              background: toggleHasGlow
                ? "rgba(224,255,79,0.18)"
                : "rgba(255,255,255,0.06)",
              animation: toggleHasGlow
                ? "annualGlow 1.8s ease-in-out infinite"
                : "none",
            }}
          >
            <span
              className="absolute top-1 left-1 h-5 w-5 rounded-full"
              style={{
                transform: annual ? "translateX(28px)" : "translateX(0)",
                transition:
                  "transform 220ms cubic-bezier(0.32, 0.72, 0, 1), background 220ms ease",
                background: toggleHasGlow
                  ? "var(--accent)"
                  : "rgba(245,242,236,0.85)",
              }}
              aria-hidden
            />
          </button>
          <span
            className={`font-mono text-[12px] transition-colors ${
              annual ? "text-paper/85" : "text-paper/55"
            }`}
          >
            Annual
          </span>
          <span
            className="ml-1 rounded-sm border border-accent/30 bg-accent/[0.07] px-1.5 py-0.5 font-mono text-[10px] text-accent"
            aria-hidden
          >
            -20%
          </span>
          {paused ? (
            <span
              className="ml-2 font-mono text-[10px] uppercase tracking-wider text-paper/35"
              aria-live="polite"
            >
              auto · paused
            </span>
          ) : null}
        </div>

        <div
          ref={priceRef}
          className="mt-6 inline-flex items-baseline gap-2 rounded-md border px-5 py-4 transition-all duration-500"
          style={{
            borderColor:
              pageTarget === "price"
                ? "rgba(224,255,79,0.45)"
                : "rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.02)",
          }}
        >
          <span
            key={priceFadeEnabled ? priceText : "static-price"}
            className="font-display text-paper"
            style={{
              fontWeight: 500,
              fontSize: "36px",
              letterSpacing: "-0.02em",
              animation: priceFadeEnabled
                ? "diffResolve 0.5s ease-out"
                : undefined,
            }}
          >
            {priceText}
          </span>
          <span className="font-mono text-[12px] text-paper/45">
            per workspace
          </span>
        </div>

        <div className="mt-6">
          <button
            ref={ctaRef}
            type="button"
            className="rounded-md px-5 py-2.5 font-display text-[14px] transition-all duration-500 relative"
            style={{
              fontWeight: 500,
              background: ctaHalo ? "var(--accent)" : "rgba(255,255,255,0.06)",
              color: ctaHalo ? "var(--bg-primary)" : "var(--text-primary)",
              border:
                pageTarget === "cta"
                  ? "1px solid rgba(224,255,79,0.5)"
                  : "1px solid rgba(255,255,255,0.10)",
              animation: ctaHalo
                ? "ctaHalo 1.6s ease-in-out infinite"
                : "none",
            }}
          >
            Start free trial →
          </button>
          <p className="mt-2 font-mono text-[11px] text-paper/35">
            No card. 14 days. Local-first.
          </p>
        </div>
      </div>
    </div>
  );
}

// ============================================================
//   DashboardPreview — KPIs + sparkline + bar chart
// ============================================================

interface DashboardPreviewProps {
  readonly flags: SceneFlags;
  readonly targetLabel: string;
  readonly onInteract: () => void;
}

const SPARK_DATA: ReadonlyArray<number> = [
  18, 22, 21, 24, 26, 23, 27, 29, 28, 31, 34, 33, 36, 38, 37, 40, 42, 41, 45,
  46, 48, 47, 50, 52,
];

const BAR_DATA: ReadonlyArray<{ label: string; value: number }> = [
  { label: "W34", value: 22 },
  { label: "W35", value: 29 },
  { label: "W36", value: 26 },
  { label: "W37", value: 33 },
  { label: "W38", value: 41 },
  { label: "W39", value: 38 },
  { label: "W40", value: 47 },
  { label: "W41", value: 58 },
];

function DashboardPreview({
  flags,
  targetLabel,
  onInteract,
}: DashboardPreviewProps): React.ReactElement {
  const [hoveredBar, setHoveredBar] = useState<number | null>(null);

  const deltasOn = flags.a;
  const sparkTinted = flags.b;
  const latestHighlighted = flags.c;
  const tooltipsOn = flags.d;

  return (
    <div className="relative bg-[#0a0a0a]">
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.06]">
        <p className="font-mono text-[11px] text-paper/45 uppercase tracking-wider">
          Preview · dashboard
        </p>
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-accent pulse-dot" aria-hidden />
          <span className="font-mono text-[10px] text-paper/45">
            looking · {targetLabel}
          </span>
        </div>
      </div>
      <div className="px-6 py-6 flex flex-col gap-5" style={{ minHeight: "440px" }}>
        {/* KPI row */}
        <div className="grid grid-cols-3 gap-3">
          <KPICard label="MRR" value="$24.8k" delta={0.124} showDelta={deltasOn} />
          <KPICard
            label="Active users"
            value="1,284"
            delta={0.083}
            showDelta={deltasOn}
          />
          <KPICard label="Churn" value="2.1%" delta={-0.014} showDelta={deltasOn} />
        </div>

        {/* Sparkline */}
        <div className="rounded-md border border-white/[0.08] bg-[#0c0c0c] p-4">
          <div className="flex items-baseline justify-between mb-3">
            <p className="font-mono text-[10px] text-paper/45 uppercase tracking-wider">
              revenue · 24w
            </p>
            <p className="font-mono text-[11px] text-paper/65">
              $52.4k
              {sparkTinted ? (
                <span className="ml-2 text-accent">↑ 18%</span>
              ) : null}
            </p>
          </div>
          <Sparkline data={SPARK_DATA} tint={sparkTinted ? "rise" : null} />
        </div>

        {/* Bar chart */}
        <div className="rounded-md border border-white/[0.08] bg-[#0c0c0c] p-4 flex-1">
          <div className="flex items-baseline justify-between mb-3">
            <p className="font-mono text-[10px] text-paper/45 uppercase tracking-wider">
              signups · weekly
            </p>
            {tooltipsOn && hoveredBar !== null ? (
              <p className="font-mono text-[11px] text-paper/85">
                {BAR_DATA[hoveredBar]!.label} ·{" "}
                <span className="text-accent">{BAR_DATA[hoveredBar]!.value}</span>
              </p>
            ) : (
              <p className="font-mono text-[11px] text-paper/65">
                {BAR_DATA[BAR_DATA.length - 1]!.value} this week
              </p>
            )}
          </div>
          <BarChart
            data={BAR_DATA}
            highlightLatest={latestHighlighted}
            tooltipsOn={tooltipsOn}
            hoveredBar={hoveredBar}
            onHover={(i) => {
              if (tooltipsOn) {
                onInteract();
                setHoveredBar(i);
              }
            }}
            onLeave={() => {
              if (tooltipsOn) setHoveredBar(null);
            }}
          />
        </div>
      </div>
    </div>
  );
}

interface KPICardProps {
  readonly label: string;
  readonly value: string;
  readonly delta: number;
  readonly showDelta: boolean;
}

function KPICard({
  label,
  value,
  delta,
  showDelta,
}: KPICardProps): React.ReactElement {
  const positive = delta >= 0;
  return (
    <div className="rounded-md border border-white/[0.08] bg-[#0c0c0c] px-4 py-3">
      <p className="font-mono text-[10px] text-paper/40 uppercase tracking-wider mb-1.5">
        {label}
      </p>
      <p
        className="font-display text-paper"
        style={{ fontSize: "22px", fontWeight: 500, letterSpacing: "-0.02em" }}
      >
        {value}
      </p>
      <div
        className="mt-1 h-4 font-mono text-[11px] flex items-center gap-1 transition-opacity duration-500"
        style={{ opacity: showDelta ? 1 : 0 }}
        aria-hidden={!showDelta}
      >
        <span className={positive ? "text-accent" : "text-[#ff8a6a]"}>
          {positive ? "↑" : "↓"} {(Math.abs(delta) * 100).toFixed(1)}%
        </span>
        <span className="text-paper/35">vs last 7d</span>
      </div>
    </div>
  );
}

interface SparklineProps {
  readonly data: ReadonlyArray<number>;
  readonly tint: "rise" | "fall" | null;
}

function Sparkline({ data, tint }: SparklineProps): React.ReactElement {
  const w = 540;
  const h = 80;
  const pad = 6;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const points = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = pad + (1 - (v - min) / (max - min || 1)) * (h - pad * 2);
    return { x, y };
  });
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");
  const areaPath = `${path} L ${points[points.length - 1]!.x} ${h} L ${points[0]!.x} ${h} Z`;
  const stroke = tint === "rise" ? "var(--accent)" : "rgba(245,242,236,0.6)";
  const fillStops = tint === "rise"
    ? "stop-color='rgba(224,255,79,0.25)'"
    : "stop-color='rgba(245,242,236,0.10)'";
  const last = points[points.length - 1]!;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full block" preserveAspectRatio="none">
      <defs>
        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" {...{}}
            stopColor={tint === "rise" ? "rgba(224,255,79,0.25)" : "rgba(245,242,236,0.10)"}
          />
          <stop
            offset="100%"
            stopColor={tint === "rise" ? "rgba(224,255,79,0)" : "rgba(245,242,236,0)"}
          />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#sparkFill)" />
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ transition: "stroke 400ms ease" }}
      />
      <circle
        cx={last.x}
        cy={last.y}
        r="3"
        fill={stroke}
        style={{ transition: "fill 400ms ease" }}
      />
      <circle
        cx={last.x}
        cy={last.y}
        r="6"
        fill={tint === "rise" ? "rgba(224,255,79,0.25)" : "rgba(245,242,236,0.12)"}
      >
        <animate
          attributeName="r"
          values="6;10;6"
          dur="1.6s"
          repeatCount="indefinite"
        />
        <animate
          attributeName="opacity"
          values="0.8;0;0.8"
          dur="1.6s"
          repeatCount="indefinite"
        />
      </circle>
      {/* Unused mute to silence lint */}
      <text fill="transparent">{fillStops}</text>
    </svg>
  );
}

interface BarChartProps {
  readonly data: ReadonlyArray<{ label: string; value: number }>;
  readonly highlightLatest: boolean;
  readonly tooltipsOn: boolean;
  readonly hoveredBar: number | null;
  readonly onHover: (i: number) => void;
  readonly onLeave: () => void;
}

function BarChart({
  data,
  highlightLatest,
  tooltipsOn,
  hoveredBar,
  onHover,
  onLeave,
}: BarChartProps): React.ReactElement {
  const w = 540;
  const h = 140;
  const pad = 8;
  const max = Math.max(...data.map((d) => d.value));
  const barWidth = (w - pad * 2) / data.length - 6;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full block">
      {data.map((d, i) => {
        const x = pad + i * ((w - pad * 2) / data.length) + 3;
        const barH = (d.value / max) * (h - pad * 2 - 14);
        const y = h - pad - barH;
        const isLatest = i === data.length - 1;
        const isHovered = tooltipsOn && i === hoveredBar;
        const fill =
          highlightLatest && isLatest
            ? "var(--accent)"
            : isHovered
              ? "rgba(224,255,79,0.55)"
              : "rgba(245,242,236,0.18)";
        return (
          <g key={d.label}>
            <rect
              x={x}
              y={y}
              width={barWidth}
              height={barH}
              rx="2"
              fill={fill}
              style={{ transition: "fill 280ms ease, y 280ms ease, height 280ms ease" }}
              onMouseEnter={() => onHover(i)}
              onMouseLeave={onLeave}
              cursor={tooltipsOn ? "pointer" : "default"}
            />
            <text
              x={x + barWidth / 2}
              y={h - 1}
              textAnchor="middle"
              className="font-mono"
              fontSize="9"
              fill="rgba(245,242,236,0.35)"
            >
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ============================================================
//   ForecastPreview — line chart, confidence band, draggable point
// ============================================================

interface ForecastPreviewProps {
  readonly flags: SceneFlags;
  readonly targetLabel: string;
  readonly forecastNudge: number;
  readonly onForecastNudge: (v: number) => void;
}

const HISTORICAL: ReadonlyArray<number> = [
  62, 64, 63, 67, 66, 69, 71, 70, 73, 76, 75, 79, 82, 80, 84, 86, 85, 89, 88,
  92,
];
const FORECAST_BASE: ReadonlyArray<number> = [
  93, 95, 96, 98, 100, 101, 103, 105, 106, 108, 110, 111, 113, 115,
];

function ForecastPreview({
  flags,
  targetLabel,
  forecastNudge,
  onForecastNudge,
}: ForecastPreviewProps): React.ReactElement {
  const horizonLong = flags.a;
  const bandVisible = flags.b;
  const anomaliesVisible = flags.c;
  const dragEnabled = flags.d;

  const forecastValues = useMemo(() => {
    const horizon = horizonLong ? FORECAST_BASE.length : 7;
    const baseSlice = FORECAST_BASE.slice(0, horizon);
    const result = [...baseSlice];
    if (dragEnabled && forecastNudge !== 0 && result.length > 0) {
      result[0] = (result[0] ?? 0) + forecastNudge;
      for (let i = 1; i < result.length; i++) {
        result[i] = (result[i] ?? 0) + forecastNudge * 0.6 ** i;
      }
    }
    return result;
  }, [horizonLong, forecastNudge, dragEnabled]);

  return (
    <div className="relative bg-[#0a0a0a]">
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.06]">
        <p className="font-mono text-[11px] text-paper/45 uppercase tracking-wider">
          Preview · forecast
        </p>
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-accent pulse-dot" aria-hidden />
          <span className="font-mono text-[10px] text-paper/45">
            looking · {targetLabel}
          </span>
        </div>
      </div>
      <div className="px-6 py-6 flex flex-col gap-4" style={{ minHeight: "440px" }}>
        <div>
          <div className="flex items-baseline justify-between mb-3">
            <p className="font-mono text-[10px] text-paper/45 uppercase tracking-wider">
              daily active · forecast
            </p>
            <p className="font-mono text-[11px] text-paper/65">
              horizon{" "}
              <span className="text-accent">
                {horizonLong ? FORECAST_BASE.length : 7}d
              </span>
              {dragEnabled && forecastNudge !== 0 ? (
                <span className="ml-3 text-paper/65">
                  rebased{" "}
                  <span
                    className={forecastNudge > 0 ? "text-accent" : "text-[#ff8a6a]"}
                  >
                    {forecastNudge > 0 ? "+" : ""}
                    {forecastNudge.toFixed(0)}
                  </span>
                </span>
              ) : null}
            </p>
          </div>
          <ForecastChart
            historical={HISTORICAL}
            forecast={forecastValues}
            bandVisible={bandVisible}
            anomaliesVisible={anomaliesVisible}
            dragEnabled={dragEnabled}
            forecastNudge={forecastNudge}
            onNudge={onForecastNudge}
          />
        </div>

        <div className="rounded-md border border-white/[0.06] bg-[#080808] px-4 py-3">
          <p className="font-mono text-[10px] text-paper/45 uppercase tracking-wider mb-2">
            model · used by
          </p>
          <div className="font-mono text-[11px] text-paper/65 space-y-1">
            <p>app/analytics/page.tsx · daily-active forecast</p>
            <p className="text-paper/40">
              jobs/retrain.ts · nightly · last run 4h ago
            </p>
          </div>
          {dragEnabled ? (
            <p className="mt-3 font-mono text-[10px] text-accent">
              ✦ drag the first forecast point to rebase the prediction
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

interface ForecastChartProps {
  readonly historical: ReadonlyArray<number>;
  readonly forecast: ReadonlyArray<number>;
  readonly bandVisible: boolean;
  readonly anomaliesVisible: boolean;
  readonly dragEnabled: boolean;
  readonly forecastNudge: number;
  readonly onNudge: (v: number) => void;
}

function ForecastChart({
  historical,
  forecast,
  bandVisible,
  anomaliesVisible,
  dragEnabled,
  forecastNudge,
  onNudge,
}: ForecastChartProps): React.ReactElement {
  const w = 560;
  const h = 220;
  const padX = 12;
  const padY = 16;
  const all = [...historical, ...forecast];
  const min = Math.min(...all) - 10;
  const max = Math.max(...all) + 10;
  const total = historical.length + forecast.length - 1;

  const xFor = (i: number): number =>
    padX + (i / total) * (w - padX * 2);
  const yFor = (v: number): number =>
    padY + (1 - (v - min) / (max - min)) * (h - padY * 2);

  const histPoints = historical.map((v, i) => ({ x: xFor(i), y: yFor(v) }));
  const forecastPoints = forecast.map((v, i) => ({
    x: xFor(historical.length - 1 + i),
    y: yFor(v),
  }));

  const histPath = histPoints
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");
  const forecastPath = [histPoints[histPoints.length - 1]!, ...forecastPoints]
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");

  // Confidence band: spread widens with horizon.
  const bandUpper = forecastPoints.map((p, i) => ({
    x: p.x,
    y: yFor(forecast[i]! + (4 + i * 0.8)),
  }));
  const bandLower = forecastPoints.map((p, i) => ({
    x: p.x,
    y: yFor(forecast[i]! - (4 + i * 0.8)),
  }));
  const bandPath = [
    `M ${bandUpper[0]!.x} ${bandUpper[0]!.y}`,
    ...bandUpper.slice(1).map((p) => `L ${p.x} ${p.y}`),
    ...bandLower
      .slice()
      .reverse()
      .map((p) => `L ${p.x} ${p.y}`),
    "Z",
  ].join(" ");

  // Anomalies = top 2 historical residuals from a linear trend.
  const anomalyIdxs: ReadonlyArray<number> = [4, 13];

  const svgRef = useRef<SVGSVGElement | null>(null);
  const draggingRef = useRef<boolean>(false);

  const handleDown = (e: React.PointerEvent<SVGCircleElement>): void => {
    if (!dragEnabled) return;
    draggingRef.current = true;
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const handleMove = (e: React.PointerEvent<SVGSVGElement>): void => {
    if (!dragEnabled || !draggingRef.current || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const ratio = (e.clientY - rect.top) / rect.height;
    const yVal = max - ratio * (max - min);
    const baseVal = FORECAST_BASE[0]!;
    const next = clamp(yVal - baseVal, -30, 30);
    onNudge(next);
  };
  const handleUp = (e: React.PointerEvent): void => {
    draggingRef.current = false;
    if ("releasePointerCapture" in e.target) {
      (e.target as Element).releasePointerCapture(e.pointerId);
    }
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${w} ${h}`}
      className="w-full block"
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      style={{ touchAction: "none", cursor: dragEnabled ? "ns-resize" : "default" }}
    >
      {/* Grid lines */}
      {[0.25, 0.5, 0.75].map((g) => (
        <line
          key={g}
          x1={padX}
          y1={padY + g * (h - padY * 2)}
          x2={w - padX}
          y2={padY + g * (h - padY * 2)}
          stroke="rgba(245,242,236,0.04)"
          strokeWidth="1"
        />
      ))}
      {/* Today divider */}
      <line
        x1={xFor(historical.length - 1)}
        y1={padY}
        x2={xFor(historical.length - 1)}
        y2={h - padY}
        stroke="rgba(245,242,236,0.12)"
        strokeDasharray="2 4"
      />
      <text
        x={xFor(historical.length - 1) + 4}
        y={padY + 8}
        className="font-mono"
        fontSize="9"
        fill="rgba(245,242,236,0.35)"
      >
        today
      </text>

      {/* Confidence band */}
      {bandVisible ? (
        <path
          d={bandPath}
          fill="rgba(224,255,79,0.10)"
          stroke="rgba(224,255,79,0.18)"
          strokeWidth="0.5"
          style={{ animation: "diffResolve 0.5s ease-out" }}
        />
      ) : null}

      {/* Historical line */}
      <path
        d={histPath}
        fill="none"
        stroke="rgba(245,242,236,0.85)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Forecast line (dashed) */}
      <path
        d={forecastPath}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.5"
        strokeDasharray="3 3"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ transition: "d 280ms ease" }}
      />

      {/* Anomaly dots */}
      {anomaliesVisible
        ? anomalyIdxs.map((i) => {
            if (i >= historical.length) return null;
            const v = historical[i]!;
            return (
              <g key={i} style={{ animation: "diffResolve 0.5s ease-out" }}>
                <circle
                  cx={xFor(i)}
                  cy={yFor(v)}
                  r="6"
                  fill="rgba(255,138,106,0.18)"
                />
                <circle
                  cx={xFor(i)}
                  cy={yFor(v)}
                  r="3"
                  fill="#ff8a6a"
                />
              </g>
            );
          })
        : null}

      {/* Last historical dot */}
      <circle
        cx={histPoints[histPoints.length - 1]!.x}
        cy={histPoints[histPoints.length - 1]!.y}
        r="3"
        fill="rgba(245,242,236,0.85)"
      />

      {/* First forecast dot (draggable when dragEnabled) */}
      {forecastPoints.length > 0 ? (
        <>
          <circle
            cx={forecastPoints[0]!.x}
            cy={forecastPoints[0]!.y}
            r={dragEnabled ? 10 : 4}
            fill={dragEnabled ? "rgba(224,255,79,0.22)" : "transparent"}
            style={{ transition: "r 280ms ease, fill 280ms ease" }}
          />
          <circle
            cx={forecastPoints[0]!.x}
            cy={forecastPoints[0]!.y}
            r="4"
            fill="var(--accent)"
            onPointerDown={handleDown}
            style={{ cursor: dragEnabled ? "ns-resize" : "default" }}
          />
          {dragEnabled ? (
            <text
              x={forecastPoints[0]!.x + 10}
              y={forecastPoints[0]!.y - 6}
              className="font-mono"
              fontSize="9"
              fill="var(--accent)"
            >
              drag ↕
            </text>
          ) : null}
        </>
      ) : null}
    </svg>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ============================================================
//   StatusBar
// ============================================================

interface StatusBarProps {
  readonly stepIndex: number;
  readonly routedTo: string;
  readonly paused: boolean;
  readonly activeFile: FileId;
}

function StatusBar({
  stepIndex,
  routedTo,
  paused,
  activeFile,
}: StatusBarProps): React.ReactElement {
  return (
    <div className="flex items-center justify-between px-4 py-1.5 border-t border-white/[0.06] bg-[#080808] font-mono text-[10px] text-paper/45">
      <div className="flex items-center gap-3">
        <span>main</span>
        <span className="text-paper/25">·</span>
        <span>{activeFile}</span>
        <span className="text-paper/25">·</span>
        <span>line {stepIndex + 1}, col 1</span>
        <span className="text-paper/25">·</span>
        <span>TypeScript React</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-accent pulse-dot" aria-hidden />
        <span>{routedTo}</span>
        {paused ? (
          <>
            <span className="text-paper/25 ml-2">·</span>
            <span className="text-paper/55">loop paused</span>
          </>
        ) : null}
      </div>
    </div>
  );
}
