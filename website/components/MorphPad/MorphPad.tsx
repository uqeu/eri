"use client";

import { useEffect, useRef, useState } from "react";
import { MousePointer2, Code2, Eye, Mic, Search, Square } from "lucide-react";
import {
  type Mode,
  type ControlKind,
  dimensionsFor,
  CONTROL_FACETS,
  TIMELINE,
  HOLD_MS,
  firstSlideOf,
  CAPTION,
} from "./morph";
import { FauxDesktop } from "./FauxDesktop";
import { BuildScene } from "./BuildScene";

// One pad, two modes. It auto-plays a short reel — a few Control beats, then the
// Build IDE — and you can jump between modes with the segmented control. The pad
// physically morphs: Control is compact, Build expands to a full editor.

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

// Most items any single control scene reveals (chips + answer + note).
const MAX_REVEAL = 12;

export function MorphPad({ className }: { readonly className?: string }): React.ReactElement {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [reveal, setReveal] = useState(MAX_REVEAL); // start fully shown (SSR-safe, never blank)
  const hovering = useRef(false);

  // Deterministic mode for screenshots / deep-links: ?mode=build|control pins it.
  useEffect(() => {
    setReduced(prefersReducedMotion());
    const q = new URLSearchParams(window.location.search).get("mode");
    if (q === "build" || q === "control") {
      setIdx(firstSlideOf(q));
      setPaused(true);
    }
  }, []);

  const slide = TIMELINE[idx];
  const mode = slide.mode;
  const dims = dimensionsFor(mode);
  const still = paused || reduced;

  // single autoplay clock — advances when not paused/hovered
  useEffect(() => {
    if (paused) return;
    const t = window.setTimeout(() => {
      if (hovering.current) return; // hold while the reader is on it
      setIdx((i) => (i + 1) % TIMELINE.length);
    }, HOLD_MS[mode]);
    return () => window.clearTimeout(t);
  }, [idx, paused, mode]);

  // progressive reveal of the current scene's items. When pinned/reduced-motion
  // the scene is shown complete (default = visible, never gated blank).
  useEffect(() => {
    if (still) {
      setReveal(MAX_REVEAL);
      return;
    }
    setReveal(0);
    const t = window.setInterval(() => {
      setReveal((r) => (r >= MAX_REVEAL ? MAX_REVEAL : r + 1));
    }, 240);
    return () => window.clearInterval(t);
  }, [idx, still]);

  const jump = (m: Mode): void => {
    setPaused(false);
    setIdx(firstSlideOf(m));
  };

  const morphTransition = reduced
    ? "none"
    : "max-width 640ms var(--ease-out), min-height 640ms var(--ease-out)";

  return (
    <div className={className}>
      <div className="relative mx-auto w-full max-w-6xl overflow-hidden rounded-[28px]">
        <FauxDesktop />

        {/* the pad floats on the faux desktop */}
        <div className="relative flex min-h-[460px] items-center justify-center px-4 py-12 sm:px-8 sm:py-16 lg:py-20">
          <div
            onMouseEnter={() => (hovering.current = true)}
            onMouseLeave={() => (hovering.current = false)}
            className="w-full overflow-hidden rounded-[20px] border border-white/[0.18]"
            style={{
              maxWidth: dims.maxWidth,
              transition: morphTransition,
              background:
                "linear-gradient(180deg, rgba(40,40,48,0.34), rgba(12,12,16,0.46))",
              backdropFilter: "blur(44px) saturate(2.0)",
              WebkitBackdropFilter: "blur(44px) saturate(2.0)",
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -1px 0 rgba(255,255,255,0.06)," +
                "inset 0 0 0 1px rgba(255,255,255,0.05), 0 0 0 1px rgba(224,255,79,0.10)," +
                "0 0 90px -20px rgba(224,255,79,0.16), 0 60px 120px -34px rgba(0,0,0,0.96)",
            }}
          >
            <PadHeader mode={mode} onJump={jump} />
            <div
              className="overflow-hidden"
              style={{ minHeight: dims.minHeight, transition: morphTransition }}
            >
              {/* key remount replays the .rise entrance for each slide */}
              <div key={idx} className="h-full">
                {mode === "build" ? (
                  <BuildScene />
                ) : (
                  <ControlScene facet={(slide as { facet: number }).facet} reveal={reveal} />
                )}
              </div>
            </div>
          </div>

          {/* a caption that morphs with the pad */}
          <p
            key={mode}
            className="absolute bottom-5 left-0 right-0 text-center font-mono text-[11px] text-text-ter"
            style={{ opacity: still ? 1 : undefined, animation: still ? undefined : "fadeUp 0.6s var(--ease-out) both" }}
          >
            {CAPTION[mode]}
          </p>
        </div>
      </div>
    </div>
  );
}

