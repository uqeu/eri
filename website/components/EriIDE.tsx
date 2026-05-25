"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

// EriIDE — an interactive, IDE-style demo of the eri loop.
//
// Layout: sidebar (file tree) · editor pane (tabs + code + voice input) ·
// preview pane (live rendered output). A scene loop walks through four
// voice-driven edits; the preview is clickable so you can verify "yes,
// this is real React state, not a video". After 5s of user interaction
// the auto-loop resumes.

const STEP_MS = 4200;
const TICK_MS = 90;
const STEP_COUNT = 4;
const IDLE_RESUME_MS = 5000;
const ANNUAL_OSCILLATE_MS = 1700;

// Sub-phase timing inside a single step (ms).
const PHASE_GAZE_END = 900;
const PHASE_VOICE_START = 900;
const PHASE_VOICE_END = 2300;
const PHASE_ROUTE_START = 1800;
const PHASE_ROUTE_END = 2600;
const PHASE_DENOISE_START = 2200;
const PHASE_DENOISE_END = 3400;
const PHASE_RESOLVE_END = 4000;

type TargetId = "headline" | "toggle" | "price" | "cta";

interface CodeToken {
  readonly kind: "plain" | "tag" | "attr" | "string" | "punct" | "comment";
  readonly text: string;
}

interface LoopStep {
  readonly target: TargetId;
  readonly targetLabel: string;
  readonly voicePhrase: string;
  readonly compiledPrompt: string;
  readonly routedTo: string;
  readonly codeLineIndex: number;
  readonly newCode: ReadonlyArray<CodeToken>;
}

const CODE_BASE: ReadonlyArray<ReadonlyArray<CodeToken>> = [
  [
    { kind: "comment", text: "// app/pricing/page.tsx" },
  ],
  [
    { kind: "punct", text: "export default function " },
    { kind: "tag", text: "Pricing" },
    { kind: "punct", text: "() {" },
  ],
  [
    { kind: "plain", text: "  return (" },
  ],
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
  [
    { kind: "plain", text: "  );" },
  ],
  [
    { kind: "punct", text: "}" },
  ],
];

