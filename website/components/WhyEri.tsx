"use client";

import { useState } from "react";

interface TabContent {
  readonly id: string;
  readonly number: string;
  readonly label: string;
  readonly headline: string;
  readonly description: string;
  readonly bullets: ReadonlyArray<string>;
}

const TABS: ReadonlyArray<TabContent> = [
  {
    id: "voice",
    number: "01",
    label: "Voice",
    headline: "Type with your mouth.",
    description:
      "Hold a hotkey, say what you want, release. eri turns intent into edits without the keyboard tax. Whisper runs on your machine, so the audio never leaves the room.",
    bullets: [
      "Local Whisper sub-second",
      "Hot-key push to talk",
      "Never sends audio anywhere",
    ],
  },
  {
    id: "diffusion",
    number: "02",
    label: "Diffusion preview",
    headline: "See the diff resolve.",
    description:
      "Files denoise into shape in real time. Watch the whole edit converge instead of tailing a token stream. You can stop a turn the instant the picture doesn't match your head.",
    bullets: [
      "Whole-file at once",
      "1.8s median",
      "Auto-reload on stream",
    ],
  },
  {
    id: "gaze",
    number: "03",
    label: "Gaze targeting",
    headline: "Look at what you mean.",
    description:
      "Point with your eyes. eri's optional gaze layer lets you say \"this function\" while looking at it, and the targeting ring follows. Everything stays on-device.",
    bullets: [
      "MediaPipe on-device",
      "Recalibrates on head movement",
      "Optional, off by default",
    ],
  },
  {
    id: "history",
    number: "04",
    label: "Iteration history",
    headline: "Time-travel your build.",
    description:
      "Every voice turn becomes a checkpoint. Walk back through past versions, branch from any one of them, and compare candidates side by side until the right shape lands.",
    bullets: [
      "Branchable from any past turn",
      "Every voice turn captured",
      "Compare side-by-side",
    ],
  },
];

