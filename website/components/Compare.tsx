"use client";

// Comparison strip — punchy visual contrast between eri and typing-only editors.
// Two side-by-side timelines that animate the same task on a shared clock so the
// speed difference reads viscerally rather than as a number in a table.

import { useEffect, useState } from "react";

const LOOP_MS = 11_000;
const TICK_MS = 100;

interface Lane {
  readonly key: "eri" | "typing";
  readonly label: string;
  readonly sub: string;
  readonly total: string;
  readonly accent: boolean;
  readonly steps: ReadonlyArray<LaneStep>;
}

interface LaneStep {
  readonly at: number;
  readonly label: string;
  readonly kind: "voice" | "diff" | "type" | "test" | "deploy" | "doc";
}

const LANES: ReadonlyArray<Lane> = [
  {
    key: "eri",
    label: "Eri",
    sub: "voice + diffusion",
    total: "0:28",
    accent: true,
    steps: [
      { at: 0.04, label: "say it", kind: "voice" },
      { at: 0.18, label: "eri engine diffuses the diff", kind: "diff" },
      { at: 0.38, label: "type check passes", kind: "test" },
      { at: 0.52, label: "preview reloads", kind: "deploy" },
      { at: 0.7, label: "ship it", kind: "voice" },
      { at: 0.88, label: "live url returned", kind: "deploy" },
    ],
  },
  {
    key: "typing",
    label: "Typing-only editor",
    sub: "autocomplete + chat",
    total: "9:40",
    accent: false,
    steps: [
      { at: 0.02, label: "context-switch into chat", kind: "type" },
      { at: 0.12, label: "write the prompt", kind: "type" },
      { at: 0.28, label: "wait for streamed tokens", kind: "type" },
      { at: 0.46, label: "read & review the diff", kind: "doc" },
      { at: 0.62, label: "apply, fix the imports", kind: "type" },
      { at: 0.78, label: "re-run, debug a regression", kind: "test" },
      { at: 0.92, label: "open the deploy dashboard", kind: "deploy" },
    ],
  },
];

const KIND_SYMBOL: Record<LaneStep["kind"], string> = {
  voice: "◉",
  diff: "▦",
  type: "›",
  test: "✓",
  deploy: "↗",
  doc: "¶",
};

export function Compare(): React.ReactElement {
  const [tick, setTick] = useState<number>(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setTick((t) => (t + TICK_MS) % LOOP_MS);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const progress = tick / LOOP_MS;

  return (
    <section id="compare-strip" className="relative border-t border-white/[0.08]">
      <div className="absolute inset-0 pointer-events-none mesh-bg opacity-30" aria-hidden />
      <div className="relative mx-auto max-w-7xl px-6 py-24 sm:py-32">
        <div className="max-w-3xl">
          <p className="mono-cap text-paper/40">Side by side</p>
          <h2 className="mt-5 font-display text-h2 text-balance font-normal leading-[1.02]">
            Same feature, same day.{" "}
            <span className="italic accent-shimmer">
              One of you is already at lunch.
            </span>
          </h2>
          <p className="mt-5 max-w-xl text-paper/60 text-[15px] leading-relaxed">
            We timed the same task — &ldquo;add a pricing toggle and ship it&rdquo; —
            on eri and on a popular typing-only editor. Both running the same
            frontier model. The difference is voice, diffusion, and one tool that
            owns the whole loop.
          </p>
        </div>

        <div className="mt-14 grid gap-4 lg:grid-cols-2">
          {LANES.map((lane) => (
            <LaneCard key={lane.key} lane={lane} progress={progress} />
          ))}
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 mono-cap text-paper/40">
          <span>◉ voice turn</span>
          <span>▦ diffusion edit</span>
          <span>› typed step</span>
          <span>✓ test / lint</span>
          <span>↗ deploy step</span>
          <span>¶ context read</span>
        </div>
      </div>
    </section>
  );
}

interface LaneCardProps {
  readonly lane: Lane;
  readonly progress: number;
}

function LaneCard({ lane, progress }: LaneCardProps): React.ReactElement {
  const headcap = lane.accent ? "text-accent" : "text-paper/70";
  const ringClass = lane.accent
    ? "border-accent/30 bg-accent/[0.03]"
    : "border-white/[0.08] bg-white/[0.015]";
  return (
    <div
      className={`relative overflow-hidden rounded-xl border ${ringClass} p-7 sm:p-9`}
    >
      <div className="flex items-baseline justify-between">
        <div>
          <p className={`mono-cap ${headcap}`}>{lane.sub}</p>
          <h3 className="mt-3 font-display text-3xl sm:text-4xl text-paper font-normal leading-none">
            {lane.label}
          </h3>
        </div>
        <div className="text-right">
          <p className="mono-cap text-paper/40">elapsed</p>
          <p
            className={
              "mt-1 font-mono text-2xl sm:text-3xl tabular-nums " +
              (lane.accent ? "text-accent" : "text-paper/80")
            }
          >
            {lane.total}
          </p>
        </div>
      </div>

      <div className="mt-8">
        <ProgressTrack progress={progress} accent={lane.accent} />
      </div>

      <ol className="mt-7 space-y-2.5">
        {lane.steps.map((step) => {
          const reached = progress >= step.at;
          return (
            <li
              key={`${lane.key}-${step.at}`}
              className={
                "flex items-center justify-between gap-3 rounded-md border px-3 py-2.5 transition-all duration-500 " +
                (reached
                  ? lane.accent
                    ? "border-accent/30 bg-accent/[0.05] text-paper"
                    : "border-white/[0.1] bg-white/[0.03] text-paper/85"
                  : "border-white/[0.04] bg-transparent text-paper/30")
              }
            >
              <div className="flex items-center gap-3 min-w-0">
                <span
                  className={
                    "inline-flex h-5 w-5 items-center justify-center rounded-sm text-[11px] font-mono shrink-0 " +
                    (reached
                      ? lane.accent
                        ? "bg-accent text-ink"
                        : "bg-white/15 text-paper"
                      : "bg-white/[0.04] text-paper/30")
                  }
                >
                  {KIND_SYMBOL[step.kind]}
                </span>
                <span className="truncate text-[13px]">{step.label}</span>
              </div>
              <span className="font-mono text-[10px] tabular-nums text-paper/40">
                {fmt(step.at * (lane.accent ? 28 : 580))}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function fmt(secondsTotal: number): string {
  const s = Math.round(secondsTotal);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

interface ProgressTrackProps {
  readonly progress: number;
  readonly accent: boolean;
}

function ProgressTrack({ progress, accent }: ProgressTrackProps): React.ReactElement {
  return (
    <div className="relative h-1.5 w-full rounded-full bg-white/[0.06] overflow-hidden">
      <div
        className={
          "absolute inset-y-0 left-0 rounded-full transition-all duration-100 ease-linear " +
          (accent ? "bg-accent" : "bg-paper/50")
        }
        style={{ width: `${Math.round(progress * 100)}%` }}
      />
    </div>
  );
}
