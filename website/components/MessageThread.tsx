"use client";

import { useEffect, useRef, useState } from "react";

// A faithful iOS Messages screen, auto-playing a scripted exchange. Reused by
// the hero (in an iPhone frame) and the EriMessages section. Blue/gray bubbles,
// a typing indicator, an optional tapback reaction, a Read receipt. SSR-safe
// (settles fully shown); honours prefers-reduced-motion.

export type Msg = {
  readonly from: "you" | "eri";
  readonly text: string;
  readonly typingMs?: number; // eri "thinks" before this bubble
  readonly gapMs?: number; // pause before a you bubble
  readonly reaction?: "heart" | "emphasis"; // tapback on this bubble
};

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function MessageThread({
  messages,
  className,
}: {
  readonly messages: ReadonlyArray<Msg>;
  readonly className?: string;
}): React.ReactElement {
  const [count, setCount] = useState(messages.length); // SSR-safe: fully shown
  const [typing, setTyping] = useState(false);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    if (prefersReducedMotion()) return;

    let alive = true;
    const clearAll = (): void => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    };
    const at = (fn: () => void, ms: number): void => {
      timers.current.push(window.setTimeout(fn, ms));
    };

    const run = (): void => {
      if (!alive) return;
      clearAll();
      setCount(0);
      setTyping(false);
      let t = 650;
      messages.forEach((m, i) => {
        if (m.from === "eri" && m.typingMs) {
          at(() => setTyping(true), t);
          t += m.typingMs;
          at(() => {
            setTyping(false);
            setCount(i + 1);
          }, t);
          t += 280;
        } else {
          t += m.gapMs ?? 520;
          at(() => setCount(i + 1), t);
          t += 280;
        }
      });
      at(run, t + 3600); // hold, then loop
    };

    run();
    return () => {
      alive = false;
      clearAll();
    };
  }, [messages]);

  const lastShownIsYou =
    count > 0 && messages[count - 1]?.from === "you" && count === messages.length;

  return (
    <div className={`flex h-full flex-col bg-white ${className ?? ""}`}>
      {/* status bar */}
      <div className="flex items-center justify-between px-6 pt-3 pb-1 font-geist text-[12px] font-semibold text-[#1c1a17]">
        <span>2:14</span>
        <span className="flex items-center gap-1 text-[10px] text-[#1c1a17]/70">
          <span>5G</span>
          <span className="inline-block h-2.5 w-5 rounded-[3px] border border-[#1c1a17]/40" />
        </span>
      </div>

      {/* contact header */}
      <div className="flex flex-col items-center gap-1 border-b border-[#1c1a17]/8 px-4 pb-2.5 pt-1.5">
        <span
          className="flex size-9 items-center justify-center rounded-full font-geist text-[13px] font-medium text-white"
          style={{ background: "#1c1a17", letterSpacing: "-0.04em" }}
        >
          eri
        </span>
        <span className="font-geist text-[12px] font-medium text-[#1c1a17]">
          eri
        </span>
      </div>

      {/* thread */}
      <div className="flex flex-1 flex-col gap-1.5 overflow-hidden px-3 py-3.5">
        <p className="mb-1 text-center font-geist text-[10px] text-[#1c1a17]/40">
          iMessage · Today 2:14 PM
        </p>

        {messages.slice(0, count).map((m, i) => (
          <Bubble key={i} msg={m} />
        ))}

        {typing && <TypingBubble />}

        {lastShownIsYou && (
          <p className="mt-0.5 pr-1.5 text-right font-geist text-[9.5px] text-[#1c1a17]/45">
            Read
          </p>
        )}
      </div>

      {/* input bar */}
      <div className="flex items-center gap-2 border-t border-[#1c1a17]/8 px-3 py-2.5">
        <div className="flex h-8 flex-1 items-center rounded-full border border-[#1c1a17]/12 px-3.5 font-geist text-[12.5px] text-[#1c1a17]/35">
          iMessage
        </div>
        <span
          className="flex size-8 items-center justify-center rounded-full text-white"
          style={{ background: "#0A7CFF" }}
          aria-hidden
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 19V5M12 5l-6 6M12 5l6 6"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </div>
    </div>
  );
}

function Bubble({ msg }: { readonly msg: Msg }): React.ReactElement {
  const you = msg.from === "you";
  return (
    <div
      className={`flex ${you ? "justify-end" : "justify-start"}`}
      style={{ animation: "fadeUp 280ms cubic-bezier(0.16,1,0.3,1) both" }}
    >
      <span
        className={`relative max-w-[76%] px-3.5 py-2 font-geist text-[14px] leading-[1.35] ${
          you ? "text-white" : "text-[#1c1a17]"
        }`}
        style={{
          borderRadius: 18,
          ...(you
            ? {
                background: "linear-gradient(180deg, #38A1FF 0%, #0A7CFF 100%)",
                borderBottomRightRadius: 5,
              }
            : { background: "#E9E9EB", borderBottomLeftRadius: 5 }),
        }}
      >
        {msg.text}
        {msg.reaction && (
          <span
            className={`absolute -top-3.5 flex size-6 items-center justify-center rounded-full border-2 border-white text-[11px] ${
              you ? "-left-2.5" : "-right-2.5"
            }`}
            style={{ background: "#E9E9EB" }}
            aria-hidden
          >
            {msg.reaction === "heart" ? "❤️" : "‼️"}
          </span>
        )}
      </span>
    </div>
  );
}

function TypingBubble(): React.ReactElement {
  return (
    <div
      className="flex justify-start"
      style={{ animation: "fadeUp 220ms cubic-bezier(0.16,1,0.3,1) both" }}
    >
      <span
        className="flex items-center gap-1 px-3.5 py-3"
        style={{ background: "#E9E9EB", borderRadius: 18, borderBottomLeftRadius: 5 }}
        aria-label="eri is typing"
      >
        {[0, 1, 2].map((d) => (
          <span
            key={d}
            className="size-1.5 rounded-full"
            style={{
              background: "rgba(28,26,23,0.4)",
              animation: "pulseDot 1.3s ease-in-out infinite",
              animationDelay: `${d * 180}ms`,
            }}
          />
        ))}
      </span>
    </div>
  );
}
