"use client";

// Orbital "watch eri in action" hub. A center chat-panel mock surrounded by
// four feature cards. A rotating "active" index lights one card at a time and
// drives the glowing packet that travels along the SVG connector to the
// center. The rotation lives in a single tick so all four corners stay in
// lock-step and the packets don't desync from the highlighted card.

import { useEffect, useState } from "react";

const TICK_MS = 150;
const STEPS_PER_NODE = 12; // 12 * 150ms = 1.8s per orbital card

type NodeId = "voice" | "gaze" | "diffusion" | "history";

interface OrbitalNode {
  readonly id: NodeId;
  readonly title: string;
  readonly side: "left" | "right";
  readonly row: "top" | "bottom";
}

const NODES: ReadonlyArray<OrbitalNode> = [
  { id: "voice", title: "Voice composer", side: "left", row: "top" },
  { id: "diffusion", title: "Diffusion preview", side: "right", row: "top" },
  { id: "gaze", title: "Gaze targeting", side: "left", row: "bottom" },
  { id: "history", title: "Iteration history", side: "right", row: "bottom" },
];

// Order in which packets fire around the hub. Reads as a turn: speak, look,
// denoise the patch, then file it into history.
const SEQUENCE: ReadonlyArray<NodeId> = ["voice", "gaze", "diffusion", "history"];

// SVG viewBox is 1000x520. Center card sits centred; orbital anchor points are
// where each connector touches the central card edge.
const SVG_W = 1000;
const SVG_H = 520;

interface PathSpec {
  readonly id: NodeId;
  readonly d: string;
  readonly from: { x: number; y: number };
  readonly to: { x: number; y: number };
}

const PATHS: ReadonlyArray<PathSpec> = [
  {
    id: "voice",
    from: { x: 230, y: 130 },
    to: { x: 410, y: 220 },
    d: "M 230 130 C 320 130, 360 180, 410 220",
  },
  {
    id: "diffusion",
    from: { x: 770, y: 130 },
    to: { x: 590, y: 220 },
    d: "M 770 130 C 680 130, 640 180, 590 220",
  },
  {
    id: "gaze",
    from: { x: 230, y: 390 },
    to: { x: 410, y: 300 },
    d: "M 230 390 C 320 390, 360 340, 410 300",
  },
  {
    id: "history",
    from: { x: 770, y: 390 },
    to: { x: 590, y: 300 },
    d: "M 770 390 C 680 390, 640 340, 590 300",
  },
];

function useSequenceTick(): { activeId: NodeId; subStep: number } {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const handle = window.setInterval(() => {
      setTick((value) => (value + 1) % (SEQUENCE.length * STEPS_PER_NODE));
    }, TICK_MS);
    return () => window.clearInterval(handle);
  }, []);
  const slot = Math.floor(tick / STEPS_PER_NODE);
  const subStep = (tick % STEPS_PER_NODE) / STEPS_PER_NODE;
  return { activeId: SEQUENCE[slot] ?? SEQUENCE[0], subStep };
}

function pointOnPath(path: PathSpec, t: number): { x: number; y: number } {
  // Linear interpolation along the chord is close enough — the curve sag is
  // small and the packet reads as "travelling" either way.
  const { from, to } = path;
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
  };
}

interface OrbitalCardProps {
  readonly node: OrbitalNode;
  readonly active: boolean;
  readonly children: React.ReactNode;
  readonly caption: string;
}

