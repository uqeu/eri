// eri's CLI surface — the coding/agentic side (the right-hand glass card is the
// live overlay; this is the terminal). Deliberately NOT a Nia clone: eri
// wordmark, lime `eri ›` prompt, our own check-step language, no tool-tab strip.

const C = {
  card: "#0e0e0e",
  line: "rgba(255,255,255,0.07)",
  text: "#ededed",
  sec: "rgba(237,237,237,0.55)",
  ter: "rgba(237,237,237,0.34)",
  accent: "#e0ff4f",
  green: "#9fe88a",
};

function Check(): React.ReactElement {
  return (
    <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full" style={{ border: `1.5px solid ${C.accent}` }}>
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none">
        <path d="M5 12l5 5L20 6" stroke={C.accent} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

const STEPS: ReadonlyArray<string> = [
  "Planned the change across 2 files",
  "Edited Header.tsx — added <ThemeToggle/>",
  "Ran the tests — 12 passed",
];

export function EriToolsTerminal({ className }: { readonly className?: string }): React.ReactElement {
  return (
    <div className={className} role="img" aria-label="eri CLI building a feature">
      <div
        className="overflow-hidden rounded-xl border"
        style={{ background: C.card, borderColor: C.line, boxShadow: "0 30px 70px -28px rgba(0,0,0,0.85)" }}
      >
        {/* branded chrome — eri wordmark, live dot */}
        <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: C.line }}>
          <span className="font-display text-[15px] leading-none" style={{ color: C.text, letterSpacing: "-0.05em" }}>
            eri
          </span>
          <span className="flex items-center gap-1.5 font-mono text-[10px]" style={{ color: C.sec }}>
            <span className="size-1.5 animate-pulse rounded-full" style={{ background: C.accent }} />
            terminal
          </span>
        </div>

        {/* run */}
        <div className="px-4 py-4 font-mono text-[12px] leading-[1.85]">
          {/* the command */}
          <div className="flex items-baseline gap-2">
            <span style={{ color: C.accent }}>eri&nbsp;›</span>
            <span style={{ color: C.text }}>build a dark-mode toggle</span>
          </div>

          {/* steps with our lime checks (not Nia's ●/↳) */}
          <div className="mt-3 flex flex-col gap-2 font-sans text-[12.5px]">
            {STEPS.map((s) => (
              <div key={s} className="flex items-start gap-2.5" style={{ color: C.sec }}>
                <Check />
                <span>
                  {s.includes("12 passed") ? (
                    <>
                      Ran the tests — <span style={{ color: C.green }}>12 passed</span>
                    </>
                  ) : (
                    s
                  )}
                </span>
              </div>
            ))}
            <div className="flex items-start gap-2.5" style={{ color: C.text }}>
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                <span className="size-3 animate-spin rounded-full border-2" style={{ borderColor: C.ter, borderTopColor: C.text }} />
              </span>
              <span>Shipping to preview…</span>
            </div>
          </div>

          {/* result chip */}
          <div className="mt-4 inline-flex items-center gap-2 rounded-lg border px-3 py-2" style={{ borderColor: C.line }}>
            <span className="font-sans text-[12px]" style={{ color: C.sec }}>
              live at
            </span>
            <span className="font-mono text-[12px]" style={{ color: C.accent }}>
              eri.app/preview
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
