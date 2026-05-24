import { Hero } from "@/components/Hero";
import { Testimonials } from "@/components/Testimonials";
import { CtaFooter } from "@/components/CtaFooter";
import { FooterBig } from "@/components/FooterBig";

export default function HomePage(): React.ReactElement {
  return (
    <main>
      <Hero />

      <section className="container mt-12 mb-16 lg:mt-20 lg:mb-24">
        <div className="rounded-xl border border-border bg-bg-card px-5 py-4 flex flex-wrap items-center gap-3 text-[13px]">
          <span className="inline-flex h-2 w-2 rounded-full bg-sage-deep" aria-hidden />
          <span className="text-text font-medium">Pre-launch · free in beta</span>
          <span className="text-text-sec">
            No usage limits, no card. We&apos;re still building — first invite waves rolling now.
          </span>
        </div>
      </section>

      <section className="container mb-20 lg:mb-28">
        <h2 className="text-h2 mb-8 text-balance text-text">What&apos;s in the box</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FrontierCard
            title="Voice + gaze in your editor"
            body="Local Whisper transcribes voice in sub-second. Optional MediaPipe gaze tells eri exactly which element you&apos;re pointing at. The camera frame never leaves your laptop."
            href="/features"
            cta="How voice + gaze works"
          />
          <FrontierCard
            title="Diffusion preview, not streaming tokens"
            body="eri&apos;s engine denoises a working patch while you finish your sentence. The preview becomes the answer — no waiting on a cursor."
            href="/features"
            cta="Inside the engine"
          />
          <FrontierCard
            title="Branchable iteration history"
            body="Every prompt is a node. Fork it, replay it, send the whole branch through a different model. Yesterday&apos;s try is one click away."
            href="/features"
            cta="See iteration history"
          />
        </div>
      </section>

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
