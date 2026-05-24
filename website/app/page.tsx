import { Hero } from "@/components/Hero";
import { PromptPipeline } from "@/components/PromptPipeline";
import { EngineRoom } from "@/components/EngineRoom";
import { EriDemo } from "@/components/EriDemo";
import { Testimonials } from "@/components/Testimonials";
import { CtaFooter } from "@/components/CtaFooter";
import { FooterBig } from "@/components/FooterBig";

export default function HomePage(): React.ReactElement {
  return (
    <main>
      <Hero />

      <section className="container mt-12 mb-12 lg:mt-20 lg:mb-16">
        <div className="rounded-xl border border-border bg-bg-card px-5 py-4 flex flex-wrap items-center gap-3 text-[13px]">
          <span className="inline-flex h-2 w-2 rounded-full bg-sage-deep" aria-hidden />
          <span className="text-text font-medium">Pre-launch · free in beta</span>
          <span className="text-text-sec">
            No usage limits, no card. We&apos;re still building — first invite waves rolling now.
          </span>
        </div>
      </section>

      {/* The 8-phase context pipeline — INPUT → COMPILE → ROUTE → PREVIEW → WHAT CHANGED */}
      <PromptPipeline />

      {/* Live cross-section of the engine — voice + diffusion + render */}
      <EngineRoom />

      {/* Iteration history demo (coffee-shop landing builder) */}
      <EriDemo />

      <section className="container mb-20 lg:mb-28">
        <h2 className="text-h2 mb-8 text-balance text-text">Stay on the frontier</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FrontierCard
            title="The model that fits the task"
            body="Claude Opus/Sonnet, GPT-5.5, Gemini 3.1, Grok 4.3, or eri&apos;s own diffusion engine for short edits. Auto-route or override per prompt."
            href="/docs/models"
            cta="Explore models"
          />
          <FrontierCard
            title="Codebase context, not chat history"
            body="eri reads your repo — semantic search, grep, AST awareness — so prompts ground in your code, not generic patterns from training data."
            href="/docs/context"
            cta="How context works"
          />
          <FrontierCard
            title="Local-first, BYOK"
            body="Voice and gaze run on your machine. Model calls go to the provider you choose with the key you hold. Your transcripts never leave the laptop."
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

function FrontierCard({
  title,
  body,
  href,
  cta,
}: {
  title: string;
  body: string;
  href: string;
  cta: string;
}): React.ReactElement {
  return (
    <a
      href={href}
      className="block rounded-2xl border border-border bg-bg-card p-6 hover:border-border-strong transition-colors"
    >
      <h3 className="text-h3 mb-2 text-balance text-text">{title}</h3>
      <p className="text-body text-text-sec mb-4">{body}</p>
      <span className="text-sage-deep text-[14px]">{cta} →</span>
    </a>
  );
}
