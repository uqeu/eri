"use client";

// Full-bleed centerpiece. A horizontal three-node loop — voice node, mercury
// node, preview node — with a packet that flows around the ring on a tick.
// This is distinct from EriDemo: that one walks through one beat; this one
// shows the *loop* itself, repeating forever, as a system diagram.

import { useEffect, useState } from "react";

const LOOP_MS = 7_000;
const TICK_MS = 80;

type Node = "voice" | "mercury" | "preview";

interface NodeMeta {
  readonly key: Node;
  readonly label: string;
  readonly sub: string;
  readonly window: readonly [number, number];
}

const NODES: ReadonlyArray<NodeMeta> = [
  { key: "voice", label: "Voice", sub: "whisper · on-device", window: [0, 0.33] },
  { key: "mercury", label: "eri Engine", sub: "diffusion · 1.8s", window: [0.33, 0.66] },
  { key: "preview", label: "Preview", sub: "hot reload · live", window: [0.66, 1] },
];

function activeNode(p: number): Node {
  for (const node of NODES) {
    if (p >= node.window[0] && p < node.window[1]) return node.key;
  }
  return "preview";
}

export function InteractiveLoop(): React.ReactElement {
  const [tick, setTick] = useState<number>(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setTick((t) => (t + TICK_MS) % LOOP_MS);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const progress = tick / LOOP_MS;
  const current = activeNode(progress);

  return (
    <section
      id="loop"
      className="relative overflow-hidden border-t border-white/[0.08] bg-bg-1"
    >
      <div className="absolute inset-0 pointer-events-none mesh-bg opacity-40" aria-hidden />
      <div className="absolute inset-0 pointer-events-none opacity-[0.04] grain mix-blend-overlay" aria-hidden />

      <div className="relative mx-auto max-w-7xl px-6 py-24 sm:py-32">
        <div className="max-w-3xl">
          <p className="mono-cap text-accent">See it in motion</p>
          <h2 className="mt-5 font-display text-h1 text-balance font-normal leading-[1.02]">
            One sentence travels.{" "}
            <span className="italic">And keeps traveling.</span>
          </h2>
          <p className="mt-5 max-w-xl text-paper/60 text-[15px] leading-relaxed">
            Voice in, diffusion in the middle, preview out — and the preview is
            an input again. Eri keeps the whole ring on one local clock so the
            loop never stalls between turns.
          </p>
        </div>

        <div className="mt-16">
          <LoopDiagram progress={progress} current={current} />
        </div>

        <LoopTelemetry progress={progress} current={current} />
      </div>
    </section>
  );
}

interface LoopDiagramProps {
  readonly progress: number;
  readonly current: Node;
}

function LoopDiagram({
  progress,
  current,
}: LoopDiagramProps): React.ReactElement {
  return (
    <div className="relative rounded-2xl border border-white/[0.08] bg-bg-2 p-6 sm:p-10 overflow-hidden">
      <div className="absolute inset-0 check-grid opacity-[0.25]" aria-hidden />

      <div className="relative grid grid-cols-1 lg:grid-cols-[1fr_60px_1fr_60px_1fr] items-stretch gap-6 lg:gap-0">
        <LoopNode meta={NODES[0]!} active={current === "voice"} progress={progress} />
        <Connector progress={progress} segment={[0.18, 0.42]} />
        <LoopNode meta={NODES[1]!} active={current === "mercury"} progress={progress} />
        <Connector progress={progress} segment={[0.5, 0.74]} />
        <LoopNode meta={NODES[2]!} active={current === "preview"} progress={progress} />
      </div>

      <ReturnArc progress={progress} />
    </div>
  );
}

interface LoopNodeProps {
  readonly meta: NodeMeta;
  readonly active: boolean;
  readonly progress: number;
}

function LoopNode({ meta, active, progress }: LoopNodeProps): React.ReactElement {
  const ring = active
    ? "border-accent/40 bg-accent/[0.05]"
    : "border-white/[0.08] bg-bg-3";
  return (
    <div
      className={
        "relative rounded-xl border p-6 sm:p-7 flex flex-col gap-4 transition-colors duration-300 min-h-[260px] " +
        ring
      }
    >
      <div className="flex items-center justify-between">
        <p className="mono-cap text-paper/40">node</p>
        <span
          className={
            "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm border font-mono text-[10px] " +
            (active
              ? "border-accent/40 bg-accent/10 text-accent"
              : "border-white/[0.06] bg-bg-2 text-paper/50")
          }
        >
          <span
            className={
              "h-1.5 w-1.5 rounded-full " +
              (active ? "bg-accent pulse-dot" : "bg-white/20")
            }
          />
          {active ? "active" : "idle"}
        </span>
      </div>

      <div>
        <h3 className="font-display text-2xl sm:text-3xl text-paper font-normal leading-none">
          {meta.label}
        </h3>
        <p className="mt-1.5 mono-cap text-paper/40">{meta.sub}</p>
      </div>

      <div className="mt-auto h-16">
        <NodeVisual node={meta.key} active={active} progress={progress} />
      </div>
    </div>
  );
}

interface NodeVisualProps {
  readonly node: Node;
  readonly active: boolean;
  readonly progress: number;
}

function NodeVisual({ node, active, progress }: NodeVisualProps): React.ReactElement {
  if (node === "voice") return <VoicePulse active={active} />;
  if (node === "mercury") return <DiffusionGrid active={active} progress={progress} />;
  return <PreviewBars active={active} progress={progress} />;
}

function VoicePulse({ active }: { readonly active: boolean }): React.ReactElement {
  const bars = Array.from({ length: 16 }, (_, i) => i);
  return (
    <div className="flex items-end gap-[3px] h-full">
      {bars.map((i) => (
        <span
          key={i}
          className="block w-[3px] flex-1 rounded-full bg-accent wave-bar"
          style={{
            height: "100%",
            animationDelay: `${(i * 90) % 1200}ms`,
            opacity: active ? 1 : 0.25,
            animationPlayState: active ? "running" : "paused",
          }}
        />
      ))}
    </div>
  );
}

function DiffusionGrid({
  active,
  progress,
}: {
  readonly active: boolean;
  readonly progress: number;
}): React.ReactElement {
  const cells = Array.from({ length: 32 }, (_, i) => i);
  const local = active ? (progress - 0.33) / 0.33 : 0;
  return (
    <div className="grid grid-cols-16 gap-[2px] h-full" style={{ gridTemplateColumns: "repeat(16, minmax(0,1fr))" }}>
      {cells.map((i) => {
        const settle = (i * 0.028 + 0.05) % 1;
        const resolved = active && local > settle;
        return (
          <span
            key={i}
            className="rounded-[1px] transition-all duration-300"
            style={{
              backgroundColor: resolved
                ? "rgba(224,255,79,0.85)"
                : active
                ? "rgba(255,255,255,0.12)"
                : "rgba(255,255,255,0.06)",
              filter: resolved ? "none" : "blur(1.5px)",
            }}
          />
        );
      })}
    </div>
  );
}

function PreviewBars({
  active,
  progress,
}: {
  readonly active: boolean;
  readonly progress: number;
}): React.ReactElement {
  const local = active ? (progress - 0.66) / 0.34 : 0;
  return (
    <div className="h-full w-full rounded-md border border-white/[0.06] bg-bg-2 p-2 space-y-1.5 overflow-hidden">
      <div
        className="h-2 rounded-sm bg-paper/70 transition-all duration-300"
        style={{ width: `${Math.min(local * 110, 65)}%` }}
      />
      <div
        className="h-1.5 rounded-sm bg-paper/35 transition-all duration-300"
        style={{ width: `${Math.min(local * 90, 42)}%` }}
      />
      <div
        className="h-6 rounded-sm bg-accent transition-all duration-500"
        style={{
          width: local > 0.6 ? "38%" : "0%",
          opacity: local > 0.6 ? 1 : 0,
        }}
      />
    </div>
  );
}

interface ConnectorProps {
  readonly progress: number;
  readonly segment: readonly [number, number];
}

function Connector({ progress, segment }: ConnectorProps): React.ReactElement {
  const [start, end] = segment;
  const within = progress >= start && progress <= end;
  const local = within ? (progress - start) / (end - start) : progress > end ? 1 : 0;
  return (
    <div className="hidden lg:flex items-center justify-center px-2" aria-hidden>
      <div className="relative h-px w-full bg-white/[0.08]">
        <div
          className="absolute inset-y-0 left-0 bg-accent transition-all duration-100"
          style={{ width: `${Math.round(local * 100)}%` }}
        />
        <span
          className="absolute -top-[3px] h-[7px] w-[7px] rounded-full bg-accent transition-all duration-100 shadow-[0_0_12px_rgba(224,255,79,0.6)]"
          style={{
            left: `calc(${Math.round(local * 100)}% - 3.5px)`,
            opacity: within ? 1 : 0,
          }}
        />
      </div>
    </div>
  );
}

function ReturnArc({ progress }: { readonly progress: number }): React.ReactElement {
  // The "return" packet runs in the last 12% of the loop (preview → voice).
  const start = 0.88;
  const within = progress >= start;
  const local = within ? (progress - start) / (1 - start) : 0;

  return (
    <div className="relative mt-6 hidden lg:block" aria-hidden>
      <svg
        viewBox="0 0 1000 60"
        className="w-full h-12"
        preserveAspectRatio="none"
      >
        <path
          d="M 950 8 C 950 50, 720 56, 500 56 C 280 56, 50 50, 50 8"
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="1"
          strokeDasharray="3,4"
        />
        {within && (
          <circle
            cx={950 - local * 900}
            cy={8 + Math.sin(local * Math.PI) * 48}
            r="3.5"
            fill="rgb(224,255,79)"
          />
        )}
      </svg>
      <p className="text-center mono-cap text-paper/35 -mt-2">
        preview becomes next voice turn
      </p>
    </div>
  );
}

interface LoopTelemetryProps {
  readonly progress: number;
  readonly current: Node;
}

function LoopTelemetry({
  progress,
  current,
}: LoopTelemetryProps): React.ReactElement {
  const elapsed = (progress * 7).toFixed(1);
  const labels: Record<Node, string> = {
    voice: "capturing intent",
    mercury: "denoising diff",
    preview: "hot-reloading",
  };
  return (
    <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-3 rounded-lg border border-white/[0.06] bg-bg-3 px-6 py-4">
      <div className="flex items-center gap-2.5">
        <span className="h-2 w-2 rounded-full bg-accent pulse-dot" />
        <span className="mono-cap text-paper/60">loop</span>
        <span className="font-mono text-[13px] text-paper tabular-nums">
          {elapsed}s
        </span>
      </div>
      <div className="flex items-center gap-2.5">
        <span className="mono-cap text-paper/40">now</span>
        <span className="font-mono text-[13px] text-accent">
          {labels[current]}
        </span>
      </div>
      <div className="flex items-center gap-2.5">
        <span className="mono-cap text-paper/40">audio</span>
        <span className="font-mono text-[13px] text-paper/70">on-device</span>
      </div>
      <div className="flex items-center gap-2.5">
        <span className="mono-cap text-paper/40">network</span>
        <span className="font-mono text-[13px] text-paper/70">
          eri engine api only
        </span>
      </div>
    </div>
  );
}
