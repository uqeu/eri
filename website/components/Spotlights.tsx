"use client";

// Bento grid of six product spotlights. Mixed sizes and visual surfaces:
// composer, diffusion, palette, gaze, agents, telemetry. Each card has its own
// micro-animation so the grid breathes without any single element shouting.

import { useEffect, useState } from "react";

export function Spotlights(): React.ReactElement {
  return (
    <section id="spotlights" className="relative border-t border-white/[0.08]">
      <div className="mx-auto max-w-7xl px-6 py-24 sm:py-32">
        <div className="flex items-end justify-between gap-8 flex-wrap">
          <div className="max-w-3xl">
            <p className="mono-cap text-paper/40">Inside eri</p>
            <h2 className="mt-5 font-display text-h2 text-balance font-normal leading-[1.02]">
              Six surfaces, one editor.{" "}
              <span className="italic accent-shimmer">
                All on your machine.
              </span>
            </h2>
          </div>
          <p className="max-w-sm text-paper/60 text-[15px] leading-relaxed">
            Eri is a VSCodium fork with the Cursor feel — composer, palette,
            voice, gaze, diffusion, agents. Same keymap, same extensions, new
            loop.
          </p>
        </div>

        <div className="mt-14 grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 lg:auto-rows-[244px]">
          <BentoCard
            className="lg:col-span-3 lg:row-span-2 h-full"
            tone="accent"
          >
            <ComposerSpot />
          </BentoCard>

          <BentoCard className="lg:col-span-3 h-full">
            <DiffusionSpot />
          </BentoCard>

          <BentoCard className="lg:col-span-2 h-full">
            <PaletteSpot />
          </BentoCard>

          <BentoCard className="lg:col-span-1 h-full">
            <GazeSpot />
          </BentoCard>

          <BentoCard className="lg:col-span-3 h-full">
            <AgentSpot />
          </BentoCard>

          <BentoCard className="lg:col-span-3 h-full">
            <TelemetrySpot />
          </BentoCard>
        </div>
      </div>
    </section>
  );
}

interface BentoCardProps {
  readonly children: React.ReactNode;
  readonly className?: string;
  readonly tone?: "default" | "accent";
}

function BentoCard({
  children,
  className,
  tone = "default",
}: BentoCardProps): React.ReactElement {
  const toneClass =
    tone === "accent"
      ? "border-accent/20 bg-accent/[0.025]"
      : "border-white/[0.08] bg-white/[0.02]";
  return (
    <div
      className={
        "group relative overflow-hidden rounded-xl border card-lift " +
        toneClass +
        " " +
        (className ?? "")
      }
    >
      {children}
      <div
        className="absolute inset-x-0 bottom-0 h-px w-0 bg-accent transition-all duration-700 ease-out group-hover:w-full"
        aria-hidden
      />
    </div>
  );
}

function ComposerSpot(): React.ReactElement {
  return (
    <div className="flex flex-col h-full">
      <div className="p-7 sm:p-8">
        <p className="mono-cap text-accent">Voice composer</p>
        <h3 className="mt-3 font-display text-2xl sm:text-3xl text-paper font-normal leading-tight">
          Type with your mouth.{" "}
          <span className="italic">Edit with your eyes.</span>
        </h3>
        <p className="mt-2.5 text-[14px] text-paper/60 leading-relaxed max-w-md">
          Hold the side key, talk. eri reads the room — fusing voice, gaze, and
          context into a single turn before you finish the sentence. Intent-first,
          not syntax-first. The composer never blocks, edits stack.
        </p>
      </div>
      <div className="relative flex-1 mx-7 sm:mx-8 mb-7 sm:mb-8 rounded-lg border border-white/[0.08] bg-bg-3 overflow-hidden">
        <div className="absolute inset-0 check-grid opacity-30" aria-hidden />
        <ComposerVisual />
      </div>
    </div>
  );
}

const COMPOSER_PHRASES: ReadonlyArray<string> = [
  "make the hero copy lighter",
  "add a pricing toggle",
  "extract this into a hook",
];

