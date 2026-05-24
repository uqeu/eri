import { Hero } from "@/components/Hero";
import { HeroBig } from "@/components/HeroBig";
import { PromptPipeline } from "@/components/PromptPipeline";
import { EngineRoom } from "@/components/EngineRoom";
import { EriDemo } from "@/components/EriDemo";
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
    <section className="container mb-24 lg:mb-32">
      <div className="mb-12 border-t border-border pt-10">
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
        label="II · The pipeline"
        title="Three lazy words. One precise prompt."
        lead="eri reads your gaze, your last few turns, and the file you're actually in — then compiles a prompt the model can act on, and routes it to whichever brain handles that kind of work."
      >
        <PromptPipeline />
      </Chapter>

      <Chapter
        label="III · The engine"
        title="From breath to commit, in one open room."
        lead="A live cross-section. Your voice on the left, the diffusion lattice in the middle settling into code, the rendered patch on the right."
      >
        <EngineRoom />
      </Chapter>

      <Chapter
        label="IV · Iteration"
        title="Branchable, time-travel edits."
        lead="Every prompt is a node. Fork it, replay it, send the whole branch through a different model. Yesterday's try is one click away."
      >
        <EriDemo />
      </Chapter>

      <section className="container mb-24 lg:mb-32">
        <div className="mb-12 border-t border-border pt-10">
          <div className="mono-cap text-text-sec mb-3">V · The platform</div>
          <h2 className="text-h2 text-balance max-w-2xl text-text">
            Quiet underneath. Frontier where it counts.
          </h2>
        </div>
        <div className="divide-y divide-border">
          <PlatformRow
            heading="The model that fits the task."
            body="Claude Opus and Sonnet, GPT-5.5, Gemini 3.1, Grok 4.3 — or eri's own diffusion engine for short edits. Auto-route, or override per prompt. The router lives in your repo, not in a vendor."
            href="/docs/models"
            cta="Explore models"
          />
          <PlatformRow
            heading="Codebase context, not chat history."
            body="eri reads your repo — semantic search, grep, AST awareness — so prompts ground in your code, not generic patterns from training data. The index lives locally."
            href="/docs/context"
            cta="How context works"
          />
          <PlatformRow
            heading="Local-first, BYOK."
            body="Voice and gaze run on your machine. Model calls go to the provider you choose with the key you hold. Your transcripts never leave the laptop unless you point them somewhere they should."
            href="/security"
            cta="Read the security model"
          />
        </div>
      </section>

      <Testimonials />

      <CtaFooter />
      <FooterBig />
    </main>
  );
}

function PlatformRow({
  heading,
  body,
  href,
  cta,
}: {
  heading: string;
  body: string;
  href: string;
  cta: string;
}): React.ReactElement {
  return (
    <div className="py-10 lg:py-14 grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-12">
      <h3 className="lg:col-span-5 text-h3 text-balance text-text">{heading}</h3>
      <div className="lg:col-span-7 text-prose-narrow">
        <p className="text-body text-text-sec">{body}</p>
        <a
          href={href}
          className="mt-4 inline-flex items-center text-[14px] text-text hover:opacity-70 transition-opacity"
        >
          {cta}
          <span className="ml-1.5">→</span>
        </a>
      </div>
    </div>
  );
}
