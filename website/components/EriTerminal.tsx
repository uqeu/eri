"use client";

import { useEffect, useRef, useState } from "react";

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

const ic = (d: React.ReactNode): React.ReactNode => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-[14px] w-[14px]">
    {d}
  </svg>
);

const SCENES: ReadonlyArray<Scene> = [
  {
    id: "control",
    tab: "Control",
    icon: ic(<path d="M5 3l14 9-6 1.5 3 6-2.5 1-3-6L5 19V3Z" />),
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
    icon: ic(<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>),
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
    icon: ic(<><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" /><path d="M19 11a7 7 0 0 1-14 0" /><path d="M12 18v3" /></>),
    prompt: "reply to priya umm i'll send the deck friday",
    steps: [
      { label: "heard you", text: "Cleaned fillers, added punctuation — on-device." },
      { label: "cleaned", text: "“I'll send the deck Friday.”" },
    ],
  },
  {
    id: "build",
    tab: "Build",
    icon: ic(<><path d="M8 9l-4 3 4 3" /><path d="M16 9l4 3-4 3" /><path d="M13 5l-2 14" /></>),
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
    icon: ic(<><path d="M12 3a7 7 0 0 0-4 12.7V19a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-3.3A7 7 0 0 0 12 3Z" /><path d="M9 21h6" /></>),
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
        className="overflow-hidden rounded-2xl border border-white/15"
        style={{
          transform: `translate(${pos.x}px, ${pos.y}px)`,
          background: "linear-gradient(180deg, rgba(18,18,18,0.86) 0%, rgba(12,12,12,0.92) 100%)",
          backdropFilter: "blur(18px)",
          WebkitBackdropFilter: "blur(18px)",
          boxShadow: "0 0 0 1px rgba(224,255,79,0.12), 0 40px 90px -30px rgba(0,0,0,0.95)",
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
          <div className="flex items-center gap-3">
            <span className="font-mono text-[10px] text-text-ter">⌥␣ to summon</span>
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              className="flex size-5 items-center justify-center rounded-full text-text-ter transition-colors hover:text-text"
              aria-label={collapsed ? "Expand" : "Collapse"}
            >
              <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 transition-transform ${collapsed ? "" : "rotate-180"}`} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m6 9 6 6 6-6" />
              </svg>
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
                    className={`flex flex-shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] transition-colors ${
                      on ? "bg-white/10 text-text" : "text-text-sec hover:text-text"
                    }`}
                  >
                    <span className={on ? "text-accent" : "text-text-ter"}>{s.icon}</span>
                    {s.tab}
                  </button>
                );
              })}
            </div>

            {/* scene body */}
            <div className="flex min-h-[208px] flex-col gap-3 p-4">
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