function ComposerVisual(): React.ReactElement {
  const [typed, setTyped] = useState<string>("");

  useEffect(() => {
    let charPos = 0;
    let phrasePos = 0;
    let phase: "typing" | "holding" | "clearing" = "typing";
    const id = window.setInterval(() => {
      const phrase = COMPOSER_PHRASES[phrasePos] ?? "";
      if (phase === "typing") {
        charPos += 1;
        setTyped(phrase.slice(0, charPos));
        if (charPos >= phrase.length) {
          phase = "holding";
          charPos = 0;
        }
      } else if (phase === "holding") {
        charPos += 1;
        if (charPos > 18) {
          phase = "clearing";
          charPos = 0;
        }
      } else {
        phrasePos = (phrasePos + 1) % COMPOSER_PHRASES.length;
        phase = "typing";
        charPos = 0;
        setTyped("");
      }
    }, 70);
    return () => window.clearInterval(id);
  }, []);

  const bars = Array.from({ length: 32 }, (_, i) => i);

  return (
    <div className="relative h-full p-5 flex flex-col justify-between">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-2 px-2 py-1 rounded-sm border border-accent/30 bg-accent/10 font-mono text-[11px] text-accent">
          <span className="h-1.5 w-1.5 rounded-full bg-accent pulse-dot" />
          listening
        </span>
        <span className="font-mono text-[10px] text-paper/40">
          gaze · hero section
        </span>
      </div>

      <div className="flex items-end gap-[3px] h-14 my-4">
        {bars.map((i) => (
          <span
            key={i}
            className="block w-[3px] rounded-full bg-accent wave-bar"
            style={{
              height: "100%",
              animationDelay: `${(i * 70) % 1400}ms`,
            }}
          />
        ))}
      </div>

      <div className="rounded-md border border-white/[0.06] bg-bg-2 px-3 py-2.5 font-mono text-[13px] text-paper/85 leading-snug min-h-[44px]">
        {typed}
        <span className="inline-block w-1.5 h-3 ml-0.5 bg-accent align-middle animate-pulse" />
      </div>
    </div>
  );
}

