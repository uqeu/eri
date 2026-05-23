import { Hero } from "@/components/Hero";
import { LogoWall } from "@/components/LogoWall";
import { FeatureCard } from "@/components/FeatureCard";
import { EngineRoom } from "@/components/EngineRoom";
import { EriDemo } from "@/components/EriDemo";
import { HeroBig } from "@/components/HeroBig";
import { Testimonials } from "@/components/Testimonials";
import { CtaFooter } from "@/components/CtaFooter";
import { FooterBig } from "@/components/FooterBig";

export default function HomePage(): React.ReactElement {
  return (
    <main>
      <Hero />

      <LogoWall />

      <FeatureCard
        eyebrow="01 · voice + gaze"
        title="Speak the edit. Look at what you mean."
        body="Local Whisper transcribes voice in sub-second; an optional MediaPipe gaze layer tells eri exactly which element you're pointing at. The camera frame never leaves your laptop."
        ctaHref="/features"
        ctaLabel="Learn about voice + gaze"
        media={<EngineRoom />}
      />

      <FeatureCard
        eyebrow="02 · diffusion preview"
        title="See the diff resolve, not the tokens stream."
        body="eri's engine denoises a working patch while you finish your sentence. The preview becomes the answer — no waiting on a cursor."
        ctaHref="/features"
        ctaLabel="How diffusion works"
        media={<HeroBig />}
      />

      <FeatureCard
        eyebrow="03 · iteration history"
        title="Branchable, time-travelable edit history."
        body="Every prompt becomes a node. Fork it, replay it, send the whole branch through a different model. The thing you tried yesterday is one click away."
        ctaHref="/features"
        ctaLabel="See iteration history"
        media={<EriDemo />}
      />

      <Testimonials />

      <section className="container mb-20 lg:mb-28">
        <h2 className="text-h2 mb-8 text-balance text-text">Stay on the frontier</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FrontierCard
            title="Use the best model for every task"
            body="Pick from Claude Opus/Sonnet, GPT-5.5, Gemini 3.1, Grok 4.3 — or eri's own diffusion engine for short edits. Auto-route or override per prompt."
            href="/docs/models"
            cta="Explore models"
          />
          <FrontierCard
            title="Codebase context, not just chat history"
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
