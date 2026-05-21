"use client";

// Centerpiece interactive demo. Three-column animated mock that loops every 12s.
// All animation is pure CSS keyframes + SVG — no framer-motion, no heavy JS libs.
// The single state we hold is the loop tick so we can scrub the demo
// deterministically and keep beats in lock-step across the three columns.
//
// The 12s loop is split into 3 × 4s iteration slots. Each slot runs its own
// listening → transcribing → denoising → ready mini-cycle and swaps in its own
// transcript + preview so the iteration rail's "done / active / queued" story
// matches the content the center and right panels are showing right now.

import type { ReactElement } from "react";
import { useEffect, useState } from "react";

const LOOP_MS = 18_000;
const TICK_MS = 80;
const ITERATION_COUNT = 3;

type Beat = "listening" | "transcribing" | "denoising" | "ready";

interface IterationEntry {
  readonly label: string;
  readonly time: string;
  readonly prompt: string;
  readonly renderPreview: (props: PreviewRenderProps) => ReactElement;
}

interface PreviewRenderProps {
  readonly slotProgress: number;
  readonly beat: Beat;
}

const ITERATIONS: ReadonlyArray<IterationEntry> = [
  {
    label: "Pricing tweak",
    time: "12:04",
    prompt: "make the annual price chip glow when toggled",
    renderPreview: (props) => <PricingPreview {...props} />,
  },
  {
    label: "Add testimonial row",
    time: "12:09",
    prompt: "add a row of three quote cards under the hero",
    renderPreview: (props) => <TestimonialsPreview {...props} />,
  },
  {
    label: "Coffee shop landing",
    time: "12:11",
    prompt:
      "build a coffee shop landing with a dark hero and a contact form",
    renderPreview: (props) => <CoffeeShopPreview {...props} />,
  },
];

type IterationStatus = "done" | "active" | "queued";

function iterationStatuses(progress: number): ReadonlyArray<IterationStatus> {
  // Three iterations across one 12s loop. Each owns ~33% of the loop, and
  // the rail walks active → done as the cycle progresses so the demo reads
  // as "this is the third turn — here are the two that came before it just now."
  const slot = activeSlot(progress);
  return ITERATIONS.map((_, index) =>
    index < slot ? "done" : index === slot ? "active" : "queued",
  );
}

function activeSlot(progress: number): number {
  return Math.min(ITERATION_COUNT - 1, Math.floor(progress * ITERATION_COUNT));
}

function slotProgress(progress: number): number {
  const scaled = progress * ITERATION_COUNT;
  const local = scaled - Math.floor(scaled);
  // Clamp to [0, 1) — when progress is exactly 1.0 (loop boundary) we want
  // to read as "ready" rather than wrap back into "listening".
  return Math.min(0.9999, Math.max(0, local));
}

function beatForSlotProgress(p: number): Beat {
  // 6s slot: 1.0s listening · 1.5s transcribing · 1.0s denoising · 2.5s ready.
  // The longer ready hold lets the finished preview breathe before the next
  // iteration cycles in.
  if (p < 0.17) return "listening";
  if (p < 0.42) return "transcribing";
  if (p < 0.58) return "denoising";
  return "ready";
}

function transcriptUpTo(prompt: string, p: number): string {
  // Type the slot's prompt out between slotProgress 0.17 and 0.42.
  const start = 0.17;
  const end = 0.42;
  if (p <= start) return "";
  if (p >= end) return prompt;
  const ratio = (p - start) / (end - start);
  const chars = Math.floor(ratio * prompt.length);
  return prompt.slice(0, chars);
}

