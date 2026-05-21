"use client";

// Context pipeline section. Three columns: input signals on the left,
// the compile box in the middle, the router on the right. We rotate
// through four scripted scenes so the surface feels alive without
// pretending to be a real demo.

import { useEffect, useMemo, useState } from "react";

type Tier = "FREE" | "STARTER" | "PRO" | "PRO+";

interface InputRow {
  readonly icon: string;
  readonly label: string;
  readonly detail: string;
  readonly tier: Tier;
}

interface ModelLane {
  readonly key: string;
  readonly name: string;
  readonly lane: string;
  readonly tier: Tier;
}

interface DiffLine {
  readonly kind: "add" | "remove" | "meta";
  readonly text: string;
}

interface Scene {
  readonly phrase: string;
  readonly voiceDetail: string;
  readonly gaze: string;
  readonly gazeFile: string;
  readonly recent: string;
  readonly codebase: string;
  readonly compiled: string;
  readonly picked: string;
  readonly reason: string;
  readonly previewKind:
    | "toggle"
    | "imports"
    | "auth"
    | "figma"
    | "heroHeadline"
    | "card"
    | "nav"
    | "renameCode";
  readonly previewLabel: string;
  // Relative position (% of preview canvas) for the gaze ring while idle and
  // its final resting spot once compile completes.
  readonly gazeStart: { x: number; y: number };
  readonly gazeEnd: { x: number; y: number };
  // Optional rest position the ring drifts toward AFTER the router fires —
  // simulates the user's eye moving on once the edit lands. Falls back to
  // gazeStart if omitted.
  readonly gazeRest?: { x: number; y: number };
  readonly diff: ReadonlyArray<DiffLine>;
}

const MODELS: ReadonlyArray<ModelLane> = [
  { key: "eri-engine", name: "eri's engine", lane: "diffusion · short edits", tier: "FREE" },
  { key: "sonnet", name: "Claude Sonnet 4.6", lane: "polish · careful diffs", tier: "STARTER" },
  { key: "opus", name: "Claude Opus 4.7", lane: "reasoning · long horizon", tier: "PRO" },
  { key: "gemini", name: "Gemini 2.5 Pro", lane: "multimodal · image-in", tier: "PRO+" },
];

