"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Eye, Mail, PenLine, CalendarClock, Undo2 } from "lucide-react";
import { OverlayPill, OverlayPanel, OverlayAskbar } from "./OverlayShell";

// The hero's living demo: the real eri overlay floating over a desktop,
// running one hands-free task end to end — heard, looked, acted, done — with
// the panic-stop and the undo kept in frame the whole time. The overlay is the
// actual product surface (see OverlayShell + globals.css `.eov-*`). The screen
// behind it is a neutral stand-in for "whatever you're working in", deliberately
// dimmed so the product, not the backdrop, is the subject.
//
// SSR-safe: renders in the finished state (trace done, result shown) so the
// section is never blank in a headless render or with JS disabled. Honours
// prefers-reduced-motion by staying in that finished state.

type Step = {
  readonly icon: React.ReactNode;
  readonly label: string;
};

const COMMAND = "reply to Priya, and push my 3pm back 30";

const STEPS: ReadonlyArray<Step> = [
  { icon: <Eye size={13} strokeWidth={2.2} />, label: "Looked at your screen" },
  { icon: <Mail size={13} strokeWidth={2.2} />, label: "Opened Priya’s thread" },
  { icon: <PenLine size={13} strokeWidth={2.2} />, label: "Drafted a reply in your voice" },
  { icon: <CalendarClock size={13} strokeWidth={2.2} />, label: "Moved your 3pm → 3:30, told the room" },
];

const RESULT = "Replied to Priya and pushed your 3pm to 3:30. Everyone’s notified.";