export function EriDemo(): ReactElement {
  const [tick, setTick] = useState<number>(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setTick((t) => (t + TICK_MS) % LOOP_MS);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const progress = tick / LOOP_MS;
  const slot = activeSlot(progress);
  const slotP = slotProgress(progress);
  const beat = beatForSlotProgress(slotP);
  const iteration = ITERATIONS[slot] ?? ITERATIONS[ITERATION_COUNT - 1]!;
  const typedTranscript = transcriptUpTo(iteration.prompt, slotP);
  const statuses = iterationStatuses(progress);

  return (
    <section
      id="demo"
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
          <p className="mono-cap text-accent">Live</p>
          <h2 className="mt-4 font-display text-h1 text-balance font-normal">
            One sentence. One page. <span className="italic">No keys.</span>
          </h2>
          <p className="mt-5 max-w-xl text-body text-paper/60">
            Watch eri turn a single spoken request into a deployed page. The
            transcript runs locally, the eri Engine diffuses the diff, every beat
            below is real — slowed down so you can see it.
          </p>
        </div>

        <div className="mt-14">
          <DemoFrame
            beat={beat}
            typedTranscript={typedTranscript}
            iteration={iteration}
            slotProgress={slotP}
            statuses={statuses}
          />
        </div>
      </div>
    </section>
  );
}

interface DemoFrameProps {
  readonly beat: Beat;
  readonly typedTranscript: string;
  readonly iteration: IterationEntry;
  readonly slotProgress: number;
  readonly statuses: ReadonlyArray<IterationStatus>;
}

function DemoFrame({
  beat,
  typedTranscript,
  iteration,
  slotProgress: slotP,
  statuses,
}: DemoFrameProps): ReactElement {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-bg-2 shadow-[0_40px_120px_-20px_rgba(0,0,0,0.6)] overflow-hidden">
      {/* Window chrome */}
      <div className="flex items-center justify-between px-4 h-10 border-b border-white/[0.06] bg-bg-3">
        <div className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-white/10" />
          <span className="h-3 w-3 rounded-full bg-white/10" />
          <span className="h-3 w-3 rounded-full bg-white/10" />
        </div>
        <div className="font-mono text-[11px] text-paper/40">
          coffee-shop · main
        </div>
        <ModelPicker />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr_320px] min-h-[560px]">
        <IterationRail statuses={statuses} />
        <PreviewPane
          iteration={iteration}
          slotProgress={slotP}
          beat={beat}
        />
        <EriPanel beat={beat} typedTranscript={typedTranscript} />
      </div>
    </div>
  );
}

function ModelPicker(): ReactElement {
  return (
    <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-sm border border-white/[0.08] bg-bg-2 text-[11px] text-paper/70 font-mono">
      <span className="h-1.5 w-1.5 rounded-full bg-accent" />
      eri Engine
      <span aria-hidden className="text-paper/30 ml-0.5">
        ▾
      </span>
    </div>
  );
}

interface IterationRailProps {
  readonly statuses: ReadonlyArray<IterationStatus>;
}