function OrbitalCard({ node, active, children, caption }: OrbitalCardProps): React.ReactElement {
  const positionClasses =
    node.row === "top"
      ? node.side === "left"
        ? "top-0 left-0"
        : "top-0 right-0"
      : node.side === "left"
        ? "bottom-0 left-0"
        : "bottom-0 right-0";
  return (
    <div
      className={`absolute w-[27%] rounded-xl border bg-[#181818] p-4 transition-all duration-300 ${positionClasses}`}
      style={{
        opacity: active ? 1 : 0.7,
        borderColor: active ? "#e0ff4f" : "#262626",
        boxShadow: active ? "0 0 24px rgba(224, 255, 79, 0.18)" : "none",
      }}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-[#8b8b96]">
          {node.title}
        </span>
        <span
          className="h-1.5 w-1.5 rounded-full transition-colors"
          style={{ backgroundColor: active ? "#e0ff4f" : "#3a3a3a" }}
        />
      </div>
      <div className="text-[13px] text-[#d6d6dd]">{children}</div>
      <div className="mt-3 text-[10px] uppercase tracking-wider text-[#5a5a64]">
        {caption}
      </div>
    </div>
  );
}

function VoiceGlyph(): React.ReactElement {
  return (
    <div className="flex items-end gap-[3px] h-7">
      {[14, 22, 10, 26, 18, 28, 12, 20, 16, 24, 8].map((height, index) => (
        <span
          key={index}
          className="w-[3px] rounded-sm bg-[#228df2]"
          style={{ height: `${height}px`, opacity: 0.4 + (index % 4) * 0.15 }}
        />
      ))}
    </div>
  );
}

function GazeGlyph(): React.ReactElement {
  return (
    <svg viewBox="0 0 48 48" className="h-8 w-8">
      <circle cx="24" cy="24" r="20" fill="none" stroke="#262626" strokeWidth="1.5" />
      <circle cx="24" cy="24" r="13" fill="none" stroke="#3a3a3a" strokeWidth="1.5" />
      <circle cx="24" cy="24" r="6" fill="none" stroke="#e0ff4f" strokeWidth="1.5" />
      <circle cx="24" cy="24" r="2" fill="#e0ff4f" />
    </svg>
  );
}

function DiffusionGrid(): React.ReactElement {
  // 4 columns x 6 rows of denoising cells. Each cell holds a stable
  // pseudo-random fill so successive renders don't strobe.
  const cells = Array.from({ length: 24 }, (_, i) => {
    const seed = (i * 37 + 11) % 100;
    const alpha = 0.15 + (seed % 70) / 100;
    return alpha;
  });
  return (
    <div className="grid grid-cols-4 gap-[3px]">
      {cells.map((alpha, index) => (
        <span
          key={index}
          className="aspect-square rounded-[2px]"
          style={{ backgroundColor: `rgba(34, 141, 242, ${alpha.toFixed(2)})` }}
        />
      ))}
    </div>
  );
}

function HistoryPills(): React.ReactElement {
  const turns: ReadonlyArray<string> = [
    "wire the auth callback",
    "swap hero copy for v3",
    "ship the pricing toggle",
  ];
  return (
    <div className="flex flex-col gap-1.5">
      {turns.map((label, index) => (
        <div
          key={label}
          className="flex items-center gap-2 rounded-full border border-[#262626] bg-[#0f0f0f] px-2.5 py-1"
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: index === 2 ? "#e0ff4f" : "#3a3a3a" }}
          />
          <span className="truncate text-[11px] text-[#d6d6dd]">{label}</span>
        </div>
      ))}
    </div>
  );
}