// phase: 0 idle · 1 listening · 2..(1+n) running each step · 2+n done
const DONE = 2 + STEPS.length;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function HeroStage(): React.ReactElement {
  const [phase, setPhase] = useState(DONE); // SSR-safe: settle finished
  const [reduced, setReduced] = useState(true);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const r = prefersReducedMotion();
    setReduced(r);
    if (!r) setPhase(0);
  }, []);

  useEffect(() => {
    if (reduced) return;
    window.clearTimeout(timer.current);
    const hold =
      phase === 0 ? 1100 : phase === 1 ? 1600 : phase === DONE ? 4200 : 820;
    timer.current = window.setTimeout(() => {
      setPhase((p) => (p >= DONE ? 0 : p + 1));
    }, hold);
    return () => window.clearTimeout(timer.current);
  }, [phase, reduced]);

  const listening = phase === 1;
  const done = phase >= DONE;
  const runningIdx = phase - 2; // which step is active
  const movedTime = phase >= 2 + 3 || done; // calendar updated after step 4 starts

  // cursor target on the backdrop, as % of the stage
  const cursor =
    phase <= 1
      ? { x: 50, y: 16, on: false }
      : phase <= 3
        ? { x: 30, y: 36, on: true } // the Priya row
        : { x: 78, y: 70, on: true }; // the calendar card

  return (
    <div
      className="relative mx-auto h-[560px] w-full max-w-[1080px] overflow-hidden rounded-[22px] border border-border sm:h-auto sm:aspect-[16/10.2]"
      style={{
        background:
          "radial-gradient(120% 90% at 50% -10%, #15171c 0%, #0d0e12 52%, #0a0b0e 100%)",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.05), 0 60px 120px -40px rgba(0,0,0,0.9)",
      }}
      aria-label="eri operating a Mac hands-free: it heard a spoken request, read the screen, replied to an email, and moved a meeting."
    >
      {/* faint engine glow, top — the product's light, not a SaaS blob */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(46% 36% at 50% 0%, rgba(217,255,87,0.08) 0%, transparent 70%)",
        }}
      />

      {/* ── the screen eri is working in (dimmed stand-in) ── */}
      <DeskBackdrop movedTime={movedTime} lookingAtPriya={cursor.on && phase <= 3} />

      {/* eri's cursor on the underlying screen */}
      <span
        aria-hidden
        className="pointer-events-none absolute z-20 hidden sm:block"
        style={{
          left: `${cursor.x}%`,
          top: `${cursor.y}%`,
          opacity: cursor.on ? 1 : 0,
          transform: "translate(-50%, -50%)",
          transition:
            "left 600ms cubic-bezier(0.16,1,0.3,1), top 600ms cubic-bezier(0.16,1,0.3,1), opacity 300ms",
        }}
      >
        <span
          className="block size-7 rounded-full"
          style={{
            border: "1.5px solid rgba(217,255,87,0.9)",
            boxShadow: "0 0 0 4px rgba(217,255,87,0.12), 0 0 18px rgba(217,255,87,0.35)",
          }}
        />
      </span>

      {/* ── the real eri overlay, floating top-center ── */}
      <div className="absolute inset-x-0 top-4 z-30 flex justify-center px-4 sm:top-6">
        <div className="eov w-full max-w-[560px]">
          <div className="flex w-full items-center justify-between gap-3">
            <OverlayPill listening={listening} />
            {/* panic-stop / cancel — always reachable while eri acts */}
            <span
              className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 font-geist-mono text-[11px]"
              style={{
                background: "rgba(15,16,19,0.78)",
                border: "1px solid rgba(255,255,255,0.14)",
                color: done ? "var(--text-ter)" : "#ffd0d0",
                backdropFilter: "blur(16px)",
                WebkitBackdropFilter: "blur(16px)",
                transition: "color 300ms",
              }}
            >
              <span
                className="size-1.5 rounded-full"
                style={{ background: done ? "rgba(255,255,255,0.3)" : "#ff5d5d" }}
              />
              <kbd className="font-geist-mono">⌥Space</kbd>
              {done ? "ready" : "stop"}
            </span>
          </div>

          <OverlayPanel entering={false} style={{ marginTop: 10 }}>
            {/* the spoken request */}
            <div className="flex items-center gap-2.5">
              <VoiceMark active={!done} />
              <p className="font-geist text-[15px] leading-snug text-[color:var(--eov-ink)]">
                <span className="text-[color:var(--eov-faint)]">“</span>
                {COMMAND}
                <span className="text-[color:var(--eov-faint)]">”</span>
              </p>
            </div>

            {/* the action trace */}
            <ol className="mt-4 space-y-2">
              {STEPS.map((s, i) => {
                const state =
                  done || i < runningIdx ? "done" : i === runningIdx ? "active" : "pending";
                const visible = done || i <= runningIdx;
                return (
                  <li
                    key={s.label}
                    className="flex items-center gap-2.5"
                    style={{
                      opacity: visible ? 1 : 0.32,
                      transform: visible ? "none" : "translateY(3px)",
                      transition:
                        "opacity 320ms cubic-bezier(0.16,1,0.3,1), transform 320ms cubic-bezier(0.16,1,0.3,1)",
                    }}
                  >
                    <span className="flex size-5 shrink-0 items-center justify-center">
                      {state === "done" ? (
                        <span
                          className="flex size-5 items-center justify-center rounded-full"
                          style={{ background: "var(--eov-accent)" }}
                        >
                          <Check size={12} strokeWidth={3} color="#14180a" />
                        </span>
                      ) : state === "active" ? (
                        <Loader2 size={15} strokeWidth={2.4} className="animate-spin text-[color:var(--eov-accent)]" />
                      ) : (
                        <span className="text-[color:var(--eov-faint)]">{s.icon}</span>
                      )}
                    </span>
                    <span
                      className="font-geist text-[13.5px]"
                      style={{ color: state === "pending" ? "var(--eov-faint)" : "var(--eov-muted)" }}
                    >
                      {s.label}
                    </span>
                  </li>
                );
              })}
            </ol>

            {/* the result + undo (trust stays in frame) */}
            <div
              className="mt-4 flex items-start gap-2.5 rounded-[13px] px-3.5 py-3"
              style={{
                background: "rgba(217,255,87,0.07)",
                border: "1px solid rgba(217,255,87,0.18)",
                opacity: done ? 1 : 0,
                maxHeight: done ? 200 : 0,
                transform: done ? "none" : "translateY(6px)",
                overflow: "hidden",
                transition: "opacity 360ms ease, transform 360ms ease, max-height 360ms ease",
              }}
            >
              <span
                className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full"
                style={{ background: "var(--eov-accent)" }}
              >
                <Check size={10} strokeWidth={3.5} color="#14180a" />
              </span>
              <p className="flex-1 font-geist text-[13.5px] leading-relaxed text-[color:var(--eov-ink)]">
                {RESULT}
              </p>
              <button
                type="button"
                tabIndex={-1}
                aria-hidden
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 font-geist text-[12px]"
                style={{ background: "rgba(255,255,255,0.06)", color: "var(--eov-muted)" }}
              >
                <Undo2 size={12} strokeWidth={2.2} />
                Undo
              </button>
            </div>

            {!done && <OverlayAskbar />}
          </OverlayPanel>
        </div>
      </div>
    </div>
  );
}

