"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";

// eri's answer to Lemma's trace demo: a clean, live-looking product card that
// shows eri actually doing a task — a typed request, an action trace whose spans
// fill in with real-looking timings, then the result. Premium via specificity +
// quiet motion, not spectacle. Pure React + CSS, auto-loops, SSR-safe (settles
// fully shown), honours prefers-reduced-motion.

type Span = { readonly label: string; readonly ms: number };

const REQUEST = "book me a table for two, Friday 7pm";

const SPANS: ReadonlyArray<Span> = [
  { label: "Understood the request", ms: 110 },
  { label: "Opened OpenTable", ms: 420 },
  { label: "Searched · Fri 7:00pm · party of 2", ms: 680 },
  { label: "Picked Rintaro · 4.8 · 0.4mi", ms: 300 },
  { label: "Confirmed the booking", ms: 240 },
];

const RESULT =
  "Booked — Rintaro, Friday 7:00pm, table for two. Added to your calendar and texted Sam.";

const TOTAL_MS = SPANS.reduce((a, s) => a + s.ms, 0);

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function EriTrace({
  className,
}: {
  readonly className?: string;
}): React.ReactElement {
  // step: 0..SPANS.length running; SPANS.length = done (result shown)
  const [step, setStep] = useState(SPANS.length);
  const [reduced, setReduced] = useState(true);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const r = prefersReducedMotion();
    setReduced(r);
    if (r) {
      setStep(SPANS.length);
      return;
    }
    setStep(0);
  }, []);

  useEffect(() => {
    if (reduced) return;
    window.clearTimeout(timer.current);

    if (step < SPANS.length) {
      // advance after a scaled version of this span's duration
      const delay = 360 + SPANS[step].ms * 0.6;
      timer.current = window.setTimeout(
        () => setStep((s) => s + 1),
        delay,
      );
    } else {
      // hold on the result, then replay
      timer.current = window.setTimeout(() => setStep(0), 3200);
    }
    return () => window.clearTimeout(timer.current);
  }, [step, reduced]);

  const done = step >= SPANS.length;
  const elapsed = done
    ? TOTAL_MS
    : SPANS.slice(0, step).reduce((a, s) => a + s.ms, 0);

  return (
    <div className={className}>
      <div
        className="mx-auto w-full max-w-[640px] overflow-hidden rounded-2xl border border-border bg-bg-card"
        style={{
          boxShadow:
            "0 1px 2px rgba(17,17,19,0.04), 0 24px 48px -24px rgba(17,17,19,0.18)",
        }}
      >
        {/* window chrome */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <div className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-[rgba(17,17,19,0.12)]" />
            <span className="size-2.5 rounded-full bg-[rgba(17,17,19,0.12)]" />
            <span className="size-2.5 rounded-full bg-[rgba(17,17,19,0.12)]" />
          </div>
          <div className="flex items-center gap-2">
            <span
              className="font-geist text-[13px] font-medium text-text"
              style={{ letterSpacing: "-0.02em" }}
            >
              eri
            </span>
            <span className="flex items-center gap-1.5 font-geist-mono text-[10px] text-text-ter">
              <span
                className="size-1.5 rounded-full"
                style={{
                  background: done ? "var(--accent-emerald)" : "#f59e0b",
                  animation: done ? "none" : "pulseDot 1.3s ease-in-out infinite",
                }}
              />
              {done ? "done" : "running"}
            </span>
          </div>
          <span className="ml-auto font-geist-mono text-[10px] tabular-nums text-text-ter">
            {(elapsed / 1000).toFixed(1)}s · {SPANS.length} steps
          </span>
        </div>

        <div className="px-5 py-5">
          {/* the request */}
          <div className="flex items-baseline gap-2 font-geist-mono text-[12.5px]">
            <span className="shrink-0 text-text-ter">you ›</span>
            <span className="text-text">{REQUEST}</span>
          </div>

          {/* the action trace */}
          <ol className="mt-4 space-y-1.5">
            {SPANS.map((s, i) => {
              const state =
                i < step ? "done" : i === step ? "active" : "pending";
              const visible = i <= step;
              return (
                <li
                  key={s.label}
                  className="flex items-center gap-3"
                  style={{
                    opacity: visible ? 1 : 0,
                    transform: visible ? "none" : "translateY(4px)",
                    transition:
                      "opacity 300ms cubic-bezier(0.16,1,0.3,1), transform 300ms cubic-bezier(0.16,1,0.3,1)",
                  }}
                >
                  <span className="flex size-5 shrink-0 items-center justify-center">
                    {state === "done" ? (
                      <span className="flex size-5 items-center justify-center rounded-full bg-[color:var(--accent-emerald)]">
                        <Check size={12} strokeWidth={3} className="text-white" />
                      </span>
                    ) : state === "active" ? (
                      <Loader2
                        size={15}
                        strokeWidth={2.4}
                        className="animate-spin text-text-ter"
                      />
                    ) : (
                      <span className="size-1.5 rounded-full bg-[rgba(17,17,19,0.18)]" />
                    )}
                  </span>

                  <span
                    className={`font-geist text-[13.5px] ${
                      state === "pending" ? "text-text-ter" : "text-text"
                    }`}
                  >
                    {s.label}
                  </span>

                  {/* duration bar + timing */}
                  <span className="ml-auto flex items-center gap-2.5">
                    <span className="hidden h-[3px] w-16 overflow-hidden rounded-full bg-[rgba(17,17,19,0.06)] sm:block">
                      <span
                        className="block h-full rounded-full bg-[color:var(--accent-emerald)]"
                        style={{
                          width: state === "pending" ? "0%" : "100%",
                          opacity: state === "pending" ? 0 : 0.55,
                          transition: `width ${Math.round(
                            s.ms * 0.6,
                          )}ms linear, opacity 200ms`,
                        }}
                      />
                    </span>
                    <span className="w-10 text-right font-geist-mono text-[10.5px] tabular-nums text-text-ter">
                      {state === "pending" ? "" : `${s.ms}ms`}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>

          {/* the result */}
          <div
            className="mt-4 flex items-start gap-2.5 rounded-xl border border-border bg-bg-card-2 px-4 py-3.5"
            style={{
              opacity: done ? 1 : 0.35,
              transition: "opacity 360ms cubic-bezier(0.16,1,0.3,1)",
            }}
          >
            <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-[color:var(--accent-emerald)]">
              <Check size={10} strokeWidth={3.5} className="text-white" />
            </span>
            <p className="font-geist text-[13.5px] leading-relaxed text-text">
              {RESULT}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