const STEPS: ReadonlyArray<LoopStep> = [
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
    routedTo: "Claude Sonnet 4.6 · careful diffs",
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

interface PrototypeFlags {
  readonly headlineTight: boolean;
  readonly toggleGlowEnabled: boolean;
  readonly priceFadeEnabled: boolean;
  readonly ctaHalo: boolean;
  readonly annual: boolean;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

type TargetPositions = Readonly<Record<TargetId, Point>>;

const FALLBACK_POSITIONS: TargetPositions = {
  headline: { x: 160, y: 80 },
  toggle: { x: 200, y: 160 },
  price: { x: 160, y: 230 },
  cta: { x: 140, y: 320 },
};

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function EriIDE(): React.ReactElement {
  const [tick, setTick] = useState<number>(0);
  const [annual, setAnnual] = useState<boolean>(false);
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const lastInteractRef = useRef<number>(0);

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

  const elapsedMs = tick * TICK_MS;
  const totalMs = STEP_MS * STEP_COUNT;
  const cycleMs = elapsedMs % totalMs;
  const stepIndex = Math.floor(cycleMs / STEP_MS);
  const inStepMs = cycleMs % STEP_MS;
  const step = STEPS[stepIndex] ?? STEPS[0]!;

  const appliedSteps: ReadonlyArray<number> = [...Array(stepIndex).keys()];
  const denoiseFraction = clamp01(
    (inStepMs - PHASE_DENOISE_START) / (PHASE_DENOISE_END - PHASE_DENOISE_START),
  );
  const resolveFraction = clamp01(
    (inStepMs - PHASE_DENOISE_END) / (PHASE_RESOLVE_END - PHASE_DENOISE_END),
  );
  const showNewLine = inStepMs >= PHASE_DENOISE_END;
  const denoising =
    inStepMs >= PHASE_DENOISE_START && inStepMs < PHASE_DENOISE_END;

  const codeLines = CODE_BASE.map((line, idx) => {
    const overrideStepIdx = [...appliedSteps]
      .reverse()
      .find((sIdx) => STEPS[sIdx]?.codeLineIndex === idx);
    if (overrideStepIdx !== undefined) {
      return STEPS[overrideStepIdx]!.newCode;
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

  const headlineTightAdded =
    stepIndex > 0 || (stepIndex === 0 && showNewLine);
  const toggleGlowAdded =
    stepIndex > 1 || (stepIndex === 1 && showNewLine);
  const priceFadeAdded =
    stepIndex > 2 || (stepIndex === 2 && showNewLine);
  const ctaHaloAdded =
    stepIndex > 3 || (stepIndex === 3 && showNewLine);

  useEffect(() => {
    if (pausedAt !== null) return;
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
  }, [pausedAt, stepIndex, inStepMs, showNewLine]);

  const handleToggleClick = (): void => {
    lastInteractRef.current = Date.now();
    setPausedAt((prev) => prev ?? Date.now());
    setAnnual((prev) => !prev);
  };

  const gazeProgress = clamp01(inStepMs / PHASE_GAZE_END);

  const prototypeFlags: PrototypeFlags = {
    headlineTight: headlineTightAdded,
    toggleGlowEnabled: toggleGlowAdded,
    priceFadeEnabled: priceFadeAdded,
    ctaHalo: ctaHaloAdded,
    annual,
  };

  return (
    <div className="relative rounded-xl border border-white/[0.08] bg-[#0b0b0b] overflow-hidden shadow-[0_20px_60px_-20px_rgba(0,0,0,0.6)]">
      {/* Title bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.06] bg-[#0a0a0a]">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-[#ff5f57]" aria-hidden />
          <span className="h-3 w-3 rounded-full bg-[#febc2e]" aria-hidden />
          <span className="h-3 w-3 rounded-full bg-[#28c840]" aria-hidden />
        </div>
        <p className="font-mono text-[11px] text-paper/45 absolute left-1/2 -translate-x-1/2">
          eri · pricing-app
        </p>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-paper/35">
            ⌘K to ship
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[200px_1.15fr_1fr] min-h-[520px]">
        {/* Sidebar — file tree */}
        <Sidebar />

        {/* Editor pane */}
        <div className="flex flex-col border-l border-r border-white/[0.06] bg-[#0c0c0c]">
          <TabBar />
          <CodePane
            codeLines={codeLines}
            activeLineIndex={step.codeLineIndex}
            denoising={denoising}
            denoiseFraction={denoiseFraction}
            resolveFraction={resolveFraction}
            showNewLine={showNewLine}
            currentStepNewCode={step.newCode}
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

        {/* Preview pane */}
        <PreviewPane
          target={step.target}
          gazeProgress={gazeProgress}
          flags={prototypeFlags}
          onToggleClick={handleToggleClick}
          paused={pausedAt !== null}
          targetLabel={step.targetLabel}
        />
      </div>

      {/* Status bar */}
      <StatusBar
        stepIndex={stepIndex}
        routedTo={step.routedTo}
        paused={pausedAt !== null}
      />
    </div>
  );
}

function Sidebar(): React.ReactElement {
  return (
    <aside className="hidden lg:flex flex-col bg-[#080808] py-4 px-3 text-[12px] font-mono">
      <p className="text-paper/35 text-[10px] uppercase tracking-wider mb-3 px-2">
        Explorer
      </p>
      <FileTreeNode label="pricing-app" expanded depth={0} />
      <FileTreeNode label="src" expanded depth={1} />
      <FileTreeNode label="app" expanded depth={2} />
      <FileTreeNode label="pricing" expanded depth={3} />
      <FileTreeNode label="page.tsx" depth={4} active />
      <FileTreeNode label="layout.tsx" depth={4} />
      <FileTreeNode label="components" depth={2} />
      <FileTreeNode label="lib" depth={2} />
      <div className="mt-auto border-t border-white/[0.04] pt-3 px-2">
        <p className="text-paper/40 text-[10px] flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
          eri · learning
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
}

function FileTreeNode({
  label,
  depth,
  expanded,
  active,
}: FileTreeNodeProps): React.ReactElement {
  const isFile = label.includes(".");
  return (
    <div
      className={`flex items-center gap-1.5 py-0.5 rounded-sm transition-colors ${
        active
          ? "bg-accent/[0.06] text-paper"
          : "text-paper/60 hover:text-paper/85"
      }`}
      style={{ paddingLeft: `${depth * 10 + 6}px` }}
    >
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
    </div>
  );
}

function TabBar(): React.ReactElement {
  return (
    <div className="flex items-center border-b border-white/[0.06] bg-[#0a0a0a] text-[12px] font-mono">
      <div className="flex items-center gap-2 px-4 py-2 border-r border-white/[0.06] bg-[#0c0c0c] text-paper/85">
        <span className="text-paper/40 text-[10px]" aria-hidden>◇</span>
        pricing.tsx
        <span className="text-paper/30 text-[9px] ml-1">●</span>
      </div>
      <div className="flex items-center gap-2 px-4 py-2 text-paper/40">
        <span className="text-paper/25 text-[10px]" aria-hidden>◇</span>
        layout.tsx
      </div>
    </div>
  );
}

interface CodePaneProps {
  readonly codeLines: ReadonlyArray<ReadonlyArray<CodeToken>>;
  readonly activeLineIndex: number;
  readonly denoising: boolean;
  readonly denoiseFraction: number;
  readonly resolveFraction: number;
  readonly showNewLine: boolean;
  readonly currentStepNewCode: ReadonlyArray<CodeToken>;
}

function CodePane({
  codeLines,
  activeLineIndex,
  denoising,
  denoiseFraction,
  resolveFraction,
  showNewLine,
  currentStepNewCode,
}: CodePaneProps): React.ReactElement {
  return (
    <div className="flex-1 px-4 py-3 font-mono text-[12px] leading-[1.65] overflow-hidden">
      {codeLines.map((line, idx) => {
        const isActive = idx === activeLineIndex;
        const showDenoise = isActive && denoising;
        const showResolved = isActive && showNewLine;
        const displayLine = showResolved ? currentStepNewCode : line;
        return (
          <CodeLineRow
            key={`line-${idx}`}
            lineNo={idx + 1}
            tokens={displayLine}
            denoising={showDenoise}
            denoiseFraction={denoiseFraction}
            resolveFraction={showResolved ? resolveFraction : 1}
            resolvedHighlight={showResolved}
          />
        );
      })}
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
}

function CodeLineRow({
  lineNo,
  tokens,
  denoising,
  denoiseFraction,
  resolveFraction,
  resolvedHighlight,
}: CodeLineRowProps): React.ReactElement {
  const bg = resolvedHighlight
    ? `rgba(224,255,79,${0.10 * (1 - resolveFraction)})`
    : "transparent";
  return (
    <div
      className="flex gap-3 transition-colors duration-300"
      style={{ background: bg }}
    >
      <span className="text-paper/25 text-[11px] w-6 text-right shrink-0 select-none">
        {lineNo}
      </span>
      <span className="min-w-0 truncate">
        {tokens.map((tok, ti) => {
          if (denoising && Math.random() < (1 - denoiseFraction) * 0.4) {
            // Render a denoise shimmer character instead of the real one.
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

interface PreviewPaneProps {
  readonly target: TargetId;
  readonly gazeProgress: number;
  readonly flags: PrototypeFlags;
  readonly onToggleClick: () => void;
  readonly paused: boolean;
  readonly targetLabel: string;
}

function PreviewPane({
  target,
  gazeProgress,
  flags,
  onToggleClick,
  paused,
  targetLabel,
}: PreviewPaneProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const headlineRef = useRef<HTMLHeadingElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const priceRef = useRef<HTMLDivElement | null>(null);
  const ctaRef = useRef<HTMLButtonElement | null>(null);
  const [positions, setPositions] = useState<TargetPositions>(
    FALLBACK_POSITIONS,
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
      const next: Partial<Record<TargetId, Point>> = {};
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

  const TARGET_ORDER: ReadonlyArray<TargetId> = [
    "headline",
    "toggle",
    "price",
    "cta",
  ];
  const idx = TARGET_ORDER.indexOf(target);
  const prevTarget =
    TARGET_ORDER[(idx + TARGET_ORDER.length - 1) % TARGET_ORDER.length]!;
  const from = positions[prevTarget];
  const to = positions[target];
  const gazeX = from.x + (to.x - from.x) * easeOut(gazeProgress);
  const gazeY = from.y + (to.y - from.y) * easeOut(gazeProgress);

  const priceText = flags.annual ? "$240/yr" : "$25/mo";
  const toggleHasGlow = flags.toggleGlowEnabled && flags.annual;

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
        {/* Gaze ring */}
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
            letterSpacing: flags.headlineTight ? "-0.04em" : "-0.005em",
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
              flags.annual ? "text-paper/55" : "text-paper/85"
            }`}
          >
            Monthly
          </span>
          <button
            ref={toggleRef}
            type="button"
            role="switch"
            aria-checked={flags.annual}
            aria-label="Toggle billing cycle"
            onClick={onToggleClick}
            className="relative h-7 w-14 rounded-full border transition-all duration-500 cursor-pointer"
            style={{
              borderColor:
                target === "toggle"
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
                transform: flags.annual ? "translateX(28px)" : "translateX(0)",
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
              flags.annual ? "text-paper/85" : "text-paper/55"
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
              target === "price"
                ? "rgba(224,255,79,0.45)"
                : "rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.02)",
          }}
        >
          <span
            key={flags.priceFadeEnabled ? priceText : "static-price"}
            className="font-display text-paper"
            style={{
              fontWeight: 500,
              fontSize: "36px",
              letterSpacing: "-0.02em",
              animation: flags.priceFadeEnabled
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
              background: flags.ctaHalo ? "var(--accent)" : "rgba(255,255,255,0.06)",
              color: flags.ctaHalo ? "var(--bg-primary)" : "var(--text-primary)",
              border:
                target === "cta"
                  ? "1px solid rgba(224,255,79,0.5)"
                  : "1px solid rgba(255,255,255,0.10)",
              animation: flags.ctaHalo
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

interface StatusBarProps {
  readonly stepIndex: number;
  readonly routedTo: string;
  readonly paused: boolean;
}

function StatusBar({
  stepIndex,
  routedTo,
  paused,
}: StatusBarProps): React.ReactElement {
  return (
    <div className="flex items-center justify-between px-4 py-1.5 border-t border-white/[0.06] bg-[#080808] font-mono text-[10px] text-paper/45">
      <div className="flex items-center gap-3">
        <span>main</span>
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
