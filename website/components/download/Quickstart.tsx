"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Cloud, Keyboard } from "lucide-react";

// The three-step quickstart. This IS an ordered sequence, so the numbers carry
// real information: download, then sign in and sync, then set the hotkey. A thin
// guide line threads through the three on wide screens; each step reveals on
// scroll with a short stagger, enhancing an already-visible default.

interface Step {
  readonly icon: React.ReactNode;
  readonly title: string;
  readonly body: string;
  readonly hint: string;
}

const STEPS: ReadonlyArray<Step> = [
  {
    icon: <Download size={20} strokeWidth={1.8} />,
    title: "Download and open eri",
    body: "Open the app from the .dmg. The first launch walks you through microphone, screen recording, and accessibility. These are what let eri hear you, see your screen, and act. Nothing is granted that you don't approve.",
    hint: "~30 seconds",
  },
  {
    icon: <Cloud size={20} strokeWidth={1.8} />,
    title: "Log in and sync",
    body: "Sign in with your eri account. It pulls your one memory onto this Mac, so eri already knows how you work and picks up where you left off. The same memory follows you to your phone.",
    hint: "carries across devices",
  },
  {
    icon: <Keyboard size={20} strokeWidth={1.8} />,
    title: "Hit ⌘⌥E to summon it",
    body: "Press the hotkey and eri appears over whatever you're doing, anywhere on your computer. Speak or type, hands-free. Rebind it to any shortcut you like; eri stays ready in the background.",
    hint: "rebindable anytime",
  },
];

const EASE = "cubic-bezier(0.16,1,0.3,1)";

export function Quickstart(): React.ReactElement {
  const ref = useRef<HTMLOListElement>(null);
  const [shown, setShown] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const red =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    setReduced(red);
    if (red) {
      setShown(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section id="quickstart" className="container scroll-mt-28 py-20 lg:py-28">
      <div className="max-w-2xl">
        <h2
          className="font-display text-[clamp(2rem,3.6vw,3rem)] font-medium leading-[1.02] text-text"
          style={{ letterSpacing: "-0.025em", textWrap: "balance" }}
        >
          Set up once. Then it's always there.
        </h2>
        <p className="mt-4 max-w-lg font-geist text-[16px] leading-relaxed text-text-sec">
          Three steps, a couple of minutes. From then on eri lives one keypress
          away.
        </p>
      </div>

      <ol
        ref={ref}
        className="relative mt-12 grid gap-px overflow-hidden rounded-[20px] border border-border bg-border md:grid-cols-3"
      >
        {STEPS.map((s, i) => (
          <li
            key={s.title}
            className="relative flex flex-col bg-bg-card p-7 lg:p-8"
            style={
              reduced
                ? {}
                : {
                    opacity: shown ? 1 : 0,
                    transform: shown ? "translateY(0)" : "translateY(18px)",
                    transition: `opacity 620ms ${EASE} ${i * 120}ms, transform 720ms ${EASE} ${i * 120}ms`,
                  }
            }
          >
            <div className="flex items-center justify-between">
              <span className="flex size-11 items-center justify-center rounded-full bg-bg text-text shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]">
                {s.icon}
              </span>
              <span
                className="font-display text-[34px] font-medium leading-none text-text-ter/55"
                style={{ letterSpacing: "-0.04em" }}
                aria-hidden
              >
                {i + 1}
              </span>
            </div>

            <h3 className="mt-6 font-display text-[20px] font-medium leading-tight text-text">
              {s.title}
            </h3>
            <p className="mt-2.5 font-geist text-[14px] leading-relaxed text-text-sec">
              {s.body}
            </p>
            <span className="mt-5 inline-flex w-fit items-center rounded-full border border-border bg-bg px-2.5 py-1 font-geist-mono text-[11px] tracking-tight text-text-sec">
              {s.hint}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
