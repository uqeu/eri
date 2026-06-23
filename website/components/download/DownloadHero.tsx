"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Apple, Command, Check } from "lucide-react";
import { EriComposer } from "@/components/home/EriComposer";

// The download hero. A confident, Apple-clean light surface: the claim on the
// left, the real eri composer pill on the right so the visitor sees the actual
// product before they install it. The primary action is one big "Download for
// Mac" button. A faint lime aura (the engine accent) breathes behind the pill —
// the only place lime appears as light, never as text on white.

const ACCENT = "#e0ff4f";
const EASE = "cubic-bezier(0.16,1,0.3,1)";

export function DownloadHero(): React.ReactElement {
  const [ready, setReady] = useState(false);
  const [reduced, setReduced] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const red =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    setReduced(red);
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Entrance: each block lifts in with a staggered ease-out-expo. Reduced
  // motion lands on the settled state instantly.
  const lift = (i: number): React.CSSProperties =>
    reduced
      ? {}
      : {
          opacity: ready ? 1 : 0,
          transform: ready ? "translateY(0)" : "translateY(14px)",
          transition: `opacity 640ms ${EASE} ${i * 80}ms, transform 720ms ${EASE} ${i * 80}ms`,
        };

  return (
    <section className="relative overflow-hidden">
      {/* ambient: one whisper-soft cool wash + a lime aura that sits behind the
          product pill, never touching the text column. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(58% 44% at 50% -6%, rgba(20,20,24,0.04) 0%, transparent 72%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -z-10 hidden lg:block"
        style={{
          right: "-6%",
          top: "18%",
          width: "44vw",
          height: "44vw",
          maxWidth: 640,
          maxHeight: 640,
          background: `radial-gradient(circle, ${ACCENT}26 0%, ${ACCENT}0d 38%, transparent 68%)`,
          filter: "blur(8px)",
        }}
      />

      <div className="container grid grid-cols-1 items-center gap-14 pb-20 pt-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10 lg:pb-28 lg:pt-16">
        {/* Left: the claim + the action */}
        <div ref={rootRef} className="max-w-xl">
          <h1
            className="font-display text-[clamp(2.6rem,5.4vw,4.4rem)] font-medium leading-[0.98] text-text"
            style={{ letterSpacing: "-0.035em", textWrap: "balance", ...lift(0) }}
          >
            Put eri on your Mac.
          </h1>

          <p
            className="mt-5 max-w-md font-geist text-[clamp(1.05rem,1.5vw,1.2rem)] leading-[1.5] text-text-sec"
            style={lift(1)}
          >
            One download and a hotkey. After that, eri is one keypress away
            anywhere on your computer: it hears you, sees your screen, runs your
            apps, and remembers you across every device.
          </p>

          {/* primary + secondary actions */}
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center" style={lift(2)}>
            <Link
              href="/api/download/macos"
              className="group inline-flex items-center justify-center gap-2.5 rounded-full bg-text px-7 py-4 font-geist text-[15.5px] font-semibold text-bg outline-none transition-transform duration-200 hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-offset-2"
              style={{ transitionTimingFunction: EASE }}
            >
              <Apple size={19} strokeWidth={0} fill="currentColor" />
              Download for Mac
            </Link>
            <Link
              href="#quickstart"
              className="inline-flex items-center justify-center rounded-full border border-border-strong px-6 py-4 font-geist text-[15px] font-medium text-text outline-none transition-colors duration-200 hover:bg-bg-card focus-visible:ring-2 focus-visible:ring-offset-2"
            >
              How it works
            </Link>
          </div>

          {/* honest sub-line under the button */}
          <ul
            className="mt-6 flex flex-wrap gap-x-6 gap-y-2 font-geist text-[13.5px] text-text-ter"
            style={lift(3)}
          >
            {[
              "macOS 13+ · Apple silicon & Intel",
              "Phone (iMessage) included",
              "No card required",
            ].map((t) => (
              <li key={t} className="inline-flex items-center gap-1.5">
                <Check size={14} strokeWidth={2.6} className="text-text-sec" />
                {t}
              </li>
            ))}
          </ul>
        </div>

        {/* Right: the real product pill, floating on a soft card */}
        <div
          className="relative mx-auto w-full max-w-md lg:mx-0 lg:justify-self-end"
          style={lift(2)}
        >
          <div
            className="relative rounded-[26px] border border-border bg-bg-card/70 p-5 sm:p-7"
            style={{
              boxShadow:
                "0 40px 90px -50px rgba(20,16,8,0.35), inset 0 1px 0 rgba(255,255,255,0.6)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
            }}
          >
            <div className="mb-5 flex items-center justify-end">
              <span className="inline-flex items-center gap-1.5 font-geist text-[12px] text-text-sec">
                <Command size={13} strokeWidth={2.2} />
                <span className="font-geist-mono">⌥E</span>
              </span>
            </div>

            {/* the actual composer surface */}
            <div className="rounded-2xl bg-bg p-2.5 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
              <EriComposer />
            </div>

            <p className="mt-5 font-geist text-[13.5px] leading-relaxed text-text-sec">
              This is the real surface. Press your hotkey, speak or type, and eri
              goes and does it: voice, screen, and a coding agent in one.
            </p>
          </div>

          {/* a soft floating tag, the way the homepage uses small cards */}
          <div
            className="absolute -bottom-4 -left-3 hidden rounded-2xl border border-border bg-bg-card px-4 py-3 sm:block"
            style={{
              boxShadow: "0 24px 50px -32px rgba(20,16,8,0.4)",
              ...(reduced ? {} : { animation: "floaty 6.5s ease-in-out infinite" }),
            }}
          >
            <p className="font-geist text-[12.5px] font-semibold text-text">
              One memory
            </p>
            <p className="font-geist text-[11.5px] text-text-sec">
              laptop &amp; phone, same eri
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