// A small breathing mic mark for the request line.
function VoiceMark({ active }: { readonly active: boolean }): React.ReactElement {
  return (
    <span className="flex h-5 items-end gap-[3px]" aria-hidden>
      {[0, 1, 2, 3].map((b) => (
        <span
          key={b}
          className="w-[3px] rounded-full"
          style={{
            height: 14,
            background: "var(--eov-accent)",
            opacity: active ? 0.9 : 0.4,
            transformOrigin: "bottom",
            animation: active ? "voiceBar 1s ease-in-out infinite" : "none",
            animationDelay: `${b * 90}ms`,
          }}
        />
      ))}
    </span>
  );
}

// The dimmed screen behind the overlay: a generic mail list + a calendar event
// card whose time updates when eri reschedules. Neutral on purpose — this is
// "your screen", not a second eri surface.
function DeskBackdrop({
  movedTime,
  lookingAtPriya,
}: {
  readonly movedTime: boolean;
  readonly lookingAtPriya: boolean;
}): React.ReactElement {
  const rows = ["Priya Nair", "GitHub", "Stripe", "Linear", "Notion"];
  return (
    <div
      aria-hidden
      className="absolute inset-0"
      style={{ filter: "saturate(0.9)", opacity: 0.92 }}
    >
      {/* mail window */}
      <div className="absolute left-[4%] top-[30%] w-[64%] overflow-hidden rounded-xl border border-white/8 bg-[#101114]">
        <div className="flex items-center gap-2 border-b border-white/6 px-4 py-2.5">
          <span className="size-2 rounded-full bg-white/12" />
          <span className="size-2 rounded-full bg-white/12" />
          <span className="size-2 rounded-full bg-white/12" />
          <span className="ml-2 font-geist-mono text-[10px] text-white/30">Mail — Inbox</span>
        </div>
        <div className="divide-y divide-white/5">
          {rows.map((r, i) => {
            const hot = i === 0 && lookingAtPriya;
            return (
              <div
                key={r}
                className="flex items-center gap-3 px-4 py-2.5"
                style={{
                  background: hot ? "rgba(217,255,87,0.08)" : "transparent",
                  boxShadow: hot ? "inset 2px 0 0 var(--accent)" : "none",
                  transition: "background 300ms, box-shadow 300ms",
                }}
              >
                <span className="size-6 shrink-0 rounded-full bg-white/6" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="font-geist text-[12px] text-white/70">{r}</span>
                    <span className="font-geist-mono text-[9px] text-white/25">
                      9:{48 - i * 6} AM
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-3/4 rounded-full bg-white/6" />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* calendar event card — its time changes when eri reschedules */}
      <div className="absolute bottom-[10%] right-[5%] w-[26%] min-w-[150px] rounded-xl border border-white/8 bg-[#101114] p-3.5">
        <div className="font-geist-mono text-[9px] uppercase tracking-[0.18em] text-white/30">
          Today
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span
            className="h-7 w-1 rounded-full"
            style={{ background: movedTime ? "var(--accent)" : "rgba(255,255,255,0.2)", transition: "background 300ms" }}
          />
          <div>
            <div className="font-geist text-[12px] text-white/75">Design review</div>
            <div className="font-geist-mono text-[10px] text-white/40">
              <span style={{ textDecoration: movedTime ? "line-through" : "none", opacity: movedTime ? 0.4 : 1 }}>
                3:00
              </span>
              {movedTime && <span className="text-[color:var(--accent)]"> → 3:30 PM</span>}
              {!movedTime && <span> PM</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