function VoiceMockup(): React.ReactElement {
  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg border border-white/[0.06] bg-bg-2 p-6">
      <div className="absolute inset-0 bg-gradient-to-br from-[#228df2]/[0.04] to-transparent" />
      <div className="relative flex h-full flex-col items-center justify-center gap-6">
        <div className="relative">
          <div className="absolute inset-0 -m-4 animate-ping rounded-full bg-accent/20" />
          <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-accent text-ink">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="3" width="6" height="12" rx="3" />
              <path d="M5 11a7 7 0 0014 0" />
              <line x1="12" y1="18" x2="12" y2="22" />
            </svg>
          </div>
        </div>
        <div className="w-full max-w-md rounded-md border border-white/[0.08] bg-bg-3 px-4 py-3">
          <div className="font-mono text-[10px] uppercase tracking-wider text-[#8b8b96]">
            transcript
          </div>
          <div className="mt-2 text-[13px] text-[#d6d6dd]">
            &ldquo;Move the export button under the form and make it sticky on
            mobile.&rdquo;
          </div>
          <div className="mt-3 flex items-center gap-1.5">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <span
                key={i}
                className="h-3 w-1 rounded-full bg-accent/70 animate-wave"
                style={{ animationDelay: `${i * 0.08}s` }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function DiffusionMockup(): React.ReactElement {
  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg border border-white/[0.06] bg-bg-2 p-6">
      <div className="absolute inset-0 bg-gradient-to-br from-accent/[0.04] to-transparent" />
      <div className="relative flex h-full flex-col items-center justify-center">
        <div className="grid grid-cols-4 gap-1.5">
          {Array.from({ length: 16 }).map((_, i) => (
            <span
              key={i}
              className="h-10 w-10 rounded-sm bg-accent/50 animate-denoise"
              style={{ animationDelay: `${(i % 4) * 0.12 + Math.floor(i / 4) * 0.08}s` }}
            />
          ))}
        </div>
        <div className="mt-6 font-mono text-[11px] uppercase tracking-wider text-[#8b8b96]">
          denoising · 1.8s
        </div>
      </div>
    </div>
  );
}

function GazeMockup(): React.ReactElement {
  const codeLines: ReadonlyArray<{ text: string; isTarget?: boolean }> = [
    { text: "function handleExport(data) {" },
    { text: "  const rows = data.map(row => ({" },
    { text: "    ...row,", isTarget: true },
    { text: "    exported: true," },
    { text: "  }));" },
    { text: "  return rows;" },
    { text: "}" },
  ];
  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg border border-white/[0.06] bg-bg-2 p-5">
      <div className="absolute inset-0 bg-gradient-to-br from-[#228df2]/[0.05] to-transparent" />
      <div className="relative font-mono text-[12px] leading-relaxed">
        <div className="mb-3 flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
        </div>
        {codeLines.map((line, i) => (
          <div key={i} className="relative flex gap-3">
            <span className="w-5 text-right text-[#8b8b96]/60">{i + 1}</span>
            <span className="text-[#d6d6dd]">{line.text}</span>
            {line.isTarget ? (
              <span className="pointer-events-none absolute left-7 -top-1 flex h-7 w-32 items-center">
                <span className="absolute inset-0 rounded-full border border-[#228df2]/70" />
                <span className="absolute inset-1 rounded-full border border-[#228df2]/30" />
                <span className="absolute -right-3 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-[#228df2]" />
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function HistoryMockup(): React.ReactElement {
  const turns: ReadonlyArray<{ time: string; label: string; active?: boolean }> = [
    { time: "12:41", label: "Add gaze ring to editor" },
    { time: "12:38", label: "Wire transcript to model" },
    { time: "12:35", label: "Scaffold voice hotkey", active: true },
  ];
  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg border border-white/[0.06] bg-bg-2 p-6">
      <div className="absolute inset-0 bg-gradient-to-br from-accent/[0.03] to-transparent" />
      <div className="relative">
        <div className="mb-4 font-mono text-[10px] uppercase tracking-wider text-[#8b8b96]">
          recent turns
        </div>
        <div className="relative space-y-3 pl-7">
          <span className="absolute left-[10px] top-2 bottom-2 w-px bg-white/10" />
          {turns.map((turn, i) => (
            <div
              key={i}
              className={
                "relative rounded-md border px-3 py-2.5 transition-colors " +
                (turn.active
                  ? "border-accent/40 bg-accent/[0.06]"
                  : "border-white/[0.07] bg-bg-3")
              }
            >
              <span
                className={
                  "absolute -left-[22px] top-3 flex h-4 w-4 items-center justify-center rounded-full " +
                  (turn.active ? "bg-accent text-ink" : "bg-bg-3 border border-white/10 text-[#8b8b96]")
                }
              >
                <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6l3 3 5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] text-[#8b8b96]">{turn.time}</span>
                {turn.active ? (
                  <span className="font-mono text-[9px] uppercase tracking-wider text-accent">on</span>
                ) : null}
              </div>
              <div className="mt-1 text-[12px] text-[#d6d6dd]">{turn.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MockupFor({ id }: { readonly id: string }): React.ReactElement {
  if (id === "voice") return <VoiceMockup />;
  if (id === "diffusion") return <DiffusionMockup />;
  if (id === "gaze") return <GazeMockup />;
  return <HistoryMockup />;
}

function TabRailButton({
  tab,
  active,
  onClick,
}: {
  readonly tab: TabContent;
  readonly active: boolean;
  readonly onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "group w-full rounded-lg border px-5 py-4 text-left transition-all duration-300 " +
        (active
          ? "border-accent/40 bg-accent/[0.08] text-paper"
          : "border-white/[0.07] bg-transparent text-[#8b8b96] hover:border-white/[0.15] hover:text-[#d6d6dd]")
      }
      aria-pressed={active}
    >
      <div className="flex items-baseline gap-3">
        <span
          className={
            "font-mono text-[11px] " +
            (active ? "text-accent" : "text-[#8b8b96]/70")
          }
        >
          {tab.number}
        </span>
        <span className="text-[14px] font-medium">{tab.label}</span>
      </div>
      <div
        className={
          "mt-1 pl-7 text-[12px] transition-opacity " +
          (active ? "text-paper/70 opacity-100" : "text-[#8b8b96]/60 opacity-80")
        }
      >
        {tab.headline.replace(/\.$/, "")}
      </div>
    </button>
  );
}

function PanelContent({
  tab,
}: {
  readonly tab: TabContent;
}): React.ReactElement {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-[#181818]">
      <div className="aspect-[16/10] w-full border-b border-white/[0.05] bg-[#0A0A0A]">
        <MockupFor id={tab.id} />
      </div>
      <div className="px-7 py-7 sm:px-9 sm:py-9">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-accent">
          <span>{tab.number}</span>
          <span className="h-px w-6 bg-accent/40" />
          <span>{tab.label}</span>
        </div>
        <h3 className="mt-3 font-display text-[28px] leading-tight text-paper sm:text-[34px]">
          {tab.headline}
        </h3>
        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-[#d6d6dd]">
          {tab.description}
        </p>
        <ul className="mt-7 space-y-3 border-t border-white/[0.06] pt-6">
          {tab.bullets.map((bullet, i) => (
            <li key={bullet} className="flex items-start gap-3">
              <span className="mt-[7px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-accent/30 bg-accent/[0.08] font-mono text-[9px] text-accent">
                {i + 1}
              </span>
              <span className="text-[14px] text-[#d6d6dd]">{bullet}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function WhyEri(): React.ReactElement {
  const [activeId, setActiveId] = useState<string>(TABS[0]?.id ?? "voice");
  const activeTab = TABS.find((t) => t.id === activeId) ?? TABS[0];

  return (
    <section className="relative border-t border-white/[0.06] bg-[#0A0A0A]">
      <div className="mx-auto max-w-7xl px-6 py-24 sm:py-32">
        <div className="max-w-2xl">
          <p className="mono-cap text-accent">Why eri</p>
          <h2 className="mt-4 font-display text-h1 text-balance font-normal">
            Four things nothing else does.
          </h2>
          <p className="mt-5 text-body text-paper/60">
            Voice in, diffusion out, eyes on the file, every turn rewindable.
            Pick a tab.
          </p>
        </div>

        <div className="mt-14 lg:hidden">
          <div className="-mx-6 flex gap-2 overflow-x-auto px-6 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {TABS.map((tab) => {
              const active = tab.id === activeId;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveId(tab.id)}
                  className={
                    "shrink-0 rounded-full border px-4 py-2 text-[12px] transition-colors " +
                    (active
                      ? "border-accent/40 bg-accent/[0.1] text-paper"
                      : "border-white/[0.08] text-[#8b8b96]")
                  }
                >
                  <span className="font-mono text-[10px] text-accent/70">{tab.number}</span>
                  <span className="ml-2">{tab.label}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-6">
            {activeTab ? <PanelContent tab={activeTab} /> : null}
          </div>
        </div>

        <div className="mt-14 hidden lg:grid lg:grid-cols-[minmax(280px,340px)_1fr] lg:gap-10">
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="flex flex-col gap-3">
              {TABS.map((tab) => (
                <TabRailButton
                  key={tab.id}
                  tab={tab}
                  active={tab.id === activeId}
                  onClick={() => setActiveId(tab.id)}
                />
              ))}
            </div>
            <p className="mt-6 pl-5 font-mono text-[10px] uppercase tracking-wider text-[#8b8b96]/70">
              click a row to switch · {String(TABS.findIndex((t) => t.id === activeId) + 1).padStart(2, "0")} of {String(TABS.length).padStart(2, "0")}
            </p>
          </aside>

          <div className="relative">
            {activeTab ? <PanelContent tab={activeTab} /> : null}
          </div>
        </div>
      </div>
    </section>
  );
}