function PadHeader({
  mode,
  onJump,
}: {
  readonly mode: Mode;
  readonly onJump: (m: Mode) => void;
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2.5">
      <div className="flex items-center gap-2">
        <span
          className="font-display text-[15px] leading-none text-text"
          style={{ letterSpacing: "-0.05em" }}
        >
          eri
        </span>
        <span className="mx-0.5 h-3 w-px bg-white/15" />
        <span className="flex items-center gap-1.5 font-mono text-[10px] text-text-ter">
          <span className="size-1.5 animate-pulse rounded-full bg-accent" />
          {mode === "build" ? "building" : "live"}
        </span>
      </div>

      {/* the morph control — Control vs Build */}
      <div className="flex items-center gap-0.5 rounded-[10px] border border-white/10 bg-black/20 p-0.5">
        <Seg active={mode === "control"} onClick={() => onJump("control")} icon={<MousePointer2 size={12} strokeWidth={2} />}>
          Control
        </Seg>
        <Seg active={mode === "build"} onClick={() => onJump("build")} icon={<Code2 size={12} strokeWidth={2} />}>
          Build
        </Seg>
      </div>

      <span className="hidden font-mono text-[10px] text-text-ter sm:inline">
        ⌥␣ to summon
      </span>
    </div>
  );
}

function Seg({
  active,
  onClick,
  icon,
  children,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly icon: React.ReactNode;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] transition-colors duration-200 ${
        active
          ? "bg-[rgba(224,255,79,0.12)] text-text shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] ring-1 ring-inset ring-[rgba(224,255,79,0.24)]"
          : "text-text-sec hover:text-text"
      }`}
    >
      <span className={active ? "text-accent" : "text-text-ter"}>{icon}</span>
      {children}
    </button>
  );
}

const KIND_ICON: Record<ControlKind, React.ReactNode> = {
  act: <MousePointer2 size={13} strokeWidth={1.9} />,
  ask: <Search size={13} strokeWidth={1.9} />,
  voice: <Mic size={13} strokeWidth={1.9} />,
};

const KIND_LABEL: Record<ControlKind, string> = {
  act: "operating your apps",
  ask: "reading your screen",
  voice: "dictation, on-device",
};

// Each scene item appears once `reveal` reaches its index. The settled state is
// fully visible, so the scene is never blank (SSR, headless, hidden tab) — the
// reveal only adds a soft rise on top of an already-visible default.
function Reveal({
  shown,
  className,
  style,
  children,
}: {
  readonly shown: boolean;
  readonly className?: string;
  readonly style?: React.CSSProperties;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      className={className}
      style={{
        ...style,
        opacity: shown ? 1 : 0,
        transform: shown ? "none" : "translateY(6px)",
        transition: "opacity 360ms var(--ease-out), transform 360ms var(--ease-out)",
      }}
    >
      {children}
    </div>
  );
}

function ControlScene({
  facet,
  reveal,
}: {
  readonly facet: number;
  readonly reveal: number;
}): React.ReactElement {
  const f = CONTROL_FACETS[facet];
  const answerAt = f.actions.length;
  const noteAt = f.actions.length + 1;
  return (
    <div className="flex h-full flex-col gap-4 p-5">
      {/* what eri is doing right now */}
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-text-ter">
        <span className="text-accent">{KIND_ICON[f.kind]}</span>
        {KIND_LABEL[f.kind]}
      </div>

      {/* your request */}
      <div className="flex items-baseline gap-2 font-mono text-[13px]">
        <span className="shrink-0 text-accent">eri&nbsp;›</span>
        <span className="text-text">
          {f.request}
          <span
            className="ml-0.5 inline-block w-[7px] -translate-y-px"
            style={{ borderBottom: "2px solid #e0ff4f", animation: "caretBlink 1.1s steps(1) infinite" }}
          >
            &nbsp;
          </span>
        </span>
      </div>

      {/* the literal steps it took on your machine */}
      <div className="flex flex-wrap gap-1.5">
        {f.actions.map((a, i) => (
          <Reveal
            key={a}
            shown={reveal > i}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.04] px-2.5 py-1 font-mono text-[11px] text-text-sec"
          >
            <span className="size-1 rounded-full bg-accent" />
            {a}
          </Reveal>
        ))}
      </div>

      {/* the answer */}
      <Reveal shown={reveal > answerAt} className="rounded-xl border border-white/10 bg-white/[0.02] p-3.5">
        <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-text-ter">eri</div>
        <p className="mt-1 text-[14px] leading-[1.5] text-text">{f.answer}</p>
      </Reveal>

      {/* ambient note + panic affordance */}
      {f.note && (
        <Reveal shown={reveal > noteAt} className="mt-auto flex items-center justify-between gap-3">
          <span className="text-[12px] leading-snug text-text-sec">{f.note}</span>
          <span className="flex shrink-0 items-center gap-1.5 rounded-md border border-white/12 px-2 py-1 font-mono text-[10px] text-text-ter">
            <Square size={9} strokeWidth={2.5} className="text-[#fca5a5]" />
            ⌘⌥⎋ stops it
          </span>
        </Reveal>
      )}
    </div>
  );
}
