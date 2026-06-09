import { Hero } from "@/components/Hero";
import { DemoShowcase } from "@/components/DemoShowcase";
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
    <section className="container mb-24 lg:mb-32">
      <div className="mb-10 border-t border-border pt-10">
        <span className="inline-block rounded-full border border-border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-text-sec mb-5">
          Chapter {n}
        </span>
        <h2
          className="text-h2 text-balance max-w-2xl text-text"
          style={{ letterSpacing: "-0.02em", fontWeight: 500 }}
        >
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

export default function HomePage(): React.ReactElement {
  return (
    <main>
      <Hero />

      {/* Click-through demo — its own section with room (no longer crammed
          behind the hero's floating cards). */}
      <section className="container mb-24 lg:mb-32">
        <div className="mb-8 text-center">
          <p className="mono-cap text-text-ter mb-4">See it work</p>
          <h2
            className="text-h2 text-balance mx-auto max-w-2xl text-text"
            style={{ letterSpacing: "-0.02em", fontWeight: 500 }}
          >
            Click through everything eri does.
          </h2>
        </div>
        <div className="mx-auto max-w-5xl">
          <DemoShowcase />
        </div>
      </section>

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
