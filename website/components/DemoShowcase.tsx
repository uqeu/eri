"use client";

import { useState } from "react";
import { DemoPlayer, type DemoSpec } from "./DemoPlayer";
import { EriLoop, ERI_LOOP } from "@/remotion/EriLoop";
import { VoiceClean, VOICE_CLEAN } from "@/remotion/VoiceClean";
import { GazeAct, GAZE_ACT } from "@/remotion/GazeAct";
import { BuildCode, BUILD_CODE } from "@/remotion/BuildCode";
import { MemoryRecall, MEMORY_RECALL } from "@/remotion/MemoryRecall";

interface Tab {
  readonly id: string;
  readonly label: string;
  readonly caption: string;
  readonly icon: React.ReactNode;
  readonly spec: DemoSpec;
}

function I({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[18px] w-[18px]"
      aria-hidden
    >
      {children}
    </svg>
  );
}

const TABS: ReadonlyArray<Tab> = [
  {
    id: "control",
    label: "Control",
    caption: "Say it — eri operates your real apps, and confirms before anything risky.",
    icon: <I><path d="M5 3l14 9-6 1.5 3 6-2.5 1-3-6L5 19V3Z" /></I>,
    spec: { component: EriLoop, ...ERI_LOOP },
  },
  {
    id: "voice",
    label: "Voice",
    caption: "Dictate anywhere. eri cleans grammar, fillers, and punctuation — and learns your words.",
    icon: (
      <I>
        <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
        <path d="M19 11a7 7 0 0 1-14 0" />
        <path d="M12 18v3" />
      </I>
    ),
    spec: { component: VoiceClean, ...VOICE_CLEAN },
  },
  {
    id: "eyes",
    label: "Eyes",
    caption: "Look at the thing you mean and say “click this” — gaze resolves the target.",
    icon: (
      <I>
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </I>
    ),
    spec: { component: GazeAct, ...GAZE_ACT },
  },
  {
    id: "build",
    label: "Build",
    caption: "A full coding agent: it plans, edits across files, runs tests, and ships.",
    icon: (
      <I>
        <path d="M8 9l-4 3 4 3" />
        <path d="M16 9l4 3-4 3" />
        <path d="M13 5l-2 14" />
      </I>
    ),
    spec: { component: BuildCode, ...BUILD_CODE },
  },
  {
    id: "memory",
    label: "Memory",
    caption: "A private, on-device memory of how you work — that anticipates the next thing.",
    icon: (
      <I>
        <path d="M12 3a7 7 0 0 0-4 12.7V19a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-3.3A7 7 0 0 0 12 3Z" />
        <path d="M9 21h6" />
      </I>
    ),
    spec: { component: MemoryRecall, ...MEMORY_RECALL },
  },
];

export function DemoShowcase(): React.ReactElement {
  const [active, setActive] = useState<string>("control");
  const tab = TABS.find((t) => t.id === active) ?? TABS[0];

  return (
    <div className="win-chrome overflow-hidden rounded-2xl">
      {/* Branded app chrome */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="flex gap-2" aria-hidden>
            <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
            <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
            <span className="h-3 w-3 rounded-full bg-[#28c840]" />
          </span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo/eri-word-white.png"
            alt="eri"
            className="ml-2 h-4 w-auto opacity-90"
          />
        </div>
        {/* Form-factor cue: eri lives in a small summon bar that expands. */}
        <span className="hidden items-center gap-2 rounded-full border border-border bg-bg px-3 py-1 font-mono text-[11px] text-text-sec sm:inline-flex">
          <span className="text-text">⌥ Space</span>
          <span className="text-text-ter">·</span>
          summon eri
        </span>
      </div>

      {/* Body: capability rail + live demo */}
      <div className="grid sm:grid-cols-[200px_1fr]">
        {/* Rail */}
        <nav className="flex gap-1 overflow-x-auto border-b border-border p-2 sm:flex-col sm:gap-0.5 sm:overflow-visible sm:border-b-0 sm:border-r">
          {TABS.map((t) => {
            const on = t.id === active;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActive(t.id)}
                aria-pressed={on}
                className={`flex flex-shrink-0 items-center gap-2.5 rounded-md px-3 py-2.5 text-left text-[14px] transition-colors ${
                  on
                    ? "bg-bg-card-2 text-text"
                    : "text-text-sec hover:bg-bg-card hover:text-text"
                }`}
              >
                <span className={on ? "text-accent" : "text-text-ter"}>{t.icon}</span>
                {t.label}
              </button>
            );
          })}
        </nav>

        {/* Demo pane */}
        <div className="bg-bg">
          <DemoPlayer key={tab.id} spec={tab.spec} />
          <p className="border-t border-border px-5 py-3.5 text-[13.5px] text-text-sec">
            {tab.caption}
          </p>
        </div>
      </div>
    </div>
  );
}