const SCENES: ReadonlyArray<Scene> = [
  {
    phrase: "make it glow",
    voiceDetail: "3 words · captured in 410ms",
    gaze: "Toggle.billing-cycle",
    gazeFile: "pricing.tsx · line 47",
    recent: "added annual toggle 2 turns ago · 4 props on draft",
    codebase: "ToggleProps · tokens.accent.neon · sibling: PriceCard",
    compiled:
      "add an eri-accent box-shadow halo to <Toggle> when value === 'annual', hover state, 200ms ease-out, respect tokens.accent.neon",
    picked: "eri-engine",
    reason: "single-file edit, < 20 lines — diffusion lane",
    previewKind: "toggle",
    previewLabel: "pricing.tsx · <Toggle>",
    // Start bottom-right of the toggle (near the $19 chip) and drift up-left
    // onto the Annual button. The Toggle pill sits roughly at y=33–43% of the
    // 220px canvas; Annual is the right half of the pill. After the edit
    // fires, the eye drifts back down toward the price chip — "saw the glow,
    // moving on."
    gazeStart: { x: 66, y: 55 },
    gazeEnd: { x: 58, y: 38 },
    gazeRest: { x: 35, y: 65 },
    diff: [
      { kind: "add", text: "+ shadow: 0 0 18px var(--accent);" },
      { kind: "meta", text: "~ Toggle.tsx · 1 line modified" },
    ],
  },
  {
    phrase: "fix the imports",
    voiceDetail: "3 words · captured in 380ms",
    gaze: "auth-form.tsx top of file",
    gazeFile: "auth-form.tsx · line 1",
    recent: "ran formatter 1 turn ago · 3 unused symbols flagged",
    codebase: "tsconfig paths: @/lib/* · prettier sort-imports rule on",
    compiled:
      "drop unused React + useMemo imports, alphabetize the remaining lines, keep type-only imports grouped at the top per the existing prettier order",
    picked: "sonnet",
    reason: "careful, deterministic cleanup — polish lane",
    previewKind: "imports",
    previewLabel: "auth-form.tsx · imports",
    gazeStart: { x: 70, y: 20 },
    gazeEnd: { x: 38, y: 38 },
    diff: [
      { kind: "remove", text: "- import { useMemo } from 'react'" },
      { kind: "meta", text: "~ imports sorted" },
      { kind: "meta", text: "~ 3 lines, 1 file" },
    ],
  },
  {
    phrase: "redesign the auth flow",
    voiceDetail: "4 words · captured in 420ms",
    gaze: "/(auth)/sign-in/page.tsx",
    gazeFile: "sign-in/page.tsx · line 14",
    recent: "scaffolded session middleware 5 turns ago",
    codebase: "uses cookie sessions · 6 files touch /(auth) · 2 server routes",
    compiled:
      "refactor /(auth)/* to server actions, replace cookie middleware with iron-session, migrate sign-in + sign-up + forgot-password, update the 6 callers, leave a Release Notes bullet",
    picked: "opus",
    reason: "cross-file refactor with state migration — deep lane",
    previewKind: "auth",
    previewLabel: "sign-in.tsx",
    gazeStart: { x: 25, y: 78 },
    gazeEnd: { x: 50, y: 56 },
    diff: [
      { kind: "add", text: "+ 'use server' directive" },
      { kind: "meta", text: "~ session via iron-session" },
      { kind: "meta", text: "~ 6 callers updated" },
    ],
  },
  {
    phrase: "match this Figma",
    voiceDetail: "3 words + 1 image · 430ms",
    gaze: "(attached) Figma frame 'PricingHero'",
    gazeFile: "drag · 1 image attached",
    recent: "asked for hero polish 1 turn ago",
    codebase: "design tokens loaded · Inter + Space Grotesk · radii.xl=20",
    compiled:
      "implement the hero shown in the attached frame: gradient mesh top-left, badge row centered, two CTAs with the eri-accent fill, match exact spacing from the image",
    picked: "gemini",
    reason: "image grounding required — multimodal lane",
    previewKind: "figma",
    previewLabel: "pricing-hero.tsx",
    gazeStart: { x: 25, y: 25 },
    gazeEnd: { x: 55, y: 65 },
    diff: [
      { kind: "add", text: "+ <Hero gradient=\"mesh-1\" />" },
      { kind: "add", text: "+ accent CTA + headline" },
      { kind: "meta", text: "~ 1 new component" },
    ],
  },
  {
    phrase: "bigger",
    voiceDetail: "1 word · captured in 280ms",
    gaze: "Hero.h1",
    gazeFile: "landing/hero.tsx · line 22",
    recent: "tightened tracking last turn · style scratchpad",
    codebase: "Hero component · uses font-display tokens · spacing scale 4–96",
    compiled:
      "bump Hero h1 font-size from 32px → 48px and tracking-tight to balance line-height; keep Tailwind tokens",
    picked: "eri-engine",
    reason: "short diff, single file — diffusion lane",
    previewKind: "heroHeadline",
    previewLabel: "landing/hero.tsx · <h1>",
    gazeStart: { x: 42, y: 40 },
    gazeEnd: { x: 50, y: 55 },
    diff: [
      { kind: "add", text: "+ text-5xl tracking-tight" },
      { kind: "meta", text: "~ Hero.tsx · 1 line modified" },
    ],
  },
  {
    phrase: "darker",
    voiceDetail: "1 word · captured in 295ms",
    gaze: "Card.surface",
    gazeFile: "dashboard/Card.tsx · line 14",
    recent: "added Card component 3 turns ago · stroked variant",
    codebase: "Card · uses bg-card token · sibling: Surface, Panel",
    compiled:
      "swap Card bg from #181818 to #0a0a0a; bump border opacity to 12%; preserve the rest of the token palette",
    picked: "eri-engine",
    reason: "token swap, < 5 lines — diffusion lane",
    previewKind: "card",
    previewLabel: "dashboard/Card.tsx",
    gazeStart: { x: 60, y: 28 },
    gazeEnd: { x: 47, y: 52 },
    diff: [
      { kind: "meta", text: "~ bg-card token: #181818 → #0a0a0a" },
      { kind: "meta", text: "~ Card.tsx · 1 line modified" },
    ],
  },
  {
    phrase: "center this",
    voiceDetail: "2 words · captured in 340ms",
    gaze: "Nav.items",
    gazeFile: "Nav.tsx · line 8",
    recent: "restyled nav last week · 4 anchor links",
    codebase: "Nav · flex container · 4 children · current main-axis: flex-start",
    compiled:
      "change Nav from justify-start to justify-center; verify mobile breakpoint stays left-aligned",
    picked: "sonnet",
    reason: "small refactor with layout reasoning — polish lane",
    previewKind: "nav",
    previewLabel: "Nav.tsx",
    gazeStart: { x: 35, y: 33 },
    gazeEnd: { x: 36, y: 33 },
    diff: [
      { kind: "meta", text: "~ justify-start → justify-center" },
      { kind: "meta", text: "~ Nav.tsx · 1 line modified" },
      { kind: "add", text: "+ md: prefix guard" },
    ],
  },
  {
    phrase: "rename this",
    voiceDetail: "2 words · captured in 360ms",
    gaze: "usePricing.data",
    gazeFile: "usePricing.tsx · line 6",
    recent: "renamed userMap 2 turns ago · across 4 callers",
    codebase: "useState binding · 7 references in same file · 0 cross-file",
    compiled:
      "rename usePricing.data → usePricing.pricingTiers across all 7 references in file; keep the type-binding intact",
    picked: "sonnet",
    reason: "rename with reference tracking — polish lane",
    previewKind: "renameCode",
    previewLabel: "usePricing.tsx",
    gazeStart: { x: 45, y: 25 },
    gazeEnd: { x: 18, y: 32 },
    diff: [
      { kind: "meta", text: "~ data → pricingTiers" },
      { kind: "meta", text: "~ usePricing.tsx · 7 references" },
      { kind: "add", text: "+ ✓ type binding preserved" },
    ],
  },
];

