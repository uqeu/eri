"use client";

import { useState } from "react";

const COMMANDS = ["transcript", "gaze", "preview", "agent", "tools", "history", "clear"] as const;

export function CLIWindow(): React.ReactElement {
  const [input, setInput] = useState<string>("");
  const showCommands = input.startsWith("/");
  const filtered = showCommands
    ? COMMANDS.filter((c) => c.startsWith(input.slice(1).toLowerCase()))
    : [];

  function onSubmit(e: React.FormEvent): void {
    e.preventDefault();
    setInput("");
  }

  return (
    <div className="flex h-full flex-col font-mono text-[12px] text-white/90">
      <div className="flex-1 overflow-y-auto px-3 pt-3 pb-2 space-y-2">
        <div className="text-white/85">eri · ~/projects/site</div>
        <div className="rounded border border-white/[0.08] bg-white/[0.02] px-2 py-1.5 text-white/85">
          <span className="text-white/45">voice:</span> &ldquo;redesign the auth flow&rdquo;{" "}
          <span className="text-white/45">· 420ms</span>
        </div>
        <div className="space-y-1 text-white/65">
          <div>⬢ Heard · 420ms</div>
          <div>⬢ Read sign-in/page.tsx, sign-up/page.tsx</div>
          <div>⬢ Routed to Eri Builder</div>
          <div>⬢ Wrote sign-in/page.tsx · +47 −12</div>
          <div>⬢ Refreshed preview · 1.4s</div>
        </div>
        <div className="text-white/85">Staged on branch <span className="text-[#bfd7c1]">eri/auth-refactor</span>. Look at it to commit.</div>
      </div>

      <form onSubmit={onSubmit} className="border-t border-white/[0.06] p-2">
        <div className="relative">
          <div className="flex items-center gap-1.5 rounded border border-white/15 px-2 py-1.5">
            <span className="text-white/55">→</span>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="add a follow-up"
              className="w-full bg-transparent outline-none placeholder:text-white/35"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
          {showCommands && filtered.length > 0 ? (
            <div className="absolute bottom-full left-0 right-0 mb-1 rounded border border-white/10 bg-[#181614] p-1 shadow-lg">
              {filtered.map((c) => (
                <div key={c} className="px-2 py-1 text-white/80 hover:bg-white/[0.06] cursor-pointer">
                  /{c}
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <div className="mt-1 flex items-center gap-2 text-[10px] text-white/45">
          <span>eri engine</span>
          <span>·</span>
          <span>/ for commands · @ for files</span>
        </div>
      </form>
    </div>
  );
}