function DiffusionSpot(): React.ReactElement {
  const lines: ReadonlyArray<string> = [
    "function Toggle({ on, set }) {",
    "  return (",
    "    <button onClick={() => set(!on)}",
    "      data-on={on}>",
    "      <span className=\"dot\" />",
    "    </button>",
    "  );",
    "}",
  ];
  return (
    <div className="flex h-full">
      <div className="flex-1 min-w-0 p-7 sm:p-8 flex flex-col justify-between">
        <div className="min-w-0">
          <p className="mono-cap text-accent break-words">eri's engine diffusion</p>
          <h3 className="mt-3 font-display text-2xl text-paper font-normal leading-tight">
            Edits resolve{" "}
            <span className="italic">in one breath.</span>
          </h3>
          <p className="mt-2.5 text-[14px] text-paper/60 leading-relaxed">
            The diff arrives whole, not streamed token by token. Small
            refactors land before your eyes finish moving.
          </p>
        </div>
        <div className="mono-cap text-paper/40 mt-3">median 1.8s · p95 under 3s</div>
      </div>
      <div className="relative w-1/2 border-l border-white/[0.06] bg-bg-3 overflow-hidden">
        <div className="absolute inset-0 check-grid opacity-30" aria-hidden />
        <div className="relative p-4 font-mono text-[11px] leading-[1.55] space-y-0.5">
          {lines.map((line, i) => (
            <div
              key={i}
              className="text-paper/80 animate-denoise"
              style={{ animationDelay: `${i * 160}ms` }}
            >
              <span className="text-paper/25 mr-2 inline-block w-4 text-right">
                {i + 1}
              </span>
              {line}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const PALETTE_ITEMS: ReadonlyArray<{ k: string; v: string }> = [
  { k: "⌘K", v: "Run command" },
  { k: "⌘L", v: "New voice turn" },
  { k: "⌘J", v: "Open composer" },
  { k: "⌘.", v: "Quick fix" },
];

function PaletteSpot(): React.ReactElement {
  return (
    <div className="flex flex-col h-full">
      <div className="p-7 pb-3">
        <p className="mono-cap text-accent">Palette</p>
        <h3 className="mt-3 font-display text-2xl text-paper font-normal leading-tight">
          Same keys.{" "}
          <span className="italic">New verbs.</span>
        </h3>
      </div>
      <div className="flex-1 mx-7 mb-7 rounded-lg border border-white/[0.08] bg-bg-3 overflow-hidden">
        <div className="p-2 space-y-1">
          {PALETTE_ITEMS.map((item, i) => (
            <div
              key={item.k}
              className={
                "flex items-center justify-between px-2.5 py-1.5 rounded-sm transition " +
                (i === 1
                  ? "bg-accent/10 border border-accent/25"
                  : "border border-transparent")
              }
            >
              <span className="font-mono text-[11px] text-paper/85">
                {item.v}
              </span>
              <span className="font-mono text-[10px] text-paper/40">
                {item.k}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function GazeSpot(): React.ReactElement {
  return (
    <div className="relative h-full overflow-hidden">
      <div className="absolute inset-0 mesh-bg opacity-50" aria-hidden />
      <div className="relative p-7 flex flex-col h-full">
        <p className="mono-cap text-accent">Gaze</p>
        <div className="flex-1 flex items-center justify-center">
          <div className="relative h-24 w-24">
            <div className="absolute inset-0 rounded-full border border-accent/40" />
            <div className="absolute inset-3 rounded-full border border-accent/30" />
            <div className="absolute inset-6 rounded-full border border-accent/20" />
            <div className="absolute inset-9 rounded-full bg-accent pulse-dot" />
          </div>
        </div>
        <p className="text-[13px] text-paper/70 leading-snug">
          eri knows{" "}
          <span className="text-paper">which line</span> you mean — before you
          name it.
        </p>
      </div>
    </div>
  );
}

function AgentSpot(): React.ReactElement {
  return (
    <div className="flex flex-col h-full">
      <div className="p-7 sm:p-8">
        <p className="mono-cap text-accent">Cloud agents</p>
        <h3 className="mt-3 font-display text-2xl text-paper font-normal leading-tight">
          Hand off the long jobs.{" "}
          <span className="italic">Sleep through the diff.</span>
        </h3>
      </div>
      <div className="flex-1 mx-7 sm:mx-8 mb-7 sm:mb-8 space-y-2">
        <AgentRow
          name="#migrate-postgres"
          time="02:14"
          status="running schema diff"
          tone="active"
        />
        <AgentRow
          name="#refactor-billing"
          time="04:02"
          status="opened pr · 12 files"
          tone="done"
        />
        <AgentRow
          name="#upgrade-next-15"
          time="07:48"
          status="resolving lockfile"
          tone="active"
        />
      </div>
    </div>
  );
}

interface AgentRowProps {
  readonly name: string;
  readonly time: string;
  readonly status: string;
  readonly tone: "active" | "done";
}

function AgentRow({
  name,
  time,
  status,
  tone,
}: AgentRowProps): React.ReactElement {
  const accent = tone === "done";
  return (
    <div
      className={
        "flex items-center justify-between rounded-md border px-3 py-2.5 font-mono text-[11px] " +
        (accent
          ? "border-accent/30 bg-accent/10 text-accent"
          : "border-white/[0.08] bg-bg-3 text-paper/85")
      }
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span
          className={
            "h-1.5 w-1.5 rounded-full shrink-0 " +
            (accent ? "bg-accent-bright" : "bg-accent pulse-dot")
          }
        />
        <span className="truncate">{name}</span>
        <span className="text-paper/40 truncate">— {status}</span>
      </div>
      <span className="text-paper/40 shrink-0 ml-3">{time}</span>
    </div>
  );
}

const TELEMETRY: ReadonlyArray<{ label: string; value: string }> = [
  { label: "voice turns / day", value: "240+" },
  { label: "median edit", value: "1.8s" },
  { label: "p95 ship time", value: "34s" },
  { label: "audio off-device", value: "0 bytes" },
];

function TelemetrySpot(): React.ReactElement {
  return (
    <div className="flex flex-col h-full">
      <div className="p-7 sm:p-8">
        <p className="mono-cap text-accent">Telemetry</p>
        <h3 className="mt-3 font-display text-2xl text-paper font-normal leading-tight">
          Honest numbers.{" "}
          <span className="italic">No asterisks.</span>
        </h3>
      </div>
      <div className="flex-1 min-h-0 grid grid-cols-2 grid-rows-2 gap-2 mx-7 sm:mx-8 mb-7 sm:mb-8">
        {TELEMETRY.map((n) => (
          <div
            key={n.label}
            className="rounded-md border border-white/[0.08] bg-bg-3 p-3 flex flex-col justify-between min-h-0"
          >
            <p className="mono-cap text-paper/40 text-[9px]">{n.label}</p>
            <p className="font-display text-2xl text-paper font-normal leading-none tabular-nums">
              {n.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
