"use client";

import { useEffect, useRef, useState } from "react";
import {
  MousePointer2,
  Eye,
  Mic,
  Code2,
  Brain,
  ChevronDown,
  Maximize2,
  Minimize2,
} from "lucide-react";

// eri's one interactive surface — a floating glass terminal that AUTO-PLAYS and
// whose tabs REPLACE the scene (the Nia/Cluely pattern, our way). Pure React/CSS,
// no Remotion in the page bundle, so it always runs and can't crash hydration.
// Drag it by the title bar. Brand: dark glass, lime, Funnel Display.

type Kind = "control" | "eyes" | "voice" | "build" | "memory";

interface Step {
  readonly label: string; // lime mono status
  readonly text: string;
}
interface Scene {
  readonly id: Kind;
  readonly tab: string;
  readonly icon: React.ReactNode;
  readonly prompt: string; // the typed command
  readonly steps: ReadonlyArray<Step>;
  readonly chip?: { readonly label: string; readonly value: string };
}

const ICON = { size: 15, strokeWidth: 1.75 } as const;

const SCENES: ReadonlyArray<Scene> = [
  {
    id: "control",
    tab: "Control",
    icon: <MousePointer2 {...ICON} />,
    prompt: "open my email and reply to Priya",
    steps: [
      { label: "looked at your screen", text: "Opened Mail and found Priya's thread." },
      { label: "drafted in your voice", text: "“Friday works — I'll send the deck then.”" },
    ],
    chip: { label: "waiting on you", value: "Send it?" },
  },
  {
    id: "eyes",
    tab: "Eyes",
    icon: <Eye {...ICON} />,
    prompt: "what's this error?",
    steps: [
      { label: "followed your gaze", text: "Read the stack trace you were looking at." },
      { label: "found it", text: "Null deref at Header.tsx:42 — theme is undefined on first paint." },
    ],
    chip: { label: "offer", value: "Want the fix?" },
  },
  {
    id: "voice",
    tab: "Voice",
    icon: <Mic {...ICON} />,
    prompt: "reply to priya umm i'll send the deck friday",
    steps: [
      { label: "heard you", text: "Cleaned fillers, added punctuation — on-device." },
      { label: "cleaned", text: "“I'll send the deck Friday.”" },
    ],
  },
  {
    id: "build",
    tab: "Build",
    icon: <Code2 {...ICON} />,
    prompt: "add a dark-mode toggle",
    steps: [
      { label: "planned", text: "Across Header.tsx and theme.ts." },
      { label: "edited", text: "Added <ThemeToggle/> and a persisted preference." },
      { label: "ran the tests", text: "12 passed." },
    ],
    chip: { label: "ready", value: "Open the preview" },
  },
  {
    id: "memory",
    tab: "Memory",
    icon: <Brain {...ICON} />,
    prompt: "(noticing how you work)",
    steps: [
      { label: "remembered, on-device", text: "You open this repo and Mail every morning." },
      { label: "anticipating", text: "Tomorrow I can have both ready before you ask." },
    ],
    chip: { label: "private", value: "Never leaves your machine" },
  },
];

// ── timing (frames @ ~45ms) ──
const TYPE = 2; // frames per char
const STEP = 16; // frames per step reveal
const HOLD = 30; // frames to hold a finished scene
const sceneLen = (s: Scene): number => s.prompt.length * TYPE + s.steps.length * STEP + HOLD;

