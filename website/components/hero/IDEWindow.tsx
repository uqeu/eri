"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";

interface Message {
  readonly id: number;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly cta?: boolean;
}

const SEED: ReadonlyArray<Message> = [
  { id: 1, role: "user", text: "speak the headline. tighten the toggle. ship it." },
  { id: 2, role: "assistant", text: "Done. Headline letter-spacing tightened, toggle now glows when annual." },
];

interface Rect {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

const TARGETS = ["h1", "p", "toggle", "price", "cta"] as const;
type Target = (typeof TARGETS)[number];

const LABELS: Record<Target, string> = {
  h1: "Heading · h1",
  p: "Subtitle · p",
  toggle: "Toggle · button",
  price: "Price · span",
  cta: "PrimaryCTA · button",
};

export function IDEWindow(): React.ReactElement {
  const [messages, setMessages] = useState<ReadonlyArray<Message>>(SEED);
  const [input, setInput] = useState<string>("");

  function send(e: React.FormEvent): void {
    e.preventDefault();
    if (!input.trim()) return;
    const userMsg: Message = { id: Date.now(), role: "user", text: input };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setTimeout(() => {
      const reply: Message = {
        id: Date.now() + 1,
        role: "assistant",
        text: "This needs the real eri running locally.",
        cta: true,
      };
      setMessages((prev) => [...prev, reply]);
    }, 600);
  }

  return (
    <div className="flex h-full w-full">
      {/* Chat */}
      <div className="flex w-[300px] shrink-0 flex-col border-r border-white/[0.06]">
        <div className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wider text-white/45">
          Voice + diffusion
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
          {messages.map((m) => (
            <div
              key={m.id}
              className={
                m.role === "user"
                  ? "rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1.5 text-[12px]"
                  : "text-[12px] text-white/85"
              }
            >
              {m.text}
              {m.cta ? (
                <Link
                  href="/download"
                  className="ml-1 text-[#e0ff4f] underline underline-offset-2 hover:opacity-80"
                >
                  Download eri →
                </Link>
              ) : null}
            </div>
          ))}
        </div>
        <form onSubmit={send} className="border-t border-white/[0.06] p-2">
          <div className="rounded-md border border-white/[0.08] bg-white/[0.02] p-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Speak or type what to build..."
              className="w-full bg-transparent text-[12px] outline-none placeholder:text-white/35"
              spellCheck={false}
              autoCorrect="off"
            />
            <div className="mt-2 flex items-center justify-between">
              <div className="flex items-center gap-2 text-[11px] text-white/55">
                <span className="rounded-full bg-white/[0.06] px-2 py-0.5">Voice</span>
                <span>eri engine · diffusion</span>
              </div>
              <button
                type="submit"
                className="flex h-5 w-5 items-center justify-center rounded-full bg-white/10 text-white/70 hover:bg-white/15"
              >
                ↑
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Preview with cycling highlight */}
      <PreviewPane />
    </div>
  );
}

function PreviewPane(): React.ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const refs: Record<Target, React.RefObject<HTMLElement | null>> = {
    h1: useRef<HTMLHeadingElement | null>(null),
    p: useRef<HTMLParagraphElement | null>(null),
    toggle: useRef<HTMLDivElement | null>(null),
    price: useRef<HTMLSpanElement | null>(null),
    cta: useRef<HTMLButtonElement | null>(null),
  };
  const [active, setActive] = useState<Target>("h1");
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => {
    let i = 0;
    const id = setInterval(() => {
      i = (i + 1) % TARGETS.length;
      setActive(TARGETS[i]!);
    }, 1900);
    return () => clearInterval(id);
  }, []);

  useLayoutEffect(() => {
    function measure(): void {
      const container = containerRef.current;
      const el = refs[active].current;
      if (!container || !el) return;
      const c = container.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      setRect({
        top: r.top - c.top,
        left: r.left - c.left,
        width: r.width,
        height: r.height,
      });
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [active, refs]);

  return (
    <div className="relative min-w-0 flex-1 overflow-hidden bg-[#0f0d09]">
      {/* Mini browser chrome */}
      <div className="flex h-6 items-center gap-2 border-b border-white/[0.06] px-3 text-[10px] text-white/45">
        <span className="opacity-50">←</span>
        <span className="opacity-50">→</span>
        <div className="rounded bg-white/[0.04] px-2 py-0.5">localhost:3000/pricing</div>
      </div>

      <div
        ref={containerRef}
        className="relative h-[calc(100%-1.5rem)] overflow-hidden px-6 py-5"
        style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
      >
        <div className="mb-3 text-[11px] italic text-white/60">Acme</div>
        <h1
          ref={refs.h1 as React.RefObject<HTMLHeadingElement>}
          className="text-[20px] leading-tight text-white"
          style={{ letterSpacing: "-0.02em" }}
        >
          Pricing that scales with you
        </h1>
        <p
          ref={refs.p as React.RefObject<HTMLParagraphElement>}
          className="mt-1 text-[11px] text-white/55"
        >
          One plan. Predictable cost. Cancel any time.
        </p>

        <div className="mt-5 flex items-center gap-3">
          <span className="text-[10px] text-white/55">Monthly</span>
          <div
            ref={refs.toggle as React.RefObject<HTMLDivElement>}
            className="relative h-5 w-9 rounded-full border border-[#bfd7c1]/45 bg-[#bfd7c1]/15"
          >
            <span
              className="absolute top-0.5 left-0.5 h-3.5 w-3.5 rounded-full bg-[#bfd7c1]"
              aria-hidden
              style={{ transform: "translateX(16px)" }}
            />
          </div>
          <span className="text-[10px] text-white/90">Annual</span>
          <span className="rounded-sm border border-[#bfd7c1]/30 bg-[#bfd7c1]/[0.07] px-1.5 py-0.5 text-[9px] text-[#bfd7c1]">
            -20%
          </span>
        </div>

        <div className="mt-4 inline-flex items-baseline gap-2 rounded-md border border-white/[0.08] px-3 py-2">
          <span
            ref={refs.price as React.RefObject<HTMLSpanElement>}
            className="text-[22px] font-medium text-white"
            style={{ letterSpacing: "-0.02em" }}
          >
            $240/yr
          </span>
          <span className="text-[10px] text-white/45">per workspace</span>
        </div>

        <div className="mt-4">
          <button
            ref={refs.cta as React.RefObject<HTMLButtonElement>}
            type="button"
            className="rounded-md bg-[#bfd7c1] px-3 py-1.5 text-[12px] font-medium text-[#1a1814]"
          >
            Start free trial →
          </button>
          <p className="mt-2 text-[10px] text-white/45">No card. 14 days. Local-first.</p>
        </div>

        {/* Highlight overlay */}
        {rect ? (
          <>
            <div
              aria-hidden
              className="pointer-events-none absolute rounded-[3px]"
              style={{
                top: rect.top - 4,
                left: rect.left - 6,
                width: rect.width + 12,
                height: rect.height + 8,
                border: "1.5px solid rgba(143, 181, 146, 0.7)",
                background: "rgba(143, 181, 146, 0.10)",
                transition: "all 320ms cubic-bezier(0.4, 0, 0.2, 1)",
              }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute rounded-sm px-1.5 py-0.5 text-[10px] font-medium"
              style={{
                top: rect.top - 22,
                left: rect.left - 6,
                background: "rgba(143, 181, 146, 0.95)",
                color: "#1a1814",
                transition: "all 320ms cubic-bezier(0.4, 0, 0.2, 1)",
                fontFamily: "ui-monospace, monospace",
                letterSpacing: "0.01em",
              }}
            >
              {LABELS[active]}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
