import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterBig } from "@/components/FooterBig";

export const metadata: Metadata = {
  title: "AI use policy — eri",
  description:
    "How AI outputs work in eri, training stance, hallucination warnings, and your responsibility to read the code.",
};

interface Section {
  readonly heading: string;
  readonly body: string;
}

const SECTIONS: ReadonlyArray<Section> = [
  {
    heading: "1. AI is a tool, not an oracle",
    body: "eri uses AI models — a diffusion code model by default, plus whichever providers you connect — to suggest, draft, and modify code. AI output is statistical, not authoritative. It can be confidently wrong. It can fabricate APIs that don't exist, security advice that's outdated, or behaviour that doesn't match the code it just wrote. Treat every output as a draft from a fast junior developer who never sleeps and has no idea what your code does in production.",
  },
  {
    heading: "2. The operator does not train on your inputs",
    body: "The operator does not collect your prompts, your code, or your voice for training. The eri inference proxy forwards model calls without storing the request or response bodies. If you bring your own provider key, the request goes from your machine to that provider — the operator does not see it. The training stance of any third-party model you connect is governed by that provider's policy (links on /legal/sub-processors).",
  },
  {
    heading: "3. You own the output",
    body: "The operator claims no ownership over AI-generated code produced through eri. Whether AI output is copyrightable in your jurisdiction is a separate question that the law is still figuring out — that's between you, your jurisdiction, and your model provider. The operator takes no position on it.",
  },
  {
    heading: "4. You are responsible for what you ship",
    body: "AI assistance does not change who's accountable for the code that ends up in your product. If eri suggests a SQL query and you ship it, you wrote that query. If eri proposes a security check and you accept it, you implemented that check. Review before commit. Test before deploy. Don't pipe AI output directly into production systems without a human in the loop.",
  },
  {
    heading: "5. Hallucinations and confident wrong answers",
    body: "Large language models hallucinate. eri's UI tries to make suggestions reviewable — diffs, search-and-replace blocks, scoped edits — but it cannot detect when the model is wrong. Pay particular attention to: API call shapes that don't match installed package versions, security-sensitive code (auth, crypto, input validation), code that touches money or PII, and refactors across files where context was clipped. When in doubt, ask the model to cite a source — and verify the source.",
  },
  {
    heading: "6. Bias and harmful output",
    body: "AI models reflect the biases of the data they were trained on. They can produce biased, stereotypical, or otherwise harmful output, especially in code that touches identity, demographics, or moderation. The acceptable-use policy applies to AI output the same way it applies to anything else.",
  },
  {
    heading: "7. Voice, gaze, and the multimodal stuff",
    body: "Voice transcription and gaze tracking run locally on your machine. The raw audio frames and gaze vectors never leave the device. What does leave is the textual prompt that the local pipeline produces — and only when you trigger a model call. Disable any modality you don't want active in Settings → Privacy.",
  },
  {
    heading: "8. Don't use eri for high-stakes decisions without a human",
    body: "eri is not certified for medical, legal, financial, safety-critical, or emergency-response use cases. Don't use it that way. If you're going to anyway, put a qualified human in the loop and verify everything.",
  },
  {
    heading: "9. Reporting model behaviour",
    body: "If a model output in eri is dangerously wrong, biased, or rule-breaking in a way that matters, email abuse@tryeri.ca with the prompt, the output, and what you'd expect instead. The operator can't fix the underlying model, but feedback shapes the prompts and guardrails the eri client wraps around it.",
  },
];

export default function AIPolicyPage() {
  return (
    <main>
      <SiteHeader variant="solid" />

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-20 sm:py-28">
          <p className="text-xs uppercase tracking-[0.25em] text-accent">
            Legal · AI use policy
          </p>
          <h1 className="mt-5 font-display text-4xl sm:text-6xl tracking-tight text-balance">
            Read the code before you ship it.
          </h1>
          <p className="mt-5 text-lg text-muted leading-relaxed">
            How AI outputs work inside eri, what the operator does and does not
            do with your inputs, and the responsibilities that come with using
            a generative tool to write software.
          </p>
          <p className="mt-6 font-mono text-[11px] uppercase tracking-wider text-paper/40">
            Last updated · May 21, 2026
          </p>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <div className="flex flex-col gap-10">
            {SECTIONS.map((section) => (
              <div key={section.heading}>
                <h2 className="font-display text-xl sm:text-2xl tracking-tight text-paper">
                  {section.heading}
                </h2>
                <p className="mt-3 text-muted leading-relaxed">
                  {section.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <FooterBig />
    </main>
  );
}
