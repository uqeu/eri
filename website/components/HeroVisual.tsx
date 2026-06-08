"use client";

import { useEffect, useRef, useState } from "react";

// The hero's signature visual: eri summoned by a hotkey, floating over the
// desktop, hearing a command and acting on it — confirming before anything
// risky. A small staged loop drives the typing + step reveal so it feels alive;
// it honors prefers-reduced-motion by snapping to the final state.

interface Step {
  readonly caption: string;
  readonly done: boolean;
}

const COMMAND = "open Mail and start a reply to Priya";

const STEPS: ReadonlyArray<Step> = [
  { caption: "Looked at the screen", done: true },
  { caption: "Opened Mail", done: true },
  { caption: "Found Priya's last email", done: true },
  { caption: "Drafting a reply — I'll confirm before sending", done: false },
];

const TYPE_MS = 38;
const HOLD_MS = 1100;
const STEP_MS = 720;

export function HeroVisual(): React.ReactElement {
  const [typed, setTyped] = useState("");
  const [visibleSteps, setVisibleSteps] = useState(0);
  const [listening, setListening] = useState(true);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced.current) {
      setTyped(COMMAND);
      setVisibleSteps(STEPS.length);
      setListening(false);
      return;
    }

    let timers: ReturnType<typeof setTimeout>[] = [];
    let cancelled = false;

    const run = () => {
      setTyped("");
      setVisibleSteps(0);
      setListening(true);

      // Type the command out.
      for (let i = 0; i <= COMMAND.length; i++) {
        timers.push(
          setTimeout(() => !cancelled && setTyped(COMMAND.slice(0, i)), i * TYPE_MS),
        );
      }
      const afterType = COMMAND.length * TYPE_MS + 280;
      timers.push(setTimeout(() => !cancelled && setListening(false), afterType));

      // Reveal each action step.
      STEPS.forEach((_, idx) => {
        timers.push(
          setTimeout(
            () => !cancelled && setVisibleSteps(idx + 1),
            afterType + 360 + idx * STEP_MS,
          ),
        );
      });

      // Loop.
      const total = afterType + 360 + STEPS.length * STEP_MS + HOLD_MS;
      timers.push(
        setTimeout(() => {
          if (!cancelled) run();
        }, total),
      );
    };

    run();
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      timers = [];
    };
  }, []);

  return (
    <div className="relative select-none" aria-hidden>
      {/* Ambient glow behind the window */}
      <div className="pointer-events-none absolute -inset-12 hero-wash blur-2xl" />

      {/* Faux desktop window */}
      <div className="win-chrome relative overflow-hidden">
        {/* Title bar */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
          <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
          <span className="h-3 w-3 rounded-full bg-[#28c840]" />
          <span className="ml-3 font-mono text-[11px] text-text-ter">
            Mail — Inbox
          </span>
        </div>

        {/* Desktop backdrop (dimmed, suggests the OS underneath) */}
        <div className="check-grid relative h-[360px] bg-bg-card-2/40 p-5">
          {/* a couple of faint inbox rows for context */}
          <div className="space-y-2 opacity-40">
            {["Priya Nair", "GitHub", "Stripe", "Calendar"].map((s, i) => (
              <div
                key={s}
                className="flex items-center gap-3 rounded-md border border-border bg-bg-card/60 px-3 py-2.5"
              >
                <div className="h-7 w-7 rounded-full bg-bg-card-2" />
                <div className="min-w-0 flex-1">
                  <div className="h-2.5 w-24 rounded bg-text/15" />
                  <div className="mt-1.5 h-2 w-40 rounded bg-text/10" />
                </div>
                <div className="font-mono text-[10px] text-text-ter">
                  {`9:${48 - i} AM`}
                </div>
              </div>
            ))}
          </div>

          {/* The floating eri command bar — the star of the show */}
          <div className="absolute inset-x-5 bottom-5">
            <div className="win-chrome spotlight rounded-xl p-4">
              {/* hotkey + listening state */}
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg px-2 py-1 font-mono text-[11px] text-text-sec">
                  <kbd className="text-text">⌥</kbd>
                  <span className="text-text-ter">+</span>
                  <kbd className="text-text">Space</kbd>
                </span>

                {listening ? (
                  <span className="inline-flex items-center gap-2 text-[13px] text-text-sec">
                    <span className="flex items-end gap-[2px]" aria-hidden>
                      {[0, 1, 2, 3, 4].map((i) => (
                        <span
                          key={i}
                          className="w-[3px] rounded-full bg-[var(--accent)]"
                          style={{
                            height: "14px",
                            animation: `voiceBar 0.9s ${i * 0.12}s ease-in-out infinite`,
                            transformOrigin: "bottom",
                          }}
                        />
                      ))}
                    </span>
                    Listening…
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-2 text-[13px] text-text-sec">
                    <span className="pulse-dot h-2 w-2 rounded-full bg-[var(--accent)]" />
                    eri is on it
                  </span>
                )}
              </div>

              {/* transcribed command */}
              <div className="mt-3 font-display text-[17px] leading-snug text-text">
                “{typed}
                {listening && (
                  <span
                    className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[2px] bg-text"
                    style={{ animation: "caretBlink 1s step-end infinite" }}
                  />
                )}
                {!listening && "”"}
              </div>

              {/* action steps */}
              <div className="mt-3 space-y-1.5">
                {STEPS.slice(0, visibleSteps).map((step) => (
                  <div
                    key={step.caption}
                    className="rise flex items-center gap-2 text-[12.5px] text-text-sec"
                  >
                    {step.done ? (
                      <span className="flex h-4 w-4 items-center justify-center rounded-full border border-[var(--accent)]/40 text-[var(--accent)]">
                        <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="3">
                          <path d="M5 12l5 5L20 6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                    ) : (
                      <span className="flex h-4 w-4 items-center justify-center">
                        <span className="h-3 w-3 rounded-full border-2 border-text-ter border-t-text animate-spin" />
                      </span>
                    )}
                    <span className={step.done ? "" : "text-text"}>{step.caption}</span>
                  </div>
                ))}
              </div>

              {/* confirm chip — eri never sends silently */}
              {visibleSteps >= STEPS.length && (
                <div className="rise mt-3 flex items-center justify-between rounded-lg border border-border bg-bg px-3 py-2">
                  <span className="text-[12px] text-text-sec">Send the reply?</span>
                  <span className="flex items-center gap-2">
                    <span className="rounded-md border border-border px-2 py-1 font-mono text-[10px] text-text-ter">
                      review
                    </span>
                    <span className="rounded-md bg-text px-2 py-1 font-mono text-[10px] text-bg">
                      send
                    </span>
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