function IterationRail({ statuses }: IterationRailProps): ReactElement {
  return (
    <aside className="border-b lg:border-b-0 lg:border-r border-white/[0.06] bg-bg-2 p-4">
      <p className="mono-cap text-paper/40 mb-3">Iterations</p>
      <ul className="space-y-1">
        {ITERATIONS.map((entry, index) => {
          const status = statuses[index] ?? "queued";
          const rowClass =
            status === "active"
              ? "bg-white/[0.04] text-paper"
              : status === "done"
                ? "text-paper/70"
                : "text-paper/40";
          return (
            <li key={entry.label}>
              <div
                className={
                  "flex items-center justify-between gap-2 px-2 py-1.5 rounded-sm text-[12px] transition-colors duration-300 " +
                  rowClass
                }
              >
                <span className="flex items-center gap-2 truncate">
                  <IterationDot status={status} />
                  <span className="truncate">{entry.label}</span>
                </span>
                <span className="font-mono text-[10px] text-paper/30">
                  {entry.time}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

function IterationDot({ status }: { status: IterationStatus }): ReactElement {
  if (status === "done") {
    return (
      <svg
        aria-hidden
        viewBox="0 0 12 12"
        className="h-3 w-3 shrink-0 text-paper/55"
      >
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M2.5 6.5 5 9l4.5-5.5"
        />
      </svg>
    );
  }
  return (
    <span
      className={
        "h-1.5 w-1.5 rounded-full shrink-0 transition-colors duration-300 " +
        (status === "active" ? "bg-accent" : "bg-white/15")
      }
    />
  );
}

interface PreviewPaneProps {
  readonly iteration: IterationEntry;
  readonly slotProgress: number;
  readonly beat: Beat;
}

function PreviewPane({
  iteration,
  slotProgress: slotP,
  beat,
}: PreviewPaneProps): ReactElement {
  // The preview canvas is empty until the eri Engine has heard enough of the
  // prompt to start diffusing. Before that we show the "waiting for diff…"
  // placeholder so each slot visibly resets when its iteration begins.
  const showPreview = beat === "denoising" || beat === "ready";

  return (
    <div className="relative bg-bg-1 overflow-hidden">
      <div className="absolute inset-0 check-grid opacity-[0.4]" aria-hidden />
      <div className="relative p-6 sm:p-10 h-full flex flex-col">
        <div className="text-[10px] font-mono text-paper/30 mb-4">
          preview · localhost:3000
        </div>

        <div className="relative flex-1 rounded-md border border-white/[0.06] bg-bg-2 overflow-hidden min-h-[360px]">
          {showPreview ? (
            iteration.renderPreview({ slotProgress: slotP, beat })
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="font-mono text-[11px] text-paper/30">
                waiting for diff…
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function maskClass(visible: boolean, denoising: boolean): string {
  if (!visible) return "opacity-0";
  if (denoising) return "opacity-100 animate-denoise";
  return "opacity-100";
}

// ─── Iteration 1: Pricing tweak ─────────────────────────────────────────

function PricingPreview({ beat }: PreviewRenderProps): ReactElement {
  const denoising = beat === "denoising";
  const ready = beat === "ready";
  // The annual chip glow is the user-visible payoff for this iteration's
  // prompt — only light it up once the diff has actually shipped.
  const annualGlow = ready;

  return (
    <div
      className={
        "absolute inset-0 p-5 sm:p-7 flex items-center justify-center transition-opacity duration-700 " +
        maskClass(true, denoising)
      }
    >
      <div className="w-full max-w-[260px] rounded-md border border-white/[0.06] bg-bg-3 p-5 flex flex-col items-center gap-4">
        <div className="font-display text-paper/90 text-[13px]">Studio plan</div>

        <div className="inline-flex items-center rounded-full border border-white/[0.08] bg-bg-2 p-0.5 text-[10px] font-mono">
          <span className="px-3 py-1 rounded-full text-paper/55">Monthly</span>
          <span
            className={
              "px-3 py-1 rounded-full transition-all duration-500 " +
              (annualGlow
                ? "bg-accent text-ink shadow-[0_0_18px_rgba(212,255,77,0.55)]"
                : "bg-white/[0.04] text-paper/80")
            }
          >
            Annual
          </span>
        </div>

        <div
          className={
            "rounded-md border px-5 py-4 flex flex-col items-center gap-1 transition-all duration-500 " +
            (annualGlow
              ? "border-accent/50 bg-accent/[0.06] shadow-[0_0_28px_rgba(212,255,77,0.18)]"
              : "border-white/[0.06] bg-bg-2")
          }
        >
          <div className="font-display text-paper text-[22px] leading-none">
            $240
            <span className="font-mono text-[10px] text-paper/50 ml-1">/yr</span>
          </div>
          <p className="text-[10px] text-paper/50">Two months on the house</p>
        </div>

        <div className="w-full px-3 py-1.5 rounded-sm bg-accent text-ink text-[11px] font-medium text-center">
          Start the trial
        </div>

        <ul className="w-full text-[10px] text-paper/55 leading-relaxed font-mono space-y-0.5">
          <li>· Unlimited iterations</li>
          <li>· Local voice + gaze</li>
          <li>· Private deploy targets</li>
        </ul>
      </div>
    </div>
  );
}

// ─── Iteration 2: Testimonial row ───────────────────────────────────────

interface Testimonial {
  readonly quote: string;
  readonly initials: string;
  readonly attribution: string;
}

const TESTIMONIALS: ReadonlyArray<Testimonial> = [
  {
    quote: "Shipped my landing before the coffee cooled.",
    initials: "RT",
    attribution: "Rae T. · indie founder",
  },
  {
    quote: "Talking to it feels closer to thinking than typing.",
    initials: "MK",
    attribution: "Marc K. · designer",
  },
  {
    quote: "The diffs are tiny. The wins keep stacking.",
    initials: "JV",
    attribution: "Jules V. · staff eng",
  },
];

function TestimonialsPreview({ beat }: PreviewRenderProps): ReactElement {
  const denoising = beat === "denoising";
  const ready = beat === "ready";

  return (
    <div
      className={
        "absolute inset-0 p-5 sm:p-7 flex flex-col gap-4 transition-opacity duration-700 " +
        maskClass(true, denoising)
      }
    >
      <div className="rounded-sm border border-white/[0.06] bg-bg-3 px-4 py-3">
        <div className="font-display text-paper/90 text-[13px]">
          What people are saying
        </div>
        <p className="mt-1 text-[10px] text-paper/45 leading-relaxed">
          Three quiet voices that keep showing up in our inbox.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3 flex-1">
        {TESTIMONIALS.map((item, index) => (
          <div
            key={item.initials}
            className={
              "rounded-md border bg-bg-2 p-3 flex flex-col gap-2 transition-all duration-500 " +
              (ready
                ? "border-white/[0.1] -translate-y-0.5 shadow-[0_8px_22px_-12px_rgba(0,0,0,0.7)]"
                : "border-white/[0.06] translate-y-0")
            }
            style={{
              transitionDelay: ready ? `${index * 70}ms` : "0ms",
            }}
          >
            <div className="flex items-center gap-2">
              <span
                className={
                  "h-7 w-7 rounded-full flex items-center justify-center text-[9px] font-mono " +
                  (ready
                    ? "bg-accent/20 text-accent"
                    : "bg-white/[0.06] text-paper/60")
                }
              >
                {item.initials}
              </span>
              <span className="font-mono text-[9px] text-paper/45 leading-tight">
                {item.attribution}
              </span>
            </div>
            <p className="text-[10.5px] text-paper/80 leading-relaxed">
              &ldquo;{item.quote}&rdquo;
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Iteration 3: Coffee shop landing (existing implementation) ─────────

function CoffeeShopPreview({ beat }: PreviewRenderProps): ReactElement {
  const denoising = beat === "denoising";
  // Re-introduce the staged reveal inside the slot so the coffee landing
  // assembles section-by-section the way it did before this refactor.
  const stages = coffeeStages(beat);
  return (
    <>
      {stages.header && (
        <MockHeader visible={stages.header} denoising={denoising} />
      )}
      {stages.hero && (
        <MockHero visible={stages.hero} denoising={denoising} />
      )}
      {stages.features && (
        <MockFeatures visible={stages.features} denoising={denoising} />
      )}
      {stages.contact && (
        <MockContact visible={stages.contact} denoising={denoising} />
      )}
    </>
  );
}

interface CoffeeStages {
  readonly header: boolean;
  readonly hero: boolean;
  readonly features: boolean;
  readonly contact: boolean;
}

function coffeeStages(beat: Beat): CoffeeStages {
  if (beat === "ready") {
    return { header: true, hero: true, features: true, contact: true };
  }
  // During the denoising beat the four sections fade in together — the
  // animate-denoise blur on each section reads as the diff resolving.
  return { header: true, hero: true, features: true, contact: true };
}

interface MockSectionProps {
  readonly visible: boolean;
  readonly denoising: boolean;
}

function MockHeader({ visible, denoising }: MockSectionProps): ReactElement {
  return (
    <div
      className={
        "flex items-center justify-between px-5 py-3 border-b border-white/[0.06] transition-opacity duration-700 " +
        maskClass(visible, denoising)
      }
    >
      <div className="font-display text-paper/90 text-sm">brew &amp; bean</div>
      <div className="hidden sm:flex items-center gap-3 text-[10px] text-paper/40">
        <span>menu</span>
        <span>visit</span>
        <span>order</span>
      </div>
    </div>
  );
}

function MockHero({ visible, denoising }: MockSectionProps): ReactElement {
  return (
    <div
      className={
        "px-5 py-8 sm:py-10 border-b border-white/[0.04] transition-opacity duration-700 " +
        maskClass(visible, denoising)
      }
    >
      <div className="font-display text-paper text-2xl sm:text-3xl leading-tight">
        Slow coffee.
        <br />
        <span className="italic text-accent">Fast mornings.</span>
      </div>
      <p className="mt-3 text-[11px] text-paper/50 max-w-sm leading-relaxed">
        Roasted three blocks away. Pulled the moment you walk in. Open 7am to
        4pm, every day except the rainy ones.
      </p>
      <div className="mt-4 flex gap-2">
        <span className="px-2.5 py-1 rounded-sm bg-accent text-ink text-[10px] font-medium">
          Order ahead
        </span>
        <span className="px-2.5 py-1 rounded-sm border border-white/15 text-paper/70 text-[10px]">
          See menu
        </span>
      </div>
    </div>
  );
}

function MockFeatures({ visible, denoising }: MockSectionProps): ReactElement {
  const items: ReadonlyArray<{ k: string; v: string }> = [
    { k: "Beans", v: "Ethiopia, washed" },
    { k: "Pull", v: "Modbar EP" },
    { k: "Hours", v: "7 — 16, daily" },
  ];
  return (
    <div
      className={
        "grid grid-cols-3 gap-3 px-5 py-5 border-b border-white/[0.04] transition-opacity duration-700 " +
        maskClass(visible, denoising)
      }
    >
      {items.map((item) => (
        <div key={item.k} className="rounded-sm border border-white/[0.06] p-3">
          <p className="mono-cap text-paper/30 text-[9px]">{item.k}</p>
          <p className="mt-1 text-[11px] text-paper/80">{item.v}</p>
        </div>
      ))}
    </div>
  );
}

function MockContact({ visible, denoising }: MockSectionProps): ReactElement {
  return (
    <div
      className={
        "px-5 py-5 transition-opacity duration-700 " +
        maskClass(visible, denoising)
      }
    >
      <p className="mono-cap text-paper/30 text-[9px]">Say hi</p>
      <div className="mt-2 flex gap-2">
        <div className="flex-1 h-7 rounded-sm border border-white/[0.08] bg-bg-3" />
        <div className="h-7 px-3 rounded-sm bg-accent text-ink text-[10px] font-medium flex items-center">
          Send
        </div>
      </div>
    </div>
  );
}

interface EriPanelProps {
  readonly beat: Beat;
  readonly typedTranscript: string;
}

function EriPanel({ beat, typedTranscript }: EriPanelProps): ReactElement {
  return (
    <aside className="border-t lg:border-t-0 lg:border-l border-white/[0.06] bg-bg-2 p-5 flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <p className="mono-cap text-paper/50">eri</p>
        <BeatBadge beat={beat} />
      </div>

      <Waveform active={beat === "listening" || beat === "transcribing"} />

      <div className="rounded-md border border-white/[0.06] bg-bg-3 p-3 min-h-[88px]">
        <p className="mono-cap text-paper/30 mb-2 text-[9px]">Transcript</p>
        <p className="font-mono text-[12px] text-paper/85 leading-relaxed">
          {typedTranscript}
          {beat !== "ready" && (
            <span className="inline-block w-1.5 h-3 ml-0.5 bg-accent align-middle animate-pulse" />
          )}
        </p>
      </div>

      <DiffusionStatus beat={beat} />

      <div className="mt-auto pt-4 border-t border-white/[0.04] flex items-center justify-between text-[10px] font-mono text-paper/40">
        <span>local whisper</span>
        <span>eri engine</span>
      </div>
    </aside>
  );
}

function BeatBadge({ beat }: { readonly beat: Beat }): ReactElement {
  const labels: Record<Beat, string> = {
    listening: "Listening",
    transcribing: "Transcribing",
    denoising: "Diffusing",
    ready: "Shipped",
  };
  const dotClass: Record<Beat, string> = {
    listening: "bg-accent",
    transcribing: "bg-accent",
    denoising: "bg-accent",
    ready: "bg-accent-bright",
  };
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm border border-white/[0.06] bg-bg-3 text-[10px] font-mono text-paper/80">
      <span className={`h-1.5 w-1.5 rounded-full pulse-dot ${dotClass[beat]}`} />
      {labels[beat]}
    </span>
  );
}

interface WaveformProps {
  readonly active: boolean;
}

function Waveform({ active }: WaveformProps): ReactElement {
  const bars = Array.from({ length: 18 }, (_, i) => i);
  return (
    <div className="flex items-center justify-center gap-[3px] h-12">
      {bars.map((i) => (
        <span
          key={i}
          className="block w-[3px] rounded-full bg-accent wave-bar"
          style={{
            height: "100%",
            animationDelay: `${(i % 9) * 80}ms`,
            animationPlayState: active ? "running" : "paused",
            opacity: active ? 1 : 0.25,
          }}
        />
      ))}
    </div>
  );
}

function DiffusionStatus({ beat }: { readonly beat: Beat }): ReactElement {
  if (beat === "listening" || beat === "transcribing") {
    return (
      <div className="rounded-md border border-white/[0.04] bg-bg-3/50 p-3 text-[11px] text-paper/40 font-mono">
        eri Engine — idle
      </div>
    );
  }
  if (beat === "denoising") {
    return (
      <div className="rounded-md border border-accent/30 bg-accent/5 p-3 text-[11px] text-paper/80 font-mono">
        eri Engine — denoising
        <span className="inline-flex ml-1 gap-0.5">
          <span className="pulse-dot inline-block w-1 h-1 rounded-full bg-accent" style={{ animationDelay: "0ms" }} />
          <span className="pulse-dot inline-block w-1 h-1 rounded-full bg-accent" style={{ animationDelay: "140ms" }} />
          <span className="pulse-dot inline-block w-1 h-1 rounded-full bg-accent" style={{ animationDelay: "280ms" }} />
        </span>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-accent/40 bg-accent/10 p-3 text-[11px] text-accent font-mono flex items-center gap-2">
      <span aria-hidden>✓</span>
      Shipped to preview · 1.8s
    </div>
  );
}
