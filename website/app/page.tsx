import { Hero } from "@/components/Hero";
import { CapabilityPillars } from "@/components/CapabilityPillars";
import { EriWorkbench } from "@/components/EriWorkbench";
import { HeroBig } from "@/components/HeroBig";
import { PromptPipeline } from "@/components/PromptPipeline";
import { CtaFooter } from "@/components/CtaFooter";
import { FooterBig } from "@/components/FooterBig";

interface ChapterProps {
  readonly n: number;
  readonly title: string;
  readonly children: React.ReactNode;
}

function Chapter({ n, title, children }: ChapterProps): React.ReactElement {
  return (
    <section className="relative mb-24 lg:mb-32">
      {/* Ambient lime glow behind the demo — Warp's floating-on-light depth. */}
      <div
        className="section-glow"
        style={{
          background:
            "radial-gradient(42% 46% at 50% 22%, rgba(255,255,255,0.03) 0%, rgba(224,255,79,0.03) 44%, transparent 74%)",
        }}
        aria-hidden
      />
      <div className="container relative">
        <div className="mb-10 pt-10">
          <span className="inline-block rounded-full border border-border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-text-sec mb-5">
            Chapter {n}
          </span>
          <h2
            className="font-display text-h2 text-balance max-w-2xl text-text"
            style={{ letterSpacing: "-0.02em", fontWeight: 500 }}
          >
            {title}
          </h2>
        </div>
        {children}
      </div>
    </section>
  );
}

export default function HomePage(): React.ReactElement {
  return (
    <main>
      <Hero />

      <CapabilityPillars />

      <Chapter n={1} title="It builds, too — a local workbench that ships.">
        <EriWorkbench />
      </Chapter>

      <Chapter n={2} title="Preview, review, checkpoint, ship.">
        <HeroBig />
      </Chapter>

      <Chapter n={3} title="Your whole context. One routed agent turn.">
        <PromptPipeline />
      </Chapter>

      <CtaFooter />
      <FooterBig />
    </main>
  );
}
