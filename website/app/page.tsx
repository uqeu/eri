import { Hero } from "@/components/Hero";
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

      <Chapter n={1} title="The loop. Look. Speak. Ship.">
        <HeroBig />
      </Chapter>

      <Chapter n={2} title="Three lazy words. One precise prompt.">
        <PromptPipeline />
      </Chapter>

      <CtaFooter />
      <FooterBig />
    </main>
  );
}
