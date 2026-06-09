// A Claude-Code-style terminal card showing eri's tools/skills firing on a real
// request, with a row of tool tabs. Static (no JS) so it can render anywhere —
// it's the "one agent, so many tools" proof, styled to drop over a demo.

const TABS = [
  "control",
  "look",
  "voice",
  "memory",
  "build",
  "mcp",
  "files",
  "git",
] as const;

export function EriToolsTerminal({
  className,
}: {
  readonly className?: string;
}): React.ReactElement {
  return (
    <div className={className} role="img" aria-label="eri terminal running its tools">
      <div className="overflow-hidden rounded-lg border border-[#1a1a1a] bg-[#0d0d0d] shadow-[0_0_60px_rgba(0,0,0,0.8)]">
        {/* title bar */}
        <div className="flex items-center border-b border-[#1a1a1a] px-3 py-2">
          <div className="flex w-[52px] gap-1.5">
            <div className="h-[9px] w-[9px] rounded-full bg-[#ff5f57]/70" />
            <div className="h-[9px] w-[9px] rounded-full bg-[#febc2e]/70" />
            <div className="h-[9px] w-[9px] rounded-full bg-[#28c840]/70" />
          </div>
          <span className="flex-1 text-center font-mono text-[11px] text-[#777]">
            eri — agent
          </span>
          <span className="w-[52px] text-right font-mono text-[10px] text-[#555]">
            ⌥␣
          </span>
        </div>

        {/* transcript */}
        <div className="min-h-[300px] max-h-[400px] overflow-hidden px-3 py-3 font-mono text-[11px] leading-[1.8] md:px-4 md:text-[12px]">
          <div className="text-[#e2e8f0]">
            <span>❯ </span>open my email and reply to Priya
          </div>
          <div className="h-1" />
          <div className="text-[#60a5fa]">
            <span>● </span>eri – look (skill)
          </div>
          <div className="text-[#555]">  reading the screen…</div>
          <div className="text-[#4ade80]">  ↳ Mail is open, found Priya&apos;s email</div>
          <div className="h-1" />
          <div className="text-[#60a5fa]">
            <span>● </span>eri – control (skill)
          </div>
          <div className="text-[#555]">  app: &quot;Mail&quot;  ·  action: reply</div>
          <div className="text-[#4ade80]">  ↳ opened a reply, cursor in body</div>
          <div className="h-1" />
          <div className="text-[#60a5fa]">
            <span>● </span>eri – voice + memory (skill)
          </div>
          <div className="text-[#555]">  &quot;say I&apos;ll send the deck Friday&quot;</div>
          <div className="text-[#999]">
            Drafted a reply in your voice. It will not send
          </div>
          <div className="text-[#999]">until you confirm.</div>
          <div className="mt-0.5 h-[13px]">
            <span className="inline-block h-[13px] w-[6px] animate-pulse bg-[#e2e8f0]/25" />
          </div>
        </div>

        {/* tool tabs */}
        <div className="flex flex-wrap items-center gap-3 border-t border-[#1a1a1a] px-3 py-2">
          {TABS.map((t, i) => (
            <span
              key={t}
              className={`font-mono text-[10px] ${
                i === 0 ? "text-[#e2e8f0]" : "text-[#666]"
              }`}
            >
              {t}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