const TIER_STYLE: Record<Tier, string> = {
  FREE: "bg-white/5 text-[#8b8b96] border-white/10",
  STARTER: "bg-[#228df2]/10 text-[#7fb8ff] border-[#228df2]/30",
  PRO: "bg-[#228df2]/20 text-[#a8cfff] border-[#228df2]/50",
  "PRO+": "bg-[#e0ff4f]/10 text-[#e0ff4f] border-[#e0ff4f]/40",
};

function TierPill({ tier }: { tier: Tier }): React.ReactElement {
  return (
    <span
      className={`inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[9px] font-medium tracking-wider ${TIER_STYLE[tier]}`}
    >
      {tier}
    </span>
  );
}

// One animation tick is short (110ms). A scene takes ~5s end to end:
// 4 input pulses, then incremental type-out, then router lock, then reset.
const TICK_MS = 110;
const SETTLE_TICKS = 14; // ~1.5s — eye sits on target before the pipeline starts
const PULSE_TICKS = 4; // ~440ms per input row lighting up
const COMPILE_TICKS = 12; // ~1.3s to fill the compiled prompt
const ROUTE_HOLD_TICKS = 20; // ~2.2s to show the picked model + edit applied

export function PromptPipeline(): React.ReactElement {
  const [sceneIndex, setSceneIndex] = useState<number>(0);
  const [tick, setTick] = useState<number>(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const totalTicks = SETTLE_TICKS + PULSE_TICKS * 4 + COMPILE_TICKS + ROUTE_HOLD_TICKS;

  useEffect(() => {
    if (tick >= totalTicks) {
      setTick(0);
      setSceneIndex((i) => (i + 1) % SCENES.length);
    }
  }, [tick, totalTicks]);

  const scene = SCENES[sceneIndex] ?? SCENES[0];

  const inputRows: ReadonlyArray<InputRow> = useMemo(
    () => [
      {
        icon: "voice",
        label: `"${scene.phrase}"`,
        detail: scene.voiceDetail,
        tier: "FREE",
      },
      {
        icon: "gaze",
        label: scene.gaze,
        detail: scene.gazeFile,
        tier: "FREE",
      },
      {
        icon: "history",
        label: "recent turns",
        detail: scene.recent,
        tier: "STARTER",
      },
      {
        icon: "codebase",
        label: "codebase context",
        detail: scene.codebase,
        tier: "PRO",
      },
    ],
    [scene],
  );

  // The first SETTLE_TICKS of each scene are dead time — the gaze sits on the
  // target element so the user can actually see what eri is looking at before
  // the input/compile/route process kicks off.
  const pipelineTick = Math.max(0, tick - SETTLE_TICKS);

  // Which input row is "lit" right now (during the pulse phase).
  const pulsePhase = Math.min(pipelineTick, PULSE_TICKS * 4);
  const litRow = Math.floor(pulsePhase / PULSE_TICKS);
  const inPulsePhase = pipelineTick >= 0 && pipelineTick < PULSE_TICKS * 4;

  // How many characters of the compiled prompt have been typed.
  const compileTick = Math.max(0, pipelineTick - PULSE_TICKS * 4);
  const compileProgress = Math.min(compileTick / COMPILE_TICKS, 1);
  const compiledShown = scene.compiled.slice(
    0,
    Math.floor(scene.compiled.length * compileProgress),
  );

  const compileDone = compileTick >= COMPILE_TICKS;
  const routerActive = compileDone;

  return (
    <section className="border-t border-white/5 bg-[#0A0A0A] py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-12 max-w-3xl">
          <div className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-[#e0ff4f]">
            Context pipeline
          </div>
          <h2 className="text-3xl font-semibold tracking-tight text-[#d6d6dd] sm:text-4xl">
            Three lazy words. One precise prompt.
          </h2>
          <p className="mt-4 text-[#8b8b96]">
            You speak in fragments. eri reads your gaze, your last few turns,
            and the file you&apos;re actually in — then compiles a prompt the
            model can act on, and routes it to whichever brain handles that
            kind of work best.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* INPUT COLUMN */}
          <div className="lg:col-span-4">
            <ColumnHeader index={1} title="Input" subtitle="signals eri already has" />
            <div className="space-y-2">
              {inputRows.map((row, i) => {
                const isLit = inPulsePhase ? i === litRow : compileDone ? false : i <= 3;
                return (
                  <InputCell key={row.icon} row={row} lit={isLit} />
                );
              })}
            </div>
          </div>

          {/* COMPILE COLUMN */}
          <div className="lg:col-span-4">
            <ColumnHeader index={2} title="Compile" subtitle="assemble + ground" />
            <div className="rounded-md border border-white/10 bg-[#181818] p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      compileDone ? "bg-[#e0ff4f]" : "bg-[#228df2] animate-pulse"
                    }`}
                  />
                  <span className="text-[10px] font-medium uppercase tracking-wider text-[#8b8b96]">
                    {compileDone ? "compiled" : "assembling"}
                  </span>
                </div>
                <span className="font-mono text-[10px] text-[#8b8b96]">
                  {Math.floor(compileProgress * 100)}%
                </span>
              </div>

              <CompileBar progress={compileProgress} />

              <div className="mt-4 rounded border border-white/10 bg-[#0A0A0A] p-3">
                <div className="mb-1.5 font-mono text-[9px] uppercase tracking-wider text-[#8b8b96]">
                  compiled prompt
                </div>
                <p className="min-h-[120px] font-mono text-[12px] leading-relaxed text-[#d6d6dd]">
                  {compiledShown}
                  {!compileDone && <span className="animate-pulse text-[#e0ff4f]">▌</span>}
                </p>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                <CompileTag label="voice intent" tier="FREE" />
                <CompileTag label="gaze anchor" tier="FREE" />
                <CompileTag label="tokens lookup" tier="PRO" />
                <CompileTag label="tone preset" tier="PRO+" />
              </div>
            </div>
          </div>

          {/* ROUTE COLUMN */}
          <div className="lg:col-span-4">
            <ColumnHeader index={3} title="Route" subtitle="pick the right brain" />
            <div className="rounded-md border border-white/10 bg-[#181818] p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <RouterIcon />
                  <span className="text-[11px] font-medium text-[#d6d6dd]">eri router</span>
                </div>
                <span className="font-mono text-[9px] text-[#8b8b96]">
                  crates/eri_router
                </span>
              </div>

              <div className="space-y-1.5">
                {MODELS.map((m) => {
                  const isPicked = routerActive && m.key === scene.picked;
                  return <ModelRow key={m.key} model={m} picked={isPicked} />;
                })}
              </div>

              <div className="mt-4 rounded border border-white/10 bg-[#0A0A0A] p-3">
                <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-[#8b8b96]">
                  decision
                </div>
                {routerActive ? (
                  <div>
                    <div className="text-[12px] text-[#d6d6dd]">
                      picked{" "}
                      <span className="font-medium text-[#e0ff4f]">
                        {MODELS.find((m) => m.key === scene.picked)?.name}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-[#8b8b96]">
                      {scene.reason}
                    </div>
                  </div>
                ) : (
                  <div className="text-[11px] text-[#8b8b96]">
                    waiting on compiled prompt…
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <PreviewStrip
          scene={scene}
          routerActive={routerActive}
          compileProgress={compileProgress}
          tick={tick}
          totalTicks={totalTicks}
        />

        <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-2 text-[11px] text-[#8b8b96]">
          <span className="flex items-center gap-1.5">
            <TierPill tier="FREE" /> baseline pipeline
          </span>
          <span className="flex items-center gap-1.5">
            <TierPill tier="STARTER" /> iteration history
          </span>
          <span className="flex items-center gap-1.5">
            <TierPill tier="PRO" /> codebase brain · auto-route
          </span>
          <span className="flex items-center gap-1.5">
            <TierPill tier="PRO+" /> multimodal · voice override
          </span>
        </div>
      </div>
    </section>
  );
}

function ColumnHeader({
  index,
  title,
  subtitle,
}: {
  index: number;
  title: string;
  subtitle: string;
}): React.ReactElement {
  return (
    <div className="mb-3 flex items-baseline gap-2">
      <span className="font-mono text-[10px] text-[#8b8b96]">0{index}</span>
      <span className="text-[11px] font-medium uppercase tracking-wider text-[#d6d6dd]">
        {title}
      </span>
      <span className="text-[10px] text-[#8b8b96]">— {subtitle}</span>
    </div>
  );
}

function InputCell({
  row,
  lit,
}: {
  row: InputRow;
  lit: boolean;
}): React.ReactElement {
  return (
    <div
      className={`flex items-start gap-3 rounded-md border bg-[#181818] p-3 transition-colors duration-200 ${
        lit
          ? "border-[#e0ff4f]/50 shadow-[0_0_0_1px_rgba(224,255,79,0.15)]"
          : "border-white/10"
      }`}
    >
      <div
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded ${
          lit ? "bg-[#e0ff4f]/15 text-[#e0ff4f]" : "bg-white/5 text-[#8b8b96]"
        }`}
      >
        <InputIcon kind={row.icon} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="truncate font-mono text-[12px] text-[#d6d6dd]">
            {row.label}
          </div>
          <TierPill tier={row.tier} />
        </div>
        <div className="mt-0.5 truncate text-[11px] text-[#8b8b96]">
          {row.detail}
        </div>
      </div>
    </div>
  );
}

