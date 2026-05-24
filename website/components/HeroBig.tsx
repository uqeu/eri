"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { HeroBoundary } from "./HeroBoundary";

// The demo simulates the eri loop:
//   gaze (look at the prototype)
//   → voice (say what you want)
//   → diffusion (code denoises into the diff)
//   → prototype updates
//
// One full loop = 4 steps × STEP_MS = 14s. We tick every TICK_MS so
// sub-phase animations (gaze drift, voice typing, code denoise) can be
// keyed off elapsed time inside each step.
const STEP_MS = 3500;
const TICK_MS = 90;
const STEP_COUNT = 4;

type TargetId = "headline" | "toggle" | "price" | "cta";

interface LoopStep {
  readonly target: TargetId;
  readonly targetLabel: string;
  readonly voicePhrase: string;
  readonly compiledPrompt: string;
  readonly codeLineIndex: number; // which line in CODE_BASE gets edited
  readonly newCode: ReadonlyArray<CodeToken>;
}

interface CodeToken {
  readonly kind: "plain" | "tag" | "attr" | "string" | "punct";
  readonly text: string;
}

// The "before" snapshot of pricing.tsx that the demo opens with.
// Each element is one rendered code line.
const CODE_BASE: ReadonlyArray<ReadonlyArray<CodeToken>> = [
  [
    { kind: "punct", text: "<" },
    { kind: "tag", text: "section" },
    { kind: "plain", text: " " },
    { kind: "attr", text: "className" },
    { kind: "punct", text: "=" },
    { kind: "string", text: '"pricing"' },
    { kind: "punct", text: ">" },
  ],
  [
    { kind: "plain", text: "  " },
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
    { kind: "plain", text: "  " },
    { kind: "punct", text: "<" },
    { kind: "tag", text: "Toggle" },
    { kind: "plain", text: " " },
    { kind: "attr", text: "value" },
    { kind: "punct", text: "={" },
    { kind: "plain", text: "annual" },
    { kind: "punct", text: "} />" },
  ],
  [
    { kind: "plain", text: "  " },
    { kind: "punct", text: "<" },
    { kind: "tag", text: "Price" },
    { kind: "plain", text: " " },
    { kind: "attr", text: "value" },
    { kind: "punct", text: "={" },
    { kind: "plain", text: "annual ? 240 : 25" },
    { kind: "punct", text: "} />" },
  ],
  [
    { kind: "plain", text: "  " },
    { kind: "punct", text: "<" },
    { kind: "tag", text: "Button" },
    { kind: "punct", text: ">" },
    { kind: "plain", text: "Start free trial" },
    { kind: "punct", text: "</" },
    { kind: "tag", text: "Button" },
    { kind: "punct", text: ">" },
  ],
  [
    { kind: "punct", text: "</" },
    { kind: "tag", text: "section" },
    { kind: "punct", text: ">" },
  ],
];