function CenterCard(): React.ReactElement {
  return (
    <div className="absolute left-1/2 top-1/2 w-[36%] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[#262626] bg-[#181818] p-5 shadow-[0_0_60px_rgba(34,141,242,0.08)]">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[#e0ff4f]" />
          <span className="text-[11px] font-medium uppercase tracking-wider text-[#8b8b96]">
            this turn
          </span>
        </div>
        <span className="rounded-full border border-[#228df2]/30 bg-[#228df2]/10 px-2 py-0.5 text-[10px] font-medium text-[#228df2]">
          eri's engine
        </span>
      </div>
      <div className="rounded-md border border-[#262626] bg-[#0f0f0f] px-3 py-2 text-[13px] text-[#d6d6dd]">
        <span className="text-[#5a5a64]">›</span> ship the pricing toggle
      </div>
      <div className="mt-3 flex items-center gap-2 text-[11px] text-[#8b8b96]">
        <span className="text-[#e0ff4f]">✓</span>
        <span>planned</span>
        <span className="text-[#3a3a3a]">·</span>
        <span className="text-[#228df2]">denoising</span>
        <span className="text-[#3a3a3a]">·</span>
        <span>committing</span>
      </div>
      <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-[#0f0f0f]">
        <div className="h-full w-2/3 rounded-full bg-gradient-to-r from-[#228df2] to-[#e0ff4f]" />
      </div>
    </div>
  );
}

export function EriHub(): React.ReactElement {
  const { activeId, subStep } = useSequenceTick();

  return (
    <section className="w-full bg-[#0A0A0A] py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mb-12 text-center">
          <span className="inline-block rounded-full border border-[#262626] bg-[#181818] px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-[#e0ff4f]">
            Watch eri build
          </span>
          <h2 className="mt-4 text-3xl font-medium tracking-tight text-[#d6d6dd] md:text-4xl">
            One voice turn. Four surfaces in motion.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-[14px] text-[#8b8b96]">
            Speak the next change. eri routes the intent through gaze, diffusion, and history so every panel converges on the same commit.
          </p>
        </div>

        <div className="relative mx-auto aspect-[1000/520] w-full">
          <svg
            viewBox={`0 0 ${SVG_W} ${SVG_H}`}
            className="absolute inset-0 h-full w-full"
            preserveAspectRatio="none"
          >
            <defs>
              <radialGradient id="packetGlow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#e0ff4f" stopOpacity="0.9" />
                <stop offset="60%" stopColor="#228df2" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#228df2" stopOpacity="0" />
              </radialGradient>
            </defs>
            {PATHS.map((path) => {
              const isActive = path.id === activeId;
              return (
                <path
                  key={path.id}
                  d={path.d}
                  fill="none"
                  stroke={isActive ? "#228df2" : "#262626"}
                  strokeWidth={isActive ? 1.5 : 1}
                  strokeDasharray="4 4"
                  style={{
                    opacity: isActive ? 0.9 : 0.45,
                    transition: "opacity 300ms, stroke 300ms",
                  }}
                />
              );
            })}
            {PATHS.map((path) => {
              if (path.id !== activeId) return null;
              const point = pointOnPath(path, subStep);
              return (
                <g key={`packet-${path.id}`}>
                  <circle cx={point.x} cy={point.y} r="14" fill="url(#packetGlow)" />
                  <circle cx={point.x} cy={point.y} r="3.5" fill="#e0ff4f" />
                </g>
              );
            })}
          </svg>

          {NODES.map((node) => {
            const active = node.id === activeId;
            if (node.id === "voice") {
              return (
                <OrbitalCard key={node.id} node={node} active={active} caption="captured from mic">
                  <div className="space-y-2">
                    <VoiceGlyph />
                    <p className="text-[12px] leading-snug text-[#d6d6dd]">
                      “ship the pricing toggle — keep the annual default.”
                    </p>
                  </div>
                </OrbitalCard>
              );
            }
            if (node.id === "gaze") {
              return (
                <OrbitalCard key={node.id} node={node} active={active} caption="knows which line">
                  <div className="flex items-center gap-3">
                    <GazeGlyph />
                    <div className="text-[12px] leading-snug text-[#d6d6dd]">
                      <div>focus → PricingToggle.tsx</div>
                      <div className="text-[#8b8b96]">line 42 · annual branch</div>
                    </div>
                  </div>
                </OrbitalCard>
              );
            }
            if (node.id === "diffusion") {
              return (
                <OrbitalCard key={node.id} node={node} active={active} caption="patch denoising">
                  <DiffusionGrid />
                </OrbitalCard>
              );
            }
            return (
              <OrbitalCard key={node.id} node={node} active={active} caption="prior turns, replayable">
                <HistoryPills />
              </OrbitalCard>
            );
          })}

          <CenterCard />
        </div>
      </div>
    </section>
  );
}
