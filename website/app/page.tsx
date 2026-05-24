import { Hero } from "@/components/Hero";
import { HeroBig } from "@/components/HeroBig";
import { PromptPipeline } from "@/components/PromptPipeline";
import { Testimonials } from "@/components/Testimonials";
import { CtaFooter } from "@/components/CtaFooter";
import { FooterBig } from "@/components/FooterBig";

interface ChapterProps {
  readonly label: string;
  readonly title: string;
  readonly lead: string;
  readonly children: React.ReactNode;
}

function Chapter({ label, title, lead, children }: ChapterProps): React.ReactElement {
  return (
    <section className="container mb-20 lg:mb-24">
      <div className="mb-10 border-t border-border pt-10">
        <div className="mono-cap text-text-sec mb-3">{label}</div>
        <h2 className="text-h2 text-balance max-w-2xl text-text">{title}</h2>
        <p className="lead text-prose-narrow mt-4">{lead}</p>
      </div>
      {children}
    </section>
  );
}

export default function HomePage(): React.ReactElement {
  return (
    <main>
      <Hero />

      <Chapter
        label="I · The loop"
        title="You look. You speak. eri diffuses the patch."
        lead="Voice and gaze fuse into one prompt. The engine writes the diff under your eye, not into a chat log."
      >
        <HeroBig />
      </Chapter>

      <Chapter
        label="II · The engine"
        title="Three lazy words. One precise prompt."
        lead="eri reads your gaze, your last few turns, and the file you're actually in — then routes the compiled prompt to whichever brain handles that kind of work."
      >
        <PromptPipeline />
      </Chapter>

      <Testimonials />

      <CtaFooter />
      <FooterBig />
    </main>
  );
}
