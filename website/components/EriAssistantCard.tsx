// eri's floating glass assistant — the "small form factor that expands" (the
// Cluely-style overlay), but on OUR brand: dark glass, lime accent, Funnel
// Display, and eri's real actions (Control/Look/Voice/Build/Memory) instead of
// meeting tooling. Static + CSS-animated so it drops over any demo.

function I({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden>
      {children}
    </svg>
  );
}

const ACTIONS: ReadonlyArray<{ label: string; icon: React.ReactNode }> = [
  { label: "Control", icon: <I><path d="M5 3l14 9-6 1.5 3 6-2.5 1-3-6L5 19V3Z" /></I> },
  { label: "Look", icon: <I><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></I> },
  { label: "Voice", icon: <I><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" /><path d="M19 11a7 7 0 0 1-14 0" /></I> },
  { label: "Build", icon: <I><path d="M8 9l-4 3 4 3" /><path d="M16 9l4 3-4 3" /><path d="M13 5l-2 14" /></I> },
];

export function EriAssistantCard({ className }: { readonly className?: string }): React.ReactElement {
  return (
    <div className={className} role="img" aria-label="eri floating assistant">
      <div className="flex flex-col gap-2">
        {/* pill header — summon / hide / stop */}
        <div
          className="mx-auto flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1"
          style={{
            background: "rgba(20,20,20,0.85)",
            boxShadow: "0 0 0 1px rgba(224,255,79,0.18), 0 -0.5px 0 0 rgba(255,255,255,0.5)",
          }}
        >
          <span className="font-display text-[15px] leading-none text-text" style={{ letterSpacing: "-0.05em" }}>
            eri
          </span>
          <span className="mx-1 h-3 w-px bg-white/15" />
          <span className="flex items-center gap-1 rounded-full bg-bg-card-2 px-2 py-1 font-mono text-[10px] text-text-sec">
            ⌥␣ summon
          </span>
          <span className="flex size-5 items-center justify-center rounded-full bg-bg-card-2 text-text-ter">
            <span className="size-2 rounded-[2px] bg-text-sec" />
          </span>
        </div>

        {/* glass assistant panel */}
        <div
          className="flex flex-col rounded-2xl border border-white/20"
          style={{
            background: "linear-gradient(180deg, rgba(20,20,20,0.75) 0%, rgba(20,20,20,0.82) 100%)",
            backdropFilter: "blur(14px)",
            boxShadow: "0 0 0 1px rgba(224,255,79,0.12), 0 30px 70px -24px rgba(0,0,0,0.9)",
          }}
        >
          <div className="flex flex-col p-4 pb-2">
            {/* user request */}
            <div className="flex justify-end">
              <div
                className="w-fit max-w-[15rem] rounded-xl rounded-br-sm px-2.5 py-1.5 text-[12px] text-bg"
                style={{ background: "linear-gradient(180deg,#e0ff4f 0%,#cdee3a 100%)" }}
              >
                open my email and reply to Priya
              </div>
            </div>

            {/* eri did something */}
            <div className="mt-2.5 font-mono text-[10px] text-accent">Looked at your screen ·  acting</div>
            <p className="mt-1 text-[12px] leading-[1.6] text-[#edeef2]">
              Opened Mail and found Priya&apos;s last email. Drafted a reply in
              your voice — I&apos;ll <span className="text-accent">confirm before sending</span>.
            </p>

            {/* action tabs (Cluely's insight row, but eri's tools) */}
            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5">
              {ACTIONS.map((a, i) => (
                <span key={a.label} className="flex items-center gap-2">
                  {i > 0 && <span className="size-[3px] rounded-full bg-text-ter" />}
                  <span className="flex items-center gap-1.5 rounded-full py-1.5 pl-1.5 pr-2 text-[11px] text-text-sec">
                    <span className={i === 0 ? "text-accent" : "text-text-ter"}>{a.icon}</span>
                    {a.label}
                  </span>
                </span>
              ))}
            </div>
          </div>

          {/* input bar */}
          <div className="px-3 pb-3">
            <div className="rounded-xl border border-white/15" style={{ boxShadow: "0 -1px 0 0 rgba(255,255,255,0.12)" }}>
              <div className="px-2.5 py-2 text-[12px] text-white/45">
                Ask eri about your screen, or <span className="font-mono text-[10px] text-white/55">⌥␣</span> to summon
              </div>
              <div className="flex items-center justify-between px-2.5 pb-2">
                <span className="flex h-[22px] items-center gap-1 rounded-full border border-white/15 px-2 text-[10px] font-medium text-white/45">
                  <span className="text-accent">⚡</span> Mercury
                </span>
                <span
                  className="flex size-6 items-center justify-center rounded-full text-bg"
                  style={{ background: "linear-gradient(180deg,#e0ff4f 0%,#cdee3a 100%)" }}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" className="ml-0.5 size-3">
                    <path d="M2.5 1.5L10.5 6L2.5 10.5V1.5Z" />
                  </svg>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