export function EriTerminal({ className }: { readonly className?: string }): React.ReactElement {
  const [active, setActive] = useState(0);
  const [frame, setFrame] = useState(0);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [collapsed, setCollapsed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const hovered = useRef(false);
  const drag = useRef<{ ox: number; oy: number } | null>(null);

  // single deterministic clock
  useEffect(() => {
    if (collapsed) return;
    const t = window.setInterval(() => {
      setFrame((f) => {
        const scene = SCENES[active];
        if (f >= sceneLen(scene)) {
          if (hovered.current) return f; // hold finished scene while reading
          setActive((a) => (a + 1) % SCENES.length);
          return 0;
        }
        return f + 1;
      });
    }, 45);
    return () => window.clearInterval(t);
  }, [active, collapsed]);

  const scene = SCENES[active];
  const typedN = Math.min(scene.prompt.length, Math.floor(frame / TYPE));
  const afterType = frame - scene.prompt.length * TYPE;
  const revealed = afterType > 0 ? Math.min(scene.steps.length, Math.floor(afterType / STEP) + 1) : 0;
  const typing = typedN < scene.prompt.length;

  const pick = (i: number): void => {
    setActive(i);
    setFrame(0);
  };

  const onDown = (e: React.PointerEvent): void => {
    drag.current = { ox: e.clientX - pos.x, oy: e.clientY - pos.y };
    e.currentTarget.setPointerCapture?.(e.pointerId); // capture on the HEADER, not a child
  };
  const onMove = (e: React.PointerEvent): void => {
    if (!drag.current) return;
    setPos({ x: e.clientX - drag.current.ox, y: e.clientY - drag.current.oy });
  };
  const onUp = (): void => {
    drag.current = null;
  };

  return (
    <div className={className}>
      <div
        onMouseEnter={() => (hovered.current = true)}
        onMouseLeave={() => (hovered.current = false)}
        className="overflow-hidden rounded-[18px] border border-white/[0.10]"
        style={{
          transform: `translate(${pos.x}px, ${pos.y}px)`,
          background:
            "linear-gradient(180deg, rgba(22,22,25,0.55) 0%, rgba(10,10,12,0.66) 100%)",
          backdropFilter: "blur(28px) saturate(1.5)",
          WebkitBackdropFilter: "blur(28px) saturate(1.5)",
          // true glass: inset top highlight (edge refraction) + faint inner
          // hairline + subtle lime ring + deep soft drop shadow.
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.10), inset 0 0 0 1px rgba(255,255,255,0.035), 0 0 0 1px rgba(224,255,79,0.10), 0 50px 100px -32px rgba(0,0,0,0.95)",
        }}
      >
        {/* title bar — drag handle */}
        <div
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          className="flex cursor-grab touch-none select-none items-center justify-between border-b border-white/10 px-4 py-2.5 active:cursor-grabbing"
        >
          <div className="flex items-center gap-2">
            <span className="font-display text-[15px] leading-none text-text" style={{ letterSpacing: "-0.05em" }}>
              eri
            </span>
            <span className="mx-1 h-3 w-px bg-white/15" />
            <span className="flex items-center gap-1.5 font-mono text-[10px] text-text-ter">
              <span className="size-1.5 animate-pulse rounded-full bg-accent" />
              live
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="mr-1 hidden font-mono text-[10px] text-text-ter sm:inline">⌥␣ to summon</span>
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="flex size-6 items-center justify-center rounded-md text-text-ter transition-colors hover:bg-white/[0.06] hover:text-text"
              aria-label={expanded ? "Restore size" : "Expand"}
            >
              {expanded ? <Minimize2 size={13} strokeWidth={2} /> : <Maximize2 size={13} strokeWidth={2} />}
            </button>
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              className="flex size-6 items-center justify-center rounded-md text-text-ter transition-colors hover:bg-white/[0.06] hover:text-text"
              aria-label={collapsed ? "Expand" : "Collapse"}
            >
              <ChevronDown size={15} strokeWidth={2} className={`transition-transform ${collapsed ? "" : "rotate-180"}`} />
            </button>
          </div>
        </div>

        {!collapsed && (
          <>
            {/* tab bar — clicking REPLACES the scene */}
            <div className="flex gap-1 overflow-x-auto border-b border-white/10 px-2 py-2">
              {SCENES.map((s, i) => {
                const on = i === active;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => pick(i)}
                    aria-pressed={on}
                    className={`flex flex-shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] transition-all duration-200 ${
                      on
                        ? "bg-white/[0.08] text-text shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                        : "text-text-sec hover:bg-white/[0.04] hover:text-text"
                    }`}
                  >
                    <span className={on ? "text-accent" : "text-text-ter"}>{s.icon}</span>
                    {s.tab}
                  </button>
                );
              })}
            </div>

            {/* scene body — grows when expanded */}
            <div
              className="flex flex-col gap-3 p-4 transition-[min-height] duration-300 ease-out"
              style={{ minHeight: expanded ? 340 : 208 }}
            >
              {/* typed command */}
              <div className="flex items-baseline gap-2 font-mono text-[12.5px]">
                <span className="shrink-0 text-accent">eri&nbsp;›</span>
                <span className="text-text">
                  {scene.prompt.slice(0, typedN)}
                  <span className={`ml-0.5 inline-block w-[7px] -translate-y-px ${typing ? "opacity-100" : "opacity-0"}`} style={{ borderBottom: "2px solid #e0ff4f" }}>
                    &nbsp;
                  </span>
                </span>
              </div>

              {/* steps reveal one-by-one */}
              <div className="flex flex-col gap-2.5">
                {scene.steps.map((st, i) => {
                  const shown = i < revealed;
                  return (
                    <div
                      key={st.label}
                      className="transition-all duration-300"
                      style={{ opacity: shown ? 1 : 0, transform: shown ? "translateY(0)" : "translateY(6px)" }}
                    >
                      <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-accent">{st.label}</div>
                      <p className="mt-0.5 text-[13px] leading-[1.5] text-[#e8e8ea]">{st.text}</p>
                    </div>
                  );
                })}
              </div>

              {/* result chip */}
              {scene.chip && (
                <div
                  className="mt-auto flex w-fit items-center gap-2 rounded-lg border border-white/12 px-3 py-2 transition-all duration-300"
                  style={{
                    opacity: revealed >= scene.steps.length ? 1 : 0,
                    transform: revealed >= scene.steps.length ? "translateY(0)" : "translateY(6px)",
                  }}
                >
                  <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-ter">{scene.chip.label}</span>
                  <span className="text-[13px] font-medium text-text">{scene.chip.value}</span>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
