"use client";

import { useState } from "react";
import Link from "next/link";

interface Message {
  readonly id: number;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly cta?: boolean;
}

const SEED: ReadonlyArray<Message> = [
  { id: 1, role: "user", text: "make a landing page based on attached docs explaining what we do" },
  { id: 2, role: "assistant", text: "Done. Fonts preload, critical CSS inlined, color-scheme meta tag added. 280ms first paint." },
];

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
      <aside className="w-[200px] shrink-0 border-r border-white/[0.06] p-2 text-[11px]">
        <div className="mb-1 px-2 py-1 text-[10px] uppercase tracking-wider text-white/45">In progress · 2</div>
        <div className="space-y-0.5">
          <SidebarRow title="Analyze Tab vs Agent usage" sub="Fetching data" />
          <SidebarRow title="Plan Mission Control" sub="Generating plan" />
        </div>
        <div className="mt-3 mb-1 px-2 py-1 text-[10px] uppercase tracking-wider text-white/45">Ready · 1</div>
        <div className="space-y-0.5">
          <SidebarRow title="Build Landing Page" sub="+52 · done" active />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="px-3 pt-2 pb-1 text-[12px] font-medium">Build Landing Page</div>
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
          {messages.map((m) => (
            <div key={m.id} className={m.role === "user" ? "rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1.5 text-[12px]" : "text-[12px] text-white/85"}>
              {m.text}
              {m.cta ? (
                <Link href="/download" className="ml-1 text-[#e0ff4f] underline underline-offset-2 hover:opacity-80">
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
              <button type="submit" className="flex h-5 w-5 items-center justify-center rounded-full bg-white/10 text-white/70 hover:bg-white/15">↑</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function SidebarRow({ title, sub, active }: { title: string; sub: string; active?: boolean }): React.ReactElement {
  return (
    <div className={"rounded px-2 py-1.5 " + (active ? "bg-white/[0.06]" : "hover:bg-white/[0.03]")}>
      <div className="truncate text-[11px] text-white/90">{title}</div>
      <div className="truncate text-[10px] text-white/45">{sub}</div>
    </div>
  );
}