function InputIcon({ kind }: { kind: string }): React.ReactElement {
  switch (kind) {
    case "voice":
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <rect x="4.5" y="1.5" width="3" height="6" rx="1.5" stroke="currentColor" />
          <path d="M2.5 6c0 2 1.5 3.5 3.5 3.5S9.5 8 9.5 6M6 9.5v1" stroke="currentColor" strokeLinecap="round" />
        </svg>
      );
    case "gaze":
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M1 6s2-3.5 5-3.5S11 6 11 6s-2 3.5-5 3.5S1 6 1 6Z" stroke="currentColor" />
          <circle cx="6" cy="6" r="1.5" fill="currentColor" />
        </svg>
      );
    case "history":
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <circle cx="6" cy="6" r="4.5" stroke="currentColor" />
          <path d="M6 3.5V6l1.75 1" stroke="currentColor" strokeLinecap="round" />
        </svg>
      );
    case "codebase":
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M4 3 1.5 6 4 9M8 3l2.5 3L8 9" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    default:
      return <span />;
  }
}

function CompileBar({ progress }: { progress: number }): React.ReactElement {
  const segments = 24;
  const lit = Math.floor(progress * segments);
  return (
    <div className="flex gap-[2px]">
      {Array.from({ length: segments }).map((_, i) => (
        <div
          key={i}
          className={`h-1 flex-1 rounded-[1px] transition-colors ${
            i < lit ? "bg-[#e0ff4f]" : i === lit ? "bg-[#228df2]" : "bg-white/5"
          }`}
        />
      ))}
    </div>
  );
}

