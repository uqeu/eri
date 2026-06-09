"use client";

import { useRef, useState } from "react";

// eri's floating assistant — actually interactive: drag it by the header,
// collapse/expand it, type a request and it responds (scripted, on-device-
// feeling). Our brand: dark glass, lime accent, Funnel Display. No model-picker
// chrome, no "AI" language — it just does the thing and confirms before risk.

interface Msg {
  readonly role: "you" | "eri";
  readonly text: string;
  readonly status?: string;
}

const SCRIPT: ReadonlyArray<{ match: RegExp; status: string; reply: string }> = [
  {
    match: /mail|email|priya|reply|message/i,
    status: "Looked at your screen · opened Mail",
    reply: "Drafted a reply to Priya in your voice. I'll confirm before it sends.",
  },
  {
    match: /youtube|search|play|lofi|music|video/i,
    status: "Opened your browser",
    reply: "Searching YouTube now — say the word and I'll play the top result.",
  },
  {
    match: /code|build|test|ship|fix|bug/i,
    status: "Reading the repo",
    reply: "Planning the change across files. I'll run the tests before I ship.",
  },
  {
    match: /look|see|screen|what.?s this|error/i,
    status: "Looking at your screen",
    reply: "I can see it. Faces are blurred on-device before anything leaves your machine.",
  },
];
const FALLBACK = {
  status: "Looked at your screen",
  reply: "On it — and I'll check with you before anything that can't be undone.",
};

const ACTIONS: ReadonlyArray<{ label: string; sample: string; icon: React.ReactNode }> = [
  { label: "Control", sample: "join my next call", icon: <path d="M5 3l14 9-6 1.5 3 6-2.5 1-3-6L5 19V3Z" /> },
  { label: "Eyes", sample: "what's this error?", icon: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></> },
  { label: "Voice", sample: "reply to Priya", icon: <><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" /><path d="M19 11a7 7 0 0 1-14 0" /></> },
  { label: "Build", sample: "add a dark-mode toggle", icon: <><path d="M8 9l-4 3 4 3" /><path d="M16 9l4 3-4 3" /><path d="M13 5l-2 14" /></> },
];

export function EriAssistantCard({ className }: { readonly className?: string }): React.ReactElement {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [collapsed, setCollapsed] = useState(false);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [msgs, setMsgs] = useState<ReadonlyArray<Msg>>([
    { role: "you", text: "open my email and reply to Priya" },
    {
      role: "eri",
      status: "Looked at your screen · opened Mail",
      text: "Drafted a reply to Priya in your voice. I'll confirm before it sends.",
    },
  ]);
  const drag = useRef<{ ox: number; oy: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { ox: e.clientX - pos.x, oy: e.clientY - pos.y };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setPos({ x: e.clientX - drag.current.ox, y: e.clientY - drag.current.oy });
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const send = (text: string) => {
    const t = text.trim();
    if (!t) return;
    setMsgs((m) => [...m, { role: "you", text: t }]);
    setInput("");
    setThinking(true);
    const hit = SCRIPT.find((s) => s.match.test(t)) ?? FALLBACK;
    window.setTimeout(() => {
      setThinking(false);
      setMsgs((m) => [...m, { role: "eri", status: hit.status, text: hit.reply }]);
    }, 650);
  };

  return (
    <div className={className} style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}>
      <div className="flex flex-col gap-2">
        {/* draggable header */}
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="mx-auto flex w-fit cursor-grab touch-none items-center gap-1.5 rounded-full px-2.5 py-1 active:cursor-grabbing select-none"
          style={{ background: "rgba(20,20,20,0.85)", boxShadow: "0 0 0 1px rgba(224,255,79,0.18)" }}
        >
          <span className="font-display text-[15px] leading-none text-text" style={{ letterSpacing: "-0.05em" }}>
            eri
          </span>
          <span className="mx-1 h-3 w-px bg-white/15" />
          <span className="font-mono text-[10px] text-text-ter">⌥␣</span>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="ml-1 flex size-5 items-center justify-center rounded-full bg-bg-card-2 text-text-sec transition-colors hover:text-text"
            aria-label={collapsed ? "Expand eri" : "Collapse eri"}
          >
            <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 transition-transform ${collapsed ? "" : "rotate-180"}`} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        </div>

        {/* glass panel */}
        {!collapsed && (
          <div
            className="flex flex-col overflow-hidden rounded-2xl border border-white/20"
            style={{
              background: "linear-gradient(180deg, rgba(18,18,18,0.82) 0%, rgba(14,14,14,0.88) 100%)",
              backdropFilter: "blur(16px)",
              boxShadow: "0 0 0 1px rgba(224,255,79,0.12), 0 30px 70px -24px rgba(0,0,0,0.9)",
            }}
          >
            <div className="flex max-h-[210px] flex-col gap-2.5 overflow-y-auto p-4 pb-2">
              {msgs.map((m, i) =>
                m.role === "you" ? (
                  <div key={i} className="flex justify-end">
                    <div
                      className="w-fit max-w-[15rem] rounded-xl rounded-br-sm px-2.5 py-1.5 text-[12px] text-bg"
                      style={{ background: "linear-gradient(180deg,#e0ff4f 0%,#cdee3a 100%)" }}
                    >
                      {m.text}
                    </div>
                  </div>
                ) : (
                  <div key={i}>
                    {m.status && <div className="font-mono text-[10px] text-accent">{m.status}</div>}
                    <p className="mt-1 text-[12px] leading-[1.6] text-[#e8e8ea]">{m.text}</p>
                  </div>
                ),
              )}
              {thinking && (
                <div className="flex items-center gap-1.5 text-[11px] text-text-ter">
                  <span className="size-1.5 animate-pulse rounded-full bg-accent" />
                  eri is working…
                </div>
              )}
            </div>

            {/* action chips — click to run a sample */}
            <div className="flex flex-wrap items-center gap-1.5 px-3 pb-1">
              {ACTIONS.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  onClick={() => send(a.sample)}
                  className="flex items-center gap-1.5 rounded-full border border-white/10 px-2 py-1 text-[11px] text-text-sec transition-colors hover:border-white/25 hover:text-text"
                >
                  <svg viewBox="0 0 24 24" className="h-3 w-3 text-text-ter" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    {a.icon}
                  </svg>
                  {a.label}
                </button>
              ))}
            </div>

            {/* input */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
              className="m-3 mt-2 flex items-center gap-2 rounded-xl border border-white/15 px-2.5 py-1.5"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Tell eri what to do…"
                className="min-w-0 flex-1 bg-transparent text-[12.5px] text-text outline-none placeholder:text-white/40"
              />
              <button
                type="submit"
                aria-label="Send"
                className="flex size-6 items-center justify-center rounded-full text-bg transition-transform hover:scale-105 active:scale-95"
                style={{ background: "linear-gradient(180deg,#e0ff4f 0%,#cdee3a 100%)" }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" className="ml-0.5 size-3">
                  <path d="M2.5 1.5L10.5 6L2.5 10.5V1.5Z" />
                </svg>
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
