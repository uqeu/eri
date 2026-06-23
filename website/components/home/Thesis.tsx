import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { CapabilityGrid } from "./CapabilityGrid";

// The thesis: what Engineered Relative Intelligence means. A flat checkerboard
// fills the empty side; scattered tiles expand on hover into the things eri
// actually does. Then a tight split shows the learning loop.

export function Manifesto(): React.ReactElement {
  return (
    <section className="relative isolate min-h-[104vh] overflow-hidden bg-bg">
      {/* the checkerboard of things eri does — poke a tile to expand it */}
      <CapabilityGrid />

      {/* legibility veil behind the top-left headline (above the grid, below text) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[5]"
        style={{ background: "radial-gradient(56% 46% at 22% 24%, rgba(255,255,255,0.96) 0%, rgba(255,255,255,0.55) 40%, transparent 72%)" }}
      />

      {/* headline */}
      <div className="relative z-10 mx-auto max-w-6xl px-6 pt-28">
        <h2 className="max-w-2xl font-display text-[clamp(2.1rem,5vw,3.7rem)] font-600 leading-[1.02] tracking-[-0.038em] text-text">
          general intelligence is one mind for everyone. we’re building the
          opposite.
        </h2>
        <p className="mt-6 max-w-md text-pretty font-geist text-[17px] leading-relaxed text-text-sec">
          Eri is <strong className="font-600 text-text">Engineered Relative Intelligence</strong>. It
          starts as a capable agent, then by only ever learning you, it turns
          into something nobody else has.
        </p>
      </div>

    </section>
  );
}

const FACETS: ReadonlyArray<{ label: string; learned: string }> = [
  { label: "your people", learned: "Sam · Priya · the team" },
  { label: "your patterns", learned: "ships mornings, dinners out Fridays" },
  { label: "your voice", learned: "short, lowercase, dry" },
  { label: "your taste", learned: "Rintaro over anywhere trendy" },
];

export function GrowsWith(): React.ReactElement {
  return (
    <section className="bg-bg-card">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-16 lg:grid-cols-2 lg:gap-20 lg:py-24">
        <div>
          <h2 className="font-display text-balance text-[clamp(1.9rem,3.6vw,2.9rem)] font-600 leading-[1.05] tracking-[-0.03em] text-text">
            a digital soul, grown by you.
          </h2>
          <p className="mt-5 max-w-md text-pretty text-[17px] leading-relaxed text-text-sec">
            eri arrives with a starting personality, the one we give it. From
            there it becomes yours: it picks up your people, your habits and
            your voice, and grows into a digital half of you. Less like
            installing an app, more like raising a mind that ends up belonging
            only to you.
          </p>
          <Link href="/security" className="group mt-6 inline-flex items-center gap-1.5 font-geist text-[15px] font-medium text-text">
            How eri grows with you
            <ArrowUpRight size={16} strokeWidth={2.2} className="text-text-ter transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
        </div>

        <div className="relative flex justify-center">
          <div
            className="w-full max-w-[440px] overflow-hidden rounded-[20px] border border-border bg-bg p-6"
            style={{ boxShadow: "0 24px 60px -28px rgba(40,26,70,0.22), 0 3px 12px -6px rgba(0,0,0,0.08)" }}
          >
            <span className="font-display text-[15px] font-600 tracking-[-0.01em] text-text">eri’s model of you</span>

            <dl className="mt-5 divide-y divide-border">
              {FACETS.map((f) => (
                <div key={f.label} className="flex items-baseline justify-between gap-6 py-3">
                  <dt className="font-geist text-[14px] text-text-sec">{f.label}</dt>
                  <dd className="text-right font-geist text-[14px] font-medium text-text">{f.learned}</dd>
                </div>
              ))}
            </dl>

            <p className="mt-5 border-t border-border pt-4 font-geist text-[13px] text-text-ter">
              Yours alone, and it grows as you do.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