function CompileTag({ label, tier }: { label: string; tier: Tier }): React.ReactElement {
  return (
    <div className="flex items-center gap-1 rounded border border-white/10 bg-[#0A0A0A] px-1.5 py-0.5">
      <span className="font-mono text-[10px] text-[#8b8b96]">{label}</span>
      <TierPill tier={tier} />
    </div>
  );
}

function ModelRow({
  model,
  picked,
}: {
  model: ModelLane;
  picked: boolean;
}): React.ReactElement {
  return (
    <div
      className={`flex items-center gap-2 rounded border px-2.5 py-1.5 transition-colors ${
        picked
          ? "border-[#e0ff4f]/50 bg-[#e0ff4f]/5"
          : "border-white/10 bg-[#0A0A0A]"
      }`}
    >
      <div
        className={`h-2 w-2 shrink-0 rounded-full ${
          picked ? "bg-[#e0ff4f] shadow-[0_0_8px_#e0ff4f]" : "bg-white/15"
        }`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span
            className={`truncate text-[12px] ${
              picked ? "text-[#e0ff4f]" : "text-[#d6d6dd]"
            }`}
          >
            {model.name}
          </span>
          <TierPill tier={model.tier} />
        </div>
        <div className="truncate font-mono text-[10px] text-[#8b8b96]">
          {model.lane}
        </div>
      </div>
    </div>
  );
}

function RouterIcon(): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <circle cx="2.5" cy="6" r="1.25" stroke="currentColor" className="text-[#8b8b96]" />
      <circle cx="9.5" cy="3" r="1.25" stroke="currentColor" className="text-[#8b8b96]" />
      <circle cx="9.5" cy="9" r="1.25" stroke="currentColor" className="text-[#8b8b96]" />
      <path d="M3.5 5.5 8.5 3.5M3.5 6.5 8.5 8.5" stroke="currentColor" className="text-[#8b8b96]" />
    </svg>
  );
}

