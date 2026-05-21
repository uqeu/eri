"use client";

// Three-step loop breakdown. Each step has its own small animated glyph that
// runs on a synchronized 9s cycle so the row reads like a single conveyor belt.

import { useEffect, useState } from "react";

const LOOP_MS = 9_000;
const TICK_MS = 100;

interface Step {
  readonly number: string;
  readonly title: string;
  readonly body: string;
  readonly detail: string;
  readonly window: readonly [number, number];
}

const STEPS: ReadonlyArray<Step> = [
  {
    number: "01",
    title: "Speak it",
    body: "A local Whisper picks up the moment you start talking. Eri segments the request, locks the intent, and never sends your audio anywhere.",
    detail: "on-device · sub-100ms turn-taking",
    window: [0, 0.33],
  },
  {
    number: "02",
    title: "Diffuse it",
    body: "Eri's engine denoises the whole diff in parallel. Eri stages the change, runs the type check, and applies it before your eyes finish moving.",
    detail: "median 1.8s · whole-file diff",
    window: [0.33, 0.7],
  },
  {
    number: "03",
    title: "See it",
    body: "Hot reload paints the preview. Say what to keep, what to undo, or what to ship — eri commits the turn and pushes when you say the word.",
    detail: "auto-commit · vercel deploy on cue",
    window: [0.7, 1],
  },
];

function progressForStep(progress: number, step: Step): number {
  const [start, end] = step.window;
  if (progress <= start) return 0;
  if (progress >= end) return 1;
  return (progress - start) / (end - start);
}

export function HowItWorks(): React.ReactElement {
  const [tick, setTick] = useState<number>(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setTick((t) => (t + TICK_MS) % LOOP_MS);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const progress = tick / LOOP_MS;

  return (
    <section id="how-it-works" className="border-t border-white/[0.08]">
      <div className="mx-auto max-w-7xl px-6 py-24 sm:py-32">
        <div className="flex items-end justify-between gap-8 flex-wrap">
          <div className="max-w-3xl">
            <p className="mono-cap text-paper/40">The loop</p>
            <h2 className="mt-5 font-display text-h2 text-balance font-normal leading-[1.02]">
              Speak. Diffuse. See.{" "}
              <span className="italic accent-shimmer">Loop forever.</span>
            </h2>
          </div>
          <p className="max-w-sm text-paper/60 text-[15px] leading-relaxed">
            One sentence is one turn. Eri keeps the audio, the model call, and
            the preview on a single clock so nothing ever feels async.
          </p>
        </div>

        <ol className="mt-16 grid gap-4 md:grid-cols-3">
          {STEPS.map((step, idx) => {
            const local = progressForStep(progress, step);
            const active = local > 0 && local < 1;
            const done = local >= 1;
            return (
              <li
                key={step.number}
                className="group relative overflow-hidden rounded-lg border border-white/[0.08] bg-white/[0.02] p-8 card-lift"
              >
                <div className="flex items-baseline justify-between">
                  <span
                    className={
                      "font-display text-5xl font-normal leading-none transition-colors duration-500 " +
                      (active || done ? "text-accent" : "text-paper/30")
                    }
                  >
                    {step.number}
                  </span>
                  <StepBadge active={active} done={done} />
                </div>

                <div className="mt-8 h-20">
                  <StepGlyph index={idx} local={local} />
                </div>

                <h3 className="mt-6 font-display text-h3 tracking-tight font-normal text-paper">
                  {step.title}
                </h3>
                <p className="mt-3 text-[15px] text-paper/60 leading-relaxed">
                  {step.body}
                </p>
                <div className="mt-8 pt-5 border-t border-white/[0.06] mono-cap text-paper/50">
                  {step.detail}
                </div>

                <div
                  className="absolute bottom-0 left-0 h-px bg-accent transition-all duration-200 ease-linear"
                  style={{
                    width: `${Math.round(local * 100)}%`,
                  }}
                  aria-hidden
                />
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

interface StepBadgeProps {
  readonly active: boolean;
  readonly done: boolean;
}

function StepBadge({ active, done }: StepBadgeProps): React.ReactElement {
  const label = done ? "done" : active ? "running" : "queued";
  const dotClass = done
    ? "bg-accent-bright"
    : active
    ? "bg-accent pulse-dot"
    : "bg-white/20";
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-mono text-paper/50 uppercase tracking-wider">
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
      {label}
    </span>
  );
}

interface StepGlyphProps {
  readonly index: number;
  readonly local: number;
}

function StepGlyph({ index, local }: StepGlyphProps): React.ReactElement {
  if (index === 0) return <VoiceGlyph local={local} />;
  if (index === 1) return <DiffuseGlyph local={local} />;
  return <PreviewGlyph local={local} />;
}

function VoiceGlyph({ local }: { readonly local: number }): React.ReactElement {
  const bars = Array.from({ length: 22 }, (_, i) => i);
  const intensity = local === 0 ? 0.2 : 1;
  return (
    <div className="flex items-end gap-[3px] h-full">
      {bars.map((i) => {
        const phase = (local * 6 + i * 0.18) % 1;
        const height = 18 + Math.abs(Math.sin(phase * Math.PI * 2)) * 60;
        return (
          <span
            key={i}
            className="block w-[3px] rounded-full bg-accent transition-[height] duration-150 ease-out"
            style={{
              height: `${height}%`,
              opacity: intensity,
            }}
          />
        );
      })}
    </div>
  );
}

function DiffuseGlyph({ local }: { readonly local: number }): React.ReactElement {
  const cells = Array.from({ length: 48 }, (_, i) => i);
  return (
    <div className="grid grid-cols-12 gap-[3px] h-full">
      {cells.map((i) => {
        const settle = (i * 0.013 + 0.05) % 1;
        const resolved = local > settle;
        return (
          <span
            key={i}
            className="rounded-[1px] transition-all duration-300 ease-out"
            style={{
              backgroundColor: resolved
                ? "rgba(224,255,79,0.85)"
                : "rgba(255,255,255,0.08)",
              filter: resolved ? "none" : "blur(2px)",
            }}
          />
        );
      })}
    </div>
  );
}

function PreviewGlyph({ local }: { readonly local: number }): React.ReactElement {
  const reveal = Math.min(local * 1.2, 1);
  return (
    <div className="relative h-full w-full rounded-md border border-white/[0.08] bg-bg-3 overflow-hidden">
      <div
        className="absolute inset-x-0 top-0 h-2 bg-accent/30"
        style={{ width: `${Math.round(reveal * 100)}%` }}
      />
      <div className="p-2 space-y-1.5">
        <div
          className="h-2 rounded-sm bg-paper/70 transition-all duration-300"
          style={{ width: `${Math.min(reveal * 100, 70)}%` }}
        />
        <div
          className="h-1.5 rounded-sm bg-paper/30 transition-all duration-300"
          style={{
            width: `${Math.min(reveal * 90, 48)}%`,
            transitionDelay: "80ms",
          }}
        />
        <div
          className="h-6 rounded-sm bg-accent transition-all duration-500"
          style={{
            width: reveal > 0.7 ? "44%" : "0%",
            opacity: reveal > 0.7 ? 1 : 0,
          }}
        />
      </div>
    </div>
  );
}