const STEPS: ReadonlyArray<LoopStep> = [
  {
    target: "headline",
    targetLabel: "h1.hero-headline",
    voicePhrase: "tighten this up",
    compiledPrompt: "tighten letter-spacing on .hero-headline in pricing.tsx",
    codeLineIndex: 1,
    newCode: [
      { kind: "plain", text: "  " },
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
    targetLabel: "Toggle.billing-cycle",
    voicePhrase: "make it glow",
    compiledPrompt:
      "add eri-accent box-shadow to Toggle.billing-cycle when value === 'annual'",
    codeLineIndex: 2,
    newCode: [
      { kind: "plain", text: "  " },
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
    voicePhrase: "fade between them",
    compiledPrompt:
      "transition price text from $25/mo to $240/yr with 200ms opacity fade",
    codeLineIndex: 3,
    newCode: [
      { kind: "plain", text: "  " },
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
    voicePhrase: "give it a halo",
    compiledPrompt:
      "add accent radial glow behind Button.cta-primary, animate on hover",
    codeLineIndex: 4,
    newCode: [
      { kind: "plain", text: "  " },
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

// Sub-phase timing inside a single step (ms).
const PHASE_GAZE_END = 800;
const PHASE_VOICE_START = 800;
const PHASE_VOICE_END = 2000;
const PHASE_DENOISE_START = 1500;
const PHASE_DENOISE_END = 2800;
const PHASE_RESOLVE_END = 3500;

interface FeatureRow {
  readonly label: string;
  readonly note: string;
}

const DIFFERENTIATORS: ReadonlyArray<FeatureRow> = [
  { label: "Voice on existing repos", note: "Whisper-on-device, sub-second" },
  { label: "Gaze targeting", note: "MediaPipe in-process, camera frames stay local" },
  { label: "Diffusion edits", note: "The patch resolves; no left-to-right wait" },
  { label: "Local Tab", note: "Embedded inference on your hardware" },
];

// Which differentiator each step highlights in the right rail.
const STEP_TO_DIFF: ReadonlyArray<string> = [
  "Gaze targeting",
  "Voice on existing repos",
  "Diffusion edits",
  "Local Tab",
];

export function HeroBig(): React.ReactElement {
  const [tick, setTick] = useState<number>(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setTick((prev) => prev + 1);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const elapsedMs = tick * TICK_MS;
  const totalMs = STEP_MS * STEP_COUNT;
  const cycleMs = elapsedMs % totalMs;
  const stepIndex = Math.floor(cycleMs / STEP_MS);
  const inStepMs = cycleMs % STEP_MS;
  const step = STEPS[stepIndex] ?? STEPS[0]!;

  // The code panel keeps applied diffs from prior steps in this cycle.
  // Once a step's denoise phase completes, that line replaces the base.
  const appliedSteps: ReadonlyArray<number> = [...Array(stepIndex).keys()];
  const codeLines = CODE_BASE.map((line, idx) => {
    const overrideStepIdx = [...appliedSteps]
      .reverse()
      .find((sIdx) => STEPS[sIdx]?.codeLineIndex === idx);
    if (overrideStepIdx !== undefined) {
      return STEPS[overrideStepIdx]!.newCode;
    }
    return line;
  });

  // Whether the current step has already past the denoise phase — if so
  // the active line shows the new code with a fading green highlight.
  const denoiseFraction = clamp01(
    (inStepMs - PHASE_DENOISE_START) / (PHASE_DENOISE_END - PHASE_DENOISE_START),
  );
  const resolveFraction = clamp01(
    (inStepMs - PHASE_DENOISE_END) / (PHASE_RESOLVE_END - PHASE_DENOISE_END),
  );
  const showNewLine = inStepMs >= PHASE_DENOISE_END;
  const denoising =
    inStepMs >= PHASE_DENOISE_START && inStepMs < PHASE_DENOISE_END;

  // Voice phrase typing — character reveal during the voice phase.
  const voiceFraction = clamp01(
    (inStepMs - PHASE_VOICE_START) / (PHASE_VOICE_END - PHASE_VOICE_START),
  );
  const phraseShownChars = Math.floor(step.voicePhrase.length * voiceFraction);
  const voicePhraseShown = step.voicePhrase.slice(0, phraseShownChars);
  const voiceActive =
    inStepMs >= PHASE_VOICE_START && inStepMs <= PHASE_RESOLVE_END;
  // The compiled prompt appears once gaze + voice have been "fused" into a
  // concrete instruction — i.e. as the denoise begins — and stays visible
  // through resolve so the user can read it.
  const compiledVisible = inStepMs >= PHASE_DENOISE_START;

  // Prototype reflects diffs that have already resolved within this loop.
  const prototypeFlags = {
    headlineTight: stepIndex > 0 || (stepIndex === 0 && showNewLine),
    toggleGlow: stepIndex > 1 || (stepIndex === 1 && showNewLine),
    annualPrice: stepIndex > 2 || (stepIndex === 2 && showNewLine),
    ctaHalo: stepIndex > 3 || (stepIndex === 3 && showNewLine),
  };

  // Gaze position drifts toward the current step's target during the
  // first 800ms, then holds.
  const gazeProgress = clamp01(inStepMs / PHASE_GAZE_END);

  const activeDiff = STEP_TO_DIFF[stepIndex] ?? null;

  return (
    <section
      id="parity"
      className="relative overflow-hidden border-y border-white/[0.06]"
    >
      <div
        className="absolute inset-0 pointer-events-none mesh-bg opacity-50"
        aria-hidden
      />
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.05] grain mix-blend-overlay"
        aria-hidden
      />

      <div className="relative mx-auto max-w-7xl px-6 py-24 sm:py-32">
        <div className="max-w-3xl">
          <p className="mono-cap text-accent">The eri loop</p>
          <h2
            className="mt-4 font-display text-balance"
            style={{
              fontWeight: 400,
              fontSize: "clamp(2.25rem, 4.5vw, 3.75rem)",
              lineHeight: 1.02,
              letterSpacing: "-0.03em",
            }}
          >
            Your eyes stay on the prototype.
            <br />
            <span className="italic text-paper/65">
              The code rewrites itself.
            </span>
          </h2>
          <p className="mt-6 text-body text-paper/55 max-w-2xl">
            Look at the part you want to change. Say it out loud. The diffusion
            engine streams the patch into the file and the prototype updates
            under your gaze. Voice, vision, completion, and apply all run on
            your hardware — the planner is the only call that crosses the wire.
          </p>
        </div>

        <div className="mt-16 grid grid-cols-1 lg:grid-cols-[1.55fr_1fr] gap-6 lg:gap-8 items-stretch">
          <DemoPanel
            stepIndex={stepIndex}
            step={step}
            codeLines={codeLines}
            denoising={denoising}
            denoiseFraction={denoiseFraction}
            resolveFraction={resolveFraction}
            showNewLine={showNewLine}
            voicePhraseShown={voicePhraseShown}
            voiceActive={voiceActive}
            compiledVisible={compiledVisible}
            gazeProgress={gazeProgress}
            prototypeFlags={prototypeFlags}
          />
          <DifferentiatorsRail activeLabel={activeDiff} />
        </div>

        <HeroBoundary />

        <div className="mt-12 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 rounded-lg border border-white/[0.06] bg-bg-2/60 p-6">
          <div>
            <p
              className="font-display text-xl text-paper"
              style={{ fontWeight: 400 }}
            >
              Every shortcut you have muscle memory for.
            </p>
            <p className="mt-1.5 text-[14px] text-paper/55">
              Plus the muscle eri brings on its own — predicting your next move,
              learning your patterns, remembering you across sessions. Your{" "}
              <code className="font-mono text-paper/80">settings.json</code>,
              keybindings, and extensions carry over on first launch.
            </p>
          </div>
          <Link
            href="/features"
            className="btn-ghost inline-flex items-center justify-center gap-2 px-5 py-2.5 text-[14px] shrink-0"
          >
            See the full feature map
            <span aria-hidden>→</span>
          </Link>
        </div>
      </div>
    </section>
  );
}

interface PrototypeFlags {
  readonly headlineTight: boolean;
  readonly toggleGlow: boolean;
  readonly annualPrice: boolean;
  readonly ctaHalo: boolean;
}

interface DemoPanelProps {
  readonly stepIndex: number;
  readonly step: LoopStep;
  readonly codeLines: ReadonlyArray<ReadonlyArray<CodeToken>>;
  readonly denoising: boolean;
  readonly denoiseFraction: number;
  readonly resolveFraction: number;
  readonly showNewLine: boolean;
  readonly voicePhraseShown: string;
  readonly voiceActive: boolean;
  readonly compiledVisible: boolean;
  readonly gazeProgress: number;
  readonly prototypeFlags: PrototypeFlags;
}

function DemoPanel({
  stepIndex,
  step,
  codeLines,
  denoising,
  denoiseFraction,
  resolveFraction,
  showNewLine,
  voicePhraseShown,
  voiceActive,
  compiledVisible,
  gazeProgress,
  prototypeFlags,
}: DemoPanelProps): React.ReactElement {
  return (
    <div className="relative rounded-lg border border-white/[0.06] bg-bg-2/60 overflow-hidden flex flex-col">
      {/* Prototype region — what the user is actually looking at. */}
      <div className="relative" style={{ minHeight: "300px" }}>
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06] bg-black/30">
          <p className="mono-cap text-paper/40 text-[10px]">
            Prototype · live preview
          </p>
          <div className="flex items-center gap-1.5">
            <span
              className="h-1.5 w-1.5 rounded-full bg-accent pulse-dot"
              aria-hidden
            />
            <span className="font-mono text-[10px] text-paper/40">
              looking · {step.targetLabel}
            </span>
          </div>
        </div>
        <Prototype
          target={step.target}
          gazeProgress={gazeProgress}
          flags={prototypeFlags}
        />
      </div>

      {/* Code region — the file being diffused. */}
      <div className="border-t border-white/[0.06] bg-black/30">
        <div className="flex items-center justify-between px-4 py-2.5">
          <p className="font-mono text-[11px] text-paper/55">
            pricing.tsx — eri
          </p>
          <div className="flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/[0.06] px-2 py-0.5">
            <span
              className="h-1.5 w-1.5 rounded-full bg-accent pulse-dot"
              aria-hidden
            />
            <span className="font-mono text-[10px] text-accent">
              eri engine
            </span>
          </div>
        </div>
        <div className="px-4 pb-3 font-mono text-[12px] leading-[1.7]">
          {codeLines.map((line, idx) => {
            const isActive = idx === step.codeLineIndex;
            const showDenoise = isActive && denoising;
            const showResolved = isActive && showNewLine;
            const displayLine =
              showResolved && step.newCode ? step.newCode : line;
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
      </div>

      {/* Voice transcript ticker. */}
      <div className="border-t border-white/[0.06] px-4 py-3 bg-black/40 flex items-start gap-3">
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
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[12px] text-paper/85 truncate">
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
          <p
            className="font-mono text-[11px] text-paper/50 truncate mt-1"
            style={{
              opacity: compiledVisible ? 1 : 0,
              transition: "opacity 240ms ease-out",
            }}
            aria-hidden={!compiledVisible}
          >
            <span className="text-accent/70">✦ compiled ·</span>{" "}
            {step.compiledPrompt}
          </p>
        </div>
      </div>

      {/* 4-dot step indicator. */}
      <div className="border-t border-white/[0.06] px-4 py-2.5 flex items-center justify-between bg-black/30">
        <p className="mono-cap text-paper/40 text-[10px]">
          gaze → voice → diffuse → render
        </p>
        <div className="flex items-center gap-1.5">
          {STEPS.map((_, i) => (
            <span
              key={`dot-${i}`}
              className="block h-1.5 rounded-full transition-all duration-300"
              style={{
                width: i === stepIndex ? "20px" : "6px",
                background:
                  i === stepIndex
                    ? "var(--accent)"
                    : "rgba(245, 242, 236, 0.16)",
              }}
              aria-hidden
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface PrototypeProps {
  readonly target: TargetId;
  readonly gazeProgress: number;
  readonly flags: PrototypeFlags;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

type TargetPositions = Readonly<Record<TargetId, Point>>;

const TARGET_ORDER: ReadonlyArray<TargetId> = [
  "headline",
  "toggle",
  "price",
  "cta",
];

// Fallback positions used on first paint, before useLayoutEffect has measured
// the DOM. They are pixel coordinates relative to the prototype container and
// are immediately overwritten by the measured values.
const FALLBACK_POSITIONS: TargetPositions = {
  headline: { x: 120, y: 70 },
  toggle: { x: 200, y: 150 },
  price: { x: 160, y: 210 },
  cta: { x: 140, y: 280 },
};

function Prototype({
  target,
  gazeProgress,
  flags,
}: PrototypeProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const headlineRef = useRef<HTMLHeadingElement | null>(null);
  const toggleRef = useRef<HTMLDivElement | null>(null);
  const priceRef = useRef<HTMLDivElement | null>(null);
  const ctaRef = useRef<HTMLButtonElement | null>(null);

  const [positions, setPositions] = useState<TargetPositions>(
    FALLBACK_POSITIONS,
  );

  useLayoutEffect(() => {
    function measure(): void {
      const container = containerRef.current;
      if (!container) return;
      const containerRect = container.getBoundingClientRect();
      const measureRef = (el: Element | null): Point | null => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          x: r.left - containerRect.left + r.width / 2,
          y: r.top - containerRect.top + r.height / 2,
        };
      };
      const next: Partial<Record<TargetId, Point>> = {};
      const h = measureRef(headlineRef.current);
      const t = measureRef(toggleRef.current);
      const p = measureRef(priceRef.current);
      const c = measureRef(ctaRef.current);
      if (h) next.headline = h;
      if (t) next.toggle = t;
      if (p) next.price = p;
      if (c) next.cta = c;
      setPositions((prev) => ({ ...prev, ...next }));
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const idx = TARGET_ORDER.indexOf(target);
  const prevTarget =
    TARGET_ORDER[(idx + TARGET_ORDER.length - 1) % TARGET_ORDER.length]!;
  const from = positions[prevTarget];
  const to = positions[target];
  const gazeX = from.x + (to.x - from.x) * easeOut(gazeProgress);
  const gazeY = from.y + (to.y - from.y) * easeOut(gazeProgress);

  const priceText = flags.annualPrice ? "$240/yr" : "$25/mo";

  return (
    <div ref={containerRef} className="relative p-6" style={{ minHeight: "260px" }}>
      {/* Subtle backdrop card to feel like a webpage */}
      <div className="rounded-md border border-white/[0.05] bg-[#101010] p-5">
        {/* Headline */}
        <h3
          ref={headlineRef}
          className="font-display text-paper transition-all duration-500"
          data-target={target === "headline" ? "active" : undefined}
          style={{
            fontWeight: 400,
            fontSize: "20px",
            letterSpacing: flags.headlineTight ? "-0.04em" : "-0.01em",
            outline:
              target === "headline"
                ? "1px solid rgba(224,255,79,0.45)"
                : "1px solid transparent",
            outlineOffset: "4px",
            borderRadius: "2px",
          }}
        >
          Pricing that scales with you
        </h3>
        <p className="mt-1 text-[12px] text-paper/45">
          One plan. Predictable cost. Cancel any time.
        </p>

        {/* Billing toggle */}
        <div className="mt-5 flex items-center gap-3">
          <span className="font-mono text-[11px] text-paper/55">Monthly</span>
          <div
            ref={toggleRef}
            className="relative h-6 w-12 rounded-full border transition-all duration-500"
            style={{
              borderColor:
                target === "toggle"
                  ? "rgba(224,255,79,0.45)"
                  : "rgba(255,255,255,0.10)",
              background: flags.toggleGlow
                ? "rgba(224,255,79,0.18)"
                : "rgba(255,255,255,0.06)",
              animation: flags.toggleGlow
                ? "annualGlow 1.8s ease-in-out infinite"
                : "none",
            }}
          >
            <span
              className="absolute top-1 left-1 h-4 w-4 rounded-full"
              style={{
                transform: flags.toggleGlow ? "translateX(24px)" : "translateX(0)",
                transition: "transform 220ms cubic-bezier(0.32, 0.72, 0, 1), background 220ms ease",
                background: flags.toggleGlow
                  ? "var(--accent)"
                  : "rgba(245,242,236,0.85)",
              }}
              aria-hidden
            />
          </div>
          <span className="font-mono text-[11px] text-paper/85">Annual</span>
          <span
            className="ml-1 rounded-sm border border-accent/30 bg-accent/[0.07] px-1.5 py-0.5 font-mono text-[9px] text-accent"
            aria-hidden
          >
            -20%
          </span>
        </div>

        {/* Price chip */}
        <div
          ref={priceRef}
          className="mt-5 inline-flex items-baseline gap-2 rounded-md border px-4 py-3 transition-all duration-500"
          style={{
            borderColor:
              target === "price"
                ? "rgba(224,255,79,0.45)"
                : "rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.02)",
          }}
        >
          <span
            key={priceText}
            className="font-display text-paper"
            style={{
              fontWeight: 500,
              fontSize: "28px",
              letterSpacing: "-0.02em",
              animation: flags.annualPrice
                ? "diffResolve 0.6s ease-out"
                : undefined,
            }}
          >
            {priceText}
          </span>
          <span className="font-mono text-[11px] text-paper/45">
            per workspace
          </span>
        </div>

        {/* CTA */}
        <div className="mt-5">
          <button
            ref={ctaRef}
            type="button"
            className="rounded-md px-4 py-2 font-display text-[13px] transition-all duration-500"
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
          <p className="mt-2 font-mono text-[10px] text-paper/35">
            No card. 14 days. Local-first.
          </p>
        </div>
      </div>

      {/* Gaze dot — drifts to the active target. Positions are measured in
          pixels from each target element's bounding box so the ring sits
          centred on the element matching the "looking · ..." label. */}
      <span
        aria-hidden
        className="pointer-events-none absolute h-6 w-6 rounded-full"
        style={{
          left: 0,
          top: 0,
          transform: `translate(${gazeX - 12}px, ${gazeY - 12}px)`,
          border: "1px solid rgba(224, 255, 79, 0.5)",
          background: "rgba(224, 255, 79, 0.18)",
          animation: "gazePulse 2.2s ease-in-out infinite",
          willChange: "transform",
        }}
      />
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
  resolveFraction,
  resolvedHighlight,
}: CodeLineRowProps): React.ReactElement {
  const fadeOpacity = resolvedHighlight ? 1 - resolveFraction : 0;
  return (
    <div
      className="flex items-start gap-4 -mx-2 px-2 rounded-sm relative"
      style={{
        background: resolvedHighlight
          ? `rgba(130, 240, 130, ${0.18 * (1 - resolveFraction)})`
          : "transparent",
        boxShadow: resolvedHighlight
          ? `inset 2px 0 0 rgba(130, 240, 130, ${0.9 * (1 - resolveFraction)})`
          : "none",
        transition: "background 200ms linear",
      }}
    >
      <span className="font-mono text-[11px] text-paper/25 tabular-nums w-5 text-right select-none shrink-0 pt-px">
        {lineNo}
      </span>
      <span className="flex-1 whitespace-pre overflow-hidden relative">
        {denoising ? <DenoisingSquares /> : null}
        <span
          style={{
            opacity: denoising ? 0.15 : 1,
            transition: "opacity 200ms linear",
          }}
        >
          {tokens.map((token, i) => (
            <TokenSpan key={`${lineNo}-${i}`} token={token} />
          ))}
        </span>
        {resolvedHighlight && fadeOpacity > 0 ? (
          <span
            aria-hidden
            className="absolute -left-1 right-0 top-0 bottom-0 pointer-events-none rounded-sm"
            style={{
              background: `linear-gradient(90deg, rgba(130, 240, 130, ${
                0.08 * fadeOpacity
              }) 0%, transparent 60%)`,
            }}
          />
        ) : null}
      </span>
    </div>
  );
}

function TokenSpan({ token }: { readonly token: CodeToken }): React.ReactElement {
  const color =
    token.kind === "tag"
      ? "#f07178"
      : token.kind === "attr"
        ? "#ffcb6b"
        : token.kind === "string"
          ? "#c3e88d"
          : token.kind === "punct"
            ? "#9aa0b4"
            : "#d6d6dd";
  return <span style={{ color }}>{token.text}</span>;
}

// Renders a row of 14 colored squares that fade in and out, occupying the
// width of the code line during the denoise phase. Each square has a
// staggered animation delay so the effect looks like resolving noise.
function DenoisingSquares(): React.ReactElement {
  const cells = 16;
  return (
    <span
      aria-hidden
      className="absolute inset-0 flex items-center gap-[3px] pointer-events-none"
    >
      {Array.from({ length: cells }).map((_, i) => (
        <span
          key={`sq-${i}`}
          className="block h-3 w-3 rounded-[2px]"
          style={{
            background:
              i % 3 === 0
                ? "rgba(224, 255, 79, 0.55)"
                : i % 3 === 1
                  ? "rgba(34, 141, 242, 0.45)"
                  : "rgba(245, 242, 236, 0.35)",
            animation: `diffuseSquare 0.55s ease-out ${i * 0.025}s infinite`,
          }}
        />
      ))}
    </span>
  );
}

interface DifferentiatorsRailProps {
  readonly activeLabel: string | null;
}

function DifferentiatorsRail({
  activeLabel,
}: DifferentiatorsRailProps): React.ReactElement {
  return (
    <div className="rounded-lg border border-accent/30 bg-accent/[0.025] p-7 flex flex-col">
      <div className="flex items-baseline justify-between gap-4 mb-2">
        <h3
          className="font-display text-2xl sm:text-3xl text-paper"
          style={{ fontWeight: 400, letterSpacing: "-0.02em" }}
        >
          Only in eri
        </h3>
        <p className="mono-cap text-accent">The reason to switch</p>
      </div>
      <p className="text-[13px] text-paper/55 mb-5">
        The four primitives that turn the loop on the left into a single
        gesture — and the ones nobody else has shipped.
      </p>
      <ul className="space-y-2.5 flex-1">
        {DIFFERENTIATORS.map((feature) => {
          const isActive = feature.label === activeLabel;
          return (
            <li
              key={feature.label}
              className="rounded-md border p-3 transition-all duration-300"
              style={{
                borderColor: isActive
                  ? "rgba(224, 255, 79, 0.45)"
                  : "rgba(245, 242, 236, 0.06)",
                background: isActive
                  ? "rgba(224, 255, 79, 0.06)"
                  : "rgba(19, 19, 17, 0.4)",
              }}
            >
              <div className="flex items-start gap-2.5">
                <span
                  className="h-1.5 w-1.5 rounded-full shrink-0 mt-1.5 transition-all"
                  style={{
                    background: isActive
                      ? "var(--accent)"
                      : "rgba(245, 242, 236, 0.3)",
                    boxShadow: isActive
                      ? "0 0 10px rgba(224, 255, 79, 0.7)"
                      : "none",
                  }}
                  aria-hidden
                />
                <div className="min-w-0">
                  <p
                    className="text-[13.5px] transition-colors"
                    style={{
                      color: isActive
                        ? "var(--text-primary)"
                        : "rgba(245, 242, 236, 0.85)",
                    }}
                  >
                    {feature.label}
                  </p>
                  <p className="text-[12px] text-paper/45 mt-0.5">
                    {feature.note}
                  </p>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-5 pt-4 border-t border-white/[0.06] text-[12px] text-paper/45 leading-relaxed">
        Tab, ⌘K, Composer, agents, @-mentions, MCP — all in the box. The four
        above are the part nobody else ships.
      </p>
    </div>
  );
}


// ---------- helpers ----------

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function easeOut(x: number): number {
  // cubic-bezier(0.22, 1, 0.36, 1) approximation
  return 1 - Math.pow(1 - x, 3);
}
