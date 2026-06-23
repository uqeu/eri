import Link from "next/link";
import { ArrowRight, Download, KeyRound, Command } from "lucide-react";

// The download front door — every path on the page resolves here. A real
// three-step sequence (so the numbers earn their place): download, log in &
// sync, press the hotkey. Then the same dual CTA as the hero.

const STEPS: ReadonlyArray<{ icon: React.ReactNode; title: string; body: string }> = [
  {
    icon: <Download size={18} strokeWidth={2} />,
    title: "Download eri",
    body: "One app for your Mac. No setup project, no config files.",
  },
  {
    icon: <KeyRound size={18} strokeWidth={2} />,
    title: "Log in & sync",
    body: "Sign in once. Your memory and connectors follow you to every device.",
  },
  {
    icon: <Command size={18} strokeWidth={2} />,
    title: "Press ⌘⌥E",
    body: "Summon eri anywhere. Talk, type, or just let it watch and act.",
  },
];

export function DownloadFrontDoor(): React.ReactElement {
  return (
    <section className="relative overflow-hidden border-t border-border py-24 lg:py-32">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(50% 50% at 50% 0%, rgba(224,255,79,0.08) 0%, transparent 70%)",
        }}
      />
      <div className="container relative">
        <header className="mx-auto mb-14 max-w-2xl text-center">
          <h2 className="font-display text-balance text-[clamp(2.1rem,4.6vw,3.4rem)] font-600 leading-[1.04] tracking-[-0.03em] text-text">
            three steps to a computer that runs itself
          </h2>
          <p className="mx-auto mt-5 max-w-md text-pretty text-[16.5px] leading-relaxed text-text-sec">
            Free to start. Mac first; your phone comes along for the ride.
          </p>
        </header>

        <ol className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="relative glass-soft rounded-2xl p-6">
              <div className="flex items-center justify-between">
                <span className="flex size-10 items-center justify-center rounded-xl border border-border bg-bg-card text-accent">
                  {s.icon}
                </span>
                <span className="font-display text-[1.6rem] font-600 leading-none text-text-ter">
                  {i + 1}
                </span>
              </div>
              <p className="mt-5 font-geist text-[16px] font-medium text-text">{s.title}</p>
              <p className="mt-1.5 font-geist text-[14px] leading-relaxed text-text-sec">
                {s.body}
              </p>
            </li>
          ))}
        </ol>

        <div className="mt-12 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/download"
            className="group inline-flex items-center gap-2 rounded-full bg-accent px-7 py-3.5 text-[15px] font-600 text-[#14180a] transition-transform duration-200 hover:-translate-y-0.5"
          >
            Download eri
            <ArrowRight
              size={16}
              strokeWidth={2.4}
              className="transition-transform duration-200 group-hover:translate-x-0.5"
            />
          </Link>
          <Link
            href="/phone"
            className="inline-flex items-center gap-2 rounded-full border border-[color:var(--border-strong)] px-7 py-3.5 text-[15px] text-text transition-colors duration-200 hover:bg-white/[0.04]"
          >
            or just text it
          </Link>
        </div>
      </div>
    </section>
  );
}
