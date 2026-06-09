"use client";

import { useState } from "react";

type Surface = "terminal" | "agent";
const PM = ["npx", "brew", "curl"] as const;
type Pm = (typeof PM)[number];

const COMMANDS: Record<Pm, string> = {
  npx: "npx eri-wizard@latest",
  brew: "brew install eri",
  curl: "curl -fsSL https://tryeri.ca/install | sh",
};

export function InstallBlock(): React.ReactElement {
  const [surface, setSurface] = useState<Surface>("terminal");
  const [pm, setPm] = useState<Pm>("curl");
  const [copied, setCopied] = useState(false);

  const cmd = COMMANDS[pm];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked — no-op */
    }
  };

  return (
    <div className="mx-auto max-w-xl text-left">
      <div className="mb-3 flex items-center justify-between">
        <span className="mono-cap text-text-ter">Install eri</span>
        <div className="flex gap-1">
          {(["terminal", "agent"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSurface(s)}
              className={`px-3 py-1.5 font-mono text-xs transition-colors ${
                surface === s
                  ? "bg-text text-bg"
                  : "text-text-ter hover:text-text"
              }`}
            >
              {s === "terminal" ? "Terminal" : "Desktop app"}
            </button>
          ))}
        </div>
      </div>

      {surface === "terminal" ? (
        <>
          <div className="mb-2 flex items-center gap-1">
            {PM.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPm(p)}
                className={`px-2.5 py-1 font-mono text-xs transition-colors ${
                  pm === p
                    ? "bg-bg-card-2 text-text"
                    : "text-text-ter hover:text-text-sec"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={copy}
            className="group flex w-full items-center justify-between border border-border-strong bg-[#0a0a0a] px-5 py-4 transition-colors hover:border-border-strong/80"
          >
            <span className="flex items-center gap-3 font-mono text-[14px] text-text md:text-base">
              <span className="select-none text-text-ter">&gt;</span>
              <span>{cmd}</span>
            </span>
            <span className="font-mono text-[11px] text-text-ter group-hover:text-text-sec">
              {copied ? "copied" : "copy"}
            </span>
          </button>
        </>
      ) : (
        <a
          href="/download"
          className="flex w-full items-center justify-between border border-border-strong bg-bg-card px-5 py-4 transition-colors hover:bg-bg-card-2"
        >
          <span className="font-mono text-[14px] text-text md:text-base">
            Download eri for macOS
          </span>
          <span aria-hidden className="text-text-ter">
            →
          </span>
        </a>
      )}
    </div>
  );
}
