"use client";

import { Mic, Eye, Keyboard, Sparkles } from "lucide-react";
import { useReveal } from "./useReveal";

// "Use it with or without your senses." Each capability reframed from a feature
// into a way you drive eri — speak, look, type, or let it act. Clean YC-style
// feature cards with a small live demo inside each. Sans, airy, crisp borders.

type Sense = {
  readonly icon: React.ReactNode;
  readonly kicker: string;
  readonly title: string;
  readonly body: string;
  readonly demo: "voice" | "gaze" | "type" | "auto";
};

const ICON = { size: 15, strokeWidth: 1.8 } as const;

const SENSES: ReadonlyArray<Sense> = [
  {
    icon: <Mic {...ICON} />,
    kicker: "Speak",
    title: "Talk to it like a person.",
    body: "Dictate anywhere — it strips the fillers, fixes the grammar, and learns your words. Or just say what you want done. On-device.",
    demo: "voice",
  },
  {
    icon: <Eye {...ICON} />,
    kicker: "Look",
    title: "It sees what you mean.",
    body: "Look at the error, the form, the design on your screen — eri reads it, so you never re-explain. Faces blur before anything leaves.",
    demo: "gaze",
  },
  {
    icon: <Keyboard {...ICON} />,
    kicker: "Type",
    title: "Or just type a line.",
    body: "One pad, summoned with a keystroke. Tell it what to do and it runs your real apps; tell it to build and it ships.",
    demo: "type",
  },
  {
    icon: <Sparkles {...ICON} />,
    kicker: "Or nothing at all",
    title: "It gets ahead of you.",
    body: "A private memory of how you work means eri acts before you ask. Adaptive to you — not the other way around.",
    demo: "auto",
  },
];

export function SensesSequence(): React.ReactElement {
  return (
    <section className="border-t border-border py-24 lg:py-32">
      <div className="container">
        <header className="mx-auto mb-16 max-w-2xl text-center">
          <p className="font-geist-mono text-[11px] uppercase tracking-[0.2em] text-text-ter mb-4">
            How you drive it
          </p>
          <h2 className="font-geist text-[2.3rem] font-semibold leading-[1.05] tracking-[-0.035em] text-text lg:text-[3rem]">
            Use it with or without{" "}
            <span className="font-instrument italic font-normal tracking-[-0.005em]">
              your senses.
            </span>
          </h2>
          <p className="mx-auto mt-5 max-w-lg text-[17px] leading-relaxed text-text-sec">
            Speak, look, type — or let it act on its own. eri meets you in
            whatever way you can reach it.
          </p>
        </header>

        <div className="grid gap-5 sm:grid-cols-2">
          {SENSES.map((s, i) => (
            <FeatureCard key={s.kicker} sense={s} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureCard({
  sense,
  index,
}: {
  readonly sense: Sense;
  readonly index: number;
}): React.ReactElement {
  const [ref, shown] = useReveal<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className="card-lift flex flex-col rounded-2xl border border-border bg-bg-card p-8"
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? "none" : "translateY(14px)",
        transition:
          "opacity 600ms cubic-bezier(0.16,1,0.3,1), transform 600ms cubic-bezier(0.16,1,0.3,1), border-color 200ms, box-shadow 200ms",
        transitionDelay: `${index * 80}ms`,
      }}
    >
      <div className="mb-5 flex items-center gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-lg border border-border bg-bg-card-2 text-[color:var(--accent-emerald)]">
          {sense.icon}
        </span>
        <span className="font-geist-mono text-[11px] uppercase tracking-[0.16em] text-text-ter">
          {sense.kicker}
        </span>
      </div>

      <h3 className="font-geist text-[1.35rem] font-semibold leading-snug tracking-[-0.02em] text-text">
        {sense.title}
      </h3>
      <p className="mt-2.5 max-w-sm text-[14.5px] leading-relaxed text-text-sec">
        {sense.body}
      </p>

      <div className="mt-7 flex h-[108px] items-center justify-center rounded-xl border border-border bg-bg-card-2 px-6">
        <SenseDemo kind={sense.demo} active={shown} />
      </div>
    </div>
  );
}

// Calm live demos. Decorative micro-loops reuse the keyframes in globals.css.
function SenseDemo({
  kind,
  active,
}: {
  readonly kind: Sense["demo"];
  readonly active: boolean;
}): React.ReactElement {
  if (kind === "voice") return <VoiceDemo active={active} />;
  if (kind === "gaze") return <GazeDemo active={active} />;
  if (kind === "type") return <TypeDemo active={active} />;
  return <AutoDemo active={active} />;
}

function VoiceDemo({ active }: { readonly active: boolean }): React.ReactElement {
  const bars = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  return (
    <div className="flex items-center gap-[5px]" aria-hidden>
      {bars.map((b) => (
        <span
          key={b}
          className="w-[4px] rounded-full bg-[color:var(--accent-emerald)]"
          style={{
            height: "30px",
            transformOrigin: "center",
            opacity: 0.85,
            animation: active ? "voiceBar 1s ease-in-out infinite" : "none",
            animationDelay: `${b * 80}ms`,
          }}
        />
      ))}
    </div>
  );
}

function GazeDemo({ active }: { readonly active: boolean }): React.ReactElement {
  return (
    <div className="relative w-full max-w-[200px]" aria-hidden>
      <div className="space-y-2">
        <div className="h-2 w-3/4 rounded-full bg-[rgba(17,17,19,0.08)]" />
        <div className="h-2 w-1/2 rounded-full bg-[rgba(17,17,19,0.08)]" />
      </div>
      <span
        className="absolute -right-1 -top-1 flex size-7 items-center justify-center rounded-full"
        style={{
          border: "1.5px solid var(--accent-emerald)",
          boxShadow: "0 0 0 0 rgba(21,128,61,0.45)",
          animation: active ? "gazePulse 2s ease-in-out infinite" : "none",
        }}
      >
        <span className="size-1.5 rounded-full bg-[color:var(--accent-emerald)]" />
      </span>
    </div>
  );
}

function TypeDemo({ active }: { readonly active: boolean }): React.ReactElement {
  return (
    <div className="w-full font-mono text-[12.5px]" aria-hidden>
      <div className="flex items-center gap-1.5 text-text">
        <span className="text-[color:var(--accent-emerald)]">eri&nbsp;›</span>
        <span>open my calendar</span>
        <span
          className="inline-block h-[14px] w-[7px] translate-y-[2px]"
          style={{
            borderBottom: "2px solid var(--accent-emerald)",
            animation: active ? "caretBlink 1.1s steps(1) infinite" : "none",
          }}
        />
      </div>
    </div>
  );
}

function AutoDemo({ active }: { readonly active: boolean }): React.ReactElement {
  return (
    <div className="w-full max-w-[220px] space-y-2.5" aria-hidden>
      {["Noticed your 2pm", "Deck not attached", "Drafted a reminder"].map(
        (t, i) => (
          <div
            key={t}
            className="flex items-center gap-2.5 text-[12.5px] text-text-sec"
          >
            <span
              className="size-2 rounded-full bg-[color:var(--accent-emerald)]"
              style={{
                animation: active
                  ? "pulseDot 1.6s ease-in-out infinite"
                  : "none",
                animationDelay: `${i * 320}ms`,
              }}
            />
            {t}
          </div>
        ),
      )}
    </div>
  );
}