function PreviewStrip({
  scene,
  routerActive,
  compileProgress,
  tick,
  totalTicks,
}: {
  scene: Scene;
  routerActive: boolean;
  compileProgress: number;
  tick: number;
  totalTicks: number;
}): React.ReactElement {
  // The gaze ring sits on gazeEnd from frame 1 — the user has already seen
  // the element they want to edit. Once the router fires, the ring drifts
  // toward gazeRest (the "next thing" the eye looks at). If gazeRest is
  // omitted, the ring stays locked on gazeEnd through the hold phase.
  const ROUTE_TICK = SETTLE_TICKS + PULSE_TICKS * 4 + COMPILE_TICKS;
  const ticksSinceRoute = routerActive ? Math.max(0, tick - ROUTE_TICK) : 0;
  const departT = scene.gazeRest ? Math.min(1, ticksSinceRoute / 8) : 0;
  const restX = scene.gazeRest?.x ?? scene.gazeEnd.x;
  const restY = scene.gazeRest?.y ?? scene.gazeEnd.y;
  const gx = scene.gazeEnd.x + (restX - scene.gazeEnd.x) * departT;
  const gy = scene.gazeEnd.y + (restY - scene.gazeEnd.y) * departT;
  void compileProgress;
  void totalTicks;

  // Hold phase begins ~1s after the router picks (ROUTE_HOLD_TICKS = 10).
  const holdTick = Math.max(0, tick - (totalTicks - ROUTE_HOLD_TICKS));
  const settled = routerActive && holdTick > 2;
  return (
    <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
      <div className="lg:col-span-7">
        <ColumnHeader index={4} title="Preview" subtitle="what you're looking at" />
        <div className="relative overflow-hidden rounded-md border border-white/10 bg-[#181818]">
          <div className="flex items-center justify-between border-b border-white/5 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-[#e0ff4f]/70" />
              <span className="font-mono text-[10px] text-[#8b8b96]">
                {scene.previewLabel}
              </span>
            </div>
            <span className="font-mono text-[9px] uppercase tracking-wider text-[#8b8b96]">
              live preview
            </span>
          </div>
          <div
            className="relative h-[220px] bg-[#0A0A0A]"
          >
            {/* Preview shows the existing UI clearly from frame 1 — these are
                edit scenes, not build-from-scratch. The "applied" boolean
                triggers the visible edit animation when the router commits. */}
            <PreviewCanvas scene={scene} applied={routerActive} settled={settled} />
            <GazeRing x={gx} y={gy} />
            {scene.previewKind === "figma" && (
              <div className="absolute right-2 top-2 inline-flex items-center gap-1 rounded border border-[#e0ff4f]/40 bg-[#0A0A0A]/80 px-1.5 py-0.5 font-mono text-[9px] text-[#e0ff4f]">
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                  <rect x="0.5" y="0.5" width="7" height="7" rx="1" stroke="currentColor" />
                  <path d="M2 5l1.5-2 1.2 1.4L6 3" stroke="currentColor" strokeLinecap="round" />
                </svg>
                image attached
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="lg:col-span-5">
        <ColumnHeader index={5} title="What changed" subtitle="diff applied" />
        <div className="rounded-md border border-white/10 bg-[#181818] p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  routerActive ? "bg-[#e0ff4f]" : "bg-white/10"
                }`}
              />
              <span className="text-[10px] font-medium uppercase tracking-wider text-[#8b8b96]">
                {routerActive ? "applied" : "awaiting model"}
              </span>
            </div>
            <span className="font-mono text-[9px] text-[#8b8b96]">
              {routerActive
                ? MODELS.find((m) => m.key === scene.picked)?.name ?? ""
                : "—"}
            </span>
          </div>
          <div className="space-y-1.5 font-mono text-[11px] leading-relaxed">
            {scene.diff.map((line, i) => (
              <div
                key={`${scene.phrase}-${i}`}
                className="transition-all duration-300"
                style={{
                  opacity: routerActive ? 1 : 0,
                  transform: routerActive ? "translateY(0)" : "translateY(4px)",
                  transitionDelay: `${i * 90}ms`,
                  color:
                    line.kind === "add"
                      ? "#e0ff4f"
                      : line.kind === "remove"
                        ? "#f87171"
                        : "#8b8b96",
                }}
              >
                {line.text}
              </div>
            ))}
          </div>
          <div className="mt-4 rounded border border-white/10 bg-[#0A0A0A] p-2.5">
            <div className="font-mono text-[9px] uppercase tracking-wider text-[#8b8b96]">
              effect
            </div>
            <div className="mt-1 text-[11px] text-[#d6d6dd]">
              {routerActive
                ? "change rendered in your editor preview — gaze ring follows."
                : "diffusion denoising · preview will resolve on lock."}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function GazeRing({ x, y }: { x: number; y: number }): React.ReactElement {
  return (
    <div
      className="pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#e0ff4f]/40 transition-all duration-700 ease-out"
      style={{
        left: `${x}%`,
        top: `${y}%`,
        boxShadow: "0 0 18px rgba(224, 255, 79, 0.45)",
        animation: "pulse 1.4s ease-in-out infinite",
      }}
    >
      <div className="absolute inset-[6px] rounded-full bg-[#e0ff4f]/30" />
    </div>
  );
}

function PreviewCanvas({
  scene,
  applied,
  settled,
}: {
  scene: Scene;
  applied: boolean;
  settled: boolean;
}): React.ReactElement {
  switch (scene.previewKind) {
    case "toggle":
      return <TogglePreview applied={applied} />;
    case "imports":
      return <ImportsPreview applied={applied} settled={settled} />;
    case "auth":
      return <AuthPreview applied={applied} />;
    case "figma":
      return <FigmaPreview applied={applied} />;
    case "heroHeadline":
      return <HeroHeadlinePreview applied={applied} />;
    case "card":
      return <CardPreview applied={applied} />;
    case "nav":
      return <NavPreview applied={applied} />;
    case "renameCode":
      return <RenameCodePreview applied={applied} settled={settled} />;
  }
}

function TogglePreview({ applied }: { applied: boolean }): React.ReactElement {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6">
      <div className="text-[10px] uppercase tracking-wider text-[#8b8b96]">
        Billing cycle
      </div>
      <div className="flex items-center rounded-full border border-white/10 bg-[#181818] p-1">
        <div className="rounded-full px-4 py-1.5 text-[11px] text-[#8b8b96]">
          Monthly
        </div>
        <div
          className="rounded-full px-4 py-1.5 text-[11px] text-[#d6d6dd] transition-all duration-500"
          style={{
            background: "#181818",
            boxShadow: applied
              ? "0 0 18px rgba(224, 255, 79, 0.55), inset 0 0 0 1px rgba(224, 255, 79, 0.5)"
              : "0 0 0px rgba(224, 255, 79, 0)",
            color: applied ? "#e0ff4f" : "#d6d6dd",
          }}
        >
          Annual
        </div>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-[22px] font-semibold text-[#d6d6dd]">$19</span>
        <span className="text-[11px] text-[#8b8b96]">/mo · billed annually</span>
      </div>
      <button
        className="rounded border border-white/10 bg-[#181818] px-3 py-1.5 text-[11px] text-[#d6d6dd] transition-colors"
        style={{
          borderColor: applied ? "rgba(224, 255, 79, 0.4)" : "rgba(255,255,255,0.1)",
        }}
      >
        Start free trial
      </button>
    </div>
  );
}

function ImportsPreview({
  applied,
  settled,
}: {
  applied: boolean;
  settled: boolean;
}): React.ReactElement {
  // Raw (pre-apply) lines vs the sorted, pruned result. We render both stacks
  // and crossfade on `applied` so the user sees the reflow.
  const before: ReadonlyArray<string> = [
    "import React, { useMemo } from 'react'",
    "import { z } from 'zod'",
    "import { useForm } from 'react-hook-form'",
    "import { Button } from '@/ui/button'",
    "import { signIn } from '@/lib/auth'",
  ];
  const after: ReadonlyArray<string> = [
    "import { Button } from '@/ui/button'",
    "import { signIn } from '@/lib/auth'",
    "import { useForm } from 'react-hook-form'",
    "import { z } from 'zod'",
  ];
  return (
    <div className="h-full px-5 py-4 font-mono text-[11px] leading-[1.7]">
      {!settled
        ? before.map((line, i) => {
            const struck = applied && (line.includes("useMemo") || line.startsWith("import React"));
            return (
              <div
                key={`b-${i}`}
                className="flex gap-3 transition-all duration-500"
                style={{
                  opacity: struck ? 0.35 : 1,
                  textDecoration: struck ? "line-through" : "none",
                  color: struck ? "#f87171" : "#d6d6dd",
                }}
              >
                <span className="w-4 text-right text-[#8b8b96]">{i + 1}</span>
                <span>{line}</span>
              </div>
            );
          })
        : after.map((line, i) => (
            <div key={`a-${i}`} className="flex gap-3 text-[#d6d6dd]">
              <span className="w-4 text-right text-[#8b8b96]">{i + 1}</span>
              <span>{line}</span>
            </div>
          ))}
    </div>
  );
}

function AuthPreview({ applied }: { applied: boolean }): React.ReactElement {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="w-full max-w-[260px] rounded border border-white/10 bg-[#181818] p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[12px] font-medium text-[#d6d6dd]">Sign in</div>
          {applied && (
            <span className="inline-flex items-center rounded border border-[#e0ff4f]/40 bg-[#e0ff4f]/10 px-1.5 py-0.5 font-mono text-[9px] text-[#e0ff4f]">
              &lt;server action&gt;
            </span>
          )}
        </div>
        <div className="space-y-2">
          <div
            className="rounded border bg-[#0A0A0A] px-2.5 py-1.5 text-[10px] text-[#8b8b96] transition-colors"
            style={{
              borderColor: applied
                ? "rgba(224, 255, 79, 0.25)"
                : "rgba(255,255,255,0.1)",
            }}
          >
            email@domain.com
          </div>
          <div
            className="rounded border px-2.5 py-1.5 text-[10px] transition-all"
            style={{
              borderColor: applied
                ? "rgba(224, 255, 79, 0.25)"
                : "rgba(255,255,255,0.1)",
              background: applied ? "transparent" : "#0A0A0A",
              borderStyle: applied ? "dashed" : "solid",
              color: "#8b8b96",
            }}
          >
            ••••••••
          </div>
          <button
            className="w-full rounded px-2.5 py-1.5 text-[11px] transition-colors"
            style={{
              background: applied ? "#e0ff4f" : "#181818",
              color: applied ? "#0A0A0A" : "#d6d6dd",
              border: applied ? "1px solid #e0ff4f" : "1px solid rgba(255,255,255,0.1)",
            }}
          >
            Continue
          </button>
        </div>
        <div className="mt-3 font-mono text-[9px] text-[#8b8b96]">
          {applied ? "session: iron-session · 6 callers migrated" : "session: cookie middleware"}
        </div>
      </div>
    </div>
  );
}

function FigmaPreview({ applied }: { applied: boolean }): React.ReactElement {
  return (
    <div className="flex h-full flex-col gap-2 px-5 py-4">
      <div className="flex h-12 items-center gap-3 rounded border border-dashed border-white/15 bg-[#0A0A0A] px-3">
        <div className="grid h-8 w-12 place-items-center rounded bg-gradient-to-br from-[#e0ff4f]/40 via-[#228df2]/40 to-[#e0ff4f]/10">
          <span className="font-mono text-[9px] text-[#0A0A0A]">FRAME</span>
        </div>
        <div>
          <div className="font-mono text-[10px] text-[#d6d6dd]">PricingHero.png</div>
          <div className="font-mono text-[9px] text-[#8b8b96]">1440 × 560 · pinned</div>
        </div>
      </div>
      <div
        className="relative flex-1 overflow-hidden rounded border border-white/10 transition-all duration-700"
        style={{
          background: applied
            ? "radial-gradient(120% 80% at 20% 0%, rgba(224,255,79,0.25), transparent 55%), radial-gradient(80% 80% at 90% 100%, rgba(34,141,242,0.25), transparent 55%), #0A0A0A"
            : "#0A0A0A",
        }}
      >
        {applied ? (
          <div className="flex h-full flex-col items-center justify-center px-4 text-center">
            <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-[#e0ff4f]">
              new in 2026
            </div>
            <div className="text-[15px] font-semibold leading-tight text-[#d6d6dd]">
              Ship faster with eri.
            </div>
            <div className="mt-1 text-[10px] text-[#8b8b96]">
              voice · gaze · routed models
            </div>
            <button className="mt-2 rounded bg-[#e0ff4f] px-3 py-1 text-[10px] font-medium text-[#0A0A0A]">
              Get early access
            </button>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center font-mono text-[10px] text-[#8b8b96]">
            placeholder · awaiting render
          </div>
        )}
      </div>
    </div>
  );
}

function HeroHeadlinePreview({ applied }: { applied: boolean }): React.ReactElement {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <div className="text-[10px] uppercase tracking-wider text-[#8b8b96]">
        landing / hero
      </div>
      <div
        className="font-semibold text-[#d6d6dd] transition-all duration-700"
        style={{
          fontSize: applied ? "44px" : "30px",
          letterSpacing: applied ? "-0.03em" : "-0.005em",
          lineHeight: applied ? "1.02" : "1.18",
        }}
      >
        Ship at the speed
        <br />
        you think.
      </div>
      <div
        className="text-[#8b8b96] transition-all duration-700"
        style={{
          fontSize: "11px",
          marginTop: applied ? "2px" : "8px",
          opacity: applied ? 0.85 : 1,
        }}
      >
        voice · gaze · diffusion edits
      </div>
    </div>
  );
}

function CardPreview({ applied }: { applied: boolean }): React.ReactElement {
  return (
    <div className="flex h-full items-center justify-center px-8">
      <div
        className="w-full max-w-[280px] rounded-md p-4 transition-all duration-700"
        style={{
          background: applied ? "#0a0a0a" : "#181818",
          border: applied
            ? "1px solid rgba(255,255,255,0.12)"
            : "1px solid rgba(255,255,255,0.06)",
          boxShadow: applied
            ? "0 0 0 1px rgba(224,255,79,0.06) inset"
            : "none",
        }}
      >
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[12px] font-medium text-[#d6d6dd]">
            Active sessions
          </div>
          <span className="font-mono text-[9px] text-[#8b8b96]">today</span>
        </div>
        <div className="text-[24px] font-semibold text-[#d6d6dd]">
          1,284
        </div>
        <div className="mt-1 text-[10px] text-[#8b8b96]">
          +12.4% vs yesterday
        </div>
        <div className="mt-3 flex h-8 items-end gap-1">
          {[3, 5, 4, 6, 8, 7, 9, 11, 10, 12].map((h, i) => (
            <div
              key={i}
              className="flex-1 rounded-[1px] bg-[#e0ff4f]/30"
              style={{ height: `${h * 6}%` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function NavPreview({ applied }: { applied: boolean }): React.ReactElement {
  const items = ["Product", "Pricing", "Docs", "Changelog"] as const;
  return (
    <div className="flex h-full flex-col px-6 py-8">
      <div className="mb-3 text-[10px] uppercase tracking-wider text-[#8b8b96]">
        Nav.tsx
      </div>
      <div
        className="flex items-center gap-5 rounded border border-white/10 bg-[#181818] px-4 py-3 transition-all duration-700"
        style={{
          justifyContent: applied ? "center" : "flex-start",
        }}
      >
        <div className="font-mono text-[11px] text-[#e0ff4f]">eri</div>
        {items.map((label) => (
          <div key={label} className="text-[11px] text-[#d6d6dd]">
            {label}
          </div>
        ))}
      </div>
      <div className="mt-3 font-mono text-[9px] text-[#8b8b96]">
        {applied ? "justify-center · md:justify-center" : "justify-start"}
      </div>
    </div>
  );
}

function RenameCodePreview({
  applied,
  settled,
}: {
  applied: boolean;
  settled: boolean;
}): React.ReactElement {
  const before: ReadonlyArray<string> = [
    "export function usePricing() {",
    "  const [data, setData] = useState(initial)",
    "  useEffect(() => { setData(fetch()) }, [])",
    "  const visible = data.filter(t => t.shown)",
    "  return { data, refresh: () => setData(...) }",
    "}",
  ];
  const after: ReadonlyArray<string> = [
    "export function usePricing() {",
    "  const [pricingTiers, setPricingTiers] = useState(initial)",
    "  useEffect(() => { setPricingTiers(fetch()) }, [])",
    "  const visible = pricingTiers.filter(t => t.shown)",
    "  return { pricingTiers, refresh: () => setPricingTiers(...) }",
    "}",
  ];
  const lines = settled ? after : before;
  return (
    <div className="h-full overflow-hidden px-5 py-4 font-mono text-[10.5px] leading-[1.7]">
      {lines.map((line, i) => {
        const hasOld = !settled && line.includes("data") && i !== 0;
        const hasNew = settled && line.includes("pricingTiers") && i !== 0;
        return (
          <div
            key={`${settled ? "a" : "b"}-${i}`}
            className="flex gap-3 transition-all duration-300"
            style={{
              background: applied && hasOld ? "rgba(248,113,113,0.08)" : hasNew ? "rgba(224,255,79,0.08)" : "transparent",
            }}
          >
            <span className="w-4 shrink-0 text-right text-[#8b8b96]">{i + 1}</span>
            <span
              className="whitespace-pre text-[#d6d6dd]"
              style={{
                color: hasNew ? "#e0ff4f" : hasOld && applied ? "#f87171" : "#d6d6dd",
                textDecoration: hasOld && applied ? "line-through" : "none",
              }}
            >
              {line}
            </span>
          </div>
        );
      })}
    </div>
  );
}
